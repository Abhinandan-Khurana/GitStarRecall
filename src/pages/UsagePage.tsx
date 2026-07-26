import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { buildChatScopeKey, buildEmbeddingPreferenceScopeKey } from "../auth/authScope";
import { createGitHubApiClient } from "../github/client";
import type { RepoReadmeRecord } from "../github/types";
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
import { fetchOllamaModelCatalog, type OllamaModelCatalog } from "../ollama/modelCatalog";
import { float32ToBlob } from "../embeddings/vector";
import {
  BROWSER_EMBEDDING_FALLBACK_MODEL,
  DEFAULT_BROWSER_EMBEDDING_MODEL,
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  formatForEmbedding,
  getRetrievalProfile,
  isCuratedRetrievalModel,
} from "../embeddings/retrievalProfile";
import { inferBackendFromModel } from "../embeddings/modelRouting";
import {
  recommendBrowserEmbeddingModel,
  type BrowserEmbeddingRecommendation,
} from "../embeddings/browserCapability";
import { buildSyncPlan, repoMetadataChanged } from "../sync/plan";
import {
  getChunkingPhaseLabel,
  getChunkingProgressLabel,
  getReadmePhaseLabel,
  getReadmeProgressLabel,
  type IndexingStatus,
} from "../sync/status";
import {
  applyReadmeBatchTransition,
  buildIncompleteSyncResult,
  buildSyncCompletion,
  toPreviousReadmeStateByRepoId,
} from "./readmeSyncOutcome";
import { sortChatMessages } from "../chat/order";
import { captureLocalError, captureLocalWarn } from "../observability/localLog";
import { SessionChat } from "../components/SessionChat";
import { WebLLMDownloadDialog } from "../components/WebLLMDownloadDialog";
import { SearchBar } from "../components/SearchBar";
import { SyncStatusBar } from "../components/SyncStatusBar";
import { OllamaConfigPanel } from "../components/OllamaConfigPanel";
import { DeveloperModePanel, type RetrievalTuning } from "../components/DeveloperModePanel";
import { ProviderSettingsForm } from "../components/ProviderSettingsForm";
import { FilterBar } from "../components/FilterBar";
import { RepoResultCard } from "../components/RepoResultCard";
import { SessionSidebar } from "../components/SessionSidebar";
import { LoginCard } from "../components/LoginCard";
import { EmptyState } from "../components/EmptyState";
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
  isWebLLMEnabled,
} from "../llm/providers";
import { resolveProviderFallback } from "../llm/fallback";
import type { LLMProviderDefinition, LLMProviderId } from "../llm/types";
import { useProviderSettingsPersistence } from "../hooks/useProviderSettingsPersistence";
import {
  getWebLLMSelectableModels,
  WEBLLM_FALLBACK_MODEL_ID,
  WEBLLM_PRIMARY_MODEL_ID,
} from "../llm/webllm/modelCatalog";
import {
  recommendWebLLMModel,
  resolveHermesModelSelection,
  type WebLLMRecommendation,
} from "../llm/webllm/capability";
import { WebLLMProviderError } from "../llm/webllm/engine";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
      selectedModel: string | null;
      fallbackReason: string | null;
    }
  | {
      kind: "ollama";
      runtime: OllamaEmbeddingRuntimeInfo | null;
      baseUrl: string;
      model: string;
    };

type OllamaConnectionStatus = "idle" | "testing" | "connected" | "failed" | "inactive";
type OllamaCatalogStatus = "idle" | "loading" | "ready" | "error";

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
  selectedModel: string | null;
  fallbackReason: string | null;
}): string {
  const { preferredBackend, selectedBackend, selectedModel, fallbackReason } = params;
  if (selectedBackend == null) {
    return `initializing (preferred: ${preferredBackend})`;
  }
  if (selectedBackend === preferredBackend) {
    return selectedModel ? `${selectedBackend} (${selectedModel})` : selectedBackend;
  }

  if (fallbackReason) {
    const modelSuffix = selectedModel ? `, ${selectedModel}` : "";
    return `${selectedBackend}${modelSuffix} (fallback from ${preferredBackend}: ${fallbackReason})`;
  }

  const modelSuffix = selectedModel ? `, ${selectedModel}` : "";
  return `${selectedBackend}${modelSuffix} (fallback from ${preferredBackend})`;
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
    selectedModel: identity.selectedModel,
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
  if (/localhost|127\.0\.0\.1|\[::1\]/i.test(message)) {
    return "Ollama URL must be localhost, 127.0.0.1, or [::1].";
  }
  if (/timed out/i.test(message)) {
    return "Ollama request timed out. Verify localhost URL/port and retry.";
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return [
      "Cannot reach Ollama from the browser.",
      "Ensure Ollama is running (`ollama serve`).",
      "Set `OLLAMA_ORIGINS` to the exact browser origin shown in the address bar; do not use `*`.",
      "Restart Ollama, then click Test again.",
    ].join(" ");
  }
  return message;
}

function formatBrowserEmbeddingSessionError(model: string, err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err);
  const normalized = detail.toLowerCase();
  if (
    normalized.includes("can't create a session") ||
    normalized.includes("unsupported model ir version") ||
    normalized.includes("no available backend")
  ) {
    return new Error(
      `Browser embedding runtime failed for model "${model}". Re-sync stars with browser embeddings ` +
        `to use the compatibility fallback model, or enable Ollama embeddings.`,
    );
  }
  return new Error(`Browser query embedding failed: ${detail}`);
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

function safeParseStringArray(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : null;
  } catch {
    return null;
  }
}

const providerDefinitions = getProviderDefinitions();
const webLLMEnabled = isWebLLMEnabled();
const webLLMModels = getWebLLMSelectableModels();

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
  return DEFAULT_OLLAMA_EMBEDDING_MODEL;
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
const EMBEDDING_BACKEND_META_KEY = "embedding_active_backend";
const EMBEDDING_MODEL_META_KEY = "embedding_active_model";
const BROWSER_EMBEDDING_MODEL = DEFAULT_BROWSER_EMBEDDING_MODEL;
const BROWSER_EMBEDDING_MODEL_CANDIDATES_DEFAULT = [
  DEFAULT_BROWSER_EMBEDDING_MODEL,
  BROWSER_EMBEDDING_FALLBACK_MODEL,
];
const OLLAMA_BATCH_SIZE_CAP = 24;
const OLLAMA_RESTART_BROWSER_ERROR = "__OLLAMA_RESTART_BROWSER__";

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

const RETRIEVAL_TUNING_KEY_PREFIX = "gitstarrecall.retrieval.tuning";
const DEFAULT_RETRIEVAL_TUNING: RetrievalTuning = {
  fetchK: 150,
  topK: 20,
  mmrLambda: 0.72,
  maxChunksPerRepo: 2,
  lexicalTop1Threshold: 0.22,
  lexicalTop5MeanThreshold: 0.18,
};

function normalizeRetrievalTuning(input: Partial<RetrievalTuning> | null | undefined): RetrievalTuning {
  return {
    fetchK:
      Number.isFinite(input?.fetchK) && Number(input?.fetchK) > 0
        ? Math.max(80, Math.min(300, Math.trunc(Number(input?.fetchK))))
        : DEFAULT_RETRIEVAL_TUNING.fetchK,
    topK:
      Number.isFinite(input?.topK) && Number(input?.topK) > 0
        ? Math.max(10, Math.min(40, Math.trunc(Number(input?.topK))))
        : DEFAULT_RETRIEVAL_TUNING.topK,
    mmrLambda:
      Number.isFinite(input?.mmrLambda)
        ? Math.max(0.55, Math.min(0.9, Number(input?.mmrLambda)))
        : DEFAULT_RETRIEVAL_TUNING.mmrLambda,
    maxChunksPerRepo:
      Number.isFinite(input?.maxChunksPerRepo) && Number(input?.maxChunksPerRepo) > 0
        ? Math.max(1, Math.min(5, Math.trunc(Number(input?.maxChunksPerRepo))))
        : DEFAULT_RETRIEVAL_TUNING.maxChunksPerRepo,
    lexicalTop1Threshold:
      Number.isFinite(input?.lexicalTop1Threshold)
        ? Math.max(0.05, Math.min(0.5, Number(input?.lexicalTop1Threshold)))
        : DEFAULT_RETRIEVAL_TUNING.lexicalTop1Threshold,
    lexicalTop5MeanThreshold:
      Number.isFinite(input?.lexicalTop5MeanThreshold)
        ? Math.max(0.05, Math.min(0.5, Number(input?.lexicalTop5MeanThreshold)))
        : DEFAULT_RETRIEVAL_TUNING.lexicalTop5MeanThreshold,
  };
}

function getRetrievalTuningStorageKey(scope: string): string {
  return `${RETRIEVAL_TUNING_KEY_PREFIX}.${scope}`;
}

function getCustomModelWarning(model: string): string | null {
  if (isCuratedRetrievalModel(model)) {
    return null;
  }
  return (
    "Custom embedding model selected. Retrieval quality may be unstable if vector dimensions, " +
    "normalization behavior, or query/document formatting differ from the tuned pipeline."
  );
}

function resolveAutoModel(params: {
  lastUsed: string;
  recommended: string;
  available: string[];
}): string {
  const { lastUsed, recommended, available } = params;
  if (lastUsed && available.includes(lastUsed)) {
    return lastUsed;
  }
  if (recommended && available.includes(recommended)) {
    return recommended;
  }
  return available[0] ?? recommended;
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

async function clearWebLLMRuntimeCaches(): Promise<void> {
  if (!("caches" in globalThis)) {
    return;
  }

  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => {
        const lower = key.toLowerCase();
        return lower.includes("webllm") || lower.includes("mlc") || lower.includes("model");
      })
      .map((key) => caches.delete(key)),
  );
}

export type UsagePageView = "legacy" | "recall" | "settings" | "setup";

type UsagePageProps = {
  view?: UsagePageView;
};

export default function UsagePage({ view = "legacy" }: UsagePageProps) {
  const { accessToken, authScopeIdentity, isAuthenticated, authMethod, loginWithPat, beginOAuthLogin, oauthConfig, logout } =
    useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [patToken, setPatToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fetchingStars, setFetchingStars] = useState(false);
  const [isRebuildingEmbeddings, setIsRebuildingEmbeddings] = useState(false);
  const [fetchPhase, setFetchPhase] = useState<string | null>(null);
  const [indexingStatus, setIndexingStatus] = useState<IndexingStatus | null>(null);
  const [embeddingRunMetrics, setEmbeddingRunMetrics] = useState<EmbeddingRunMetrics | null>(null);
  const [starsSummary, setStarsSummary] = useState<string | null>(null);
  const [dbStorageMode, setDbStorageMode] = useState<string | null>(null);
  const [indexDetailsExpanded, setIndexDetailsExpanded] = useState(true);
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const [repoInventoryCount, setRepoInventoryCount] = useState(0);
  const [storedEmbeddingCount, setStoredEmbeddingCount] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SearchSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedContextChunkIdsBySessionId, setSelectedContextChunkIdsBySessionId] = useState<Record<string, string[]>>({});
  const [sessionMessagesById, setSessionMessagesById] = useState<Record<string, ChatMessageRecord[]>>({});
  const [historyLoadState, setHistoryLoadState] = useState<HistoryLoadState>("idle");
  const [historyLastRestoredAt, setHistoryLastRestoredAt] = useState<number | null>(null);
  const [historyDataSource, setHistoryDataSource] = useState<"sqlite" | "indexeddb" | "local-storage" | null>(null);
  const [sessionMode, setSessionMode] = useState<"new" | "continue">("new");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [topicFilter, setTopicFilter] = useState("all");
  const [updatedWithinDaysFilter, setUpdatedWithinDaysFilter] = useState("all");
  const { providerId, setProviderId, providerBaseUrl, setProviderBaseUrl, providerModel, setProviderModel, providerApiKey, setProviderApiKey, ollamaPreferredChatModel, setOllamaPreferredChatModel, allowRemoteProvider, setAllowRemoteProvider,
    allowLocalProvider, setAllowLocalProvider, webllmConsent, setWebllmConsent, webllmSelectedModel, setWebllmSelectedModel, webllmModelManuallySet, setWebllmModelManuallySet, webllmLastRecommendedModel, setWebllmLastRecommendedModel, saveState: providerSettingsSaveState, statusMessage: providerSettingsStatusMessage } =
    useProviderSettingsPersistence({ scopeIdentity: authScopeIdentity, webLLMEnabled, webLLMPrimaryModel: WEBLLM_PRIMARY_MODEL_ID, providerDefinitions });
  const [webllmRuntimeState, setWebllmRuntimeState] = useState<
    "idle" | "probing" | "needs-consent" | "downloading" | "ready" | "failed"
  >("idle");
  const [webllmRecommendation, setWebllmRecommendation] = useState<WebLLMRecommendation | null>(null);
  const [browserEmbeddingRecommendation, setBrowserEmbeddingRecommendation] =
    useState<BrowserEmbeddingRecommendation | null>(null);
  const [browserEmbeddingModelCandidates, setBrowserEmbeddingModelCandidates] = useState<string[]>(
    BROWSER_EMBEDDING_MODEL_CANDIDATES_DEFAULT,
  );
  const [webllmDownloadProgress, setWebllmDownloadProgress] = useState(0);
  const [webllmProgressText, setWebllmProgressText] = useState<string | null>(null);
  const [webllmDialogOpen, setWebllmDialogOpen] = useState(false);
  const [webllmAllowModelDownload, setWebllmAllowModelDownload] = useState(false);
  const [allowOllamaEmbedding, setAllowOllamaEmbedding] = useState(false);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(getDefaultOllamaBaseUrl());
  const [ollamaModel, setOllamaModel] = useState(getDefaultOllamaModel());
  const [ollamaCatalog, setOllamaCatalog] = useState<OllamaModelCatalog | null>(null);
  const [ollamaCatalogStatus, setOllamaCatalogStatus] = useState<OllamaCatalogStatus>("idle");
  const [ollamaCatalogError, setOllamaCatalogError] = useState<string | null>(null);
  const [ollamaConnectionStatus, setOllamaConnectionStatus] = useState<OllamaConnectionStatus>("idle");
  const [ollamaConnectionMessage, setOllamaConnectionMessage] = useState<string | null>(null);
  const [isSudoUser, setIsSudoUser] = useState(false);
  const [retrievalTuning, setRetrievalTuning] = useState<RetrievalTuning>(DEFAULT_RETRIEVAL_TUNING);
  const [advancedTuningOpen, setAdvancedTuningOpen] = useState(false);
  const [llmPrompt, setLlmPrompt] = useState("");
  const [llmAnswer, setLlmAnswer] = useState("");
  const [llmError, setLlmError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const generationControllerRef = useRef<AbortController | null>(null);
  const pendingWebllmGenerationRef = useRef(false);
  const generateAnswerRef = useRef<() => Promise<void>>(async () => undefined);
  const ollamaCatalogRequestIdRef = useRef(0);
  const ollamaEmbeddingModelManuallySetRef = useRef(false);
  const ollamaChatModelManuallySetRef = useRef(false);
  const searchEmbedderRef = useRef<Embedder | null>(null);
  const searchEmbedderModelCandidatesRef = useRef<string[]>(BROWSER_EMBEDDING_MODEL_CANDIDATES_DEFAULT);
  const browserEmbeddingRecommendationPromiseRef = useRef<Promise<BrowserEmbeddingRecommendation> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const restoreRequestTrackerRef = useRef(createRestoreRequestTracker());
  const webllmPreviousRecommendationRef = useRef<WebLLMRecommendation | null>(null);
  const previousIsAuthenticatedRef = useRef(isAuthenticated);
  const chatScopeKey = useMemo(() => buildChatScopeKey(authScopeIdentity), [authScopeIdentity]);
  const embeddingPreferenceScopeKey = useMemo(
    () => buildEmbeddingPreferenceScopeKey(authScopeIdentity),
    [authScopeIdentity],
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
  const ollamaProviderDefinition = useMemo<LLMProviderDefinition | null>(() => {
    return providerDefinitions.find((provider) => provider.id === "ollama") ?? null;
  }, []);
  const ollamaEmbeddingModelOptions = useMemo(() => ollamaCatalog?.embedding ?? [], [ollamaCatalog]);
  const customEmbeddingModelWarning = useMemo(
    () => (ollamaModel.trim() ? getCustomModelWarning(ollamaModel) : null),
    [ollamaModel],
  );
  const showAdvancedTuning = isSudoUser;

  const updateRetrievalTuning = useCallback(
    (patch: Partial<RetrievalTuning>) => {
      setRetrievalTuning((previous) => normalizeRetrievalTuning({ ...previous, ...patch }));
    },
    [],
  );
  const ollamaChatModelOptions = useMemo(() => ollamaCatalog?.llm ?? [], [ollamaCatalog]);
  const ollamaChatRecommendedModel = useMemo(() => {
    const providerDefault = ollamaProviderDefinition?.defaultModel ?? "llama3.1:8b";
    if (ollamaChatModelOptions.includes(providerDefault)) {
      return providerDefault;
    }
    return ollamaCatalog?.recommendedLlm ?? providerDefault;
  }, [ollamaCatalog, ollamaChatModelOptions, ollamaProviderDefinition]);

  const refreshOllamaCatalog = useCallback(async (baseUrlInput?: string): Promise<OllamaModelCatalog> => {
    const normalizedBaseUrl = (baseUrlInput ?? ollamaBaseUrl).trim() || getDefaultOllamaBaseUrl();
    const nextRequestId = ollamaCatalogRequestIdRef.current + 1;
    ollamaCatalogRequestIdRef.current = nextRequestId;

    setOllamaCatalogStatus("loading");
    setOllamaCatalogError(null);
    try {
      const catalog = await fetchOllamaModelCatalog({
        baseUrl: normalizedBaseUrl,
        timeoutMs: getOllamaTimeoutMs(),
        preferredLlmModel: ollamaProviderDefinition?.defaultModel ?? null,
      });
      if (ollamaCatalogRequestIdRef.current === nextRequestId) {
        setOllamaCatalog(catalog);
        setOllamaCatalogStatus("ready");
      }
      return catalog;
    } catch (err) {
      const formatted = formatOllamaConnectionError(err);
      if (ollamaCatalogRequestIdRef.current === nextRequestId) {
        setOllamaCatalogStatus("error");
        setOllamaCatalogError(formatted);
      }
      throw new Error(formatted);
    }
  }, [ollamaBaseUrl, ollamaProviderDefinition]);

  const handleEmbeddingModelChange = useCallback((value: string) => {
    ollamaEmbeddingModelManuallySetRef.current = true;
    setOllamaModel(value);
  }, []);

  const handleProviderModelChange = useCallback((value: string) => {
    if (providerId === "ollama") {
      ollamaChatModelManuallySetRef.current = true;
      setOllamaPreferredChatModel(value);
    }
    setProviderModel(value);
    if (providerId === "webllm") {
      setWebllmSelectedModel(resolveHermesModelSelection(value));
      setWebllmModelManuallySet(true);
    }
  }, [providerId, setOllamaPreferredChatModel, setProviderModel, setWebllmModelManuallySet, setWebllmSelectedModel]);

  const ensureBrowserEmbeddingRecommendation = useCallback(async (): Promise<BrowserEmbeddingRecommendation> => {
    if (browserEmbeddingRecommendation) {
      return browserEmbeddingRecommendation;
    }
    if (browserEmbeddingRecommendationPromiseRef.current) {
      return browserEmbeddingRecommendationPromiseRef.current;
    }

    const pending = recommendBrowserEmbeddingModel({
      previousRecommendation: browserEmbeddingRecommendation,
    })
      .then((recommendation) => {
        setBrowserEmbeddingRecommendation(recommendation);
        setBrowserEmbeddingModelCandidates((previous) =>
          sameStringArray(previous, recommendation.modelCandidates)
            ? previous
            : recommendation.modelCandidates,
        );
        return recommendation;
      })
      .finally(() => {
        browserEmbeddingRecommendationPromiseRef.current = null;
      });
    browserEmbeddingRecommendationPromiseRef.current = pending;
    return pending;
  }, [browserEmbeddingRecommendation]);

  const getSearchEmbedder = useCallback((modelCandidates?: string[]): Embedder => {
    const nextCandidates = modelCandidates ?? browserEmbeddingModelCandidates;
    if (!sameStringArray(searchEmbedderModelCandidatesRef.current, nextCandidates)) {
      if (searchEmbedderRef.current) {
        searchEmbedderRef.current.terminate();
        searchEmbedderRef.current = null;
      }
      searchEmbedderModelCandidatesRef.current = [...nextCandidates];
    }

    if (searchEmbedderRef.current == null) {
      searchEmbedderRef.current = new Embedder({
        modelCandidates: nextCandidates,
      });
      searchEmbedderModelCandidatesRef.current = [...nextCandidates];
    }
    return searchEmbedderRef.current;
  }, [browserEmbeddingModelCandidates]);

  const resetSearchEmbedder = useCallback(() => {
    if (searchEmbedderRef.current) {
      searchEmbedderRef.current.terminate();
      searchEmbedderRef.current = null;
    }
    searchEmbedderModelCandidatesRef.current = BROWSER_EMBEDDING_MODEL_CANDIDATES_DEFAULT;
  }, []);

  useEffect(() => {
    void ensureBrowserEmbeddingRecommendation();
  }, [ensureBrowserEmbeddingRecommendation]);

  const activeResults = useMemo(() => activeSession?.results ?? [], [activeSession]);
  const workspaceReady = repoInventoryCount > 0 && storedEmbeddingCount > 0;
  const activeSessionMessages = useMemo(() => {
    if (!activeSessionId) {
      return [];
    }

    return sessionMessagesById[activeSessionId] ?? [];
  }, [activeSessionId, sessionMessagesById]);
  const selectedContextChunkIds = useMemo(() => {
    if (!activeSessionId) {
      return [];
    }
    return selectedContextChunkIdsBySessionId[activeSessionId] ?? [];
  }, [activeSessionId, selectedContextChunkIdsBySessionId]);

  useEffect(() => {
    if (!isAuthenticated) {
      setRepoInventoryCount(0);
      setStoredEmbeddingCount(0);
      return;
    }

    let cancelled = false;
    void getLocalDatabase().then((database) => {
      if (cancelled) {
        return;
      }

      setRepoInventoryCount(database.getRepoCount());
      setStoredEmbeddingCount(database.getEmbeddingCount());
    });

    return () => {
      cancelled = true;
    };
  }, [chatScopeKey, indexingStatus, isAuthenticated, starsSummary, sessions.length]);

  useEffect(() => {
    const requestedSessionId = searchParams.get("session");
    if (!requestedSessionId) {
      return;
    }

    if (!sessions.some((session) => session.id === requestedSessionId)) {
      return;
    }

    setActiveSessionId(requestedSessionId);
    setSessionMode("continue");
  }, [searchParams, sessions]);

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
  const selectedContextResults = useMemo(() => {
    const selectedIds = new Set(selectedContextChunkIds);
    return activeResults.filter((result) => selectedIds.has(result.chunkId));
  }, [activeResults, selectedContextChunkIds]);

  const resetResultFilters = useCallback(() => {
    setLanguageFilter("all");
    setTopicFilter("all");
    setUpdatedWithinDaysFilter("all");
  }, []);

  const persistSessionContextSelection = useCallback(async (sessionId: string, chunkIds: string[]) => {
    const database = await getLocalDatabase();
    await database.upsertIndexMeta({
      key: `session_context_ids:${sessionId}`,
      value: JSON.stringify(chunkIds),
      updatedAt: Date.now(),
    });
  }, []);

  const updateSelectedContextForSession = useCallback((sessionId: string, nextChunkIds: string[]) => {
    setSelectedContextChunkIdsBySessionId((previous) => {
      const current = previous[sessionId] ?? [];
      if (sameStringArray(current, nextChunkIds)) {
        return previous;
      }
      return {
        ...previous,
        [sessionId]: nextChunkIds,
      };
    });
    void persistSessionContextSelection(sessionId, nextChunkIds);
  }, [persistSessionContextSelection]);

  const toggleContextChunk = useCallback((chunkId: string) => {
    if (!activeSessionId) {
      return;
    }
    const selectedIds = new Set(selectedContextChunkIdsBySessionId[activeSessionId] ?? []);
    if (selectedIds.has(chunkId)) {
      selectedIds.delete(chunkId);
    } else {
      selectedIds.add(chunkId);
    }
    updateSelectedContextForSession(activeSessionId, activeResults
      .map((result) => result.chunkId)
      .filter((id) => selectedIds.has(id)));
  }, [activeResults, activeSessionId, selectedContextChunkIdsBySessionId, updateSelectedContextForSession]);

  useEffect(() => {
    const requestedQuery = searchParams.get("query");
    if (!requestedQuery) {
      return;
    }
    setSearchQuery((previous) => previous || requestedQuery);
  }, [searchParams]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    let cancelled = false;
    void getLocalDatabase().then((database) => {
      if (cancelled) {
        return;
      }
      const stored = database.getIndexMetaValue(`session_context_ids:${activeSessionId}`);
      const parsed = stored ? safeParseStringArray(stored) : null;
      const activeChunkIds = activeResults.map((result) => result.chunkId);
      const nextSelection = (parsed && parsed.length > 0 ? parsed : activeChunkIds.slice(0, 8))
        .filter((chunkId) => activeChunkIds.includes(chunkId));
      setSelectedContextChunkIdsBySessionId((previous) => ({
        ...previous,
        [activeSessionId]: nextSelection,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [activeResults, activeSessionId]);

  const restoreHistory = useCallback(async () => {
    if (!chatScopeKey) {
      setSessions([]);
      setSelectedContextChunkIdsBySessionId({});
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

  useEffect(() => {
    if (providerId !== "ollama") {
      return;
    }
    const normalizedModel = providerModel.trim();
    if (!normalizedModel) {
      return;
    }
    setOllamaPreferredChatModel((previous) => {
      if (previous === normalizedModel) {
        return previous;
      }
      return normalizedModel;
    });
  }, [providerId, providerModel, setOllamaPreferredChatModel]);

  useEffect(() => {
    if (providerId !== "ollama") {
      return;
    }
    if (ollamaCatalogStatus !== "idle") {
      return;
    }
    void refreshOllamaCatalog().catch(() => undefined);
  }, [providerId, ollamaCatalogStatus, refreshOllamaCatalog]);

  useEffect(() => {
    if (!ollamaCatalog) {
      return;
    }
    if (!ollamaEmbeddingModelManuallySetRef.current && ollamaCatalog.embedding.length > 0) {
      const resolvedEmbeddingModel = resolveAutoModel({
        lastUsed: ollamaModel.trim(),
        recommended: ollamaCatalog.recommendedEmbedding,
        available: ollamaCatalog.embedding,
      });
      if (resolvedEmbeddingModel !== ollamaModel) {
        setOllamaModel(resolvedEmbeddingModel);
      }
    }

    if (providerId === "ollama" && !ollamaChatModelManuallySetRef.current && ollamaCatalog.llm.length > 0) {
      const resolvedChatModel = resolveAutoModel({
        lastUsed: ollamaPreferredChatModel.trim(),
        recommended: ollamaChatRecommendedModel,
        available: ollamaCatalog.llm,
      });
      if (resolvedChatModel !== providerModel) {
        setProviderModel(resolvedChatModel);
      }
      if (resolvedChatModel !== ollamaPreferredChatModel) {
        setOllamaPreferredChatModel(resolvedChatModel);
      }
    }
  }, [
    ollamaCatalog,
    ollamaModel,
    ollamaPreferredChatModel,
    ollamaChatRecommendedModel,
    providerId,
    providerModel,
    setOllamaPreferredChatModel,
    setProviderModel,
  ]);

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
    if (!webLLMEnabled) {
      return;
    }

    let cancelled = false;
    setWebllmRuntimeState("probing");
    void recommendWebLLMModel({
      previousRecommendation: webllmPreviousRecommendationRef.current,
    })
      .then((recommendation) => {
        if (cancelled) {
          return;
        }
        webllmPreviousRecommendationRef.current = recommendation;
        setWebllmRecommendation(recommendation);
        setWebllmLastRecommendedModel(recommendation.modelId);
        const allowAutoSelect =
          !webllmModelManuallySet &&
          (
            !webllmSelectedModel ||
            webllmSelectedModel === WEBLLM_PRIMARY_MODEL_ID ||
            webllmSelectedModel === webllmLastRecommendedModel
          );
        if (allowAutoSelect) {
          setWebllmSelectedModel(recommendation.modelId);
          if (providerId === "webllm") {
            setProviderModel(resolveHermesModelSelection(recommendation.modelId));
          }
        }
        setWebllmRuntimeState("idle");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        const fallbackRecommendation: WebLLMRecommendation = {
          modelId: WEBLLM_FALLBACK_MODEL_ID,
          reason: "probe-failed",
          score: null,
          threshold: null,
          capability: null,
        };
        webllmPreviousRecommendationRef.current = fallbackRecommendation;
        setWebllmRecommendation(fallbackRecommendation);
        setWebllmRuntimeState("idle");
      });

    return () => {
      cancelled = true;
    };
  }, [providerId, setProviderModel, setWebllmLastRecommendedModel, setWebllmSelectedModel, webllmLastRecommendedModel, webllmModelManuallySet, webllmSelectedModel]);

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
    setOllamaCatalog(null);
    setOllamaCatalogStatus("idle");
    setOllamaCatalogError(null);
    ollamaEmbeddingModelManuallySetRef.current = false;
    ollamaChatModelManuallySetRef.current = false;
  }, [embeddingPreferenceScopeKey]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(getRetrievalTuningStorageKey(embeddingPreferenceScopeKey));
      const parsed = raw ? (JSON.parse(raw) as Partial<RetrievalTuning>) : null;
      setRetrievalTuning(normalizeRetrievalTuning(parsed));
    } catch {
      setRetrievalTuning(DEFAULT_RETRIEVAL_TUNING);
    }
  }, [embeddingPreferenceScopeKey]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`gitstarrecall.sudo.${embeddingPreferenceScopeKey}`);
      setIsSudoUser(raw === "1" || raw === "true");
    } catch {
      setIsSudoUser(false);
    }
  }, [embeddingPreferenceScopeKey]);

  useEffect(() => {
    try {
      localStorage.setItem(
        getRetrievalTuningStorageKey(embeddingPreferenceScopeKey),
        JSON.stringify(retrievalTuning),
      );
    } catch {
      // ignore persistence errors for tuning
    }
  }, [embeddingPreferenceScopeKey, retrievalTuning]);

  useEffect(() => {
    try {
      localStorage.setItem(`gitstarrecall.sudo.${embeddingPreferenceScopeKey}`, isSudoUser ? "1" : "0");
    } catch {
      // ignore local preference persistence errors
    }
  }, [embeddingPreferenceScopeKey, isSudoUser]);

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

  useEffect(() => {
    setOllamaCatalog(null);
    setOllamaCatalogStatus("idle");
    setOllamaCatalogError(null);
    ollamaEmbeddingModelManuallySetRef.current = false;
    ollamaChatModelManuallySetRef.current = false;
  }, [ollamaBaseUrl]);

  /* Chat scroll is handled inside SessionChat (only the message list scrolls, not the page) */

  const handleProviderChange = (nextProviderId: LLMProviderId) => {
    const nextProvider =
      providerDefinitions.find((provider) => provider.id === nextProviderId) ?? providerDefinitions[0];
    setProviderId(nextProviderId);
    setProviderBaseUrl(nextProvider.defaultBaseUrl);
    if (nextProviderId === "webllm") {
      const nextModel = resolveHermesModelSelection(webllmSelectedModel || nextProvider.defaultModel);
      setProviderModel(nextModel);
    } else if (nextProviderId === "ollama") {
      const nextModel = resolveAutoModel({
        lastUsed: ollamaPreferredChatModel.trim(),
        recommended: ollamaChatRecommendedModel,
        available: ollamaChatModelOptions,
      });
      setProviderModel(nextModel);
      setOllamaPreferredChatModel(nextModel);
      if (ollamaCatalogStatus === "idle" || ollamaCatalogStatus === "error") {
        void refreshOllamaCatalog();
      }
    } else {
      setProviderModel(nextProvider.defaultModel);
    }
    setLlmError(null);
  };

  const handlePatLogin = async (event: { preventDefault(): void }) => {
    event.preventDefault();

    try {
      await loginWithPat(patToken);
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
      try {
        const catalog = await refreshOllamaCatalog(normalizedBaseUrl);
        setOllamaConnectionMessage(
          `Connected (${runtime.endpoint}) · embedding models ${catalog.embedding.length} · chat models ${catalog.llm.length}`,
        );
      } catch (catalogError) {
        setOllamaConnectionMessage(
          `Connected (${runtime.endpoint}) · model ${runtime.model}. Model list refresh failed: ${formatOllamaConnectionError(catalogError)}`,
        );
      }
    } catch (err) {
      setOllamaConnectionStatus("failed");
      setOllamaConnectionMessage(formatOllamaConnectionError(err));
    }
  }, [ollamaBaseUrl, ollamaModel, refreshOllamaCatalog]);

  const syncStarsToLocal = async (
    database: Awaited<ReturnType<typeof getLocalDatabase>>,
    source: "manual" | "query",
  ): Promise<void> => {
    if (!accessToken) {
      throw new Error("No access token is available.");
    }

    setIndexingStatus({
      phase: source === "manual" ? "Fetching starred repos" : "Refreshing stars before query",
      primaryStage: "fetch-stars",
      readmeActive: false,
      chunkingActive: false,
      embeddingActive: false,
      embeddingWindowed: false,
      startedAt: Date.now(),
      repoTotal: 0,
      readmesTarget: 0,
      readmesCompleted: 0,
      chunkingTarget: 0,
      chunkingCompleted: 0,
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
    const isInitialSync = existingStates.length === 0 && existingRepos.length === 0;
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
              primaryStage: "fetch-stars",
              readmeActive: false,
              chunkingActive: false,
              embeddingActive: false,
              embeddingWindowed: false,
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
          primaryStage: "diff",
          readmeActive: false,
          chunkingActive: false,
          embeddingActive: false,
          embeddingWindowed: false,
          repoTotal: starResult.repos.length,
        }
        : previous,
    );

    if (syncPlan.removedRepoIds.length > 0) {
      await database.deleteReposByIds(syncPlan.removedRepoIds);
    }

    const candidateIds = new Set(syncPlan.candidateRepoIds);
    const candidates = starResult.repos.filter((repo) => candidateIds.has(repo.id));
    const previousSyncStateByRepoId = toPreviousReadmeStateByRepoId(existingStates);
    let chunkUpsertLatencyTotalMs = 0;
    let chunkUpsertCount = 0;
    let firstEmbeddingAvailableAt: number | null = null;
    const successfullyChangedRepoIds = new Set<number>();
    let chunkingCoverageCompleted = 0;
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
          phase: getReadmePhaseLabel(isInitialSync, candidates.length),
          primaryStage: "readmes",
          readmeActive: true,
          chunkingActive: false,
          embeddingActive: false,
          embeddingWindowed: false,
          readmesTarget: candidates.length,
          readmesCompleted: 0,
          chunkingTarget: candidates.length,
          chunkingCompleted: 0,
          readmesMissing: 0,
          readmesFailed: 0,
        }
        : previous,
    );

    const processReadmeBatch = async (
      batch: RepoReadmeRecord[],
      completedReadmes: number,
    ): Promise<void> => {
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
        const metadataChanged = localState ? repoMetadataChanged(localState, remoteRepo) : true;
        const transition = applyReadmeBatchTransition({
          remoteRepo,
          readme,
          localRepo,
          metadataChanged,
          syncedAt,
        });
        if (transition.shouldUpsert) {
          const { record } = transition;
          upserts.push(record);
        }
        if (transition.shouldRechunk) {
          const { record } = transition;
          changedForChunk.push(record);
          successfullyChangedRepoIds.add(record.id);
        }

        const { record } = transition;
        existingReposById.set(record.id, record);
        existingById.set(record.id, transition.syncState);
      }

      chunkingCoverageCompleted += batch.filter(
        (readme) => readme.outcome !== "transient_failure",
      ).length;

      if (upserts.length > 0) {
        await database.upsertRepos(upserts);
      }

      if (changedForChunk.length > 0) {
        setFetchPhase(getChunkingProgressLabel(isInitialSync));
        setIndexingStatus((previous) =>
          previous
            ? {
                ...previous,
                phase: getChunkingPhaseLabel(isInitialSync),
                primaryStage: "chunking",
                readmeActive: previous.readmesCompleted < previous.readmesTarget,
                chunkingActive: true,
                embeddingActive: false,
                embeddingWindowed: false,
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

      setIndexingStatus((previous) =>
        previous
          ? {
              ...previous,
              readmeActive: completedReadmes < previous.readmesTarget,
              chunkingActive: completedReadmes < previous.chunkingTarget,
              embeddingWindowed: previous.embeddingWindowed,
              chunkTotal: database.getChunkCount(),
              chunkingCompleted: Math.max(
                previous.chunkingCompleted,
                chunkingCoverageCompleted,
              ),
            }
          : previous,
      );

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
        setFetchPhase(getReadmeProgressLabel(isInitialSync, progress.completed, progress.total));
      },
      onBatch: usePipelineV2
        ? async (records, progress, stats) => {
            await processReadmeBatch(records, progress.completed);
            lastReadmeStats = stats;
            setFetchPhase(
              getReadmeProgressLabel(isInitialSync, progress.completed, progress.total, stats.p95LatencyMs),
            );
          }
        : undefined,
    });
    const readmeStageDurationMs = performance.now() - readmeStageStartedAt;

    if (!usePipelineV2) {
      await processReadmeBatch(readmeResult.records, readmeResult.records.length);
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
        changedRepos: successfullyChangedRepoIds.size,
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
    const hasPendingEmbeddingChunks = database.getPendingEmbeddingChunkCount() > 0;
    const hasReadmeRetriesPending = readmeResult.failedCount > 0;
    const completion = buildSyncCompletion({
      totalRepos: starResult.repos.length,
      fetchedPages: starResult.fetchedPages,
      candidateCount: candidates.length,
      changedCount: successfullyChangedRepoIds.size,
      removedCount: syncPlan.removedRepoIds.length,
      records: readmeResult.records,
      missingCount: readmeResult.missingCount,
      failedCount: readmeResult.failedCount,
      repoCount: localRepoCount,
      chunkCount: localChunkCount,
      embeddingCount: localEmbeddingCount,
      pendingEmbeddings: hasPendingEmbeddingChunks,
      pipelineV2: usePipelineV2,
      readmeP95LatencyMs: lastReadmeStats.p95LatencyMs,
    });
    setIndexingStatus((previous) =>
      previous
        ? {
            ...previous,
            ...completion.status,
            elapsedSeconds: hasPendingEmbeddingChunks
              ? undefined
              : Math.max(1, Math.round((Date.now() - previous.startedAt) / 1000)),
          }
        : previous,
    );
    setStarsSummary(completion.summary);

    if (hasPendingEmbeddingChunks) {
      await generateEmbeddings(database);
    }
    if (hasReadmeRetriesPending) {
      const finalRepoCount = database.getRepoCount();
      const finalChunkCount = database.getChunkCount();
      const finalEmbeddingCount = database.getEmbeddingCount();
      const incomplete = buildIncompleteSyncResult({
        failedCount: readmeResult.failedCount,
        candidateCount: candidates.length,
        repoCount: finalRepoCount,
        chunkCount: finalChunkCount,
        embeddingCount: finalEmbeddingCount,
      });
      setIndexingStatus((previous) =>
        previous
          ? {
              ...previous,
              ...incomplete.status,
            }
          : previous,
      );
      setStarsSummary(incomplete.summary);
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
            primaryStage: "failed",
            readmeActive: false,
            chunkingActive: false,
            embeddingActive: false,
            embeddingWindowed: false,
          }
          : previous,
      );
      setError(err instanceof Error ? err.message : "Failed to fetch starred repos");
    } finally {
      setFetchingStars(false);
      setFetchPhase(null);
    }
  };

  const handleRebuildEmbeddings = async (skipConfirm = false) => {
    if (isRebuildingEmbeddings) {
      return;
    }
    if (
      !skipConfirm &&
      typeof window !== "undefined" &&
      !window.confirm(
        "Rebuild embeddings now?\n\nThis clears all existing embeddings and re-generates them with current settings. This can take time.",
      )
    ) {
      return;
    }

    try {
      setIsRebuildingEmbeddings(true);
      setError(null);
      setFetchPhase("Rebuilding embeddings with current settings…");
      const database = await getLocalDatabase();
      await database.clearEmbeddings();
      await database.upsertIndexMeta({
        key: "embedding_job_cursor",
        value: "",
        updatedAt: Date.now(),
      });
      setStarsSummary("Rebuilding embeddings with current settings…");
      await generateEmbeddings(database);
    } catch (err) {
      captureLocalError("rebuild_embeddings_failed", err);
      setError(err instanceof Error ? err.message : "Failed to rebuild embeddings");
    } finally {
      setIsRebuildingEmbeddings(false);
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
      const incrementalMode = options?.incremental === true;
      setFetchPhase("Initializing embedding model (this may take a moment)…");
      setIndexingStatus((previous) =>
        previous
          ? {
              ...previous,
              phase: "Initializing embedding model",
              primaryStage: "embedding-init",
              readmeActive: incrementalMode ? previous.readmeActive : false,
              chunkingActive: incrementalMode ? previous.chunkingActive : false,
              embeddingActive: true,
              embeddingWindowed: incrementalMode,
              embeddingsCreated: incrementalMode ? previous.embeddingsCreated : 0,
              embeddingTarget: incrementalMode ? previous.embeddingTarget : 0,
              duplicateEmbeddingHits: incrementalMode ? previous.duplicateEmbeddingHits : 0,
            }
          : previous,
      );

      const preferredBackend = getPreferredEmbeddingBackend();
      const browserEmbeddingPlan = await ensureBrowserEmbeddingRecommendation();
      const browserPreferredModel = browserEmbeddingPlan.modelId;
      const browserModelCandidates = browserEmbeddingPlan.modelCandidates;
      const poolSize = getEmbeddingPoolSize();
      const workerBatchSize = getEmbeddingWorkerBatchSize();
      embedder = new Embedder({
        preferredBackend,
        modelCandidates: browserModelCandidates,
      });
      embeddingPool = new EmbeddingWorkerPool({
        poolSize,
        maxPoolSize: 2,
        workerBatchSize,
        preferredBackend,
        modelCandidates: browserModelCandidates,
      });
      const activeEmbeddingPool = embeddingPool;
      const dbWriteBatchSize = getEmbeddingDbWriteBatchSize();
      const uiUpdateIntervalMs = getEmbeddingUiUpdateIntervalMs();
      const maxBatchChars = 32_000;
      const largeLibraryModeEnabled = getLargeLibraryModeEnabled();
      const largeLibraryThreshold = getLargeLibraryThreshold();
      const forceBrowser = options?.forceBrowser === true;
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
        selectedModel: initialPoolStatus.selectedModel,
        fallbackReason: initialPoolStatus.backendFallbackReason,
      };
      let activeBackendKind: "browser" | "ollama" = "browser";
      let activeEmbeddingModel = browserPreferredModel;
      let activeRetrievalProfile = getRetrievalProfile(activeEmbeddingModel);

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
          activeRetrievalProfile = getRetrievalProfile(activeEmbeddingModel);
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
                primaryStage: "embedding",
                readmeActive: false,
                chunkingActive: false,
                embeddingActive: true,
                embeddingWindowed: false,
                embeddingsCreated: 0,
                embeddingTarget,
                duplicateEmbeddingHits: 0,
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
        const pendingEmbeddingCount = incrementalMode
          ? database.getPendingEmbeddingChunkCount()
          : remaining;
        const queueDepth = Math.max(pendingEmbeddingCount, 0);
        const checkpointStatus = database.getEmbeddingCheckpointStatus();
        const poolStatus = activeEmbeddingPool.getStatus();
        const totalPendingEmbeddingCount = incrementalMode
          ? queueDepth
          : remaining;
        const displayEmbeddingTarget = incrementalMode
          ? processedCount + totalPendingEmbeddingCount
          : embeddingTarget;
        if (backendIdentity.kind === "browser") {
          backendIdentity = {
            kind: "browser",
            preferredBackend: poolStatus.preferredBackend,
            selectedBackend: poolStatus.selectedBackend,
            selectedModel: poolStatus.selectedModel,
            fallbackReason: poolStatus.backendFallbackReason,
          };
        }
        peakQueueDepth = Math.max(peakQueueDepth, queueDepth);
        setIndexingStatus((previous) =>
          previous
            ? {
                ...previous,
                phase: "Generating embeddings",
                primaryStage: "embedding",
                readmeActive: incrementalMode ? previous.readmeActive : false,
                chunkingActive: incrementalMode ? previous.chunkingActive : false,
                embeddingActive: true,
                embeddingWindowed: incrementalMode,
                embeddingsCreated: processedCount,
                embeddingTarget: displayEmbeddingTarget,
                duplicateEmbeddingHits: duplicateHits,
              }
            : previous,
        );
        if (!incrementalMode) {
          setFetchPhase(`Generating embeddings… ${processedCount}/${embeddingTarget} completed`);
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
        const browserRuntimeModel = activeEmbeddingPool.getStatus().selectedModel ?? activeEmbeddingModel;
        const batchModel = ollamaClient ? resolvedOllamaModel : browserRuntimeModel;

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
          const texts = uncachedItems.map((item) =>
            formatForEmbedding(item.text, activeRetrievalProfile.documentPrefix),
          );
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
            const runtimeModel = activeEmbeddingPool.getStatus().selectedModel;
            if (runtimeModel && runtimeModel !== activeEmbeddingModel) {
              activeEmbeddingModel = runtimeModel;
              activeRetrievalProfile = getRetrievalProfile(activeEmbeddingModel);
              await database.upsertIndexMeta({
                key: EMBEDDING_MODEL_META_KEY,
                value: activeEmbeddingModel,
                updatedAt: Date.now(),
              });
            }
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
            let vectorModel = usedBrowserBatch
              ? activeEmbeddingPool.getStatus().selectedModel ?? activeEmbeddingModel
              : resolvedOllamaModel;
            if (!vector) {
              try {
                vector = await embedder.embed(formatForEmbedding(item.text, activeRetrievalProfile.documentPrefix));
                vectorModel = embedder.getRuntimeInfo().selectedModel ?? activeEmbeddingModel;
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
                primaryStage: "complete",
                readmeActive: false,
                chunkingActive: false,
                embeddingActive: false,
                embeddingWindowed: false,
                repoTotal: finalRepoCount,
                readmesCompleted: previous.readmesCompleted,
                readmesTarget: previous.readmesTarget,
                chunkingCompleted: previous.chunkingCompleted,
                chunkingTarget: previous.chunkingTarget,
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
          selectedModel: finalPoolStatus.selectedModel,
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
      resetSearchEmbedder();
      const database = await getLocalDatabase();
      await database.clearAllData();
      await clearWebLLMRuntimeCaches();
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

  useEffect(() => {
    return () => {
      resetSearchEmbedder();
    };
  }, [resetSearchEmbedder]);

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
      let activeEmbeddingBackend = database.getIndexMetaValue(EMBEDDING_BACKEND_META_KEY);
      let activeEmbeddingModel = database.getIndexMetaValue(EMBEDDING_MODEL_META_KEY);
      if (activeEmbeddingModel && activeEmbeddingBackend) {
        const inferredBackend = inferBackendFromModel(activeEmbeddingModel);
        if (activeEmbeddingBackend !== inferredBackend) {
          activeEmbeddingBackend = inferredBackend;
          await database.upsertIndexMeta({
            key: EMBEDDING_BACKEND_META_KEY,
            value: activeEmbeddingBackend,
            updatedAt: Date.now(),
          });
        }
      }
      if (!activeEmbeddingModel || !activeEmbeddingBackend) {
        const inferredModel = database.getDominantEmbeddingModel();
        if (inferredModel) {
          activeEmbeddingModel = inferredModel;
          activeEmbeddingBackend = inferBackendFromModel(inferredModel);
          await database.upsertIndexMeta({
            key: EMBEDDING_BACKEND_META_KEY,
            value: activeEmbeddingBackend,
            updatedAt: Date.now(),
          });
          await database.upsertIndexMeta({
            key: EMBEDDING_MODEL_META_KEY,
            value: activeEmbeddingModel,
            updatedAt: Date.now(),
          });
        }
      }
      let browserEmbeddingPlan: BrowserEmbeddingRecommendation | null = null;
      if (!(activeEmbeddingBackend === "ollama" && activeEmbeddingModel)) {
        browserEmbeddingPlan = await ensureBrowserEmbeddingRecommendation();
      }
      const effectiveModel =
        activeEmbeddingModel ?? browserEmbeddingPlan?.modelId ?? BROWSER_EMBEDDING_MODEL;
      const queryProfile = getRetrievalProfile(effectiveModel);
      const formattedQuery = formatForEmbedding(trimmedQuery, queryProfile.queryPrefix);
      if (activeEmbeddingBackend === "ollama" && activeEmbeddingModel) {
        setSearchProgress("Generating query embedding with Ollama…");
        try {
          const client = new OllamaEmbeddingClient({
            baseUrl: ollamaBaseUrl.trim() || getDefaultOllamaBaseUrl(),
            model: activeEmbeddingModel,
            timeoutMs: getOllamaTimeoutMs(),
          });
          const vectors = await client.embedBatch([formattedQuery]);
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
        try {
          vector = await getSearchEmbedder(
            browserEmbeddingPlan?.modelCandidates ?? browserEmbeddingModelCandidates,
          ).embed(formattedQuery);
        } catch (browserEmbeddingError) {
          resetSearchEmbedder();
          throw formatBrowserEmbeddingSessionError(effectiveModel, browserEmbeddingError);
        }
      }

      // 2. Search DB
      setSearchProgress("Running semantic search…");
      const results = await database.findSimilarChunks(vector, retrievalTuning.topK, {
        queryText: trimmedQuery,
        tuning: retrievalTuning,
        onDiagnostics: (payload) => {
          captureLocalWarn("search_diagnostics", JSON.stringify({
            ...payload,
            topScores: payload.denseTopScores.map((score) => Number(score.toFixed(6))),
          }));
        },
      });
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
      resetResultFilters();
      const defaultContextChunkIds = results.slice(0, 8).map((result) => result.chunkId);
      setSelectedContextChunkIdsBySessionId((previous) => ({
        ...previous,
        [targetSessionId]: defaultContextChunkIds,
      }));
      await database.upsertIndexMeta({
        key: `session_context_ids:${targetSessionId}`,
        value: JSON.stringify(defaultContextChunkIds),
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
            primaryStage: "failed",
            readmeActive: false,
            chunkingActive: false,
            embeddingActive: false,
            embeddingWindowed: false,
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

  const handleSelectSession = (sessionId: string) => {
    void getLocalDatabase().then((db) => {
      setSessionMessagesById((previous) => ({
        ...previous,
        [sessionId]: sortChatMessages(db.listChatMessages(sessionId)),
      }));
    });
    setActiveSessionId(sessionId);
    setSessionMode("continue");
  };

  const handleClearActiveSession = () => {
    setActiveSessionId(null);
    setSessionMode("new");
    resetResultFilters();
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

  const canReachLocalProvider = useCallback(async (provider: "ollama" | "lmstudio"): Promise<boolean> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2000);
    try {
      const url =
        provider === "ollama"
          ? `${(ollamaBaseUrl.trim() || "http://localhost:11434").replace(/\/+$/, "")}/api/tags`
          : `${(
              providerDefinitions.find((item) => item.id === "lmstudio")?.defaultBaseUrl ||
              "http://localhost:1234"
            ).replace(/\/+$/, "")}/v1/models`;
      const response = await fetch(url, { method: "GET", signal: controller.signal });
      return response.ok;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }, [ollamaBaseUrl]);

  const runProviderStream = useCallback(async (args: {
    provider: LLMProviderId;
    model: string;
    promptText: string;
    snippets: string[];
    controller: AbortController;
    onToken: (token: string) => void;
    allowModelDownload: boolean;
  }): Promise<void> => {
    const provider = getProviderById(args.provider);
    const lmStudioDefaultBase =
      providerDefinitions.find((item) => item.id === "lmstudio")?.defaultBaseUrl ||
      "http://localhost:1234";
    const providerBase =
      args.provider === "ollama"
        ? (ollamaBaseUrl.trim() || "http://localhost:11434")
        : args.provider === "lmstudio"
          ? lmStudioDefaultBase
          : providerBaseUrl.trim();
    await provider.stream(
      {
        baseUrl: providerBase,
        model: args.model,
        apiKey: providerApiKey.trim(),
        allowModelDownload: args.allowModelDownload,
      },
      {
        prompt: args.promptText,
        contextSnippets: args.snippets,
        signal: args.controller.signal,
        onToken: args.onToken,
        onInitProgress: (progress, text) => {
          setWebllmDownloadProgress(progress);
          setWebllmProgressText(text);
          setWebllmRuntimeState("downloading");
        },
      },
    );
  }, [ollamaBaseUrl, providerApiKey, providerBaseUrl]);

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

    if (providerId === "webllm" && !webLLMEnabled) {
      setLlmError("WebLLM is disabled. Enable VITE_WEBLLM_ENABLED=1 to use browser models.");
      return;
    }

    if (providerId === "webllm" && !webllmConsent) {
      setWebllmRuntimeState("needs-consent");
      setWebllmDialogOpen(true);
      setLlmError(null);
      return;
    }

    if (selectedProvider.requiresApiKey && !providerApiKey.trim()) {
      setLlmError("API key is required for the selected provider.");
      return;
    }

    const snippets = selectedContextResults.map((result) => {
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
          : "No context selected for chat. " +
          `session_id=${activeSession.id}; total_results=${debug.totalResults}; ` +
          `filtered_results=${debug.filteredResults}; ` +
          `filters={language:${languageFilter},topic:${topicFilter},updatedWithinDays:${updatedWithinDaysFilter}}; ` +
          `pass_counts={language:${debug.languagePassCount},topic:${debug.topicPassCount},recency:${debug.recencyPassCount},invalidUpdatedAt:${debug.invalidUpdatedAtCount}}. ` +
          "Select snippets from the result list or reset filters.";
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

      const streamToken = (token: string) => {
        streamedAnswer += token;
        setLlmAnswer((previous) => previous + token);
      };

      const activeModel = resolveHermesModelSelection(providerModel.trim() || WEBLLM_PRIMARY_MODEL_ID);
      let effectiveProviderId = providerId;
      let effectiveModel = activeModel;

      try {
        await runProviderStream({
          provider: effectiveProviderId,
          model: effectiveModel,
          promptText,
          snippets,
          controller,
          onToken: streamToken,
          allowModelDownload: webllmAllowModelDownload,
        });
        if (effectiveProviderId === "webllm") {
          setWebllmRuntimeState("ready");
        }
      } catch (streamError) {
        if (effectiveProviderId === "webllm" && streamError instanceof WebLLMProviderError) {
          if (streamError.code === "WEBLLM_DOWNLOAD_REQUIRED") {
            setWebllmRuntimeState("needs-consent");
            setWebllmDialogOpen(true);
            setLlmError(null);
            return;
          }

          if (effectiveModel !== WEBLLM_FALLBACK_MODEL_ID) {
            effectiveModel = WEBLLM_FALLBACK_MODEL_ID;
            setProviderModel(effectiveModel);
            setWebllmSelectedModel(effectiveModel);
            try {
              setWebllmRuntimeState("downloading");
              await runProviderStream({
                provider: "webllm",
                model: effectiveModel,
                promptText,
                snippets,
                controller,
                onToken: streamToken,
                allowModelDownload: true,
              });
              setWebllmRuntimeState("ready");
            } catch {
              setWebllmRuntimeState("failed");
            }
          } else {
            setWebllmRuntimeState("failed");
          }

          if (streamedAnswer.trim().length === 0) {
            const fallbackProviderId = resolveProviderFallback({
              canUseOllama: allowLocalProvider && await canReachLocalProvider("ollama"),
              canUseLmStudio: allowLocalProvider && await canReachLocalProvider("lmstudio"),
              canUseOpenAICompatible: allowRemoteProvider && providerApiKey.trim().length > 0,
            });
            if (fallbackProviderId == null) {
              throw streamError;
            }

            effectiveProviderId = fallbackProviderId;
            const fallbackDefinition =
              providerDefinitions.find((provider) => provider.id === fallbackProviderId) ?? null;
            const fallbackModel = fallbackDefinition?.defaultModel ?? "gpt-4o-mini";
            setProviderId(fallbackProviderId);
            setProviderModel(fallbackModel);
            setProviderBaseUrl(fallbackDefinition?.defaultBaseUrl ?? providerBaseUrl);
            setLlmError(`WebLLM failed, switched to ${fallbackDefinition?.label ?? fallbackProviderId}.`);

            await runProviderStream({
              provider: fallbackProviderId,
              model: fallbackModel,
              promptText,
              snippets,
              controller,
              onToken: streamToken,
              allowModelDownload: false,
            });
          } else {
            throw streamError;
          }
        } else {
          throw streamError;
        }
      }

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
      setWebllmAllowModelDownload(false);
    }
  };

  generateAnswerRef.current = handleGenerateAnswer;

  const handleCancelGeneration = () => {
    generationControllerRef.current?.abort();
  };

  useEffect(() => {
    if (!pendingWebllmGenerationRef.current) {
      return;
    }

    if (providerId !== "webllm" || !webllmConsent || !webllmAllowModelDownload) {
      return;
    }

    pendingWebllmGenerationRef.current = false;
    void generateAnswerRef.current();
  }, [providerId, webllmAllowModelDownload, webllmConsent]);

  const handleConfirmWebllmDownload = () => {
    pendingWebllmGenerationRef.current = true;
    setWebllmConsent(true);
    setWebllmAllowModelDownload(true);
    setProviderId("webllm");
    setProviderModel(resolveHermesModelSelection(webllmSelectedModel));
    setWebllmDialogOpen(false);
    setWebllmRuntimeState("downloading");
  };

  const handleCancelWebllmDownload = () => {
    pendingWebllmGenerationRef.current = false;
    setWebllmDialogOpen(false);
    setWebllmRuntimeState("idle");
  };

  return (
    <article className="space-y-5">
      <WebLLMDownloadDialog
        open={webllmDialogOpen}
        recommendedModelId={webllmRecommendation?.modelId ?? WEBLLM_FALLBACK_MODEL_ID}
        selectedModelId={webllmSelectedModel}
        models={webLLMModels}
        recommendationReason={webllmRecommendation?.reason ?? "manual-selection"}
        downloading={webllmRuntimeState === "downloading"}
        progress={webllmDownloadProgress}
        progressText={webllmProgressText}
        onSelectModel={(modelId) => {
          setWebllmSelectedModel(resolveHermesModelSelection(modelId));
          setProviderModel(resolveHermesModelSelection(modelId));
          setWebllmModelManuallySet(true);
        }}
        onConfirm={handleConfirmWebllmDownload}
        onCancel={handleCancelWebllmDownload}
      />

      {error && (
        <Alert variant="destructive" className="animate-fade-in">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {dbStorageMode === "memory" && (
        <Alert variant="destructive" className="animate-fade-in">
          <AlertDescription>
            Local persistence quota was exceeded. Running in memory-only mode for this tab; data may be lost on refresh.
          </AlertDescription>
        </Alert>
      )}

      {isAuthenticated ? (
        view === "setup" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
              <CardHeader className="border-b border-border/60 pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-xl font-semibold text-foreground">Build your local workspace</p>
                    <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                      Import your stars, fetch README content, and generate embeddings so Recall can work against a local index.
                    </p>
                  </div>
                  <Badge variant={workspaceReady ? "secondary" : "outline"} className="rounded-md px-3 py-1">
                    {workspaceReady ? "Ready" : indexingStatus ? indexingStatus.phase : "Setup"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md border border-border/60 bg-background/70 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Connected</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">{authMethod === "oauth" ? "GitHub OAuth" : "Personal token"}</p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background/70 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Indexed repos</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">{repoInventoryCount}</p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background/70 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Embeddings</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">{storedEmbeddingCount}</p>
                  </div>
                </div>

                <div className="rounded-md border border-border/60 bg-background/70 p-4">
                  <p className="text-sm font-medium text-foreground">Recommended path</p>
                  <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
                    <li className="rounded-md border border-border/50 bg-background/70 px-3 py-3">
                      <span className="font-medium text-foreground">1. Import stars</span>
                      <span className="mt-1 block">Pull your starred repos into the local database.</span>
                      <span className="mt-2 block text-xs">
                        {repoInventoryCount > 0 ? "Complete" : fetchingStars ? "In progress" : "Pending"}
                      </span>
                    </li>
                    <li className="rounded-md border border-border/50 bg-background/70 px-3 py-3">
                      <span className="font-medium text-foreground">2. Fetch READMEs</span>
                      <span className="mt-1 block">Download repo documentation for search context.</span>
                      <span className="mt-2 block text-xs">
                        {indexingStatus?.readmesCompleted && indexingStatus.readmesCompleted > 0
                          ? `${indexingStatus.readmesCompleted} fetched`
                          : fetchingStars
                            ? "In progress"
                            : "Pending"}
                      </span>
                    </li>
                    <li className="rounded-md border border-border/50 bg-background/70 px-3 py-3">
                      <span className="font-medium text-foreground">3. Generate embeddings</span>
                      <span className="mt-1 block">Build the semantic index used by Recall and chat context.</span>
                      <span className="mt-2 block text-xs">
                        {storedEmbeddingCount > 0
                          ? `${storedEmbeddingCount} embeddings ready`
                          : isRebuildingEmbeddings || indexingStatus?.embeddingTarget
                            ? "In progress"
                            : "Pending"}
                      </span>
                    </li>
                  </ol>
                </div>

                <SyncStatusBar
                  indexingStatus={indexingStatus}
                  embeddingRunMetrics={embeddingRunMetrics}
                  starsSummary={starsSummary}
                  dbStorageMode={dbStorageMode}
                  indexDetailsExpanded={indexDetailsExpanded}
                  onToggleDetails={() => setIndexDetailsExpanded((expanded) => !expanded)}
                  historyLoadState={historyLoadState}
                  historyDataSource={historyDataSource}
                  historyLastRestoredAt={historyLastRestoredAt}
                  onRetryHistory={() => void restoreHistory()}
                />

                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => void handleFetchStars()} disabled={fetchingStars || isRebuildingEmbeddings} className="rounded-md">
                    {fetchingStars ? "Syncing..." : workspaceReady ? "Run sync again" : "Start sync"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleRebuildEmbeddings(false)}
                    disabled={fetchingStars || isRebuildingEmbeddings || repoInventoryCount === 0}
                    className="rounded-md"
                  >
                    {isRebuildingEmbeddings ? "Rebuilding..." : "Rebuild embeddings"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate("/app/recall")}
                    disabled={!workspaceReady}
                    className="rounded-md"
                  >
                    Continue to Recall
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
                <CardHeader className="border-b border-border/60 pb-4">
                  <p className="font-display text-lg font-semibold text-foreground">Local-first by default</p>
                </CardHeader>
                <CardContent className="space-y-3 pt-5 text-sm text-muted-foreground">
                  <p>Your stars, README content, sessions, and embeddings stay in the browser-local database unless you explicitly use a remote provider.</p>
                  <p>Use the recommended local path first. You can customize the embedding runtime later without blocking the first run.</p>
                </CardContent>
              </Card>

              <Collapsible>
                <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between rounded-none px-6 py-4 text-left font-medium">
                      <span>Customize indexing</span>
                      <span className="text-xs text-muted-foreground">Advanced</span>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="border-t border-border/60 pt-5">
                      <OllamaConfigPanel
                        allowOllamaEmbedding={allowOllamaEmbedding}
                        onAllowOllamaChange={setAllowOllamaEmbedding}
                        ollamaBaseUrl={ollamaBaseUrl}
                        onBaseUrlChange={setOllamaBaseUrl}
                        ollamaModel={ollamaModel}
                        onModelChange={handleEmbeddingModelChange}
                        embeddingModelOptions={ollamaEmbeddingModelOptions}
                        embeddingModelStatus={ollamaCatalogStatus}
                        embeddingModelError={ollamaCatalogError}
                        customModelWarning={customEmbeddingModelWarning}
                        browserEmbeddingRecommendation={browserEmbeddingRecommendation}
                        onRefreshModels={() => {
                          void refreshOllamaCatalog();
                        }}
                        ollamaConnectionStatus={ollamaConnectionStatus}
                        ollamaConnectionMessage={ollamaConnectionMessage}
                        onTestConnection={() => void handleTestOllamaConnection()}
                      />
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            </div>
          </div>
        ) : view === "settings" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
            <div className="space-y-4">
              <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
                <CardHeader className="border-b border-border/60 pb-4">
                  <p className="font-display text-lg font-semibold text-foreground">Sync and indexing</p>
                </CardHeader>
                <CardContent className="space-y-4 pt-5">
                  <SyncStatusBar
                    indexingStatus={indexingStatus}
                    embeddingRunMetrics={embeddingRunMetrics}
                    starsSummary={starsSummary}
                    dbStorageMode={dbStorageMode}
                    indexDetailsExpanded={indexDetailsExpanded}
                    onToggleDetails={() => setIndexDetailsExpanded((expanded) => !expanded)}
                    historyLoadState={historyLoadState}
                    historyDataSource={historyDataSource}
                    historyLastRestoredAt={historyLastRestoredAt}
                    onRetryHistory={() => void restoreHistory()}
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button onClick={() => void handleFetchStars()} disabled={fetchingStars} className="rounded-md">
                      {fetchingStars ? "Syncing..." : "Run sync now"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void handleRebuildEmbeddings(false)}
                      disabled={isRebuildingEmbeddings || repoInventoryCount === 0}
                      className="rounded-md"
                    >
                      {isRebuildingEmbeddings ? "Rebuilding..." : "Rebuild embeddings"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
                <CardHeader className="border-b border-border/60 pb-4">
                  <p className="font-display text-lg font-semibold text-foreground">Embedding engine</p>
                </CardHeader>
                <CardContent className="pt-5">
                  <OllamaConfigPanel
                    allowOllamaEmbedding={allowOllamaEmbedding}
                    onAllowOllamaChange={setAllowOllamaEmbedding}
                    ollamaBaseUrl={ollamaBaseUrl}
                    onBaseUrlChange={setOllamaBaseUrl}
                    ollamaModel={ollamaModel}
                    onModelChange={handleEmbeddingModelChange}
                    embeddingModelOptions={ollamaEmbeddingModelOptions}
                    embeddingModelStatus={ollamaCatalogStatus}
                    embeddingModelError={ollamaCatalogError}
                    customModelWarning={customEmbeddingModelWarning}
                    browserEmbeddingRecommendation={browserEmbeddingRecommendation}
                    onRefreshModels={() => {
                      void refreshOllamaCatalog();
                    }}
                    ollamaConnectionStatus={ollamaConnectionStatus}
                    ollamaConnectionMessage={ollamaConnectionMessage}
                    onTestConnection={() => void handleTestOllamaConnection()}
                  />
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
                <CardHeader className="border-b border-border/60 pb-4">
                  <p className="font-display text-lg font-semibold text-foreground">Developer and retrieval</p>
                </CardHeader>
                <CardContent className="pt-5">
                  <DeveloperModePanel
                    isSudoUser={isSudoUser}
                    onSudoChange={setIsSudoUser}
                    showAdvancedTuning={showAdvancedTuning}
                    advancedTuningOpen={advancedTuningOpen}
                    onAdvancedTuningOpenChange={setAdvancedTuningOpen}
                    retrievalTuning={retrievalTuning}
                    onUpdateRetrievalTuning={updateRetrievalTuning}
                    onRebuildEmbeddings={() => void handleRebuildEmbeddings(true)}
                    isRebuilding={isRebuildingEmbeddings}
                  />
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
                <CardHeader className="border-b border-border/60 pb-4">
                  <p className="font-display text-lg font-semibold text-foreground">Chat provider defaults</p>
                </CardHeader>
                <CardContent className="space-y-4 pt-5 text-sm text-muted-foreground">
                  <div className="rounded-md border border-border/60 bg-background/70 p-4">
                    <p className="text-sm font-medium text-foreground">Default chat route</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Configure provider, endpoint, model, and consent here. Recall now uses these defaults instead of hiding them inside the composer.
                    </p>
                  </div>
                  <ProviderSettingsForm
                    providerId={providerId}
                    onProviderIdChange={(id) => handleProviderChange(id)}
                    providerDefinitions={providerDefinitions}
                    providerBaseUrl={providerBaseUrl}
                    onProviderBaseUrlChange={setProviderBaseUrl}
                    providerModel={providerModel}
                    onProviderModelChange={handleProviderModelChange}
                    providerApiKey={providerApiKey}
                    onProviderApiKeyChange={setProviderApiKey}
                    selectedProvider={selectedProvider}
                    allowRemoteProvider={allowRemoteProvider}
                    onAllowRemoteChange={setAllowRemoteProvider}
                    allowLocalProvider={allowLocalProvider}
                    onAllowLocalChange={setAllowLocalProvider}
                    webllmModels={webLLMModels}
                    ollamaModels={ollamaChatModelOptions}
                    ollamaModelsStatus={ollamaCatalogStatus}
                    ollamaModelsError={ollamaCatalogError}
                    onRefreshOllamaModels={() => {
                      void refreshOllamaCatalog();
                    }}
                  />
                  <p aria-live="polite" className={`text-xs ${providerSettingsSaveState === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                    {providerSettingsStatusMessage}</p>
                  <div className="rounded-md border border-border/60 bg-background/70 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Permissions</p>
                    <p className="mt-2">Remote providers: <span className="font-medium text-foreground">{allowRemoteProvider ? "enabled" : "disabled"}</span></p>
                    <p className="mt-1">Local providers: <span className="font-medium text-foreground">{allowLocalProvider ? "enabled" : "disabled"}</span></p>
                    <p className="mt-1">
                      WebLLM runtime: <span className="font-medium text-foreground">{webllmRuntimeState}</span>
                      {webllmRuntimeState === "downloading"
                        ? ` · ${Math.round(webllmDownloadProgress)}% downloaded`
                        : ""}
                      {webllmProgressText ? ` · ${webllmProgressText}` : ""}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
                <CardHeader className="border-b border-border/60 pb-4">
                  <p className="font-display text-lg font-semibold text-foreground">Account and local data</p>
                </CardHeader>
                <CardContent className="space-y-4 pt-5">
                  {authMethod === "pat" ? (
                    <Alert>
                      <AlertDescription>
                        You are using a Personal Access Token. OAuth remains the recommended path for long-term use.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-border/60 bg-background/70 p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Storage mode</p>
                      <p className="mt-2 text-sm font-semibold text-foreground">{dbStorageMode ?? "Unknown"}</p>
                    </div>
                    <div className="rounded-md border border-border/60 bg-background/70 p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">History restore</p>
                      <p className="mt-2 text-sm font-semibold text-foreground">{historyLoadState}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button variant="outline" className="rounded-md" onClick={logout}>
                      {authMethod === "oauth" ? "Sign out of GitHub" : "Clear PAT session"}
                    </Button>
                    <Button variant="destructive" className="rounded-md" onClick={() => void handleClearLocalData()}>
                      Delete local data
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : view === "recall" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
            <div className="space-y-4">
              <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
                <CardContent className="space-y-4 pt-6">
                  <SearchBar
                    query={searchQuery}
                    onQueryChange={setSearchQuery}
                    onSearch={() => void handleSearch()}
                    isSearching={isSearching}
                    onFetchStars={() => void handleFetchStars()}
                    isFetching={fetchingStars}
                    fetchPhase={fetchPhase}
                    searchProgress={searchProgress}
                  />
                  <SyncStatusBar
                    indexingStatus={indexingStatus}
                    embeddingRunMetrics={embeddingRunMetrics}
                    starsSummary={starsSummary}
                    dbStorageMode={dbStorageMode}
                    indexDetailsExpanded={indexDetailsExpanded}
                    onToggleDetails={() => setIndexDetailsExpanded((expanded) => !expanded)}
                    historyLoadState={historyLoadState}
                    historyDataSource={historyDataSource}
                    historyLastRestoredAt={historyLastRestoredAt}
                    onRetryHistory={() => void restoreHistory()}
                  />
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
                <CardHeader className="border-b border-border/60 pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-display text-lg font-semibold text-foreground">
                        {activeSession ? activeSession.title : "Recall results"}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Search by memory, then inspect the strongest matches before sending chat context.
                      </p>
                    </div>
                    <Badge variant="secondary" className="rounded-md">
                      {activeSession ? `${filteredResults.length} shown` : "No session"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-5">
                  {activeSession ? (
                    <>
                      {activeSession.results.length === 0 ? (
                        <div className="rounded-md border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                          This session has no results in memory. Re-run the search to refresh it.
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="mt-3 rounded-md"
                            onClick={() => void handleRehydrateSession()}
                          >
                            Re-run search
                          </Button>
                        </div>
                      ) : (
                        <>
                          <FilterBar
                            sessionMode={sessionMode}
                            onSessionModeChange={(mode) => setSessionMode(mode)}
                            activeSessionId={activeSessionId}
                            languageFilter={languageFilter}
                            onLanguageChange={setLanguageFilter}
                            topicFilter={topicFilter}
                            onTopicChange={setTopicFilter}
                            updatedWithinDaysFilter={updatedWithinDaysFilter}
                            onUpdatedWithinDaysChange={setUpdatedWithinDaysFilter}
                            availableLanguages={availableLanguages}
                            availableTopics={availableTopics}
                            filteredCount={filteredResults.length}
                            totalCount={activeSession.results.length}
                            onResetFilters={resetResultFilters}
                          />
                          <div className="max-h-[min(50vh,32rem)] space-y-2 overflow-auto rounded-md border border-border/60 bg-background/60 p-3">
                            {filteredResults.map((result) => (
                              <RepoResultCard
                                key={result.chunkId}
                                chunkId={result.chunkId}
                                repoFullName={result.repoFullName}
                                repoUrl={result.repoUrl}
                                repoDescription={result.repoDescription}
                                language={result.language}
                                topics={result.topics}
                                score={result.score}
                                text={result.text}
                                selected={selectedContextChunkIds.includes(result.chunkId)}
                                onToggleSelect={toggleContextChunk}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="rounded-md border border-dashed border-border/60 bg-background/60 p-8 text-center">
                      <p className="font-display text-lg font-semibold text-foreground">Start with a memory, not a repo name</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Try: "browser-based vector database", "TypeScript auth starter", or "GraphQL security toolkit".
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <SessionSidebar
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelectSession={handleSelectSession}
                onClearActive={handleClearActiveSession}
              />

              <Card className="flex min-h-[32rem] flex-col border-border/60 bg-[var(--app-panel)] shadow-none">
                <CardHeader className="border-b border-border/60 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-display text-lg font-semibold text-foreground">Chat context</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Review and select the snippets that should be sent with your prompt.
                      </p>
                    </div>
                    <Badge variant="outline" className="rounded-md">
                      {selectedContextResults.length} selected
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 flex-col pt-5">
                  {activeSession ? (
                    <>
                      <div className="mb-4 rounded-md border border-border/60 bg-background/70 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">Selected context</p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-md"
                              onClick={() => activeSessionId ? updateSelectedContextForSession(activeSessionId, filteredResults.slice(0, 8).map((result) => result.chunkId)) : undefined}
                            >
                              Select top matches
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-md"
                              onClick={() => activeSessionId ? updateSelectedContextForSession(activeSessionId, filteredResults.map((result) => result.chunkId)) : undefined}
                            >
                              Select filtered
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="rounded-md"
                              onClick={() => activeSessionId ? updateSelectedContextForSession(activeSessionId, []) : undefined}
                            >
                              Clear
                            </Button>
                          </div>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {selectedContextResults.length > 0
                            ? `${selectedContextResults.length} snippets will be included with your next prompt.`
                            : "No context selected yet. Pick snippets from the result list before sending."}
                        </p>
                      </div>
                      <SessionChat
                        messages={activeSessionMessages}
                        isGenerating={isGenerating}
                        streamingContent={llmAnswer}
                        prompt={llmPrompt}
                        onPromptChange={setLlmPrompt}
                        onSend={() => void handleGenerateAnswer()}
                        onCancel={handleCancelGeneration}
                        error={llmError}
                        canSend={selectedContextResults.length > 0}
                        noResultsHint={selectedContextResults.length === 0}
                        messagesEndRef={messagesEndRef}
                        providerId={providerId}
                        providerBaseUrl={providerBaseUrl}
                        providerModel={providerModel}
                        providerApiKey={providerApiKey}
                        onProviderIdChange={(id) => handleProviderChange(id)}
                        onProviderBaseUrlChange={setProviderBaseUrl}
                        onProviderModelChange={handleProviderModelChange}
                        onProviderApiKeyChange={setProviderApiKey}
                        selectedProvider={selectedProvider}
                        providerDefinitions={providerDefinitions}
                        allowRemoteProvider={allowRemoteProvider}
                        allowLocalProvider={allowLocalProvider}
                        onAllowRemoteChange={setAllowRemoteProvider}
                        onAllowLocalChange={setAllowLocalProvider}
                        webllmModels={webLLMModels}
                        ollamaModels={ollamaChatModelOptions}
                        ollamaModelsStatus={ollamaCatalogStatus}
                        ollamaModelsError={ollamaCatalogError}
                        onRefreshOllamaModels={() => {
                          void refreshOllamaCatalog();
                        }}
                      />
                    </>
                  ) : (
                    <EmptyState type="no-session" />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
          {/* Search & Controls */}
          <div className="space-y-3">
            <SearchBar
              query={searchQuery}
              onQueryChange={setSearchQuery}
              onSearch={() => void handleSearch()}
              isSearching={isSearching}
              onFetchStars={() => void handleFetchStars()}
              isFetching={fetchingStars}
              fetchPhase={fetchPhase}
              searchProgress={searchProgress}
            />

            <div className="flex items-center gap-2">
              <OllamaConfigPanel
                allowOllamaEmbedding={allowOllamaEmbedding}
                onAllowOllamaChange={setAllowOllamaEmbedding}
                ollamaBaseUrl={ollamaBaseUrl}
                onBaseUrlChange={setOllamaBaseUrl}
                ollamaModel={ollamaModel}
                onModelChange={handleEmbeddingModelChange}
                embeddingModelOptions={ollamaEmbeddingModelOptions}
                embeddingModelStatus={ollamaCatalogStatus}
                embeddingModelError={ollamaCatalogError}
                customModelWarning={customEmbeddingModelWarning}
                browserEmbeddingRecommendation={browserEmbeddingRecommendation}
                onRefreshModels={() => {
                  void refreshOllamaCatalog();
                }}
                ollamaConnectionStatus={ollamaConnectionStatus}
                ollamaConnectionMessage={ollamaConnectionMessage}
                onTestConnection={() => void handleTestOllamaConnection()}
              />
            </div>
            <DeveloperModePanel
              isSudoUser={isSudoUser}
              onSudoChange={setIsSudoUser}
              showAdvancedTuning={showAdvancedTuning}
              advancedTuningOpen={advancedTuningOpen}
              onAdvancedTuningOpenChange={setAdvancedTuningOpen}
              retrievalTuning={retrievalTuning}
              onUpdateRetrievalTuning={updateRetrievalTuning}
              onRebuildEmbeddings={() => void handleRebuildEmbeddings(true)}
              isRebuilding={isRebuildingEmbeddings}
            />

            <SyncStatusBar
              indexingStatus={indexingStatus}
              embeddingRunMetrics={embeddingRunMetrics}
              starsSummary={starsSummary}
              dbStorageMode={dbStorageMode}
              indexDetailsExpanded={indexDetailsExpanded}
              onToggleDetails={() => setIndexDetailsExpanded((e) => !e)}
              historyLoadState={historyLoadState}
              historyDataSource={historyDataSource}
              historyLastRestoredAt={historyLastRestoredAt}
              onRetryHistory={() => void restoreHistory()}
            />
          </div>

          {/* Session results + filters */}
          {activeSession && (
            <div className="animate-fade-in space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-semibold text-foreground">
                  {activeSession.title}
                </h2>
              </div>

              {activeSession.results.length === 0 ? (
                <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    This session has no results in memory. Run the same search again to repopulate.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() => void handleRehydrateSession()}
                  >
                    Re-run search
                  </Button>
                </div>
              ) : (
                <>
                  <FilterBar
                    sessionMode={sessionMode}
                    onSessionModeChange={(mode) => setSessionMode(mode)}
                    activeSessionId={activeSessionId}
                    languageFilter={languageFilter}
                    onLanguageChange={setLanguageFilter}
                    topicFilter={topicFilter}
                    onTopicChange={setTopicFilter}
                    updatedWithinDaysFilter={updatedWithinDaysFilter}
                    onUpdatedWithinDaysChange={setUpdatedWithinDaysFilter}
                    availableLanguages={availableLanguages}
                    availableTopics={availableTopics}
                    filteredCount={filteredResults.length}
                    totalCount={activeSession.results.length}
                    onResetFilters={resetResultFilters}
                  />

                  <div className="max-h-[min(50vh,24rem)] space-y-1.5 overflow-auto rounded-lg border border-border/30 bg-background/30 p-2">
                    {filteredResults.map((result) => (
                      <RepoResultCard
                        key={result.chunkId}
                        chunkId={result.chunkId}
                        repoFullName={result.repoFullName}
                        repoUrl={result.repoUrl}
                        repoDescription={result.repoDescription}
                        language={result.language}
                        topics={result.topics}
                        score={result.score}
                        text={result.text}
                        selected={selectedContextChunkIds.includes(result.chunkId)}
                        onToggleSelect={toggleContextChunk}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Chat section: sidebar + main chat */}
          <div className="flex flex-col gap-4 md:flex-row md:items-stretch">
            <SessionSidebar
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={handleSelectSession}
              onClearActive={handleClearActiveSession}
            />

            {/* Main chat area */}
            <div className="min-w-0 flex-1">
              {activeSession ? (
                <Card className="flex h-full flex-col border-border/50 bg-card/50">
                  <CardHeader className="py-3">
                    <p className="text-sm font-medium text-foreground">Chat</p>
                    <p className="text-[11px] text-muted-foreground">
                      Selected snippets are sent as context.
                    </p>
                    {providerId === "webllm" && (
                      <p className="text-[11px] text-muted-foreground">
                        WebLLM: {webllmRuntimeState}
                        {webllmRuntimeState === "downloading"
                          ? ` -- ${Math.round(webllmDownloadProgress)}% downloaded`
                          : ""}
                        {webllmProgressText ? ` -- ${webllmProgressText}` : ""}
                      </p>
                    )}
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
                      canSend={selectedContextResults.length > 0}
                      noResultsHint={selectedContextResults.length === 0}
                      messagesEndRef={messagesEndRef}
                      providerId={providerId}
                      providerBaseUrl={providerBaseUrl}
                      providerModel={providerModel}
                      providerApiKey={providerApiKey}
                      onProviderIdChange={(id) => handleProviderChange(id)}
                      onProviderBaseUrlChange={setProviderBaseUrl}
                      onProviderModelChange={handleProviderModelChange}
                      onProviderApiKeyChange={setProviderApiKey}
                      selectedProvider={selectedProvider}
                      providerDefinitions={providerDefinitions}
                      allowRemoteProvider={allowRemoteProvider}
                      allowLocalProvider={allowLocalProvider}
                      onAllowRemoteChange={setAllowRemoteProvider}
                      onAllowLocalChange={setAllowLocalProvider}
                      webllmModels={webLLMModels}
                      ollamaModels={ollamaChatModelOptions}
                      ollamaModelsStatus={ollamaCatalogStatus}
                      ollamaModelsError={ollamaCatalogError}
                      onRefreshOllamaModels={() => {
                        void refreshOllamaCatalog();
                      }}
                    />
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-border/50 bg-card/50">
                  <CardContent className="p-0">
                    <EmptyState type="no-session" />
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Account section */}
          <Collapsible open={sessionsExpanded} onOpenChange={setSessionsExpanded}>
            <Card className="border-border/50 bg-card/30">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between px-4 py-2.5 font-normal">
                  <span className="text-sm">Account</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="hidden sm:inline">{authMethod}</span>
                    <span>{sessionsExpanded ? "\u2212" : "+"}</span>
                  </span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="border-t border-border/30 pt-4">
                  {authMethod === "pat" && (
                    <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                      {"You are using a Personal Access Token. For better security, prefer "}
                      <Button variant="link" className="h-auto p-0 text-xs font-medium text-amber-200 underline" onClick={() => void handleOAuth()}>
                        GitHub OAuth
                      </Button>.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" className="h-7 rounded-lg text-xs" onClick={logout}>
                      Clear token
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 rounded-lg text-xs"
                      onClick={() => void handleClearLocalData()}
                    >
                      Delete local data
                    </Button>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
        )
      ) : (
        <LoginCard
          onOAuthLogin={() => void handleOAuth()}
          patToken={patToken}
          onPatChange={setPatToken}
          onPatSubmit={handlePatLogin}
          oauthRedirectUri={oauthConfig.redirectUri}
          error={error}
          sessionCount={sessions.length}
          historyLoadState={historyLoadState}
          onRetryHistory={() => void restoreHistory()}
        />
      )}
    </article>
  );
}
