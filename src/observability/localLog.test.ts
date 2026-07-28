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
    captureLocalWarn("github-user:1", "search_diagnostics", JSON.stringify({ topK: 5 }));
    captureLocalError("github-user:2", "search_failed", new Error("account B"));

    const [accountAEntry] = getLocalLogs("github-user:1");
    expect(accountAEntry).toMatchObject({ level: "warn", event: "search_diagnostics" });
    expect(JSON.parse(accountAEntry?.message ?? "")).toEqual({ topK: 5 });
    expect(getLocalLogs("github-user:2").map((entry) => entry.message)).toEqual([
      "Error details omitted",
    ]);

    const accountBKey = "gitstarrecall.local_logs.v2.github-user%3A2";
    const accountBBefore = storage.getItem(accountBKey);
    clearLocalLogs("github-user:1");

    expect(getLocalLogs("github-user:1")).toEqual([]);
    expect(getLocalLogs("github-user:2").map((entry) => entry.message)).toEqual([
      "Error details omitted",
    ]);
    expect(storage.getItem(accountBKey)).toBe(accountBBefore);
  });

  it("never persists arbitrary exception text or malformed event identifiers", () => {
    const rawValues = [
      "ghp_bearerSecret123",
      "sk-apiSecret456",
      "oauthCode789",
      "refreshSecret012",
      "tokenSecret345",
    ];
    captureLocalError(
      "github-user:1",
      `oauth_code=${rawValues[2]}\nforged_event`,
      new Error(
        `Authorization: Bearer ${rawValues[0]} apiKey=${rawValues[1]} oauth_code=${rawValues[2]} refresh_token=${rawValues[3]} token=${rawValues[4]}`,
      ),
    );

    const bytes = persistedBytes(storage);
    for (const rawValue of rawValues) {
      expect(bytes).not.toContain(rawValue);
    }
    expect(getLocalLogs("github-user:1")).toMatchObject([
      {
        level: "error",
        event: "invalid_event",
        message: "Error details omitted",
      },
    ]);
  });

  it("schema-normalizes embedding instrumentation without persisting dynamic values", () => {
    const rawValues = ["ghp_unlabelledPat123", "sk-unlabelledApiKey456"];
    captureLocalWarn(
      "github-user:1",
      "embedding_instrumentation_run",
      JSON.stringify({
        backendIdentity: `webgpu (${rawValues[0]})`,
        configuredPoolSize: 2,
        activePoolSize: 1,
        poolDownshifted: true,
        poolDownshiftReason: `worker failed: ${rawValues[1]}`,
        batchCount: 3,
        embeddingsProcessed: 20,
        embeddingsPerSecond: 4.5,
        avgBatchEmbedLatencyMs: 10,
        avgDbCheckpointMs: 2,
        checkpointEveryEmbeddings: 10,
        checkpointEveryMs: 1_000,
        pendingEmbeddingsSinceCheckpoint: 0,
        lastCheckpointAt: null,
        peakQueueDepth: 8,
        unexpected: rawValues[0],
      }),
    );

    const [entry] = getLocalLogs("github-user:1");
    expect(entry).toMatchObject({
      level: "warn",
      event: "embedding_instrumentation_run",
    });
    const metrics = JSON.parse(entry?.message ?? "") as Record<string, unknown>;
    expect(metrics).toEqual({
      configuredPoolSize: 2,
      activePoolSize: 1,
      batchCount: 3,
      embeddingsProcessed: 20,
      embeddingsPerSecond: 4.5,
      avgBatchEmbedLatencyMs: 10,
      avgDbCheckpointMs: 2,
      checkpointEveryEmbeddings: 10,
      checkpointEveryMs: 1_000,
      pendingEmbeddingsSinceCheckpoint: 0,
      peakQueueDepth: 8,
      poolDownshifted: true,
      lastCheckpointAt: null,
    });
    expect(metrics).not.toHaveProperty("backendIdentity");
    expect(metrics).not.toHaveProperty("poolDownshiftReason");
    for (const rawValue of rawValues) {
      expect(persistedBytes(storage)).not.toContain(rawValue);
    }
  });

  it("retains only schema-proven search diagnostics", () => {
    const rawValue = "ghp_queryTextSecret123";
    captureLocalWarn(
      "github-user:1",
      "search_diagnostics",
      JSON.stringify({
        queryDim: 384,
        sampledIndexDims: [384, 384],
        topK: 5,
        denseSuspicious: true,
        lexicalTriggered: true,
        lexicalTriggerReason: "low_top1",
        topScores: [0.75, 0.5],
        queryText: rawValue,
      }),
    );

    const [entry] = getLocalLogs("github-user:1");
    expect(JSON.parse(entry?.message ?? "")).toEqual({
      queryDim: 384,
      topK: 5,
      denseSuspicious: true,
      lexicalTriggered: true,
      sampledIndexDims: [384, 384],
      topScores: [0.75, 0.5],
      lexicalTriggerReason: "low_top1",
    });
    expect(persistedBytes(storage)).not.toContain(rawValue);
  });

  it("omits exception-derived details from Ollama warnings", () => {
    const secret = "warningTokenSecret";
    captureLocalWarn(
      "github-user:1",
      "ollama_embedding_unavailable",
      `connection failed token=${secret}`,
    );

    expect(getLocalLogs("github-user:1")).toMatchObject([
      {
        level: "warn",
        event: "ollama_embedding_unavailable",
        message: "Warning details omitted",
      },
    ]);
    expect(persistedBytes(storage)).not.toContain(secret);
  });

  it("sanitizes vulnerable v2 entries before returning or rewriting them", () => {
    const scopeKey = "gitstarrecall.local_logs.v2.github-user%3A1";
    const rawValues = ["ghp_existingPat123", "sk-existingApiKey456", "oauthExisting789"];
    storage.setItem(
      scopeKey,
      JSON.stringify([
        {
          ts: Date.now(),
          level: "error",
          event: "search_failed",
          message: `Bearer ${rawValues[0]}`,
        },
        {
          ts: Date.now(),
          level: "warn",
          event: "embedding_instrumentation_run",
          message: JSON.stringify({
            activePoolSize: 1,
            poolDownshifted: true,
            poolDownshiftReason: rawValues[1],
          }),
        },
        {
          ts: Date.now(),
          level: "warn",
          event: `oauth_code=${rawValues[2]}`,
          message: rawValues[0],
        },
      ]),
    );

    const entries = getLocalLogs("github-user:1");
    expect(entries[0]).toMatchObject({
      level: "error",
      event: "search_failed",
      message: "Error details omitted",
    });
    expect(JSON.parse(entries[1]?.message ?? "")).toEqual({
      activePoolSize: 1,
      poolDownshifted: true,
    });
    expect(entries[2]).toMatchObject({
      level: "warn",
      event: "invalid_event",
      message: "Warning details omitted",
    });

    const returnedBytes = JSON.stringify(entries);
    const bytes = persistedBytes(storage);
    for (const rawValue of rawValues) {
      expect(returnedBytes).not.toContain(rawValue);
      expect(bytes).not.toContain(rawValue);
    }
  });

  it("expires entries older than seven days", () => {
    captureLocalWarn("github-user:1", "search_diagnostics", "expired");
    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1_000 + 1);
    captureLocalWarn("github-user:1", "embedding_instrumentation_run", "retained");

    expect(getLocalLogs("github-user:1").map((entry) => entry.event)).toEqual([
      "embedding_instrumentation_run",
    ]);
    expect(persistedBytes(storage)).not.toContain("expired");
  });

  it("retains only the newest 200 entries", () => {
    for (let index = 0; index < 205; index += 1) {
      captureLocalWarn(
        "github-user:1",
        "embedding_resume_cursor_reset",
        `resetting cursor to pending head because ${index} pending chunks exist before cursor`,
      );
    }

    const entries = getLocalLogs("github-user:1");
    expect(entries).toHaveLength(200);
    expect(entries[0]?.message).toBe("pending_chunks_before_cursor=5");
    expect(entries.at(-1)?.message).toBe("pending_chunks_before_cursor=204");
  });

  it("purges unattributable legacy logs and does not persist unauthenticated captures", () => {
    storage.setItem(
      "gitstarrecall.local_logs.v1",
      JSON.stringify([{ ts: Date.now(), level: "error", event: "legacy", message: "secret" }]),
    );

    captureLocalError(null, "oauth_login_start_failed", new Error("code=unauthenticated-secret"));

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
    captureLocalWarn("github-user:1", "search_diagnostics", "account A");
    storage.setItem("gitstarrecall.local_logs.v1", JSON.stringify([{ legacy: true }]));
    expect(storage.getItem(accountAKey)).not.toBeNull();

    clearLocalLogsStrict("github-user:1");

    expect(storage.getItem(accountAKey)).toBeNull();
    expect(storage.getItem("gitstarrecall.local_logs.v1")).toBeNull();
  });

  it("leaves account B byte-for-byte intact when clearing account A", () => {
    captureLocalWarn("github-user:1", "search_diagnostics", "account A");
    captureLocalError("github-user:2", "search_failed", new Error("account B"));
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
