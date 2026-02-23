import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { createGitHubApiClient } from "../github/client";
import type { GitHubStarredRepo, RepoReadmeRecord } from "../github/types";
import { getLocalDatabase } from "../db/client";
import { backupChatSnapshot, loadChatBackup } from "../db/chatBackup";
import type {
  ChatMessageRecord,
  ChatSessionRecord,
  RepoRecord,
  EmbeddingRecord,
  SearchResult,
} from "../db/types";
import { chunkRepos } from "../chunking/chunker";
import { Embedder, type EmbeddingBackendPreference } from "../embeddings/Embedder";
import { EmbeddingWorkerPool } from "../embeddings/WorkerPool";
import {
  OllamaEmbeddingClient,
  type OllamaEmbeddingRuntimeInfo,
} from "../embeddings/ollamaClient";
import { float32ToBlob } from "../embeddings/vector";
import { buildSyncPlan, repoMetadataChanged } from "../sync/plan";
import { sortChatMessages } from "../chat/order";
import { captureLocalError, captureLocalWarn } from "../observability/localLog";
import SafeMarkdown from "../components/SafeMarkdown";
import { SessionChat } from "../components/SessionChat";
import {
  buildHistoryRestoreResult,
  createRestoreRequestTracker,
  shouldRestoreOnAuthTransition,
  type HistoryLoadState,
  type SearchSession,
} from "./historyRestore";
import {
  formatProviderError,
  getProviderById,
  getProviderDefinitions,
} from "../llm/providers";
import type { LLMProviderDefinition, LLMProviderId } from "../llm/types";
import { loadSettings, loadSettingsAsync, saveSettings } from "../lib/settings";
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

type EmbeddingBackendIdentity =
  | {
      kind: "browser";
      preferredBackend: EmbeddingBackendPreference;
      selectedBackend: EmbeddingBackendPreference | null;
      fallbackReason: string | null;
    }
  | {
      kind: "ollama";
      runtime: OllamaEmbeddingRuntimeInfo | null;
      baseUrl: string;
      model: string;
    };

type OllamaConnectionStatus = "idle" | "testing" | "connected" | "failed" | "inactive";

type OllamaPreferenceSnapshot = {
  baseUrl: string;
  model: string;
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

function formatEmbeddingBackendIdentity(identity: EmbeddingBackendIdentity): string {
  if (identity.kind === "ollama") {
    if (!identity.runtime) {
      return `ollama (initializing: ${identity.baseUrl})`;
    }
    return `ollama-${identity.runtime.endpoint} (${identity.runtime.model})`;
  }

  return formatBackendIdentity({
    preferredBackend: identity.preferredBackend,
    selectedBackend: identity.selectedBackend,
    fallbackReason: identity.fallbackReason,
  });
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

function formatOllamaConnectionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.toLowerCase().includes("localhost")) {
    return "Ollama URL must be localhost, 127.0.0.1, or [::1].";
  }
  return message;
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

function getDefaultOllamaBaseUrl(): string {
  const raw = import.meta.env.VITE_OLLAMA_BASE_URL;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  return "http://localhost:11434";
}

function getDefaultOllamaModel(): string {
  const raw = import.meta.env.VITE_OLLAMA_MODEL;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  return "nomic-embed-text";
}

function getOllamaTimeoutMs(): number {
  const raw = Number(import.meta.env.VITE_OLLAMA_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(1_000, Math.trunc(raw));
  }
  return 30_000;
}

function getEmbeddingDbWriteBatchSize(): number {
  const raw = Number(import.meta.env.VITE_EMBEDDING_DB_WRITE_BATCH_SIZE);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(16, Math.min(2048, Math.trunc(raw)));
  }
  return 256;
}

function getEmbeddingUiUpdateIntervalMs(): number {
  const raw = Number(import.meta.env.VITE_EMBEDDING_UI_UPDATE_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(100, Math.min(2000, Math.trunc(raw)));
  }
  return 300;
}

function getLargeLibraryThreshold(): number {
  const raw = Number(import.meta.env.VITE_EMBEDDING_LARGE_LIBRARY_THRESHOLD);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(100, Math.trunc(raw));
  }
  return 500;
}

function getLargeLibraryModeEnabled(): boolean {
  const raw = import.meta.env.VITE_EMBEDDING_LARGE_LIBRARY_MODE;
  return raw === undefined || raw === "1" || raw === "true";
}

function getReadmePipelineV2Enabled(): boolean {
  const raw = import.meta.env.VITE_README_BATCH_PIPELINE_V2;
  return raw === "1" || raw === "true";
}

function getReadmeBatchSize(): number {
  const raw = Number(import.meta.env.VITE_README_BATCH_SIZE);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(10, Math.min(100, Math.trunc(raw)));
  }
  return 40;
}

function getEmbedTriggerThreshold(): number {
  const raw = Number(import.meta.env.VITE_EMBED_TRIGGER_THRESHOLD);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(32, Math.trunc(raw));
  }
  return 256;
}

function getEmbedWindowSize(): number {
  const raw = Number(import.meta.env.VITE_EMBED_WINDOW_SIZE);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(32, Math.trunc(raw));
  }
  return 512;
}

function parseIsoToMs(iso: string): number {
  const timestamp = new Date(iso).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function scoreRepoForEmbeddingPriority(repo: RepoRecord): number {
  const now = Date.now();
  const updatedAtMs = parseIsoToMs(repo.updatedAt);
  const recencyDays = updatedAtMs > 0 ? Math.max(0, (now - updatedAtMs) / 86_400_000) : 3650;
  const recencyScore = Math.max(0, 1 - recencyDays / 365);
  const starScore = Math.log10(Math.max(1, repo.stars + 1));
  const readmeScore = repo.readmeText && repo.readmeText.trim().length > 0 ? 1 : 0;
  return starScore * 0.4 + recencyScore * 0.4 + readmeScore * 0.2;
}

const OLLAMA_EMBEDDING_CONSENT_KEY_PREFIX = "gitstarrecall.embedding.ollama.consent";
const OLLAMA_EMBEDDING_PREF_KEY_PREFIX = "gitstarrecall.embedding.ollama.pref";
const CHAT_SCOPE_PREFIX = "chat";
const EMBEDDING_BACKEND_META_KEY = "embedding_active_backend";
const EMBEDDING_MODEL_META_KEY = "embedding_active_model";
const BROWSER_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
const OLLAMA_BATCH_SIZE_CAP = 24;
const OLLAMA_RESTART_BROWSER_ERROR = "__OLLAMA_RESTART_BROWSER__";

function hashTokenScope(raw: string): string {
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function getChatScopeKey(accessToken: string | null): string | null {
  if (!accessToken) {
    return null;
  }
  return `${CHAT_SCOPE_PREFIX}:${hashTokenScope(accessToken)}`;
}

function getEmbeddingPreferenceScopeKey(accessToken: string | null): string {
  if (!accessToken) {
    return "anon";
  }
  return `token:${hashTokenScope(accessToken)}`;
}

function getOllamaConsentKey(scopeKey: string): string {
  return `${OLLAMA_EMBEDDING_CONSENT_KEY_PREFIX}.${scopeKey}`;
}

function getOllamaPreferenceKey(scopeKey: string): string {
  return `${OLLAMA_EMBEDDING_PREF_KEY_PREFIX}.${scopeKey}`;
}

function parseOllamaPreference(raw: string | null): OllamaPreferenceSnapshot | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const baseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "";
    const model = typeof parsed.model === "string" ? parsed.model.trim() : "";
    if (!baseUrl || !model) {
      return null;
    }
    return { baseUrl, model };
  } catch {
    return null;
  }
}

function makeScopedSessionId(scopeKey: string): string {
  return `${scopeKey}:${crypto.randomUUID()}`;
}

function isSessionInScope(sessionId: string, scopeKey: string): boolean {
  return sessionId.startsWith(`${scopeKey}:`);
}

function mergeRestoredSessions(
  restored: SearchSession[],
  current: SearchSession[],
): SearchSession[] {
  const currentById = new Map(current.map((session) => [session.id, session]));
  const merged: SearchSession[] = restored.map((session) => {
    const existing = currentById.get(session.id);
    if (!existing) {
      return session;
    }
    if (existing.results.length === 0) {
      return session;
    }
    return {
      ...session,
      results: existing.results,
    };
  });

  const mergedIds = new Set(merged.map((session) => session.id));
  for (const session of current) {
    if (!mergedIds.has(session.id) && session.results.length > 0) {
      merged.push(session);
    }
  }

  merged.sort((a, b) => b.updatedAt - a.updatedAt);
  return merged;
}

function mergeRestoredMessages(
  restored: Record<string, ChatMessageRecord[]>,
  current: Record<string, ChatMessageRecord[]>,
): Record<string, ChatMessageRecord[]> {
  const merged: Record<string, ChatMessageRecord[]> = { ...restored };
  const keys = new Set([...Object.keys(restored), ...Object.keys(current)]);

  for (const key of keys) {
    const restoredList = restored[key] ?? [];
    const currentList = current[key] ?? [];
    if (restoredList.length === 0) {
      merged[key] = currentList;
      continue;
    }
    if (currentList.length === 0) {
      merged[key] = restoredList;
      continue;
    }
    merged[key] = currentList.length >= restoredList.length ? currentList : restoredList;
  }

  return merged;
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
    readmeEtag: null,
    readmeLastModified: null,
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
  const [historyLoadState, setHistoryLoadState] = useState<HistoryLoadState>("idle");
  const [historyLastRestoredAt, setHistoryLastRestoredAt] = useState<number | null>(null);
  const [historyDataSource, setHistoryDataSource] = useState<"sqlite" | "indexeddb" | "local-storage" | null>(null);
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
  const [allowOllamaEmbedding, setAllowOllamaEmbedding] = useState(false);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(getDefaultOllamaBaseUrl());
  const [ollamaModel, setOllamaModel] = useState(getDefaultOllamaModel());
  const [ollamaConnectionStatus, setOllamaConnectionStatus] = useState<OllamaConnectionStatus>("idle");
  const [ollamaConnectionMessage, setOllamaConnectionMessage] = useState<string | null>(null);
  const [llmPrompt, setLlmPrompt] = useState("");
  const [llmAnswer, setLlmAnswer] = useState("");
  const [llmError, setLlmError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const generationControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const restoreRequestTrackerRef = useRef(createRestoreRequestTracker());
  const previousIsAuthenticatedRef = useRef(isAuthenticated);
  const chatScopeKey = useMemo(() => getChatScopeKey(accessToken), [accessToken]);
  const embeddingPreferenceScopeKey = useMemo(
    () => getEmbeddingPreferenceScopeKey(accessToken),
    [accessToken],
  );
  const previousChatScopeKeyRef = useRef<string | null>(chatScopeKey);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const sessionsRef = useRef<SearchSession[]>(sessions);
  const sessionMessagesByIdRef = useRef<Record<string, ChatMessageRecord[]>>(sessionMessagesById);
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

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    sessionMessagesByIdRef.current = sessionMessagesById;
  }, [sessionMessagesById]);

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

  const restoreHistory = useCallback(async () => {
    if (!chatScopeKey) {
      setSessions([]);
      setSessionMessagesById({});
      setActiveSessionId(null);
      setSessionMode("new");
      setHistoryDataSource(null);
      setHistoryLastRestoredAt(null);
      setHistoryLoadState("empty");
      return;
    }

    const requestId = restoreRequestTrackerRef.current.nextRequestId();
    setHistoryLoadState("loading");

    const applyRestore = async (params: {
      restoreResult: ReturnType<typeof buildHistoryRestoreResult>;
      source: "sqlite" | "indexeddb" | "local-storage";
      database?: Awaited<ReturnType<typeof getLocalDatabase>>;
    }) => {
      if (!restoreRequestTrackerRef.current.isCurrent(requestId)) {
        return;
      }

      const mergedSessions = mergeRestoredSessions(
        params.restoreResult.sessions,
        sessionsRef.current,
      );
      const mergedMessages = mergeRestoredMessages(
        params.restoreResult.messagesBySessionId,
        sessionMessagesByIdRef.current,
      );
      setSessions(mergedSessions);
      setSessionMessagesById(mergedMessages);
      setActiveSessionId((previous) => {
        if (previous && mergedSessions.some((session) => session.id === previous)) {
          return previous;
        }
        if (
          params.restoreResult.activeSessionId &&
          mergedSessions.some((session) => session.id === params.restoreResult.activeSessionId)
        ) {
          return params.restoreResult.activeSessionId;
        }
        return mergedSessions[0]?.id ?? null;
      });
      setSessionMode(params.restoreResult.sessionMode);
      setHistoryLoadState(params.restoreResult.historyLoadState);
      setHistoryDataSource(params.source);
      const restoredAt = Date.now();
      setHistoryLastRestoredAt(restoredAt);

      if (params.database) {
        try {
          await params.database.upsertIndexMeta({
            key: "history_last_restored_at",
            value: String(restoredAt),
            updatedAt: restoredAt,
          });
        } catch {
          // history metadata should not block restore
        }
      }
    };

    try {
      const database = await getLocalDatabase();
      const scopedPersistedSessions = database
        .listChatSessions()
        .filter((session) => isSessionInScope(session.id, chatScopeKey));
      let restoreResult = buildHistoryRestoreResult({
        persistedSessions: scopedPersistedSessions,
        previousActiveSessionId: activeSessionId,
        listSessionMessages: (sessionId) => sortChatMessages(database.listChatMessages(sessionId)),
      });
      let source: "sqlite" | "indexeddb" | "local-storage" = "sqlite";

      if (restoreResult.sessions.length === 0) {
        const backupSnapshot = await loadChatBackup();
        const scopedBackupSessions = backupSnapshot.sessions.filter((session) =>
          isSessionInScope(session.id, chatScopeKey),
        );
        if (scopedBackupSessions.length > 0) {
          restoreResult = buildHistoryRestoreResult({
            persistedSessions: scopedBackupSessions,
            previousActiveSessionId: activeSessionId,
            listSessionMessages: (sessionId) => backupSnapshot.messagesBySessionId[sessionId] ?? [],
          });
          source = backupSnapshot.source ?? "indexeddb";

          for (const session of scopedBackupSessions) {
            try {
              await database.upsertChatSession(session);
            } catch {
              // best effort: restore UI from backup even if primary DB write fails
            }
          }

          const scopedSessionIds = new Set(scopedBackupSessions.map((session) => session.id));
          const backupMessages = Object.values(backupSnapshot.messagesBySessionId)
            .flat()
            .filter((message) => scopedSessionIds.has(message.sessionId));
          for (const message of backupMessages) {
            try {
              await database.addChatMessage(message);
            } catch {
              // best effort: restore UI from backup even if primary DB write fails
            }
          }
        }
      } else {
        const sessionsForBackup: ChatSessionRecord[] = restoreResult.sessions.map((session) => ({
          id: session.id,
          query: session.query,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        }));
        void backupChatSnapshot({
          sessions: sessionsForBackup,
          messagesBySessionId: restoreResult.messagesBySessionId,
        });
      }

      await applyRestore({ restoreResult, source, database });
    } catch (err) {
      captureLocalError("history_restore_failed", err);
      if (!restoreRequestTrackerRef.current.isCurrent(requestId)) {
        return;
      }

      const backupSnapshot = await loadChatBackup();
      const scopedBackupSessions = backupSnapshot.sessions.filter((session) =>
        isSessionInScope(session.id, chatScopeKey),
      );
      if (scopedBackupSessions.length > 0) {
        const restoreResult = buildHistoryRestoreResult({
          persistedSessions: scopedBackupSessions,
          previousActiveSessionId: activeSessionId,
          listSessionMessages: (sessionId) => backupSnapshot.messagesBySessionId[sessionId] ?? [],
        });
        await applyRestore({
          restoreResult,
          source: backupSnapshot.source ?? "indexeddb",
        });
        return;
      }

      setHistoryDataSource(null);
      setHistoryLastRestoredAt(null);
      setHistoryLoadState("error");
    }
  }, [activeSessionId, chatScopeKey]);

  useEffect(() => {
    void restoreHistory();
  }, [restoreHistory]);

  useEffect(() => {
    const wasAuthenticated = previousIsAuthenticatedRef.current;
    previousIsAuthenticatedRef.current = isAuthenticated;

    if (shouldRestoreOnAuthTransition(wasAuthenticated, isAuthenticated)) {
      void restoreHistory();
    }
  }, [isAuthenticated, restoreHistory]);

  useEffect(() => {
    const previousScope = previousChatScopeKeyRef.current;
    previousChatScopeKeyRef.current = chatScopeKey;
    if (previousScope === chatScopeKey) {
      return;
    }

    setSessions([]);
    setSessionMessagesById({});
    setActiveSessionId(null);
    setSessionMode("new");
    void restoreHistory();
  }, [chatScopeKey, restoreHistory]);

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

  // Load saved provider settings when user logs in (sync for plaintext, async for encrypted)
  useEffect(() => {
    if (!accessToken) return;
    const sync = loadSettings(accessToken);
    if (sync) {
      setProviderId(sync.providerId);
      setProviderBaseUrl(sync.baseUrl);
      setProviderModel(sync.model);
      setProviderApiKey(sync.apiKey);
      setAllowRemoteProvider(sync.allowRemoteProvider);
      setAllowLocalProvider(sync.allowLocalProvider);
      return;
    }
    let cancelled = false;
    loadSettingsAsync(accessToken).then((saved) => {
      if (cancelled || !saved) return;
      setProviderId(saved.providerId);
      setProviderBaseUrl(saved.baseUrl);
      setProviderModel(saved.model);
      setProviderApiKey(saved.apiKey);
      setAllowRemoteProvider(saved.allowRemoteProvider);
      setAllowLocalProvider(saved.allowLocalProvider);
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  // Save provider settings when they change
  useEffect(() => {
    if (accessToken) {
      saveSettings(accessToken, {
        providerId,
        baseUrl: providerBaseUrl,
        model: providerModel,
        apiKey: providerApiKey,
        allowRemoteProvider,
        allowLocalProvider,
      });
    }
  }, [accessToken, providerId, providerBaseUrl, providerModel, providerApiKey, allowRemoteProvider, allowLocalProvider]);

  useEffect(() => {
    if (sessions.length === 0) {
      setActiveSessionId(null);
      return;
    }

    if (activeSessionId && sessions.some((session) => session.id === activeSessionId)) {
      return;
    }

    setActiveSessionId(sessions[0].id);
  }, [sessions, activeSessionId]);

  useEffect(() => {
    const fallbackPreference: OllamaPreferenceSnapshot = {
      baseUrl: getDefaultOllamaBaseUrl(),
      model: getDefaultOllamaModel(),
    };
    try {
      const storedConsent = localStorage.getItem(getOllamaConsentKey(embeddingPreferenceScopeKey));
      const storedPreference = parseOllamaPreference(
        localStorage.getItem(getOllamaPreferenceKey(embeddingPreferenceScopeKey)),
      );
      setAllowOllamaEmbedding(storedConsent === "1");
      setOllamaBaseUrl(storedPreference?.baseUrl ?? fallbackPreference.baseUrl);
      setOllamaModel(storedPreference?.model ?? fallbackPreference.model);
    } catch {
      setAllowOllamaEmbedding(false);
      setOllamaBaseUrl(fallbackPreference.baseUrl);
      setOllamaModel(fallbackPreference.model);
    }
    setOllamaConnectionStatus("idle");
    setOllamaConnectionMessage(null);
  }, [embeddingPreferenceScopeKey]);

  useEffect(() => {
    try {
      localStorage.setItem(
        getOllamaConsentKey(embeddingPreferenceScopeKey),
        allowOllamaEmbedding ? "1" : "0",
      );
      localStorage.setItem(
        getOllamaPreferenceKey(embeddingPreferenceScopeKey),
        JSON.stringify({
          baseUrl: ollamaBaseUrl.trim() || getDefaultOllamaBaseUrl(),
          model: ollamaModel.trim() || getDefaultOllamaModel(),
        } satisfies OllamaPreferenceSnapshot),
      );
    } catch {
      // ignore local preference persistence errors
    }
  }, [allowOllamaEmbedding, embeddingPreferenceScopeKey, ollamaBaseUrl, ollamaModel]);

  /* Chat scroll is handled inside SessionChat (only the message list scrolls, not the page) */

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

  const handleTestOllamaConnection = useCallback(async () => {
    const normalizedBaseUrl = ollamaBaseUrl.trim() || getDefaultOllamaBaseUrl();
    const normalizedModel = ollamaModel.trim() || getDefaultOllamaModel();
    setOllamaConnectionStatus("testing");
    setOllamaConnectionMessage(null);
    try {
      const client = new OllamaEmbeddingClient({
        baseUrl: normalizedBaseUrl,
        model: normalizedModel,
        timeoutMs: getOllamaTimeoutMs(),
      });
      const runtime = await client.probeRuntime();
      setOllamaConnectionStatus("connected");
      setOllamaConnectionMessage(
        `Connected (${runtime.endpoint}) · model ${runtime.model} · ${runtime.availableModels.length} models detected`,
      );
    } catch (err) {
      setOllamaConnectionStatus("failed");
      setOllamaConnectionMessage(formatOllamaConnectionError(err));
    }
  }, [ollamaBaseUrl, ollamaModel]);

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
    const existingRepos = database.listRepos();
    const existingById = new Map(existingStates.map((repo) => [repo.id, repo]));
    const existingReposById = new Map(existingRepos.map((repo) => [repo.id, repo]));
    const previousRepoIds = existingStates.map((repo) => repo.id);
    const usePipelineV2 = getReadmePipelineV2Enabled();
    const runStartedAt = Date.now();
    const starFetchStartedAt = performance.now();

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
    const starFetchDurationMs = performance.now() - starFetchStartedAt;
    const syncedAt = Date.now();
    const syncPlan = buildSyncPlan(existingStates, starResult.repos);
    const remoteById = new Map(starResult.repos.map((repo) => [repo.id, repo]));

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
    const previousSyncStateByRepoId = new Map(
      existingStates.map((state) => [
        state.id,
        {
          checksum: state.checksum,
          readmeEtag: state.readmeEtag ?? null,
          readmeLastModified: state.readmeLastModified ?? null,
        },
      ]),
    );
    let chunkUpsertLatencyTotalMs = 0;
    let chunkUpsertCount = 0;
    let firstEmbeddingAvailableAt: number | null = null;
    let lastReadmeStats = {
      requested: candidates.length,
      succeeded: 0,
      missing: 0,
      failed: 0,
      retryCount: 0,
      rateLimitHits: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
    };
    let embeddingWindowRunning = false;
    let lastEmbeddingWindowAt = 0;

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

    const processReadmeBatch = async (batch: RepoReadmeRecord[]): Promise<void> => {
      if (batch.length === 0) {
        return;
      }
      const upserts: RepoRecord[] = [];
      const changedForChunk: RepoRecord[] = [];
      for (const readme of batch) {
        const remoteRepo = remoteById.get(readme.repoId);
        if (!remoteRepo) {
          continue;
        }

        const localRepo = existingReposById.get(readme.repoId);
        const localState = existingById.get(readme.repoId);
        const record = mapStarredRepoToRecord(remoteRepo, syncedAt);
        if (readme.notModified && localRepo) {
          record.readmeUrl = localRepo.readmeUrl;
          record.readmeText = localRepo.readmeText;
          record.checksum = localRepo.checksum;
          record.readmeEtag = readme.readmeEtag ?? localRepo.readmeEtag;
          record.readmeLastModified = readme.readmeLastModified ?? localRepo.readmeLastModified;
        } else {
          record.readmeUrl = readme.readmeUrl;
          record.readmeText = readme.readmeText;
          record.checksum = readme.checksum;
          record.readmeEtag = readme.readmeEtag;
          record.readmeLastModified = readme.readmeLastModified;
        }

        const metadataChanged = localState ? repoMetadataChanged(localState, remoteRepo) : true;
        const checksumChanged = localRepo ? localRepo.checksum !== record.checksum : true;
        if (!localRepo || checksumChanged || metadataChanged) {
          upserts.push(record);
        }
        if (checksumChanged) {
          changedForChunk.push(record);
        }

        existingReposById.set(record.id, record);
        existingById.set(record.id, {
          id: record.id,
          fullName: record.fullName,
          description: record.description,
          topics: record.topics,
          language: record.language,
          updatedAt: record.updatedAt,
          readmeEtag: record.readmeEtag,
          readmeLastModified: record.readmeLastModified,
          checksum: record.checksum,
        });
      }

      if (upserts.length > 0) {
        await database.upsertRepos(upserts);
      }

      if (changedForChunk.length > 0) {
        setFetchPhase("Chunking changed repos…");
        setIndexingStatus((previous) =>
          previous
            ? {
                ...previous,
                phase: "Chunking changed repositories",
              }
            : previous,
        );
        const repoIds = changedForChunk.map((repo) => repo.id);
        const chunkStart = performance.now();
        await database.deleteChunksByRepoIds(repoIds);
        const chunks = chunkRepos(changedForChunk);
        await database.upsertChunks(chunks);
        chunkUpsertLatencyTotalMs += performance.now() - chunkStart;
        chunkUpsertCount += 1;
      }

      const now = Date.now();
      const shouldRunEmbeddingWindow =
        usePipelineV2 &&
        !embeddingWindowRunning &&
        now - lastEmbeddingWindowAt >= 1500 &&
        database.getPendingEmbeddingChunkCount() >= getEmbedTriggerThreshold();
      if (shouldRunEmbeddingWindow) {
        embeddingWindowRunning = true;
        lastEmbeddingWindowAt = now;
        const beforeCount = database.getEmbeddingCount();
        try {
          await generateEmbeddings(database, {
            incremental: true,
            maxChunks: getEmbedWindowSize(),
          });
          const afterCount = database.getEmbeddingCount();
          if (afterCount > beforeCount && firstEmbeddingAvailableAt == null) {
            firstEmbeddingAvailableAt = Date.now();
          }
        } finally {
          embeddingWindowRunning = false;
        }
      }

      setIndexingStatus((previous) =>
        previous
          ? {
              ...previous,
              chunkTotal: database.getChunkCount(),
            }
          : previous,
      );
    };

    const readmeStageStartedAt = performance.now();
    const readmeResult = await client.fetchReadmes(candidates, {
      batchSize: getReadmeBatchSize(),
      previousSyncStateByRepoId,
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
      onBatch: usePipelineV2
        ? async (records, progress, stats) => {
            await processReadmeBatch(records);
            lastReadmeStats = stats;
            setFetchPhase(
              `Fetching changed READMEs… ${progress.completed}/${progress.total} · p95 ${Math.round(
                stats.p95LatencyMs,
              )}ms`,
            );
          }
        : undefined,
    });
    const readmeStageDurationMs = performance.now() - readmeStageStartedAt;

    if (!usePipelineV2) {
      await processReadmeBatch(readmeResult.records);
    }
    if (firstEmbeddingAvailableAt == null && database.getEmbeddingCount() > 0) {
      firstEmbeddingAvailableAt = Date.now();
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
        changedRepos: readmeResult.records.filter((record) => !record.notModified).length,
        fetchedPages: starResult.fetchedPages,
      }),
      updatedAt: Date.now(),
    });
    await database.upsertIndexMeta({
      key: "last_star_sync_pipeline_metrics",
      value: JSON.stringify({
        source,
        pipeline: usePipelineV2 ? "batch-v2" : "legacy",
        starFetchMs: Math.round(starFetchDurationMs),
        readmeFetchMs: Math.round(readmeStageDurationMs),
        chunkUpsertMsAvg:
          chunkUpsertCount > 0 ? Math.round(chunkUpsertLatencyTotalMs / chunkUpsertCount) : 0,
        firstEmbeddingAvailableMs:
          firstEmbeddingAvailableAt == null
            ? null
            : Math.max(0, firstEmbeddingAvailableAt - runStartedAt),
        readmeStats: lastReadmeStats,
      }),
      updatedAt: Date.now(),
    });

    setDbStorageMode(database.storageMode);
    const localRepoCount = database.getRepoCount();
    const localChunkCount = database.getChunkCount();
    const localEmbeddingCount = database.getEmbeddingCount();
    const readmeCount = readmeResult.records.length - readmeResult.missingCount - readmeResult.failedCount;
    const hasPendingEmbeddingChunks = database.getPendingEmbeddingChunkCount() > 0;
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
      `${readmeResult.records.filter((record) => !record.notModified).length} changed/new, ${syncPlan.removedRepoIds.length} removed. ` +
      `READMEs fetched: ${readmeCount}, missing: ${readmeResult.missingCount}, failed: ${readmeResult.failedCount}. ` +
      `Local DB: ${localRepoCount} repos, ${localChunkCount} chunks, ${localEmbeddingCount} embeddings. ` +
      `Pipeline: ${usePipelineV2 ? "batch-v2" : "legacy"} · README p95 ${Math.round(lastReadmeStats.p95LatencyMs)}ms.`,
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

  const generateEmbeddings = async (
    database: Awaited<ReturnType<typeof getLocalDatabase>>,
    options?: { forceBrowser?: boolean; maxChunks?: number; repoIds?: number[]; incremental?: boolean },
  ) => {
    let embedder: Embedder | null = null;
    let embeddingPool: EmbeddingWorkerPool | null = null;
    let restartWithBrowser = false;
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
      const poolSize = getEmbeddingPoolSize();
      const workerBatchSize = getEmbeddingWorkerBatchSize();
      embedder = new Embedder({ preferredBackend });
      embeddingPool = new EmbeddingWorkerPool({
        poolSize,
        maxPoolSize: 2,
        workerBatchSize,
        preferredBackend,
      });
      const activeEmbeddingPool = embeddingPool;
      const dbWriteBatchSize = getEmbeddingDbWriteBatchSize();
      const uiUpdateIntervalMs = getEmbeddingUiUpdateIntervalMs();
      const maxBatchChars = 32_000;
      const largeLibraryModeEnabled = getLargeLibraryModeEnabled();
      const largeLibraryThreshold = getLargeLibraryThreshold();
      const forceBrowser = options?.forceBrowser === true;
      const incrementalMode = options?.incremental === true;
      const repoIdsFilter = options?.repoIds;
      const maxChunks = options?.maxChunks;
      const ollamaEnabled = allowOllamaEmbedding && !forceBrowser;
      const resolvedOllamaBaseUrl = ollamaBaseUrl.trim() || getDefaultOllamaBaseUrl();
      const resolvedOllamaModel = ollamaModel.trim() || getDefaultOllamaModel();
      const ollamaTimeoutMs = getOllamaTimeoutMs();
      let ollamaRuntime: OllamaEmbeddingRuntimeInfo | null = null;
      let ollamaClient: OllamaEmbeddingClient | null = null;
      const initialPoolStatus = embeddingPool.getStatus();
      let backendIdentity: EmbeddingBackendIdentity = {
        kind: "browser",
        preferredBackend: initialPoolStatus.preferredBackend,
        selectedBackend: initialPoolStatus.selectedBackend,
        fallbackReason: initialPoolStatus.backendFallbackReason,
      };
      let activeBackendKind: "browser" | "ollama" = "browser";
      let activeEmbeddingModel = BROWSER_EMBEDDING_MODEL;

      if (ollamaEnabled) {
        try {
          const nextOllamaClient = new OllamaEmbeddingClient({
            baseUrl: resolvedOllamaBaseUrl,
            model: resolvedOllamaModel,
            timeoutMs: ollamaTimeoutMs,
          });
          ollamaRuntime = await nextOllamaClient.probeRuntime();
          ollamaClient = nextOllamaClient;
          activeBackendKind = "ollama";
          activeEmbeddingModel = resolvedOllamaModel;
          backendIdentity = {
            kind: "ollama",
            runtime: ollamaRuntime,
            baseUrl: resolvedOllamaBaseUrl,
            model: resolvedOllamaModel,
          };
          setOllamaConnectionStatus("connected");
          setOllamaConnectionMessage(
            `Connected (${ollamaRuntime.endpoint}) · model ${ollamaRuntime.model}`,
          );
        } catch (ollamaError) {
          captureLocalWarn(
            "ollama_embedding_unavailable",
            ollamaError instanceof Error ? ollamaError.message : String(ollamaError),
          );
          setOllamaConnectionStatus("inactive");
          setOllamaConnectionMessage(
            `Ollama unavailable, using browser fallback: ${formatOllamaConnectionError(ollamaError)}`,
          );
        }
      } else if (forceBrowser && allowOllamaEmbedding) {
        setOllamaConnectionStatus("inactive");
        setOllamaConnectionMessage("Ollama disabled for this run after fallback to browser.");
      }

      const existingBackend = database.getIndexMetaValue(EMBEDDING_BACKEND_META_KEY);
      const existingModel = database.getIndexMetaValue(EMBEDDING_MODEL_META_KEY);
      if (
        database.getEmbeddingCount() > 0 &&
        (existingBackend !== activeBackendKind || existingModel !== activeEmbeddingModel)
      ) {
        await database.clearEmbeddings();
        await database.upsertIndexMeta({
          key: "embedding_job_cursor",
          value: "",
          updatedAt: Date.now(),
        });
        setStarsSummary(
          `Embedding model changed (${existingModel ?? "unknown"} -> ${activeEmbeddingModel}); rebuilding index.`,
        );
      }
      await database.upsertIndexMeta({
        key: EMBEDDING_BACKEND_META_KEY,
        value: activeBackendKind,
        updatedAt: Date.now(),
      });
      await database.upsertIndexMeta({
        key: EMBEDDING_MODEL_META_KEY,
        value: activeEmbeddingModel,
        updatedAt: Date.now(),
      });

      const repoCount = database.getRepoCount();
      const largeLibraryMode = largeLibraryModeEnabled && repoCount > largeLibraryThreshold;
      const pendingChunks = database.listPendingChunksForEmbedding({
        repoIds: repoIdsFilter,
        limit: maxChunks,
      });
      if (largeLibraryMode && pendingChunks.length > 0) {
        const repos = database.listRepos();
        const rankByRepo = new Map<number, number>();
        repos
          .sort((a, b) => scoreRepoForEmbeddingPriority(b) - scoreRepoForEmbeddingPriority(a))
          .forEach((repo, index) => {
            rankByRepo.set(repo.id, index);
          });
        pendingChunks.sort((a, b) => {
          const rankA = rankByRepo.get(a.repoId) ?? Number.MAX_SAFE_INTEGER;
          const rankB = rankByRepo.get(b.repoId) ?? Number.MAX_SAFE_INTEGER;
          if (rankA !== rankB) {
            return rankA - rankB;
          }
          if (a.createdAt !== b.createdAt) {
            return a.createdAt - b.createdAt;
          }
          return a.id.localeCompare(b.id);
        });
      }
      const embeddingTarget = pendingChunks.length;
      const pendingPlan = database.getPendingChunksQueryPlan();
      if (!incrementalMode) {
        await database.upsertIndexMeta({
          key: "embedding_job_mode",
          value: largeLibraryMode ? "large-library" : "standard",
          updatedAt: Date.now(),
        });
        await database.upsertIndexMeta({
          key: "embedding_job_started_at",
          value: String(Date.now()),
          updatedAt: Date.now(),
        });
        await database.upsertIndexMeta({
          key: "embedding_job_query_plan",
          value: pendingPlan,
          updatedAt: Date.now(),
        });
      }
      const cursorChunkId = incrementalMode ? null : database.getIndexMetaValue("embedding_job_cursor");
      let queueCursor = 0;
      if (cursorChunkId) {
        const foundIndex = pendingChunks.findIndex((chunk) => chunk.id === cursorChunkId);
        if (foundIndex === 0) {
          queueCursor = foundIndex;
        } else if (foundIndex > 0) {
          captureLocalWarn(
            "embedding_resume_cursor_reset",
            `resetting cursor to pending head because ${foundIndex} pending chunks exist before cursor`,
          );
        }
      }
      let processedCount = 0;
      let duplicateHits = 0;
      let batchCount = 0;
      let totalBatchEmbedLatencyMs = 0;
      let totalDbCheckpointMs = 0;
      let lastBatchEmbedLatencyMs = 0;
      let lastDbCheckpointMs = 0;
      const localEmbeddingCache = new Map<string, { model: string; vector: Float32Array }>();
      const embeddingBuffer: EmbeddingRecord[] = [];
      const startMs = Date.now();
      let lastUiUpdateAt = 0;
      const initialCheckpointStatus = database.getEmbeddingCheckpointStatus();
      let peakQueueDepth = Math.max(embeddingTarget - queueCursor, 0);
      let nextWorkerBatchSize = Math.max(
        1,
        Math.min(workerBatchSize, ollamaClient ? OLLAMA_BATCH_SIZE_CAP : 32),
      );
      if (!incrementalMode) {
        setIndexingStatus((previous) =>
          previous
            ? {
                ...previous,
                phase: "Generating embeddings",
                embeddingTarget,
              }
            : previous,
        );
      }
      if (!incrementalMode) {
        setEmbeddingRunMetrics({
        backendIdentity: formatEmbeddingBackendIdentity(backendIdentity),
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
      }

      const flushEmbeddingBuffer = async (forced: boolean) => {
        if (embeddingBuffer.length === 0) {
          return;
        }
        if (!forced && embeddingBuffer.length < dbWriteBatchSize) {
          return;
        }
        const checkpointStart = performance.now();
        const flushed = embeddingBuffer.splice(0, embeddingBuffer.length);
        await database.upsertEmbeddings(flushed);
        lastDbCheckpointMs = performance.now() - checkpointStart;
        totalDbCheckpointMs += lastDbCheckpointMs;
      };

      const publishProgress = async (force: boolean) => {
        const now = Date.now();
        if (!force && now - lastUiUpdateAt < uiUpdateIntervalMs) {
          return;
        }
        lastUiUpdateAt = now;
        const elapsedSeconds = Math.max((now - startMs) / 1000, 1);
        const speed = processedCount / elapsedSeconds;
        const remaining = Math.max(embeddingTarget - processedCount, 0);
        const etaSeconds = speed > 0 ? Math.ceil(remaining / speed) : 0;
        const queueDepth = Math.max(embeddingTarget - processedCount, 0);
        const checkpointStatus = database.getEmbeddingCheckpointStatus();
        const poolStatus = activeEmbeddingPool.getStatus();
        if (backendIdentity.kind === "browser") {
          backendIdentity = {
            kind: "browser",
            preferredBackend: poolStatus.preferredBackend,
            selectedBackend: poolStatus.selectedBackend,
            fallbackReason: poolStatus.backendFallbackReason,
          };
        }
        peakQueueDepth = Math.max(peakQueueDepth, queueDepth);
        if (!incrementalMode) {
          setFetchPhase(`Generating embeddings… ${processedCount}/${embeddingTarget} completed`);
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
        }
        setEmbeddingRunMetrics({
          backendIdentity: formatEmbeddingBackendIdentity(backendIdentity),
          configuredPoolSize: poolStatus.configuredPoolSize,
          activePoolSize: poolStatus.activePoolSize,
          poolDownshifted: poolStatus.downshifted,
          poolDownshiftReason: poolStatus.downshiftReason,
          batchCount,
          embeddingsProcessed: processedCount,
          embeddingsPerSecond: speed,
          avgBatchEmbedLatencyMs: batchCount > 0 ? totalBatchEmbedLatencyMs / batchCount : 0,
          lastBatchEmbedLatencyMs,
          avgDbCheckpointMs: batchCount > 0 ? totalDbCheckpointMs / batchCount : 0,
          lastDbCheckpointMs,
          checkpointEveryEmbeddings: checkpointStatus.everyEmbeddings,
          checkpointEveryMs: checkpointStatus.everyMs,
          pendingEmbeddingsSinceCheckpoint: checkpointStatus.pendingEmbeddings,
          lastCheckpointAt: checkpointStatus.lastCheckpointAt,
          queueDepth,
          peakQueueDepth,
          updatedAt: now,
        });
      };

      while (queueCursor < pendingChunks.length) {
        const batchStart = queueCursor;
        const batchSizeCap = ollamaClient ? OLLAMA_BATCH_SIZE_CAP : 32;
        let batchSize = Math.max(1, Math.min(nextWorkerBatchSize, batchSizeCap));
        let batchChars = 0;
        while (batchStart + batchSize <= pendingChunks.length) {
          const nextChunk = pendingChunks[batchStart + batchSize - 1];
          if (!nextChunk) {
            break;
          }
          batchChars += nextChunk.text.length;
          if (batchChars > maxBatchChars && batchSize > 1) {
            batchSize -= 1;
            break;
          }
          if (batchSize >= Math.min(nextWorkerBatchSize, batchSizeCap)) {
            break;
          }
          batchSize += 1;
        }
        const chunks = pendingChunks.slice(batchStart, batchStart + batchSize);
        queueCursor += chunks.length;
        if (chunks.length === 0) {
          break;
        }

        const batchEmbedStart = performance.now();
        const uncachedItems: Array<{ chunkId: string; text: string }> = [];
        const batchModel = ollamaClient ? resolvedOllamaModel : BROWSER_EMBEDDING_MODEL;

        for (const chunk of chunks) {
          const cachedEntry = localEmbeddingCache.get(chunk.text);
          if (cachedEntry && cachedEntry.model === batchModel) {
            duplicateHits += 1;
            embeddingBuffer.push({
              id: crypto.randomUUID(),
              chunkId: chunk.id,
              model: cachedEntry.model,
              dimension: cachedEntry.vector.length,
              vectorBlob: float32ToBlob(cachedEntry.vector),
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
          const texts = uncachedItems.map((item) => item.text);
          let vectors: Array<Float32Array | null> = [];
          let usedBrowserBatch = false;
          if (ollamaClient) {
            try {
              const ollamaVectors = await ollamaClient.embedBatch(texts);
              vectors = ollamaVectors;
            } catch (ollamaError) {
              captureLocalWarn(
                "ollama_embedding_batch_failed",
                ollamaError instanceof Error ? ollamaError.message : String(ollamaError),
              );
              setOllamaConnectionStatus("inactive");
              setOllamaConnectionMessage(
                `Ollama failed during indexing; restarting on browser backend. ${formatOllamaConnectionError(
                  ollamaError,
                )}`,
              );
              throw new Error(OLLAMA_RESTART_BROWSER_ERROR);
            }
          } else {
            usedBrowserBatch = true;
            const poolStatus = activeEmbeddingPool.getStatus();
            if (poolStatus.selectedBackend === "webgpu") {
              activeEmbeddingPool.setConcurrency(1);
            } else if (!poolStatus.downshifted) {
              activeEmbeddingPool.setConcurrency(getEmbeddingPoolSize());
            }
            const batchResults = await activeEmbeddingPool.embedBatch(texts);
            vectors = batchResults.map((item) => item.embedding);
          }
          if (vectors.length !== uncachedItems.length) {
            throw new Error(
              `embedding batch result length mismatch: expected ${uncachedItems.length}, got ${vectors.length}`,
            );
          }

          for (let i = 0; i < uncachedItems.length; i += 1) {
            const item = uncachedItems[i];
            let vector = vectors[i];
            let vectorModel = usedBrowserBatch ? BROWSER_EMBEDDING_MODEL : resolvedOllamaModel;
            if (!vector) {
              try {
                vector = await embedder.embed(item.text);
                vectorModel = BROWSER_EMBEDDING_MODEL;
                captureLocalWarn("embedding_batch_item_recovered", `chunk_id=${item.chunkId}`);
              } catch (singleErr) {
                throw new Error(
                  `embedding batch item failed for chunk ${item.chunkId}; single_retry=${
                    singleErr instanceof Error ? singleErr.message : String(singleErr)
                  }`,
                );
              }
            }
            if (localEmbeddingCache.size < 4_000) {
              localEmbeddingCache.set(item.text, { model: vectorModel, vector });
            }
            embeddingBuffer.push({
              id: crypto.randomUUID(),
              chunkId: item.chunkId,
              model: vectorModel,
              dimension: vector.length,
              vectorBlob: float32ToBlob(vector),
              createdAt: Date.now(),
            });
          }
        }

        lastBatchEmbedLatencyMs = performance.now() - batchEmbedStart;
        processedCount += chunks.length;
        batchCount += 1;
        totalBatchEmbedLatencyMs += lastBatchEmbedLatencyMs;
        const dynamicBatchCap = ollamaClient ? OLLAMA_BATCH_SIZE_CAP : 32;
        if (lastBatchEmbedLatencyMs > 2_500) {
          nextWorkerBatchSize = Math.max(1, Math.floor(nextWorkerBatchSize / 2));
        } else if (lastBatchEmbedLatencyMs < 900) {
          nextWorkerBatchSize = Math.min(dynamicBatchCap, nextWorkerBatchSize + 1);
        }
        await flushEmbeddingBuffer(false);
        if (!incrementalMode) {
          await database.upsertIndexMeta({
            key: "embedding_job_cursor",
            value: String(chunks[chunks.length - 1]?.id ?? ""),
            updatedAt: Date.now(),
          });
          await database.upsertIndexMeta({
            key: "embedding_job_last_repo_id",
            value: String(chunks[chunks.length - 1]?.repoId ?? 0),
            updatedAt: Date.now(),
          });
        }
        await publishProgress(false);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      await flushEmbeddingBuffer(true);

      const finalRepoCount = database.getRepoCount();
      const finalChunkCount = database.getChunkCount();
      const finalEmbeddingCount = database.getEmbeddingCount();
      const totalDurationSec = Math.max(Math.round((Date.now() - startMs) / 1000), 1);
      if (!incrementalMode) {
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
      }
      const finalElapsedSeconds = Math.max((Date.now() - startMs) / 1000, 1);
      const finalQueueDepth = Math.max(embeddingTarget - processedCount, 0);
      await database.flushPendingEmbeddingCheckpoint();
      if (!incrementalMode) {
        await database.upsertIndexMeta({
          key: "embedding_job_cursor",
          value: "",
          updatedAt: Date.now(),
        });
      }
      const finalCheckpointStatus = database.getEmbeddingCheckpointStatus();
      const finalPoolStatus = activeEmbeddingPool.getStatus();
      if (backendIdentity.kind === "browser") {
        backendIdentity = {
          kind: "browser",
          preferredBackend: finalPoolStatus.preferredBackend,
          selectedBackend: finalPoolStatus.selectedBackend,
          fallbackReason: finalPoolStatus.backendFallbackReason,
        };
      }
      const finalMetrics: EmbeddingRunMetrics = {
        backendIdentity: formatEmbeddingBackendIdentity(backendIdentity),
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
      if (!incrementalMode) {
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
      }
      await publishProgress(true);
    } catch (err) {
      if (err instanceof Error && err.message === OLLAMA_RESTART_BROWSER_ERROR) {
        restartWithBrowser = true;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        if (import.meta.env.DEV) console.error("Embedding generation failed", err);
        else console.error("Embedding generation failed:", msg);
        captureLocalError("embedding_generation_failed", err);
        setError(formatEmbeddingError(err));
      }
    } finally {
      embedder?.terminate();
      embeddingPool?.terminate();
    }

    if (restartWithBrowser) {
      try {
        await database.clearEmbeddings();
        await database.upsertIndexMeta({
          key: EMBEDDING_BACKEND_META_KEY,
          value: "browser",
          updatedAt: Date.now(),
        });
        await database.upsertIndexMeta({
          key: EMBEDDING_MODEL_META_KEY,
          value: BROWSER_EMBEDDING_MODEL,
          updatedAt: Date.now(),
        });
        await database.upsertIndexMeta({
          key: "embedding_job_cursor",
          value: "",
          updatedAt: Date.now(),
        });
        setFetchPhase("Ollama unavailable. Restarting embedding generation with browser backend…");
        await generateEmbeddings(database, { forceBrowser: true });
      } catch (restartError) {
        captureLocalError("ollama_restart_with_browser_failed", restartError);
        setError(formatEmbeddingError(restartError));
      }
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
      setHistoryLoadState("empty");
      setHistoryLastRestoredAt(null);
      setHistoryDataSource(null);
      setDbStorageMode(database.storageMode);
      setError(null);
    } catch (err) {
      captureLocalError("clear_local_data_failed", err);
      setError(err instanceof Error ? err.message : "Failed to clear local database");
    }
  };

  const executeSearch = async (
    rawQuery: string,
    options?: {
      preferredSessionId?: string;
    },
  ) => {
    const trimmedQuery = rawQuery.trim();
    if (!trimmedQuery) return;

    try {
      setIsSearching(true);
      setSearchProgress("Preparing search query…");
      setError(null);

      const database = await getLocalDatabase();

      // 1. Generate embedding for query
      let vector: Float32Array;
      const activeEmbeddingBackend = database.getIndexMetaValue(EMBEDDING_BACKEND_META_KEY);
      const activeEmbeddingModel = database.getIndexMetaValue(EMBEDDING_MODEL_META_KEY);
      if (activeEmbeddingBackend === "ollama" && activeEmbeddingModel) {
        setSearchProgress("Generating query embedding with Ollama…");
        try {
          const client = new OllamaEmbeddingClient({
            baseUrl: ollamaBaseUrl.trim() || getDefaultOllamaBaseUrl(),
            model: activeEmbeddingModel,
            timeoutMs: getOllamaTimeoutMs(),
          });
          const vectors = await client.embedBatch([trimmedQuery]);
          if (vectors.length !== 1 || !vectors[0]) {
            throw new Error("query embedding failed: no vector returned from Ollama");
          }
          vector = vectors[0];
          setOllamaConnectionStatus("connected");
          setOllamaConnectionMessage(`Search using Ollama model ${activeEmbeddingModel}.`);
        } catch (ollamaError) {
          captureLocalWarn(
            "ollama_query_embedding_failed",
            ollamaError instanceof Error ? ollamaError.message : String(ollamaError),
          );
          setOllamaConnectionStatus("inactive");
          setOllamaConnectionMessage(
            `Ollama query embedding failed. Search requires the indexed Ollama model: ${formatOllamaConnectionError(
              ollamaError,
            )}`,
          );
          throw new Error(
            "Search unavailable because query embedding with Ollama failed. Restore Ollama connectivity or re-index with the browser embedding backend.",
          );
        }
      } else {
        setSearchProgress("Generating query embedding…");
        const embedder = new Embedder();
        vector = await embedder.embed(trimmedQuery);
        embedder.terminate();
      }

      // 2. Search DB
      setSearchProgress("Running semantic search…");
      const results = await database.findSimilarChunks(vector, 20); // Top 20
      const now = Date.now();

      const preferredSession =
        options?.preferredSessionId != null
          ? sessions.find((session) => session.id === options.preferredSessionId) ?? null
          : null;
      const continuingSession = preferredSession ??
        (sessionMode === "continue" && activeSessionId
          ? sessions.find((session) => session.id === activeSessionId) ?? null
          : null);

      let targetSessionId = continuingSession?.id ?? null;
      if (!targetSessionId) {
        if (!chatScopeKey) {
          throw new Error("Login required");
        }
        targetSessionId = makeScopedSessionId(chatScopeKey);
      }
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
      await database.upsertIndexMeta({
        key: `session_context_ids:${targetSessionId}`,
        value: JSON.stringify(results.map((result) => result.chunkId)),
        updatedAt: now,
      });
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

  const handleSearch = async () => {
    await executeSearch(searchQuery);
  };

  const handleRehydrateSession = async () => {
    if (!activeSession) {
      return;
    }

    setSearchQuery(activeSession.query);
    await executeSearch(activeSession.query, {
      preferredSessionId: activeSession.id,
    });
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
      {dbStorageMode === "memory" ? (
        <Alert variant="destructive">
          <AlertDescription>
            Local persistence quota was exceeded. Running in memory-only mode for this tab; data may be lost on refresh.
            Clear local data or reduce indexed content to restore persistent storage.
          </AlertDescription>
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
              <div className="mt-3 border-t border-border pt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
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
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={allowOllamaEmbedding}
                      onChange={(event) => setAllowOllamaEmbedding(event.target.checked)}
                    />
                    Use Ollama for local embeddings
                  </label>
                  <span className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {ollamaConnectionStatus === "connected"
                      ? "runtime: ollama-active"
                      : ollamaConnectionStatus === "testing"
                        ? "runtime: testing"
                        : ollamaConnectionStatus === "inactive"
                          ? "runtime: fallback-browser"
                          : ollamaConnectionStatus === "failed"
                            ? "runtime: failed"
                            : "runtime: browser"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Requests go only to localhost. No GitHub token is sent.
                </p>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="space-y-1">
                    <Label htmlFor="ollama-base-url" className="text-[11px] text-muted-foreground">
                      Ollama URL
                    </Label>
                    <Input
                      id="ollama-base-url"
                      value={ollamaBaseUrl}
                      onChange={(event) => setOllamaBaseUrl(event.target.value)}
                      placeholder="http://localhost:11434"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ollama-model" className="text-[11px] text-muted-foreground">
                      Embedding model
                    </Label>
                    <Input
                      id="ollama-model"
                      value={ollamaModel}
                      onChange={(event) => setOllamaModel(event.target.value)}
                      placeholder="nomic-embed-text"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleTestOllamaConnection()}
                      disabled={ollamaConnectionStatus === "testing"}
                    >
                      {ollamaConnectionStatus === "testing" ? "Testing…" : "Test connection"}
                    </Button>
                  </div>
                </div>
                {ollamaConnectionMessage ? (
                  <p
                    className={`text-[11px] ${
                      ollamaConnectionStatus === "failed" || ollamaConnectionStatus === "inactive"
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    {ollamaConnectionMessage}
                  </p>
                ) : null}
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
              {historyLoadState === "loading" ? (
                <p className="mt-2 text-xs text-muted-foreground">Loading local chat history…</p>
              ) : null}
              {historyLoadState === "error" ? (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <p className="text-destructive">Failed to load local chat history.</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => void restoreHistory()}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                History restore: {historyLoadState}
                {historyDataSource ? ` · source: ${historyDataSource}` : ""}
                {historyLastRestoredAt ? ` · ${new Date(historyLastRestoredAt).toLocaleString()}` : ""}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Search your stars to create a session; then filter and chat below.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                To query latest stars, click Fetch Stars first to refresh and re-embed new repositories.
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
                      onClick={() => void handleRehydrateSession()}
                    >
                      Re-run search
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <p className="text-[11px] text-muted-foreground">Filter repos in this session</p>
                    <RadioGroup
                      value={sessionMode}
                      onValueChange={(value: string) => setSessionMode(value as "new" | "continue")}
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
            {sessions.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Local chat history is available ({sessions.length} session{sessions.length === 1 ? "" : "s"}). Login to search/sync and continue chats.
              </p>
            ) : null}
            {historyLoadState === "error" ? (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <p className="text-destructive">Local history could not be loaded.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => void restoreHistory()}
                >
                  Retry history load
                </Button>
              </div>
            ) : null}
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
