import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLocalError, captureLocalWarn, clearLocalLogs, getLocalLogs } from "./localLog";

class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

function persistedBytes(storage: Storage): string {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => key !== null)
    .map((key) => `${key}:${storage.getItem(key) ?? ""}`)
    .join("\n");
}

describe("scoped local logs", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("isolates reads and clears by authenticated identity", () => {
    captureLocalWarn("github-user:1", "sync_warning", "account A");
    captureLocalError("github-user:2", "sync_failure", new Error("account B"));

    expect(getLocalLogs("github-user:1").map((entry) => entry.message)).toEqual(["account A"]);
    expect(getLocalLogs("github-user:2").map((entry) => entry.message)).toEqual(["account B"]);

    const accountBKey = "gitstarrecall.local_logs.v2.github-user%3A2";
    const accountBBefore = storage.getItem(accountBKey);
    clearLocalLogs("github-user:1");

    expect(getLocalLogs("github-user:1")).toEqual([]);
    expect(getLocalLogs("github-user:2").map((entry) => entry.message)).toEqual(["account B"]);
    expect(storage.getItem(accountBKey)).toBe(accountBBefore);
  });

  it("redacts credentials, OAuth values, and API-key-shaped fields before persistence", () => {
    const secrets = [
      "ghp_bearerSecret123",
      "sk-apiSecret456",
      "oauthCode789",
      "refreshSecret012",
      "clientSecret345",
    ];
    captureLocalError(
      "github-user:1",
      "oauth_code=oauthCode789",
      new Error(
        `Authorization: Bearer ${secrets[0]} apiKey=${secrets[1]} refresh_token=${secrets[3]} client_secret=${secrets[4]}`,
      ),
    );

    const bytes = persistedBytes(storage);
    expect(bytes).toContain("[REDACTED]");
    for (const secret of secrets) {
      expect(bytes).not.toContain(secret);
    }
  });

  it("expires entries older than seven days", () => {
    captureLocalWarn("github-user:1", "old", "expired");
    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1_000 + 1);
    captureLocalWarn("github-user:1", "current", "retained");

    expect(getLocalLogs("github-user:1").map((entry) => entry.event)).toEqual(["current"]);
    expect(persistedBytes(storage)).not.toContain("expired");
  });

  it("retains only the newest 200 entries", () => {
    for (let index = 0; index < 205; index += 1) {
      captureLocalWarn("github-user:1", `event-${index}`, `message-${index}`);
    }

    const entries = getLocalLogs("github-user:1");
    expect(entries).toHaveLength(200);
    expect(entries[0]?.event).toBe("event-5");
    expect(entries.at(-1)?.event).toBe("event-204");
  });

  it("purges unattributable legacy logs and does not persist unauthenticated captures", () => {
    storage.setItem(
      "gitstarrecall.local_logs.v1",
      JSON.stringify([{ ts: Date.now(), level: "error", event: "legacy", message: "secret" }]),
    );

    captureLocalError(null, "oauth_failure", new Error("code=unauthenticated-secret"));

    expect(storage.length).toBe(0);
  });
});
