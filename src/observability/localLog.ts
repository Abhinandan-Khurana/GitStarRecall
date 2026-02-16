const LOCAL_LOG_KEY = "gitstarrecall.local_logs.v1";
const MAX_ENTRIES = 200;

export type LocalLogEntry = {
  ts: number;
  level: "error" | "warn";
  event: string;
  message: string;
};

function readLogs(): LocalLogEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_LOG_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as LocalLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLogs(entries: LocalLogEntry[]): void {
  try {
    localStorage.setItem(LOCAL_LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Ignore storage write failures.
  }
}

export function captureLocalError(event: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const entries = readLogs();
  entries.push({
    ts: Date.now(),
    level: "error",
    event,
    message,
  });
  writeLogs(entries);
}

export function captureLocalWarn(event: string, message: string): void {
  const entries = readLogs();
  entries.push({
    ts: Date.now(),
    level: "warn",
    event,
    message,
  });
  writeLogs(entries);
}

export function getLocalLogs(): LocalLogEntry[] {
  return readLogs();
}
