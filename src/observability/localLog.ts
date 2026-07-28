const LEGACY_LOCAL_LOG_KEY = "gitstarrecall.local_logs.v1";
const LOCAL_LOG_KEY_PREFIX = "gitstarrecall.local_logs.v2.";
const MAX_ENTRIES = 200;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const ERROR_DETAILS_OMITTED = "Error details omitted";
const WARNING_DETAILS_OMITTED = "Warning details omitted";
const MAX_DIAGNOSTIC_ARRAY_LENGTH = 16;

const EMBEDDING_INSTRUMENTATION_NUMBER_FIELDS = [
  "configuredPoolSize",
  "activePoolSize",
  "batchCount",
  "embeddingsProcessed",
  "embeddingsPerSecond",
  "avgBatchEmbedLatencyMs",
  "avgDbCheckpointMs",
  "checkpointEveryEmbeddings",
  "checkpointEveryMs",
  "pendingEmbeddingsSinceCheckpoint",
  "peakQueueDepth",
] as const;

const SEARCH_DIAGNOSTIC_NUMBER_FIELDS = [
  "queryDim",
  "fetchK",
  "topK",
  "mmrLambda",
  "maxChunksPerRepo",
  "lexicalScanLimit",
  "lexicalPoolRecentCount",
  "lexicalPoolBroadCount",
  "lexicalPoolOldestCount",
  "lexicalPoolDedupedCount",
  "corpusRepoCount",
  "corpusChunkCount",
  "rerankVectorMismatchPairs",
  "rerankCapOverrideCount",
] as const;

const SEARCH_DIAGNOSTIC_BOOLEAN_FIELDS = ["denseSuspicious", "lexicalTriggered"] as const;
const SEARCH_DIAGNOSTIC_NUMBER_ARRAY_FIELDS = [
  "sampledIndexDims",
  "denseTopScores",
  "topScores",
] as const;
const SEARCH_DIAGNOSTIC_REASONS = new Set([
  "low_top1",
  "low_top5_mean",
  "low_repo_diversity",
  "rare_token_query",
]);

export type LocalLogEntry = {
  ts: number;
  level: "error" | "warn";
  event: string;
  message: string;
};

function getScopeKey(scopeIdentity: string): string {
  return `${LOCAL_LOG_KEY_PREFIX}${encodeURIComponent(scopeIdentity)}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const storage = localStorage as Partial<Storage>;
    return typeof storage.getItem === "function" &&
      typeof storage.setItem === "function" &&
      typeof storage.removeItem === "function"
      ? (storage as Storage)
      : null;
  } catch {
    return null;
  }
}

function purgeLegacyLogs(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(LEGACY_LOCAL_LOG_KEY);
  } catch {
    // Ignore storage failures. The legacy log is never read or reassigned.
  }
}

function purgeLegacyLogsStrict(storage: Storage): void {
  storage.removeItem(LEGACY_LOCAL_LOG_KEY);

  if (storage.getItem(LEGACY_LOCAL_LOG_KEY) !== null) {
    throw new Error("Failed to clear legacy local logs");
  }
}

purgeLegacyLogs();

function isLogEntry(value: unknown): value is LocalLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<LocalLogEntry>;
  return (
    typeof entry.ts === "number" &&
    Number.isFinite(entry.ts) &&
    (entry.level === "error" || entry.level === "warn") &&
    typeof entry.event === "string" &&
    typeof entry.message === "string"
  );
}

function parseObject(message: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(message) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

type ProtectedWarningPayload = Record<string, number | boolean | string | null | number[]>;

function copyFiniteNumbers(
  source: Record<string, unknown>,
  target: ProtectedWarningPayload,
  fields: readonly string[],
): void {
  for (const field of fields) {
    const value = source[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      target[field] = value;
    }
  }
}

function copyBooleans(
  source: Record<string, unknown>,
  target: ProtectedWarningPayload,
  fields: readonly string[],
): void {
  for (const field of fields) {
    const value = source[field];
    if (typeof value === "boolean") {
      target[field] = value;
    }
  }
}

function copyFiniteNumberArrays(
  source: Record<string, unknown>,
  target: ProtectedWarningPayload,
  fields: readonly string[],
): void {
  for (const field of fields) {
    const value = source[field];
    if (
      Array.isArray(value) &&
      value.length <= MAX_DIAGNOSTIC_ARRAY_LENGTH &&
      value.every((item): item is number => typeof item === "number" && Number.isFinite(item))
    ) {
      target[field] = value;
    }
  }
}

function serializeProtectedPayload(payload: ProtectedWarningPayload): string {
  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : WARNING_DETAILS_OMITTED;
}

function protectEmbeddingInstrumentation(message: string): string {
  const source = parseObject(message);
  if (!source) return WARNING_DETAILS_OMITTED;

  const payload: ProtectedWarningPayload = {};
  copyFiniteNumbers(source, payload, EMBEDDING_INSTRUMENTATION_NUMBER_FIELDS);
  copyBooleans(source, payload, ["poolDownshifted"]);

  if (
    source.lastCheckpointAt === null ||
    (typeof source.lastCheckpointAt === "number" && Number.isFinite(source.lastCheckpointAt))
  ) {
    payload.lastCheckpointAt = source.lastCheckpointAt;
  }

  return serializeProtectedPayload(payload);
}

function protectSearchDiagnostics(message: string): string {
  const source = parseObject(message);
  if (!source) return WARNING_DETAILS_OMITTED;

  const payload: ProtectedWarningPayload = {};
  copyFiniteNumbers(source, payload, SEARCH_DIAGNOSTIC_NUMBER_FIELDS);
  copyBooleans(source, payload, SEARCH_DIAGNOSTIC_BOOLEAN_FIELDS);
  copyFiniteNumberArrays(source, payload, SEARCH_DIAGNOSTIC_NUMBER_ARRAY_FIELDS);

  if (source.lexicalTriggerReason === null) {
    payload.lexicalTriggerReason = null;
  } else if (
    typeof source.lexicalTriggerReason === "string" &&
    SEARCH_DIAGNOSTIC_REASONS.has(source.lexicalTriggerReason)
  ) {
    payload.lexicalTriggerReason = source.lexicalTriggerReason;
  }

  return serializeProtectedPayload(payload);
}

function normalizeEvent(event: string): string {
  switch (event) {
    case "chat_message_backup_failed":
      return "chat_message_backup_failed";
    case "chat_session_backup_failed":
      return "chat_session_backup_failed";
    case "chat_backup_scope_migration_failed":
      return "chat_backup_scope_migration_failed";
    case "embedding_batch_item_recovered":
      return "embedding_batch_item_recovered";
    case "embedding_generation_failed":
      return "embedding_generation_failed";
    case "embedding_instrumentation_run":
      return "embedding_instrumentation_run";
    case "embedding_resume_cursor_reset":
      return "embedding_resume_cursor_reset";
    case "fetch_stars_failed":
      return "fetch_stars_failed";
    case "history_backup_failed":
      return "history_backup_failed";
    case "history_backup_restore_failed":
      return "history_backup_restore_failed";
    case "history_restore_failed":
      return "history_restore_failed";
    case "llm_generation_failed":
      return "llm_generation_failed";
    case "llm_no_context_available":
      return "llm_no_context_available";
    case "oauth_login_start_failed":
      return "oauth_login_start_failed";
    case "ollama_embedding_batch_failed":
      return "ollama_embedding_batch_failed";
    case "ollama_embedding_unavailable":
      return "ollama_embedding_unavailable";
    case "ollama_query_embedding_failed":
      return "ollama_query_embedding_failed";
    case "ollama_restart_with_browser_failed":
      return "ollama_restart_with_browser_failed";
    case "provider_settings_hydration_failed":
      return "provider_settings_hydration_failed";
    case "provider_settings_save_failed":
      return "provider_settings_save_failed";
    case "rebuild_embeddings_failed":
      return "rebuild_embeddings_failed";
    case "search_diagnostics":
      return "search_diagnostics";
    case "search_failed":
      return "search_failed";
    default:
      return "invalid_event";
  }
}

function protectWarningMessage(event: string, message: string): string {
  switch (event) {
    case "embedding_instrumentation_run":
      return protectEmbeddingInstrumentation(message);
    case "embedding_resume_cursor_reset":
      return protectResumeCursorMessage(message);
    case "search_diagnostics":
      return protectSearchDiagnostics(message);
    default:
      return WARNING_DETAILS_OMITTED;
  }
}

function protectResumeCursorMessage(message: string): string {
  const match =
    /^resetting cursor to pending head because (\d+) pending chunks exist before cursor$/.exec(
      message,
    ) ?? /^pending_chunks_before_cursor=(\d+)$/.exec(message);
  if (!match) return WARNING_DETAILS_OMITTED;

  const pendingChunks = Number(match[1]);
  return Number.isSafeInteger(pendingChunks)
    ? `pending_chunks_before_cursor=${pendingChunks}`
    : WARNING_DETAILS_OMITTED;
}

function protectLogEntry(entry: LocalLogEntry): LocalLogEntry {
  const event = normalizeEvent(entry.event);
  return {
    ts: entry.ts,
    level: entry.level,
    event,
    message:
      entry.level === "error" ? ERROR_DETAILS_OMITTED : protectWarningMessage(event, entry.message),
  };
}

function readLogs(scopeIdentity: string, now = Date.now()): LocalLogEntry[] {
  purgeLegacyLogs();
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(getScopeKey(scopeIdentity));
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isLogEntry)
      .map(protectLogEntry)
      .filter((entry) => entry.ts >= now - RETENTION_MS);
  } catch {
    return [];
  }
}

function writeLogs(scopeIdentity: string, entries: LocalLogEntry[], now = Date.now()): void {
  purgeLegacyLogs();
  const storage = getStorage();
  if (!storage) return;
  try {
    const retained = entries.filter((entry) => entry.ts >= now - RETENTION_MS).slice(-MAX_ENTRIES);
    storage.setItem(getScopeKey(scopeIdentity), JSON.stringify(retained));
  } catch {
    // Ignore storage write failures.
  }
}

function capture(
  scopeIdentity: string | null,
  level: LocalLogEntry["level"],
  event: string,
  message: string,
): void {
  purgeLegacyLogs();
  if (!scopeIdentity) return;

  const now = Date.now();
  const normalizedEvent = normalizeEvent(event);
  const entries = readLogs(scopeIdentity, now);
  entries.push({
    ts: now,
    level,
    event: normalizedEvent,
    message:
      level === "error" ? ERROR_DETAILS_OMITTED : protectWarningMessage(normalizedEvent, message),
  });
  writeLogs(scopeIdentity, entries, now);
}

export function captureLocalError(scopeIdentity: string | null, event: string, err: unknown): void {
  void err;
  capture(scopeIdentity, "error", event, ERROR_DETAILS_OMITTED);
}

export function captureLocalWarn(
  scopeIdentity: string | null,
  event: string,
  message: string,
): void {
  capture(scopeIdentity, "warn", event, message);
}

export function getLocalLogs(scopeIdentity: string): LocalLogEntry[] {
  const now = Date.now();
  const entries = readLogs(scopeIdentity, now);
  writeLogs(scopeIdentity, entries, now);
  return entries;
}

export function clearLocalLogsStrict(scopeIdentity: string): void {
  if (!scopeIdentity || !scopeIdentity.trim()) {
    throw new Error("clearLocalLogsStrict requires a non-empty scope identity");
  }

  const storage = getStorage();
  if (!storage) {
    throw new Error("Local log storage is unavailable");
  }

  purgeLegacyLogsStrict(storage);
  const scopeKey = getScopeKey(scopeIdentity);
  storage.removeItem(scopeKey);

  if (storage.getItem(scopeKey) !== null) {
    throw new Error(`Failed to clear local logs for scope ${scopeIdentity}`);
  }
}

export function clearLocalLogs(scopeIdentity: string): void {
  // Best-effort clear for logout and existing callers. Legacy purge and scoped
  // removal are attempted independently so a legacy-key failure cannot block
  // scoped cleanup.
  purgeLegacyLogs();
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(getScopeKey(scopeIdentity));
  } catch {
    // Ignore storage removal failures.
  }
}
