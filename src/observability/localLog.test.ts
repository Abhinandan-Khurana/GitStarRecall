import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureLocalError,
  captureLocalWarn,
  clearLocalLogs,
  clearLocalLogsStrict,
  getLocalLogs,
} from "./localLog";

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

describe("clearLocalLogsStrict", () => {
  const accountAKey = "gitstarrecall.local_logs.v2.github-user%3A1";
  const accountBKey = "gitstarrecall.local_logs.v2.github-user%3A2";

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

  it("rejects an empty scope identity without touching storage", () => {
    storage.setItem(accountAKey, JSON.stringify([]));

    expect(() => clearLocalLogsStrict("")).toThrow(/scope/i);
    expect(() => clearLocalLogsStrict("   ")).toThrow(/scope/i);
    expect(storage.getItem(accountAKey)).not.toBeNull();
  });

  it("removes the scope key and the legacy global key on success", () => {
    captureLocalWarn("github-user:1", "sync_warning", "account A");
    storage.setItem("gitstarrecall.local_logs.v1", JSON.stringify([{ legacy: true }]));
    expect(storage.getItem(accountAKey)).not.toBeNull();

    clearLocalLogsStrict("github-user:1");

    expect(storage.getItem(accountAKey)).toBeNull();
    expect(storage.getItem("gitstarrecall.local_logs.v1")).toBeNull();
  });

  it("leaves account B byte-for-byte intact when clearing account A", () => {
    captureLocalWarn("github-user:1", "sync_warning", "account A");
    captureLocalError("github-user:2", "sync_failure", new Error("account B"));
    const accountBBefore = storage.getItem(accountBKey);

    clearLocalLogsStrict("github-user:1");

    expect(storage.getItem(accountAKey)).toBeNull();
    expect(storage.getItem(accountBKey)).toBe(accountBBefore);
  });

  it("propagates a thrown removeItem instead of reporting success", () => {
    class ThrowingRemoveStorage extends MemoryStorage {
      override removeItem(): void {
        throw new Error("removeItem is unavailable");
      }
    }
    const throwing = new ThrowingRemoveStorage();
    throwing.setItem(accountAKey, JSON.stringify([]));
    vi.stubGlobal("localStorage", throwing);

    expect(() => clearLocalLogsStrict("github-user:1")).toThrow("removeItem is unavailable");
    expect(throwing.getItem(accountAKey)).not.toBeNull();
  });

  it("propagates a legacy-key removeItem failure and leaves legacy data intact", () => {
    class LegacyRemoveFailsStorage extends MemoryStorage {
      override removeItem(key: string): void {
        if (key === "gitstarrecall.local_logs.v1") {
          throw new Error("legacy removeItem is unavailable");
        }
        super.removeItem(key);
      }
    }
    const throwing = new LegacyRemoveFailsStorage();
    throwing.setItem(accountAKey, JSON.stringify([]));
    throwing.setItem("gitstarrecall.local_logs.v1", JSON.stringify([{ legacy: true }]));
    vi.stubGlobal("localStorage", throwing);

    expect(() => clearLocalLogsStrict("github-user:1")).toThrow("legacy removeItem is unavailable");
    expect(throwing.getItem("gitstarrecall.local_logs.v1")).not.toBeNull();
  });

  it("clears the scope key best-effort even when legacy-key removal fails", () => {
    class LegacyRemoveFailsStorage extends MemoryStorage {
      override removeItem(key: string): void {
        if (key === "gitstarrecall.local_logs.v1") {
          throw new Error("legacy removeItem is unavailable");
        }
        super.removeItem(key);
      }
    }
    const throwing = new LegacyRemoveFailsStorage();
    throwing.setItem(accountAKey, JSON.stringify([]));
    throwing.setItem("gitstarrecall.local_logs.v1", JSON.stringify([{ legacy: true }]));
    vi.stubGlobal("localStorage", throwing);

    expect(() => clearLocalLogs("github-user:1")).not.toThrow();
    expect(throwing.getItem(accountAKey)).toBeNull();
  });

  it("throws when the scope key survives a removeItem that lies about success", () => {
    class LyingRemoveStorage extends MemoryStorage {
      override removeItem(): void {
        // Pretend the deletion succeeded while retaining the data.
      }
    }
    const lying = new LyingRemoveStorage();
    lying.setItem(
      accountAKey,
      JSON.stringify([{ ts: 0, level: "warn", event: "e", message: "m" }]),
    );
    vi.stubGlobal("localStorage", lying);

    expect(() => clearLocalLogsStrict("github-user:1")).toThrow(/github-user:1/);
    expect(lying.getItem(accountAKey)).not.toBeNull();
  });
});
