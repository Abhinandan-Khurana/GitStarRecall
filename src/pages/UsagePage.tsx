import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { createGitHubApiClient } from "../github/client";
import type { GitHubStarredRepo, RepoReadmeRecord } from "../github/types";
import { getLocalDatabase } from "../db/client";
import type { ChatMessageRecord, RepoRecord, EmbeddingRecord, SearchResult } from "../db/types";
import { chunkRepos } from "../chunking/chunker";
import { Embedder, type EmbeddingBackendPreference } from "../embeddings/Embedder";
import { EmbeddingWorkerPool } from "../embeddings/WorkerPool";
import { float32ToBlob } from "../embeddings/vector";
import { buildSyncPlan } from "../sync/plan";
import { sortChatMessages } from "../chat/order";
import { captureLocalError, captureLocalWarn } from "../observability/localLog";
import SafeMarkdown from "../components/SafeMarkdown";
import { SessionChat } from "../components/SessionChat";
import {
  formatProviderError,
  getProviderById,
  getProviderDefinitions,
} from "../llm/providers";
import type { LLMProviderDefinition, LLMProviderId } from "../llm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
  /** Set when phase is "Sync complete" or "Indexing complete" */
  elapsedSeconds?: number;
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
  const [indexDetailsExpanded, setIndexDetailsExpanded] = useState(true);
  const [sessionsExpanded, setSessionsExpanded] = useState(true);

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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSessionMessages.length, isGenerating, llmAnswer]);

  const handleProviderChange = (nextProviderId: LLMProviderId) => {
    const nextProvider =
      providerDefinitions.find((provider) => provider.id === nextProviderId) ?? providerDefinitions[0];
    setProviderId(nextProviderId);
    setProviderBaseUrl(nextProvider.defaultBaseUrl);
    setProviderModel(nextProvider.defaultModel);
    setLlmError(null);
  };

  const handlePatLogin = (event: { preventDefault(): void }) => {
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
          elapsedSeconds: hasPendingEmbeddingChunks
            ? undefined
            : Math.max(1, Math.round((Date.now() - previous.startedAt) / 1000)),
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
            repoTotal: finalRepoCount,
            readmesCompleted: previous.readmesCompleted,
            readmesTarget: previous.readmesTarget,
            chunkTotal: finalChunkCount,
            embeddingsCreated: finalEmbeddingCount,
            embeddingTarget,
            duplicateEmbeddingHits: duplicateHits,
            elapsedSeconds: totalDurationSec,
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
      const msg = err instanceof Error ? err.message : String(err);
      if (import.meta.env.DEV) console.error("Embedding generation failed", err);
      else console.error("Embedding generation failed:", msg);
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

      setActiveSessionId(targetSessionId);
      setSessionMode("continue");
      setLanguageFilter("all");
      setTopicFilter("all");
      setUpdatedWithinDaysFilter("all");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (import.meta.env.DEV) console.error("Search failed", err);
      else console.error("Search failed:", msg);
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

    const promptText = llmPrompt.trim();
    try {
      setLlmError(null);
      setLlmAnswer("");
      setIsGenerating(true);
      setLlmPrompt("");
      let streamedAnswer = "";
      const controller = new AbortController();
      generationControllerRef.current = controller;

      const database = await getLocalDatabase();
      const userSequence = database.getNextChatMessageSequence(activeSessionId!);
      const userMessage: ChatMessageRecord = {
        id: crypto.randomUUID(),
        sessionId: activeSessionId!,
        role: "user",
        content: promptText,
        sequence: userSequence,
        createdAt: Date.now(),
      };
      await database.addChatMessage(userMessage);
      setSessionMessagesById((previous) => {
        const current = previous[activeSessionId!] ?? [];
        return {
          ...previous,
          [activeSessionId!]: sortChatMessages([...current, userMessage]),
        };
      });

      const provider = getProviderById(providerId);
      await provider.stream(
        {
          baseUrl: providerBaseUrl.trim(),
          model: providerModel.trim(),
          apiKey: providerApiKey.trim(),
        },
        {
          prompt: promptText,
          contextSnippets: snippets,
          signal: controller.signal,
          onToken: (token) => {
            streamedAnswer += token;
            setLlmAnswer((previous) => previous + token);
          },
        },
      );

      if (activeSessionId && streamedAnswer.trim()) {
        const assistantSequence = database.getNextChatMessageSequence(activeSessionId);
        const assistantMessage: ChatMessageRecord = {
          id: crypto.randomUUID(),
          sessionId: activeSessionId,
          role: "assistant",
          content: streamedAnswer,
          sequence: assistantSequence,
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
    <article className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {isAuthenticated ? (
        <>
          {/* Primary: Search */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Label htmlFor="search-stars" className="sr-only">
                  Search your stars
                </Label>
                <Input
                  id="search-stars"
                  className="min-w-0 flex-1"
                  placeholder="e.g. vector database in browser"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
                />
                <Button
                  onClick={() => void handleSearch()}
                  disabled={isSearching}
                  className="sm:shrink-0"
                >
                  {isSearching ? "Searching…" : "Search"}
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleFetchStars()}
                  disabled={fetchingStars}
                  className="text-accent border-accent/50 hover:bg-accent/10"
                >
                  {fetchingStars ? (fetchPhase ?? "Syncing…") : "Fetch Stars"}
                </Button>
              </div>
              {/* Index status block */}
              {indexingStatus ? (
                <div className="mt-3 rounded-lg border border-accent/20 bg-accent/5 p-3 text-[11px] text-foreground space-y-1.5">
                  <p className="font-medium">
                    Index status: <span className="text-accent">{indexingStatus.phase}</span>
                  </p>
                  <p>
                    Repos: {indexingStatus.repoTotal} | READMEs: {indexingStatus.readmesCompleted} / {indexingStatus.readmesTarget} (missing {indexingStatus.readmesMissing}, failed {indexingStatus.readmesFailed})
                  </p>
                  <p>
                    Chunks: {indexingStatus.chunkTotal} | Embeddings: {indexingStatus.embeddingsCreated}
                    {indexingStatus.embeddingTarget > 0 ? ` / ${indexingStatus.embeddingTarget}` : ""}
                  </p>
                  <p>
                    Duplicate embedding cache hits: {indexingStatus.duplicateEmbeddingHits}
                    {indexingStatus.elapsedSeconds != null ? ` | Elapsed: ${indexingStatus.elapsedSeconds}s` : ""}
                  </p>
                  {starsSummary ? (
                    <p className="text-accent">{starsSummary}</p>
                  ) : null}
                  {dbStorageMode ? (
                    <p className="pt-0.5">Storage mode: {dbStorageMode}</p>
                  ) : null}
                </div>
              ) : starsSummary || dbStorageMode ? (
                <div className="mt-3 rounded-lg border border-accent/20 bg-accent/5 p-3 text-[11px] text-foreground space-y-1.5">
                  {starsSummary ? <p className="text-accent">{starsSummary}</p> : null}
                  {dbStorageMode ? <p>Storage mode: {dbStorageMode}</p> : null}
                </div>
              ) : null}
              {/* Optional embedding run details */}
              {(indexingStatus || embeddingRunMetrics) && embeddingRunMetrics ? (
                <>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 text-xs text-muted-foreground underline"
                      onClick={() => setIndexDetailsExpanded((e) => !e)}
                    >
                      {indexDetailsExpanded ? "Hide" : "Show"} embedding run details
                    </Button>
                  </div>
                  {indexDetailsExpanded ? (
                    <div className="mt-2 rounded border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground space-y-1">
                      <p>Backend: {embeddingRunMetrics.backendIdentity} · pool {embeddingRunMetrics.activePoolSize}/{embeddingRunMetrics.configuredPoolSize}{embeddingRunMetrics.poolDownshifted ? ` (downshifted: ${embeddingRunMetrics.poolDownshiftReason ?? "yes"})` : ""}</p>
                      <p>Batches: {embeddingRunMetrics.batchCount} · speed {embeddingRunMetrics.embeddingsPerSecond.toFixed(2)}/s · queue {embeddingRunMetrics.queueDepth} (peak {embeddingRunMetrics.peakQueueDepth})</p>
                      <p>Latency: avg batch {embeddingRunMetrics.avgBatchEmbedLatencyMs.toFixed(0)}ms · DB checkpoint avg {embeddingRunMetrics.avgDbCheckpointMs.toFixed(0)}ms</p>
                    </div>
                  ) : null}
                </>
              ) : null}
              {searchProgress ? <p className="mt-2 text-xs text-muted-foreground">{searchProgress}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">
                Search your stars to create a session; then filter and chat below.
              </p>
            </CardContent>
          </Card>

          {/* Session results + filters (only when there is an active session) */}
          {activeSession ? (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">Session: {activeSession.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {filteredResults.length} of {activeSession.results.length} results
                  </p>
                </div>
                {activeSession.results.length === 0 ? (
                  <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                    <p>This session has no results in memory. Run the same search again to repopulate, or start a new search.</p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        setSearchQuery(activeSession.query);
                        void handleSearch();
                      }}
                    >
                      Re-run search
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <p className="text-[11px] text-muted-foreground">Filter repos in this session</p>
                    <RadioGroup
                      value={sessionMode}
                      onValueChange={(v) => setSessionMode(v as "new" | "continue")}
                      className="flex flex-wrap items-center gap-3 text-xs"
                    >
                      <Label className="w-full shrink-0 text-muted-foreground sm:w-auto">Session:</Label>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="new" id="session-new" />
                        <Label htmlFor="session-new" className="cursor-pointer font-normal">New</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="continue" id="session-continue" disabled={!activeSessionId} />
                        <Label htmlFor="session-continue" className="cursor-pointer font-normal">Continue</Label>
                      </div>
                    </RadioGroup>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Select value={languageFilter} onValueChange={setLanguageFilter}>
                        <SelectTrigger aria-label="Filter by language">
                          <SelectValue placeholder="All languages" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All languages</SelectItem>
                          {availableLanguages.map((lang) => <SelectItem key={lang} value={lang}>{lang}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={topicFilter} onValueChange={setTopicFilter}>
                        <SelectTrigger aria-label="Filter by topic">
                          <SelectValue placeholder="All topics" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All topics</SelectItem>
                          {availableTopics.map((topic) => <SelectItem key={topic} value={topic}>{topic}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={updatedWithinDaysFilter} onValueChange={setUpdatedWithinDaysFilter}>
                        <SelectTrigger aria-label="Filter by last updated">
                          <SelectValue placeholder="Any date" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Any date</SelectItem>
                          <SelectItem value="30">Last 30 days</SelectItem>
                          <SelectItem value="90">Last 90 days</SelectItem>
                          <SelectItem value="365">Last year</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </CardHeader>
              {activeSession.results.length > 0 ? (
                <CardContent className="pt-0">
                  <div className="max-h-[min(60vh,28rem)] overflow-auto rounded-md border border-border">
                    <div className="space-y-2 p-2">
                      {filteredResults.map((result) => (
                        <Card key={result.chunkId} className="transition-colors hover:bg-card/80">
                          <CardContent className="p-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-1">
                              <a
                                href={result.repoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-sm font-bold text-primary hover:underline"
                              >
                                {result.repoFullName}
                              </a>
                              <span className="text-[11px] text-muted-foreground">{result.score.toFixed(3)}</span>
                            </div>
                            {result.repoDescription ? (
                              <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{result.repoDescription}</p>
                            ) : null}
                            <div className="mt-1 rounded bg-muted/50 p-2 text-xs">
                              <SafeMarkdown className="line-clamp-2 whitespace-pre-wrap font-mono text-[11px]" content={result.text} />
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          ) : null}

          {/* Chat section: sidebar (chats) + main chat */}
          <div className="flex flex-col gap-4 md:flex-row md:items-stretch">
            {/* Chats sidebar */}
            <aside
              className="w-full shrink-0 rounded-lg border border-border bg-card p-3 md:w-60"
              aria-label="Chat sessions"
            >
              <p className="mb-2 text-sm font-medium">Chats</p>
              <Button
                variant="outline"
                size="sm"
                className="mb-3 h-7 w-full text-xs"
                onClick={() => {
                  setActiveSessionId(null);
                  setSessionMode("new");
                  setLanguageFilter("all");
                  setTopicFilter("all");
                  setUpdatedWithinDaysFilter("all");
                }}
              >
                Clear active
              </Button>
              <ul className="space-y-1">
                {sessions.length === 0 ? (
                  <li>
                    <p className="text-xs text-muted-foreground">No chats yet. Run a search to start one.</p>
                  </li>
                ) : (
                  sessions.map((session) => (
                    <li key={session.id}>
                      <Button
                        variant={activeSessionId === session.id ? "secondary" : "ghost"}
                        size="sm"
                        className="h-auto w-full justify-start py-1.5 text-left text-xs font-normal"
                        onClick={() => {
                          void getLocalDatabase().then((db) => {
                            setSessionMessagesById((prev) => ({
                              ...prev,
                              [session.id]: sortChatMessages(db.listChatMessages(session.id)),
                            }));
                          });
                          setActiveSessionId(session.id);
                          setSessionMode("continue");
                        }}
                        aria-current={activeSessionId === session.id ? "true" : undefined}
                      >
                        <span className="truncate font-medium">{session.title}</span>
                        <span className="ml-1 shrink-0 text-muted-foreground">· {session.results.length}</span>
                      </Button>
                    </li>
                  ))
                )}
              </ul>
            </aside>

            {/* Main chat area */}
            <div className="min-w-0 flex-1">
              {activeSession ? (
                <Card className="flex h-full flex-col">
                  <CardHeader className="py-3">
                    <p className="text-sm font-medium">Chat</p>
                    <p className="text-[11px] text-muted-foreground">
                      Top 8 filtered snippets are sent as context.
                    </p>
                  </CardHeader>
                  <CardContent className="flex min-h-0 flex-1 flex-col pt-0">
                    <SessionChat
                      messages={activeSessionMessages}
                      isGenerating={isGenerating}
                      streamingContent={llmAnswer}
                      prompt={llmPrompt}
                      onPromptChange={setLlmPrompt}
                      onSend={() => void handleGenerateAnswer()}
                      onCancel={handleCancelGeneration}
                      error={llmError}
                      canSend={filteredResults.length > 0}
                      noResultsHint={filteredResults.length === 0}
                      messagesEndRef={messagesEndRef}
                      providerId={providerId}
                      providerBaseUrl={providerBaseUrl}
                      providerModel={providerModel}
                      providerApiKey={providerApiKey}
                      onProviderIdChange={(id) => handleProviderChange(id)}
                      onProviderBaseUrlChange={setProviderBaseUrl}
                      onProviderModelChange={setProviderModel}
                      onProviderApiKeyChange={setProviderApiKey}
                      selectedProvider={selectedProvider}
                      providerDefinitions={providerDefinitions}
                      allowRemoteProvider={allowRemoteProvider}
                      allowLocalProvider={allowLocalProvider}
                      onAllowRemoteChange={setAllowRemoteProvider}
                      onAllowLocalChange={setAllowLocalProvider}
                    />
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    Run a search above to start a session, then chat here.
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Account: collapsible (no session list) */}
          <Collapsible open={sessionsExpanded} onOpenChange={setSessionsExpanded}>
            <Card>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between px-4 py-2.5 font-normal">
                  <span>Account</span>
                  <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                    <span className="hidden sm:inline">{authMethod}</span>
                    <span>{sessionsExpanded ? "−" : "+"}</span>
                  </span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="border-t border-border pt-4">
                  {authMethod === "pat" ? (
                    <p className="mb-3 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                      You are using a Personal Access Token. For better security, prefer{" "}
                      <Button variant="link" className="h-auto p-0 text-xs font-medium" onClick={() => void handleOAuth()}>
                        Login with GitHub OAuth
                      </Button>.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={logout}>
                      Clear token
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => void handleClearLocalData()}
                    >
                      Delete local data
                    </Button>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </>
      ) : (
        <Card>
          <CardContent className="p-6">
            <p className="text-lg font-medium">Login required</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Connect GitHub with OAuth or provide a PAT. Token stays in memory by default.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button onClick={() => void handleOAuth()}>
                Login with GitHub OAuth
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              OAuth redirect URI expected by app: <code className="rounded bg-muted px-1">{oauthConfig.redirectUri}</code>
            </p>
            <form onSubmit={handlePatLogin} className="mt-4 space-y-3 rounded-lg border border-border p-4">
              <Label htmlFor="patToken">Personal Access Token (fallback)</Label>
              <Input
                id="patToken"
                type="password"
                value={patToken}
                onChange={(e) => setPatToken(e.target.value)}
                placeholder="ghp_..."
              />
              <Button type="submit" variant="secondary" className="text-accent-foreground bg-accent hover:bg-accent/90">
                Use PAT
              </Button>
            </form>
            {error ? (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      )}
    </article>
  );
}
