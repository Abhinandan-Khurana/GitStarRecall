const LEGACY_LOCAL_LOG_KEY = "gitstarrecall.local_logs.v1";
const LOCAL_LOG_KEY_PREFIX = "gitstarrecall.local_logs.v2.";
const MAX_ENTRIES = 200;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export type LocalLogEntry = {
  ts: number;
  level: "error" | "warn";
  event: string;
  message: string;
};

function getScopeKey(scopeIdentity: string): string {
  return `${LOCAL_LOG_KEY_PREFIX}${encodeURIComponent(scopeIdentity)}`;
}

function purgeLegacyLogs(): void {
  try {
    localStorage.removeItem(LEGACY_LOCAL_LOG_KEY);
  } catch {
    // Ignore storage failures. The legacy log is never read or reassigned.
  }
}

if (typeof localStorage !== "undefined") {
  purgeLegacyLogs();
}

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

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /(["']?(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?code|client[_-]?secret|token|secret|code)["']?\s*[:=]\s*)(["'][^"']*["']|[^\s,;}]+)/gi,
      "$1[REDACTED]",
    );
}

function readLogs(scopeIdentity: string, now = Date.now()): LocalLogEntry[] {
  purgeLegacyLogs();
  try {
    const raw = localStorage.getItem(getScopeKey(scopeIdentity));
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLogEntry).filter((entry) => entry.ts >= now - RETENTION_MS);
  } catch {
    return [];
  }
}

function writeLogs(scopeIdentity: string, entries: LocalLogEntry[], now = Date.now()): void {
  purgeLegacyLogs();
  try {
    const retained = entries.filter((entry) => entry.ts >= now - RETENTION_MS).slice(-MAX_ENTRIES);
    localStorage.setItem(getScopeKey(scopeIdentity), JSON.stringify(retained));
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
  const entries = readLogs(scopeIdentity, now);
  entries.push({
    ts: now,
    level,
    event: redactSensitiveText(event),
    message: redactSensitiveText(message),
  });
  writeLogs(scopeIdentity, entries, now);
}

export function captureLocalError(scopeIdentity: string | null, event: string, err: unknown): void {
  capture(scopeIdentity, "error", event, err instanceof Error ? err.message : String(err));
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

export function clearLocalLogs(scopeIdentity: string): void {
  purgeLegacyLogs();
  try {
    localStorage.removeItem(getScopeKey(scopeIdentity));
  } catch {
    // Ignore storage failures.
  }
}
