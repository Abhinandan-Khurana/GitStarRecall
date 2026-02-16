import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { createGitHubApiClient } from "../github/client";
import type { GitHubStarredRepo, RepoReadmeRecord } from "../github/types";
import { getLocalDatabase } from "../db/client";
import type { ChatMessageRecord, RepoRecord } from "../db/types";
import { chunkRepos } from "../chunking/chunker";
import { Embedder, type EmbeddingBackendPreference } from "../embeddings/Embedder";
import { EmbeddingWorkerPool } from "../embeddings/WorkerPool";
import { float32ToBlob } from "../embeddings/vector";
import type { EmbeddingRecord, SearchResult } from "../db/types";
import { buildSyncPlan } from "../sync/plan";
import { sortChatMessages } from "../chat/order";
import { captureLocalError, captureLocalWarn } from "../observability/localLog";
import SafeMarkdown from "../components/SafeMarkdown";
import {
  formatProviderError,
  getProviderById,
  getProviderDefinitions,
} from "../llm/providers";
import type { LLMProviderDefinition, LLMProviderId } from "../llm/types";

type SearchSession = {
  id: string;
  query: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  results: SearchResult[];
};

type IndexingStatus = {
  phase: string;
  startedAt: number;
  repoTotal: number;
  readmesTarget: number;
  readmesCompleted: number;
  readmesMissing: number;
  readmesFailed: number;
  chunkTotal: number;
  embeddingsCreated: number;
  embeddingTarget: number;
  duplicateEmbeddingHits: number;
};

type ContextAvailabilityDebug = {
  totalResults: number;
  filteredResults: number;
  languagePassCount: number;
  topicPassCount: number;
  recencyPassCount: number;
  invalidUpdatedAtCount: number;
};

type EmbeddingRunMetrics = {
  backendIdentity: string;
  configuredPoolSize: number;
  activePoolSize: number;
  poolDownshifted: boolean;
  poolDownshiftReason: string | null;
  batchCount: number;
  embeddingsProcessed: number;
  embeddingsPerSecond: number;
  avgBatchEmbedLatencyMs: number;
  lastBatchEmbedLatencyMs: number;
  avgDbCheckpointMs: number;
  lastDbCheckpointMs: number;
  checkpointEveryEmbeddings: number;
  checkpointEveryMs: number;
  pendingEmbeddingsSinceCheckpoint: number;
  lastCheckpointAt: number | null;
  queueDepth: number;
  peakQueueDepth: number;
  updatedAt: number;
};

function getPreferredEmbeddingBackend(): EmbeddingBackendPreference {
  const envPreferred = import.meta.env.VITE_EMBEDDING_BACKEND_PREFERRED;
  return envPreferred === "wasm" ? "wasm" : "webgpu";
}

function formatBackendIdentity(params: {
  preferredBackend: EmbeddingBackendPreference;
  selectedBackend: EmbeddingBackendPreference | null;
  fallbackReason: string | null;
}): string {
  const { preferredBackend, selectedBackend, fallbackReason } = params;
  if (selectedBackend == null) {
    return `initializing (preferred: ${preferredBackend})`;
  }
  if (selectedBackend === preferredBackend) {
    return selectedBackend;
  }

  if (fallbackReason) {
    return `${selectedBackend} (fallback from ${preferredBackend}: ${fallbackReason})`;
  }

  return `${selectedBackend} (fallback from ${preferredBackend})`;
}

function formatEmbeddingError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return (
      "Embedding model download failed. Check internet access and CSP connect-src for Hugging Face/CDN hosts. " +
      `Details: ${message}`
    );
  }

  if (lower.includes("memory") || lower.includes("out of memory")) {
    return "Embedding failed due memory pressure. Retry with fewer repos/chunks or close other tabs.";
  }

  return `Embedding failed: ${message}`;
}

function computeContextAvailabilityDebug(
  results: SearchResult[],
  languageFilter: string,
  topicFilter: string,
  updatedWithinDaysFilter: string,
): ContextAvailabilityDebug {
  const now = Date.now();
  let languagePassCount = 0;
  let topicPassCount = 0;
  let recencyPassCount = 0;
  let invalidUpdatedAtCount = 0;

  for (const result of results) {
    const languagePass = languageFilter === "all" || result.language === languageFilter;
    if (languagePass) {
      languagePassCount += 1;
    }

    const topicPass = topicFilter === "all" || result.topics.includes(topicFilter);
    if (topicPass) {
      topicPassCount += 1;
    }

    let recencyPass = true;
    if (updatedWithinDaysFilter !== "all") {
      const days = Number(updatedWithinDaysFilter);
      const updatedAtTs = new Date(result.updatedAt).getTime();
      if (!Number.isFinite(updatedAtTs)) {
        recencyPass = false;
        invalidUpdatedAtCount += 1;
      } else {
        const deltaDays = (now - updatedAtTs) / (1000 * 60 * 60 * 24);
        recencyPass = deltaDays <= days;
      }
    }

    if (recencyPass) {
      recencyPassCount += 1;
    }
  }

  return {
    totalResults: results.length,
    filteredResults: results.filter((result) => {
      if (languageFilter !== "all" && result.language !== languageFilter) {
        return false;
      }
      if (topicFilter !== "all" && !result.topics.includes(topicFilter)) {
        return false;
      }
      if (updatedWithinDaysFilter !== "all") {
        const days = Number(updatedWithinDaysFilter);
        const updatedAtTs = new Date(result.updatedAt).getTime();
        if (!Number.isFinite(updatedAtTs)) {
          return false;
        }
        const deltaDays = (now - updatedAtTs) / (1000 * 60 * 60 * 24);
        if (deltaDays > days) {
          return false;
        }
      }
      return true;
    }).length,
    languagePassCount,
    topicPassCount,
    recencyPassCount,
    invalidUpdatedAtCount,
  };
}

const providerDefinitions = getProviderDefinitions();

function detectDefaultEmbeddingPoolSize(): number {
  const concurrency = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0;
  const deviceMemory =
    typeof navigator !== "undefined" && "deviceMemory" in navigator
      ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
      : 0;

  if (Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4) {
    return 1;
  }
  if (!Number.isFinite(concurrency) || concurrency <= 2) {
    return 1;
  }
  return 2;
}

function getEmbeddingPoolSize(): number {
  const fromEnv = Number(import.meta.env.VITE_EMBEDDING_POOL_SIZE);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.max(1, Math.min(2, Math.trunc(fromEnv)));
  }
  return detectDefaultEmbeddingPoolSize();
}

function getEmbeddingWorkerBatchSize(): number {
  const fromEnv = Number(import.meta.env.VITE_EMBEDDING_WORKER_BATCH_SIZE);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.max(1, Math.min(32, Math.trunc(fromEnv)));
  }
  return 8;
}

function mapStarredRepoToRecord(repo: GitHubStarredRepo, syncedAt: number): RepoRecord {
  return {
    id: repo.id,
    fullName: repo.full_name,
    name: repo.name,
    description: repo.description,
    topics: repo.topics ?? [],
    language: repo.language,
    htmlUrl: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    updatedAt: repo.updated_at,
    readmeUrl: null,
    readmeText: null,
    checksum: null,
    lastSyncedAt: syncedAt,
  };
}

export default function UsagePage() {
  const { accessToken, isAuthenticated, authMethod, loginWithPat, beginOAuthLogin, oauthConfig, logout } =
    useAuth();
  const navigate = useNavigate();
  const [patToken, setPatToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fetchingStars, setFetchingStars] = useState(false);
  const [fetchPhase, setFetchPhase] = useState<string | null>(null);
  const [indexingStatus, setIndexingStatus] = useState<IndexingStatus | null>(null);
  const [embeddingRunMetrics, setEmbeddingRunMetrics] = useState<EmbeddingRunMetrics | null>(null);
  const [starsSummary, setStarsSummary] = useState<string | null>(null);
  const [dbStorageMode, setDbStorageMode] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SearchSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionMessagesById, setSessionMessagesById] = useState<Record<string, ChatMessageRecord[]>>({});
  const [sessionMode, setSessionMode] = useState<"new" | "continue">("new");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [topicFilter, setTopicFilter] = useState("all");
  const [updatedWithinDaysFilter, setUpdatedWithinDaysFilter] = useState("all");
  const [providerId, setProviderId] = useState<LLMProviderId>("openai-compatible");
  const [providerBaseUrl, setProviderBaseUrl] = useState(
    providerDefinitions.find((provider) => provider.id === "openai-compatible")?.defaultBaseUrl ??
      "https://api.openai.com",
  );
  const [providerModel, setProviderModel] = useState(
    providerDefinitions.find((provider) => provider.id === "openai-compatible")?.defaultModel ??
      "gpt-4o-mini",
  );
  const [providerApiKey, setProviderApiKey] = useState("");
  const [allowRemoteProvider, setAllowRemoteProvider] = useState(false);
  const [allowLocalProvider, setAllowLocalProvider] = useState(false);
  const [llmPrompt, setLlmPrompt] = useState("");
  const [llmAnswer, setLlmAnswer] = useState("");
  const [llmError, setLlmError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const generationControllerRef = useRef<AbortController | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const selectedProvider = useMemo<LLMProviderDefinition>(() => {
    return (
      providerDefinitions.find((provider) => provider.id === providerId) ?? providerDefinitions[0]
    );
  }, [providerId]);

  const activeResults = useMemo(() => activeSession?.results ?? [], [activeSession]);
  const activeSessionMessages = useMemo(() => {
    if (!activeSessionId) {
      return [];
    }

    return sessionMessagesById[activeSessionId] ?? [];
  }, [activeSessionId, sessionMessagesById]);

  const availableLanguages = useMemo(() => {
    return Array.from(
      new Set(activeResults.map((result) => result.language).filter((value): value is string => Boolean(value))),
    ).sort((a, b) => a.localeCompare(b));
  }, [activeResults]);

  const availableTopics = useMemo(() => {
    return Array.from(
      new Set(activeResults.flatMap((result) => result.topics)),
    ).sort((a, b) => a.localeCompare(b));
  }, [activeResults]);

  const filteredResults = useMemo(() => {
    const now = Date.now();
    return activeResults.filter((result) => {
      if (languageFilter !== "all" && result.language !== languageFilter) {
        return false;
      }

      if (topicFilter !== "all" && !result.topics.includes(topicFilter)) {
        return false;
      }

      if (updatedWithinDaysFilter !== "all") {
        const days = Number(updatedWithinDaysFilter);
        const updatedAtTs = new Date(result.updatedAt).getTime();
        if (!Number.isFinite(updatedAtTs)) {
          return false;
        }

        const deltaDays = (now - updatedAtTs) / (1000 * 60 * 60 * 24);
        if (deltaDays > days) {
          return false;
        }
      }

      return true;
    });
  }, [activeResults, languageFilter, topicFilter, updatedWithinDaysFilter]);

  useEffect(() => {
    let cancelled = false;

    const loadPersistedSessions = async () => {
      const database = await getLocalDatabase();
      const persistedSessions = database.listChatSessions().map((session) => {
        const title = session.query.length > 48 ? `${session.query.slice(0, 48)}…` : session.query;
        return {
          id: session.id,
          query: session.query,
          title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          results: [],
        } satisfies SearchSession;
      });

      const messagesById: Record<string, ChatMessageRecord[]> = {};
      for (const session of persistedSessions) {
        messagesById[session.id] = sortChatMessages(database.listChatMessages(session.id));
      }

      if (cancelled) {
        return;
      }

      setSessions(persistedSessions);
      setSessionMessagesById(messagesById);
      if (persistedSessions.length > 0) {
        setActiveSessionId((previous) => previous ?? persistedSessions[0].id);
        setSessionMode("continue");
      }
    };

    void loadPersistedSessions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const flushPendingCheckpoint = () => {
      void getLocalDatabase()
        .then((database) => database.flushPendingEmbeddingCheckpoint())
        .catch(() => {
          // best effort during page lifecycle transitions
        });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingCheckpoint();
      }
    };

    window.addEventListener("pagehide", flushPendingCheckpoint);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushPendingCheckpoint);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const handleProviderChange = (nextProviderId: LLMProviderId) => {
    const nextProvider =
      providerDefinitions.find((provider) => provider.id === nextProviderId) ?? providerDefinitions[0];
    setProviderId(nextProviderId);
    setProviderBaseUrl(nextProvider.defaultBaseUrl);
    setProviderModel(nextProvider.defaultModel);
    setLlmError(null);
  };

  const handlePatLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      loginWithPat(patToken);
      setError(null);
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "PAT login failed");
    }
  };

  const handleOAuth = async () => {
    try {
      setError(null);
      await beginOAuthLogin();
    } catch (err) {
      captureLocalError("oauth_login_start_failed", err);
      setError(err instanceof Error ? err.message : "Unable to start OAuth");
    }
  };

  const syncStarsToLocal = async (
    database: Awaited<ReturnType<typeof getLocalDatabase>>,
    source: "manual" | "query",
  ): Promise<void> => {
    if (!accessToken) {
      throw new Error("No access token is available.");
    }

    setIndexingStatus({
      phase: source === "manual" ? "Fetching starred repos" : "Refreshing stars before query",
      startedAt: Date.now(),
      repoTotal: 0,
      readmesTarget: 0,
      readmesCompleted: 0,
      readmesMissing: 0,
      readmesFailed: 0,
      chunkTotal: 0,
      embeddingsCreated: 0,
      embeddingTarget: 0,
      duplicateEmbeddingHits: 0,
    });
    setEmbeddingRunMetrics(null);
    setFetchPhase("Fetching starred repos…");

    const client = createGitHubApiClient({ accessToken });
    const existingStates = database.listRepoSyncState();
    const existingById = new Map(existingStates.map((repo) => [repo.id, repo]));
    const previousRepoIds = existingStates.map((repo) => repo.id);

    const starResult = await client.fetchAllStarredRepos({
      previousRepoIds,
      onProgress: (progress) => {
        setFetchPhase(
          `Fetching starred repos… page ${progress.fetchedPages}, total repos ${progress.totalReposSoFar}`,
        );
        setIndexingStatus((previous) =>
          previous
            ? {
                ...previous,
                phase: `Fetching starred repos (page ${progress.fetchedPages})`,
                repoTotal: progress.totalReposSoFar,
              }
            : previous,
        );
      },
    });
    const syncedAt = Date.now();
    const syncPlan = buildSyncPlan(existingStates, starResult.repos);

    setIndexingStatus((previous) =>
      previous
        ? {
            ...previous,
            phase: "Diffing repos with checksum state",
            repoTotal: starResult.repos.length,
          }
        : previous,
    );

    if (syncPlan.removedRepoIds.length > 0) {
      await database.deleteReposByIds(syncPlan.removedRepoIds);
    }

    const candidateIds = new Set(syncPlan.candidateRepoIds);
    const candidates = starResult.repos.filter((repo) => candidateIds.has(repo.id));

    setIndexingStatus((previous) =>
      previous
        ? {
            ...previous,
            phase: `Fetching READMEs for changed/new repos (${candidates.length})`,
            readmesTarget: candidates.length,
            readmesCompleted: 0,
            readmesMissing: 0,
            readmesFailed: 0,
          }
        : previous,
    );

    const readmeResult = await client.fetchReadmes(candidates, {
      onProgress: (progress) => {
        setIndexingStatus((previous) =>
          previous
            ? {
                ...previous,
                readmesCompleted: progress.completed,
                readmesMissing: progress.missingCount,
                readmesFailed: progress.failedCount,
              }
            : previous,
        );
        setFetchPhase(`Fetching changed READMEs… ${progress.completed}/${progress.total}`);
      },
    });

    const readmeByRepoId = new Map<number, RepoReadmeRecord>();
    for (const record of readmeResult.records) {
      readmeByRepoId.set(record.repoId, record);
    }

    setIndexingStatus((previous) =>
      previous
        ? {
            ...previous,
            readmesTarget: candidates.length,
            readmesCompleted: candidates.length,
            readmesMissing: readmeResult.missingCount,
            readmesFailed: readmeResult.failedCount,
          }
        : previous,
    );

    const changedRecords: RepoRecord[] = [];
    for (const repo of candidates) {
      const readme = readmeByRepoId.get(repo.id);
      if (!readme) {
        continue;
      }

      const record = mapStarredRepoToRecord(repo, syncedAt);
      record.readmeUrl = readme.readmeUrl;
      record.readmeText = readme.readmeText;
      record.checksum = readme.checksum;

      const local = existingById.get(repo.id);
      if (!local || local.checksum !== record.checksum) {
        changedRecords.push(record);
      }
    }

    if (changedRecords.length > 0) {
      await database.upsertRepos(changedRecords);
      await database.deleteChunksByRepoIds(changedRecords.map((repo) => repo.id));

      setFetchPhase("Chunking changed repos…");
      setIndexingStatus((previous) =>
        previous
          ? {
              ...previous,
              phase: "Chunking changed repositories",
            }
          : previous,
      );

      const chunks = chunkRepos(changedRecords);
      await database.upsertChunks(chunks);
      setIndexingStatus((previous) =>
        previous
          ? {
              ...previous,
              chunkTotal: chunks.length,
            }
          : previous,
      );
    }

    await database.upsertIndexMeta({
      key: "last_star_sync_at",
      value: String(Date.now()),
      updatedAt: Date.now(),
    });
    await database.upsertIndexMeta({
      key: "last_star_sync_summary",
      value: JSON.stringify({
        source,
        totalRepos: starResult.repos.length,
        removedRepos: syncPlan.removedRepoIds.length,
        candidateRepos: candidates.length,
        changedRepos: changedRecords.length,
        fetchedPages: starResult.fetchedPages,
      }),
      updatedAt: Date.now(),
    });

    setDbStorageMode(database.storageMode);
    const localRepoCount = database.getRepoCount();
    const localChunkCount = database.getChunkCount();
    const localEmbeddingCount = database.getEmbeddingCount();
    const readmeCount = readmeResult.records.length - readmeResult.missingCount - readmeResult.failedCount;
    const hasPendingEmbeddingChunks = database.getChunksToEmbed(1).length > 0;
    setIndexingStatus((previous) =>
      previous
        ? {
            ...previous,
            phase: hasPendingEmbeddingChunks ? "Preparing embeddings for unindexed chunks" : "Sync complete",
            repoTotal: starResult.repos.length,
            readmesTarget: candidates.length,
            readmesCompleted: candidates.length,
            readmesMissing: readmeResult.missingCount,
            readmesFailed: readmeResult.failedCount,
            chunkTotal: localChunkCount,
            embeddingsCreated: localEmbeddingCount,
            embeddingTarget: hasPendingEmbeddingChunks ? previous.embeddingTarget : 0,
          }
        : previous,
    );

    setStarsSummary(
      `Sync complete: ${starResult.repos.length} stars scanned (${starResult.fetchedPages} pages), ` +
        `${changedRecords.length} changed/new, ${syncPlan.removedRepoIds.length} removed. ` +
        `READMEs fetched: ${readmeCount}, missing: ${readmeResult.missingCount}, failed: ${readmeResult.failedCount}. ` +
        `Local DB: ${localRepoCount} repos, ${localChunkCount} chunks, ${localEmbeddingCount} embeddings.`,
    );

    if (hasPendingEmbeddingChunks) {
      await generateEmbeddings(database);
    }
  };

  const handleFetchStars = async () => {
    if (!accessToken) {
      setError("No access token is available.");
      return;
    }

    try {
      setFetchingStars(true);
      setError(null);
      const database = await getLocalDatabase();
      await syncStarsToLocal(database, "manual");
    } catch (err) {
      captureLocalError("fetch_stars_failed", err);
      setIndexingStatus((previous) =>
        previous
          ? {
              ...previous,
              phase: `Failed: ${err instanceof Error ? err.message : "Unknown error"}`,
            }
          : previous,
      );
      setError(err instanceof Error ? err.message : "Failed to fetch starred repos");
    } finally {
      setFetchingStars(false);
      setFetchPhase(null);
    }
  };

  const generateEmbeddings = async (database: Awaited<ReturnType<typeof getLocalDatabase>>) => {
    let embedder: Embedder | null = null;
    let embeddingPool: EmbeddingWorkerPool | null = null;
    try {
      setFetchPhase("Initializing embedding model (this may take a moment)…");
      setIndexingStatus((previous) =>
        previous
          ? {
              ...previous,
              phase: "Initializing embedding model",
            }
          : previous,
      );

      const preferredBackend = getPreferredEmbeddingBackend();
      embedder = new Embedder({ preferredBackend });
      embeddingPool = new EmbeddingWorkerPool({
        poolSize: getEmbeddingPoolSize(),
        workerBatchSize: getEmbeddingWorkerBatchSize(),
        preferredBackend,
      });
      const BATCH_SIZE = 16;
      const initialPoolStatus = embeddingPool.getStatus();
      const initialBackendIdentity = formatBackendIdentity({
        preferredBackend: initialPoolStatus.preferredBackend,
        selectedBackend: initialPoolStatus.selectedBackend,
        fallbackReason: initialPoolStatus.backendFallbackReason,
      });
      const totalChunkCount = database.getChunkCount();
      const initialEmbeddingCount = database.getEmbeddingCount();
      const embeddingTarget = Math.max(totalChunkCount - initialEmbeddingCount, 0);
      let processedCount = 0;
      let duplicateHits = 0;
      let batchCount = 0;
      let totalBatchEmbedLatencyMs = 0;
      let totalDbCheckpointMs = 0;
      let lastBatchEmbedLatencyMs = 0;
      let lastDbCheckpointMs = 0;
      const localEmbeddingCache = new Map<string, Float32Array>();
      const startMs = Date.now();
      const initialCheckpointStatus = database.getEmbeddingCheckpointStatus();
      let peakQueueDepth = database.getPendingEmbeddingChunkCount();
      setIndexingStatus((previous) =>
        previous
          ? {
              ...previous,
              phase: "Generating embeddings",
              embeddingTarget,
            }
            : previous,
      );
      setEmbeddingRunMetrics({
        backendIdentity: initialBackendIdentity,
        configuredPoolSize: initialPoolStatus.configuredPoolSize,
        activePoolSize: initialPoolStatus.activePoolSize,
        poolDownshifted: initialPoolStatus.downshifted,
        poolDownshiftReason: initialPoolStatus.downshiftReason,
        batchCount: 0,
        embeddingsProcessed: 0,
        embeddingsPerSecond: 0,
        avgBatchEmbedLatencyMs: 0,
        lastBatchEmbedLatencyMs: 0,
        avgDbCheckpointMs: 0,
        lastDbCheckpointMs: 0,
        checkpointEveryEmbeddings: initialCheckpointStatus.everyEmbeddings,
        checkpointEveryMs: initialCheckpointStatus.everyMs,
        pendingEmbeddingsSinceCheckpoint: initialCheckpointStatus.pendingEmbeddings,
        lastCheckpointAt: initialCheckpointStatus.lastCheckpointAt,
        queueDepth: peakQueueDepth,
        peakQueueDepth,
        updatedAt: Date.now(),
      });

      // Process embeddings incrementally so partial results are searchable quickly.
      while (true) {
        const chunks = database.getChunksToEmbed(BATCH_SIZE);
        if (chunks.length === 0) {
          break;
        }

        const batchEmbedStart = performance.now();

        setFetchPhase(
          `Generating embeddings… ${processedCount}/${embeddingTarget} completed`,
        );

        const embeddingRecords: EmbeddingRecord[] = [];
        const uncachedItems: Array<{ chunkId: string; text: string }> = [];

        for (const chunk of chunks) {
          const cachedVector = localEmbeddingCache.get(chunk.text);
          if (cachedVector) {
            duplicateHits += 1;
            embeddingRecords.push({
              id: crypto.randomUUID(),
              chunkId: chunk.id,
              model: "Xenova/all-MiniLM-L6-v2",
              dimension: cachedVector.length,
              vectorBlob: float32ToBlob(cachedVector),
              createdAt: Date.now(),
            });
          } else {
            uncachedItems.push({
              chunkId: chunk.id,
              text: chunk.text,
            });
          }
        }

        if (uncachedItems.length > 0) {
          const batchResults = await embeddingPool.embedBatch(uncachedItems.map((item) => item.text));
          if (batchResults.length !== uncachedItems.length) {
            throw new Error(
              `embedding batch result length mismatch: expected ${uncachedItems.length}, got ${batchResults.length}`,
            );
          }

          for (let i = 0; i < uncachedItems.length; i += 1) {
            const item = uncachedItems[i];
            const batchItem = batchResults[i];
            let vector = batchItem.embedding;

            // Per-item fallback: retry failed batch entry as a single embedding request.
            if (!vector || batchItem.error) {
              try {
                vector = await embedder.embed(item.text);
                captureLocalWarn(
                  "embedding_batch_item_recovered",
                  `chunk_id=${item.chunkId}; reason=${batchItem.error ?? "missing embedding in batch response"}`,
                );
              } catch (singleErr) {
                throw new Error(
                  `embedding batch item failed for chunk ${item.chunkId}: ${batchItem.error ?? "unknown"}; ` +
                    `single_retry=${singleErr instanceof Error ? singleErr.message : String(singleErr)}`,
                );
              }
            }

            if (localEmbeddingCache.size < 4_000) {
              localEmbeddingCache.set(item.text, vector);
            }

            embeddingRecords.push({
              id: crypto.randomUUID(),
              chunkId: item.chunkId,
              model: "Xenova/all-MiniLM-L6-v2",
              dimension: vector.length,
              vectorBlob: float32ToBlob(vector),
              createdAt: Date.now(),
            });
          }
        }

        const batchEmbedLatencyMs = performance.now() - batchEmbedStart;
        const checkpointStart = performance.now();
        await database.upsertEmbeddings(embeddingRecords);
        const dbCheckpointMs = performance.now() - checkpointStart;
        processedCount += chunks.length;
        batchCount += 1;
        totalBatchEmbedLatencyMs += batchEmbedLatencyMs;
        totalDbCheckpointMs += dbCheckpointMs;
        lastBatchEmbedLatencyMs = batchEmbedLatencyMs;
        lastDbCheckpointMs = dbCheckpointMs;
        const elapsedSeconds = Math.max((Date.now() - startMs) / 1000, 1);
        const speed = processedCount / elapsedSeconds;
        const remaining = Math.max(embeddingTarget - processedCount, 0);
        const etaSeconds = speed > 0 ? Math.ceil(remaining / speed) : 0;
        const queueDepth = database.getPendingEmbeddingChunkCount();
        const checkpointStatus = database.getEmbeddingCheckpointStatus();
        const poolStatus = embeddingPool.getStatus();
        const backendIdentity = formatBackendIdentity({
          preferredBackend: poolStatus.preferredBackend,
          selectedBackend: poolStatus.selectedBackend,
          fallbackReason: poolStatus.backendFallbackReason,
        });
        peakQueueDepth = Math.max(peakQueueDepth, queueDepth);
        setIndexingStatus((previous) =>
          previous
            ? {
                ...previous,
                phase: "Generating embeddings",
                embeddingsCreated: processedCount,
                embeddingTarget,
                duplicateEmbeddingHits: duplicateHits,
              }
            : previous,
        );
        setStarsSummary(
          `Indexing in progress: ${processedCount}/${embeddingTarget} embeddings ` +
            `(cache hits: ${duplicateHits}, ~${Math.max(0, etaSeconds)}s remaining).`,
        );
        setEmbeddingRunMetrics({
          backendIdentity,
          configuredPoolSize: poolStatus.configuredPoolSize,
          activePoolSize: poolStatus.activePoolSize,
          poolDownshifted: poolStatus.downshifted,
          poolDownshiftReason: poolStatus.downshiftReason,
          batchCount,
          embeddingsProcessed: processedCount,
          embeddingsPerSecond: speed,
          avgBatchEmbedLatencyMs: totalBatchEmbedLatencyMs / batchCount,
          lastBatchEmbedLatencyMs,
          avgDbCheckpointMs: totalDbCheckpointMs / batchCount,
          lastDbCheckpointMs,
          checkpointEveryEmbeddings: checkpointStatus.everyEmbeddings,
          checkpointEveryMs: checkpointStatus.everyMs,
          pendingEmbeddingsSinceCheckpoint: checkpointStatus.pendingEmbeddings,
          lastCheckpointAt: checkpointStatus.lastCheckpointAt,
          queueDepth,
          peakQueueDepth,
          updatedAt: Date.now(),
        });

        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      }

      const finalRepoCount = database.getRepoCount();
      const finalChunkCount = database.getChunkCount();
      const finalEmbeddingCount = database.getEmbeddingCount();
      const totalDurationSec = Math.max(Math.round((Date.now() - startMs) / 1000), 1);
      setIndexingStatus((previous) =>
        previous
          ? {
              ...previous,
              phase: "Indexing complete",
              embeddingsCreated: processedCount,
              embeddingTarget,
              duplicateEmbeddingHits: duplicateHits,
            }
          : previous,
      );

      setStarsSummary(
        `Sync complete in ${totalDurationSec}s. ` +
          `Repos: ${finalRepoCount}, Chunks: ${finalChunkCount}, Embeddings: ${finalEmbeddingCount} ` +
          `(new: ${processedCount}, cache hits: ${duplicateHits}).`,
      );
      const finalElapsedSeconds = Math.max((Date.now() - startMs) / 1000, 1);
      const finalQueueDepth = database.getPendingEmbeddingChunkCount();
      await database.flushPendingEmbeddingCheckpoint();
      const finalCheckpointStatus = database.getEmbeddingCheckpointStatus();
      const finalPoolStatus = embeddingPool.getStatus();
      const finalBackendIdentity = formatBackendIdentity({
        preferredBackend: finalPoolStatus.preferredBackend,
        selectedBackend: finalPoolStatus.selectedBackend,
        fallbackReason: finalPoolStatus.backendFallbackReason,
      });
      const finalMetrics: EmbeddingRunMetrics = {
        backendIdentity: finalBackendIdentity,
        configuredPoolSize: finalPoolStatus.configuredPoolSize,
        activePoolSize: finalPoolStatus.activePoolSize,
        poolDownshifted: finalPoolStatus.downshifted,
        poolDownshiftReason: finalPoolStatus.downshiftReason,
        batchCount,
        embeddingsProcessed: processedCount,
        embeddingsPerSecond: processedCount / finalElapsedSeconds,
        avgBatchEmbedLatencyMs: batchCount > 0 ? totalBatchEmbedLatencyMs / batchCount : 0,
        lastBatchEmbedLatencyMs,
        avgDbCheckpointMs: batchCount > 0 ? totalDbCheckpointMs / batchCount : 0,
        lastDbCheckpointMs,
        checkpointEveryEmbeddings: finalCheckpointStatus.everyEmbeddings,
        checkpointEveryMs: finalCheckpointStatus.everyMs,
        pendingEmbeddingsSinceCheckpoint: finalCheckpointStatus.pendingEmbeddings,
        lastCheckpointAt: finalCheckpointStatus.lastCheckpointAt,
        queueDepth: finalQueueDepth,
        peakQueueDepth,
        updatedAt: Date.now(),
      };
      setEmbeddingRunMetrics(finalMetrics);
      captureLocalWarn(
        "embedding_instrumentation_run",
        JSON.stringify({
          backendIdentity: finalMetrics.backendIdentity,
          configuredPoolSize: finalMetrics.configuredPoolSize,
          activePoolSize: finalMetrics.activePoolSize,
          poolDownshifted: finalMetrics.poolDownshifted,
          poolDownshiftReason: finalMetrics.poolDownshiftReason,
          batchCount: finalMetrics.batchCount,
          embeddingsProcessed: finalMetrics.embeddingsProcessed,
          embeddingsPerSecond: Number(finalMetrics.embeddingsPerSecond.toFixed(2)),
          avgBatchEmbedLatencyMs: Number(finalMetrics.avgBatchEmbedLatencyMs.toFixed(2)),
          avgDbCheckpointMs: Number(finalMetrics.avgDbCheckpointMs.toFixed(2)),
          checkpointEveryEmbeddings: finalMetrics.checkpointEveryEmbeddings,
          checkpointEveryMs: finalMetrics.checkpointEveryMs,
          pendingEmbeddingsSinceCheckpoint: finalMetrics.pendingEmbeddingsSinceCheckpoint,
          lastCheckpointAt: finalMetrics.lastCheckpointAt,
          peakQueueDepth: finalMetrics.peakQueueDepth,
        }),
      );
    } catch (err) {
      console.error("Embedding generation failed", err);
      captureLocalError("embedding_generation_failed", err);
      setError(formatEmbeddingError(err));
    } finally {
      embedder?.terminate();
      embeddingPool?.terminate();
    }
  };

  const handleClearLocalData = async () => {
    try {
      const database = await getLocalDatabase();
      await database.clearAllData();
      setStarsSummary("Local database cleared.");
      setIndexingStatus(null);
      setSessions([]);
      setSessionMessagesById({});
      setActiveSessionId(null);
      setSessionMode("new");
      setDbStorageMode(database.storageMode);
      setError(null);
    } catch (err) {
      captureLocalError("clear_local_data_failed", err);
      setError(err instanceof Error ? err.message : "Failed to clear local database");
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      setIsSearching(true);
      setSearchProgress("Preparing search query…");
      setError(null);

      const database = await getLocalDatabase();
      if (accessToken) {
        setSearchProgress("Syncing starred repos before retrieval…");
        await syncStarsToLocal(database, "query");
      }

      const embedder = new Embedder();

      // 1. Generate embedding for query
      setSearchProgress("Generating query embedding…");
      const vector = await embedder.embed(searchQuery);
      embedder.terminate();

      // 2. Search DB
      setSearchProgress("Running semantic search…");
      const results = await database.findSimilarChunks(vector, 20); // Top 20
      const trimmedQuery = searchQuery.trim();
      const now = Date.now();

      const continuingSession =
        sessionMode === "continue" && activeSessionId
          ? sessions.find((session) => session.id === activeSessionId) ?? null
          : null;

      const targetSessionId = continuingSession?.id ?? crypto.randomUUID();
      const targetSessionQuery =
        continuingSession?.query && continuingSession.query.trim().length > 0
          ? continuingSession.query
          : trimmedQuery;
      const continuingCreatedAt = Number(continuingSession?.createdAt);
      const targetSessionCreatedAt =
        Number.isFinite(continuingCreatedAt) && continuingCreatedAt > 0
          ? Math.trunc(continuingCreatedAt)
          : now;
      const targetSessionTitle =
        targetSessionQuery.length > 48 ? `${targetSessionQuery.slice(0, 48)}…` : targetSessionQuery;

      await database.upsertChatSession({
        id: targetSessionId,
        query: targetSessionQuery,
        createdAt: targetSessionCreatedAt,
        updatedAt: now,
      });

      const sequence = database.getNextChatMessageSequence(targetSessionId);
      const userMessage: ChatMessageRecord = {
        id: crypto.randomUUID(),
        sessionId: targetSessionId,
        role: "user",
        content: trimmedQuery,
        sequence,
        createdAt: now,
      };
      await database.addChatMessage(userMessage);

      setSessions((previous) => {
        const existingIndex = previous.findIndex((session) => session.id === targetSessionId);
        const nextSession: SearchSession = {
          id: targetSessionId,
          query: targetSessionQuery,
          title: targetSessionTitle,
          createdAt: targetSessionCreatedAt,
          updatedAt: now,
          results,
        };

        if (existingIndex === -1) {
          return [nextSession, ...previous];
        }

        const updated = [...previous];
        updated[existingIndex] = nextSession;
        updated.sort((a, b) => b.updatedAt - a.updatedAt);
        return updated;
      });

      setSessionMessagesById((previous) => {
        const current = previous[targetSessionId] ?? [];
        return {
          ...previous,
          [targetSessionId]: sortChatMessages([...current, userMessage]),
        };
      });

      setActiveSessionId(targetSessionId);
      setSessionMode("continue");
      setLanguageFilter("all");
      setTopicFilter("all");
      setUpdatedWithinDaysFilter("all");
    } catch (err) {
      console.error("Search failed", err);
      captureLocalError("search_failed", err);
      setIndexingStatus((previous) =>
        previous
          ? {
              ...previous,
              phase: `Failed: ${err instanceof Error ? err.message : "Unknown error"}`,
            }
          : previous,
      );
      setError(err instanceof Error ? "Search failed: " + err.message : "Search failed");
    } finally {
      setIsSearching(false);
      setSearchProgress(null);
    }
  };

  const handleGenerateAnswer = async () => {
    if (!activeSession) {
      setLlmError("No active session. Run a search first.");
      return;
    }

    if (!llmPrompt.trim()) {
      setLlmError("Prompt is required.");
      return;
    }

    if (selectedProvider.kind === "remote" && !allowRemoteProvider) {
      setLlmError("Enable remote provider consent before generating.");
      return;
    }

    if (selectedProvider.kind === "local" && !allowLocalProvider) {
      setLlmError("Enable local provider consent before generating.");
      return;
    }

    if (selectedProvider.requiresApiKey && !providerApiKey.trim()) {
      setLlmError("API key is required for the selected provider.");
      return;
    }

    const snippets = filteredResults.slice(0, 8).map((result) => {
      return `${result.repoFullName}\n${result.text}`;
    });

    if (snippets.length === 0) {
      const debug = computeContextAvailabilityDebug(
        activeResults,
        languageFilter,
        topicFilter,
        updatedWithinDaysFilter,
      );
      const debugMessage =
        debug.totalResults === 0
          ? `No context available. Active session has 0 retrieved results. session_id=${activeSession.id}. ` +
            "Run Search first to populate context."
          : "No context available after filtering. " +
            `session_id=${activeSession.id}; total_results=${debug.totalResults}; ` +
            `filtered_results=${debug.filteredResults}; ` +
            `filters={language:${languageFilter},topic:${topicFilter},updatedWithinDays:${updatedWithinDaysFilter}}; ` +
            `pass_counts={language:${debug.languagePassCount},topic:${debug.topicPassCount},recency:${debug.recencyPassCount},invalidUpdatedAt:${debug.invalidUpdatedAtCount}}. ` +
            "Set filters to all or run a new search.";
      captureLocalError("llm_no_context_available", new Error(debugMessage));
      setLlmError(debugMessage);
      return;
    }

    try {
      setLlmError(null);
      setLlmAnswer("");
      setIsGenerating(true);
      let streamedAnswer = "";
      const controller = new AbortController();
      generationControllerRef.current = controller;

      const provider = getProviderById(providerId);
      await provider.stream(
        {
          baseUrl: providerBaseUrl.trim(),
          model: providerModel.trim(),
          apiKey: providerApiKey.trim(),
        },
        {
          prompt: llmPrompt.trim(),
          contextSnippets: snippets,
          signal: controller.signal,
          onToken: (token) => {
            streamedAnswer += token;
            setLlmAnswer((previous) => previous + token);
          },
        },
      );

      if (activeSessionId && streamedAnswer.trim()) {
        const database = await getLocalDatabase();
        const sequence = database.getNextChatMessageSequence(activeSessionId);
        const assistantMessage: ChatMessageRecord = {
          id: crypto.randomUUID(),
          sessionId: activeSessionId,
          role: "assistant",
          content: streamedAnswer,
          sequence,
          createdAt: Date.now(),
        };
        await database.addChatMessage(assistantMessage);
        setSessionMessagesById((previous) => {
          const current = previous[activeSessionId] ?? [];
          return {
            ...previous,
            [activeSessionId]: sortChatMessages([...current, assistantMessage]),
          };
        });
      }
    } catch (err) {
      captureLocalError("llm_generation_failed", err);
      setLlmError(formatProviderError(err, selectedProvider.kind));
    } finally {
      setIsGenerating(false);
      generationControllerRef.current = null;
    }
  };

  const handleCancelGeneration = () => {
    generationControllerRef.current?.abort();
  };

  return (
    <section className="space-y-6">
      <h2 className="font-display text-3xl text-white">Usage Console</h2>
      {isAuthenticated ? (
        <div className="space-y-4">
          {error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-sm text-mist/70">Search your stars</p>
            <div className="mt-3 flex items-center gap-3">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-sm text-white focus:border-mint focus:outline-none"
                placeholder="e.g. vector database in browser"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSearch();
                }}
              />
              <button
                className="rounded-lg bg-mint px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
                onClick={() => void handleSearch()}
                disabled={isSearching}
              >
                {isSearching ? "..." : "Search"}
              </button>
              <button
                className="rounded-lg border border-cyan/60 px-4 py-2 text-sm font-semibold text-cyan disabled:opacity-50"
                onClick={() => {
                  void handleFetchStars();
                }}
                disabled={fetchingStars}
              >
                {fetchingStars ? (fetchPhase ?? "Fetching…") : "Fetch Stars"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-mist/80">
              <span className="text-mist/60">Session mode:</span>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="session-mode"
                  checked={sessionMode === "new"}
                  onChange={() => setSessionMode("new")}
                />
                New session
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="session-mode"
                  checked={sessionMode === "continue"}
                  onChange={() => setSessionMode("continue")}
                  disabled={!activeSessionId}
                />
                Continue active session
              </label>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <select
                value={languageFilter}
                onChange={(event) => {
                  setLanguageFilter(event.target.value);
                }}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-mist"
              >
                <option value="all">All languages</option>
                {availableLanguages.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
              <select
                value={topicFilter}
                onChange={(event) => {
                  setTopicFilter(event.target.value);
                }}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-mist"
              >
                <option value="all">All topics</option>
                {availableTopics.map((topic) => (
                  <option key={topic} value={topic}>
                    {topic}
                  </option>
                ))}
              </select>
              <select
                value={updatedWithinDaysFilter}
                onChange={(event) => {
                  setUpdatedWithinDaysFilter(event.target.value);
                }}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-mist"
              >
                <option value="all">Any updated date</option>
                <option value="30">Updated in last 30 days</option>
                <option value="90">Updated in last 90 days</option>
                <option value="365">Updated in last year</option>
              </select>
            </div>
            {searchProgress ? <p className="mt-2 text-xs text-mist/60">{searchProgress}</p> : null}
            {indexingStatus ? (
              <div className="mt-3 rounded-lg border border-cyan/30 bg-cyan/10 p-3 text-[11px] text-cyan-50">
                <p className="font-semibold text-cyan">Index status: {indexingStatus.phase}</p>
                <p className="mt-1">
                  Repos: {indexingStatus.repoTotal} | READMEs: {indexingStatus.readmesCompleted}
                  {" / "}
                  {indexingStatus.readmesTarget} (missing {indexingStatus.readmesMissing}, failed{" "}
                  {indexingStatus.readmesFailed})
                </p>
                <p>
                  Chunks: {indexingStatus.chunkTotal} | Embeddings: {indexingStatus.embeddingsCreated}
                  {indexingStatus.embeddingTarget > 0
                    ? ` / ${indexingStatus.embeddingTarget}`
                    : ""}
                </p>
                <p>
                  Duplicate embedding cache hits: {indexingStatus.duplicateEmbeddingHits} | Elapsed:{" "}
                  {Math.max(Math.floor((Date.now() - indexingStatus.startedAt) / 1000), 0)}s
                </p>
                {embeddingRunMetrics ? (
                  <p className="mt-1">
                    Embedding telemetry: backend {embeddingRunMetrics.backendIdentity} | batches{" "}
                    {embeddingRunMetrics.batchCount} | pool {embeddingRunMetrics.activePoolSize}/
                    {embeddingRunMetrics.configuredPoolSize}
                    {embeddingRunMetrics.poolDownshifted
                      ? ` (downshifted: ${embeddingRunMetrics.poolDownshiftReason ?? "error threshold"})`
                      : ""}{" "}
                    | speed{" "}
                    {embeddingRunMetrics.embeddingsPerSecond.toFixed(2)}/s | batch latency avg{" "}
                    {embeddingRunMetrics.avgBatchEmbedLatencyMs.toFixed(1)}ms (last{" "}
                    {embeddingRunMetrics.lastBatchEmbedLatencyMs.toFixed(1)}ms) | checkpoint avg{" "}
                    {embeddingRunMetrics.avgDbCheckpointMs.toFixed(1)}ms (last{" "}
                    {embeddingRunMetrics.lastDbCheckpointMs.toFixed(1)}ms) | checkpoint policy{" "}
                    {embeddingRunMetrics.checkpointEveryEmbeddings} embeddings or{" "}
                    {embeddingRunMetrics.checkpointEveryMs}ms | pending since checkpoint{" "}
                    {embeddingRunMetrics.pendingEmbeddingsSinceCheckpoint} | last checkpoint{" "}
                    {embeddingRunMetrics.lastCheckpointAt
                      ? new Date(embeddingRunMetrics.lastCheckpointAt).toLocaleTimeString()
                      : "not yet"}{" "}
                    | queue depth{" "}
                    {embeddingRunMetrics.queueDepth} (peak {embeddingRunMetrics.peakQueueDepth})
                  </p>
                ) : null}
              </div>
            ) : null}
            {starsSummary ? <p className="mt-3 text-xs text-cyan">{starsSummary}</p> : null}
            {dbStorageMode ? (
              <p className="mt-1 text-xs text-mist/60">Storage mode: {dbStorageMode}</p>
            ) : null}
          </div>

          {/* Search Results */}
          {activeSession ? (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white">
                Search Results
                <span className="ml-2 text-xs text-mist/60">
                  Session: {activeSession.title}
                </span>
              </h3>
              <p className="text-xs text-mist/60">
                Showing {filteredResults.length} / {activeSession.results.length} results
              </p>
              <div className="space-y-3">
                {filteredResults.map((result) => (
                  <div
                    key={result.chunkId}
                    className="rounded-xl border border-white/10 bg-black/20 p-4 transition hover:bg-black/30"
                  >
                    <div className="mb-2 flex items-baseline justify-between">
                      <a
                        href={result.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-sm font-bold text-mint hover:underline"
                      >
                        {result.repoFullName}
                      </a>
                      <span className="text-xs text-mist/50">
                        Score: {result.score.toFixed(4)}
                      </span>
                    </div>
                    {result.repoDescription ? (
                      <p className="mb-2 text-xs text-mist/70">{result.repoDescription}</p>
                    ) : null}
                    <p className="mb-2 text-[11px] text-mist/50">
                      {result.language ?? "Unknown language"} | Updated {new Date(result.updatedAt).toLocaleDateString()}
                      {result.topics.length > 0 ? ` | Topics: ${result.topics.join(", ")}` : ""}
                    </p>
                    <div className="rounded bg-black/40 p-3 text-sm text-mist">
                      <SafeMarkdown
                        className="line-clamp-3 whitespace-pre-wrap font-mono text-xs"
                        content={result.text}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {activeSession ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-sm font-medium text-white">Session messages</p>
              <div className="mt-3 space-y-2">
                {activeSessionMessages.length === 0 ? (
                  <p className="text-xs text-mist/60">No messages yet.</p>
                ) : (
                  activeSessionMessages.map((message) => (
                    <div
                      key={message.id}
                      className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-mist"
                    >
                      <p className="mb-1 font-mono uppercase tracking-[0.1em] text-mist/60">
                        {message.role} • seq {message.sequence}
                      </p>
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-mist/70">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-medium text-white">LLM Answer Mode</p>
              <p className="text-[11px] text-mist/50">Top 8 filtered snippets are sent as context</p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <select
                value={providerId}
                onChange={(event) => {
                  handleProviderChange(event.target.value as LLMProviderId);
                }}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-mist"
              >
                {providerDefinitions.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
              <input
                value={providerBaseUrl}
                onChange={(event) => {
                  setProviderBaseUrl(event.target.value);
                }}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-mist"
                placeholder="Base URL"
              />
              <input
                value={providerModel}
                onChange={(event) => {
                  setProviderModel(event.target.value);
                }}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-mist"
                placeholder="Model"
              />
            </div>

            {selectedProvider.requiresApiKey ? (
              <input
                type="password"
                value={providerApiKey}
                onChange={(event) => {
                  setProviderApiKey(event.target.value);
                }}
                className="mt-3 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-mist"
                placeholder="Provider API key"
              />
            ) : null}

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 text-xs text-mist/80">
                <input
                  type="checkbox"
                  checked={allowRemoteProvider}
                  onChange={(event) => {
                    setAllowRemoteProvider(event.target.checked);
                  }}
                />
                Enable remote provider usage (sends context out of browser)
              </label>
              <label className="flex items-center gap-2 text-xs text-mist/80">
                <input
                  type="checkbox"
                  checked={allowLocalProvider}
                  onChange={(event) => {
                    setAllowLocalProvider(event.target.checked);
                  }}
                />
                Enable local endpoint usage (localhost/Ollama/LM Studio)
              </label>
            </div>

            <textarea
              value={llmPrompt}
              onChange={(event) => {
                setLlmPrompt(event.target.value);
              }}
              className="mt-3 h-24 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-mist"
              placeholder="Ask a recommendation question based on current filtered results..."
            />

            <div className="mt-3 flex items-center gap-3">
              <button
                className="rounded-lg bg-cyan px-4 py-2 text-xs font-semibold text-ink disabled:opacity-50"
                disabled={isGenerating}
                onClick={() => {
                  void handleGenerateAnswer();
                }}
              >
                {isGenerating ? "Generating..." : "Generate Answer"}
              </button>
              <button
                className="rounded-lg border border-white/20 px-4 py-2 text-xs font-semibold text-mist disabled:opacity-50"
                disabled={!isGenerating}
                onClick={handleCancelGeneration}
              >
                Cancel
              </button>
            </div>

            {llmError ? (
              <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                {llmError}
              </p>
            ) : null}

            <div className="mt-3 rounded-lg border border-white/10 bg-black/40 p-3">
              <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-mist/50">Streamed answer</p>
              <div className="min-h-16 whitespace-pre-wrap text-xs text-mist">
                {llmAnswer || "No answer yet."}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-mist/70">
            <div className="flex items-center justify-between">
              <p>Sessions (logged in via {authMethod})</p>
              <button
                className="rounded-lg border border-white/20 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-mist/80"
                onClick={() => {
                  setActiveSessionId(null);
                  setSessionMode("new");
                  setLanguageFilter("all");
                  setTopicFilter("all");
                  setUpdatedWithinDaysFilter("all");
                }}
              >
                Clear active
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {sessions.length === 0 ? (
                <p className="text-xs text-mist/50">No search sessions yet.</p>
              ) : (
                sessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => {
                      void (async () => {
                        const database = await getLocalDatabase();
                        const persistedMessages = database.listChatMessages(session.id);
                        setSessionMessagesById((previous) => ({
                          ...previous,
                          [session.id]: sortChatMessages(persistedMessages),
                        }));
                      })();
                      setActiveSessionId(session.id);
                      setSessionMode("continue");
                    }}
                    className={`block w-full rounded-lg border px-3 py-2 text-left text-xs ${
                      activeSessionId === session.id
                        ? "border-mint/60 bg-mint/10 text-mint"
                        : "border-white/10 bg-black/30 text-mist/70"
                    }`}
                  >
                    <div className="font-medium">{session.title}</div>
                    <div className="text-[11px] opacity-80">
                      {session.results.length} results |{" "}
                      {new Date(session.updatedAt).toLocaleString()}
                    </div>
                  </button>
                ))
              )}
            </div>
            <div className="mt-3">
              <button
                className="mr-3 rounded-lg border border-white/25 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white"
                onClick={logout}
              >
                Clear token
              </button>
              <button
                className="rounded-lg border border-red-400/50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-red-200"
                onClick={() => {
                  void handleClearLocalData();
                }}
              >
                Delete all local data
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-6 text-mist/70">
          <p className="text-lg text-white">Login required</p>
          <p className="mt-2 text-sm">
            Connect GitHub with OAuth or provide a PAT. Token stays in memory by default.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-lg bg-mint px-4 py-2 text-sm font-semibold text-ink"
              onClick={() => {
                void handleOAuth();
              }}
            >
              Login with GitHub OAuth
            </button>
          </div>
          <p className="text-xs text-mist/60">
            OAuth redirect URI expected by app: <code>{oauthConfig.redirectUri}</code>
          </p>
          <form onSubmit={handlePatLogin} className="space-y-3 rounded-lg border border-white/10 p-4">
            <label className="block text-sm text-mist/80" htmlFor="patToken">
              Personal Access Token (fallback)
            </label>
            <input
              id="patToken"
              type="password"
              value={patToken}
              onChange={(event) => {
                setPatToken(event.target.value);
              }}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-sm text-white focus:border-mint focus:outline-none"
              placeholder="ghp_..."
            />
            <button
              type="submit"
              className="rounded-lg border border-cyan/60 px-4 py-2 text-sm font-semibold text-cyan"
            >
              Use PAT
            </button>
          </form>
          {error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
