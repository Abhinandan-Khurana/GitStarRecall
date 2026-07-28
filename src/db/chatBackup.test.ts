import {
  IDBFactory,
  IDBIndex as FakeIDBIndex,
  IDBKeyRange as FakeIDBKeyRange,
  IDBObjectStore as FakeIDBObjectStore,
} from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessageRecord, ChatSessionRecord } from "./types";
import {
  backupChatMessage,
  backupChatSession,
  backupChatSnapshot,
  clearChatBackup,
  loadChatBackup,
  migrateChatBackupScope,
  type ChatBackupScope,
} from "./chatBackup";

const LEGACY_SESSIONS_KEY = "gitstarrecall.chat.backup.sessions.v1";
const LEGACY_MESSAGES_KEY = "gitstarrecall.chat.backup.messages.v1";
// Implementation-owned scoped key; asserted here so the bounds test can seed a
// full store cheaply instead of writing 5000 records through the queue.
const SCOPED_MESSAGES_KEY_A = "gitstarrecall.chat.backup.messages.v2.user-a";
const SCOPED_SESSIONS_KEY_A = "gitstarrecall.chat.backup.sessions.v2.user-a";
const LEGACY_MIGRATED_KEY = "gitstarrecall.chat.backup.legacy-migrated.v2.legacy-user";
const MIGRATION_MARKER_KEY_A = "gitstarrecall.chat.backup.legacy-migrated.v2.user-a";
const BACKUP_DB_NAME = "gitstarrecall-chat-backup";

/**
 * An in-memory Storage that can be told to throw exactly once on the next
 * `setItem` whose value contains a marker substring. This drives a single write
 * to a hard failure without disturbing the writes queued around it.
 */
class MemoryStorage implements Storage {
  private entries = new Map<string, string>();
  private throwOnceOnValueIncludes: string | null = null;
  private throwOnceOnRemoveKey: string | null = null;
  private ignoreOnceOnRemoveKey: string | null = null;
  private throwOnceOnGetKey: string | null = null;
  private runOnceAfterSet: { key: string; run: () => void } | null = null;
  private runOnceAfterRemove: { key: string; run: () => void } | null = null;

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    if (this.throwOnceOnGetKey === key) {
      this.throwOnceOnGetKey = null;
      throw new DOMException("storage unavailable", "SecurityError");
    }
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    if (this.throwOnceOnRemoveKey === key) {
      this.throwOnceOnRemoveKey = null;
      throw new DOMException("storage unavailable", "SecurityError");
    }
    if (this.ignoreOnceOnRemoveKey === key) {
      this.ignoreOnceOnRemoveKey = null;
      return;
    }
    this.entries.delete(key);
    if (this.runOnceAfterRemove?.key === key) {
      const hook = this.runOnceAfterRemove;
      this.runOnceAfterRemove = null;
      hook.run();
    }
  }

  setItem(key: string, value: string): void {
    if (this.throwOnceOnValueIncludes !== null && value.includes(this.throwOnceOnValueIncludes)) {
      this.throwOnceOnValueIncludes = null;
      throw new DOMException("quota exceeded", "QuotaExceededError");
    }
    this.entries.set(key, value);
    if (this.runOnceAfterSet?.key === key) {
      const hook = this.runOnceAfterSet;
      this.runOnceAfterSet = null;
      hook.run();
    }
  }

  /** Runs `run` immediately after the next successful write to `key`. */
  afterNextWrite(key: string, run: () => void): void {
    this.runOnceAfterSet = { key, run };
  }

  /** Runs `run` immediately after the next successful removal of `key`. */
  afterNextRemove(key: string, run: () => void): void {
    this.runOnceAfterRemove = { key, run };
  }

  failNextWriteContaining(marker: string): void {
    this.throwOnceOnValueIncludes = marker;
  }

  failNextRemove(key: string): void {
    this.throwOnceOnRemoveKey = key;
  }

  ignoreNextRemove(key: string): void {
    this.ignoreOnceOnRemoveKey = key;
  }

  failNextRead(key: string): void {
    this.throwOnceOnGetKey = key;
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.entries);
  }
}

const scopeA: ChatBackupScope = { key: "user-a", legacySessionPrefix: "user-a:" };
const scopeB: ChatBackupScope = { key: "user-b", legacySessionPrefix: "user-b:" };
const legacyScope: ChatBackupScope = { key: "legacy-user", legacySessionPrefix: "user-a:" };

function session(overrides: Partial<ChatSessionRecord> = {}): ChatSessionRecord {
  return {
    id: "s-1",
    query: "vector db",
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord {
  return {
    id: "m-1",
    sessionId: "s-1",
    role: "user",
    content: "hello",
    sequence: 1,
    createdAt: 1700000002000,
    ...overrides,
  };
}

function installStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
  return storage;
}

describe("scoped chat backup storage", () => {
  let storage: MemoryStorage;
  let originalLocalStorage: Storage | undefined;

  beforeEach(() => {
    originalLocalStorage = globalThis.localStorage;
    storage = installStorage();
    storage.setItem("gitstarrecall.chat.backup.legacy-migrated.v2.user-a", "1");
    storage.setItem("gitstarrecall.chat.backup.legacy-migrated.v2.user-b", "1");
  });

  afterEach(() => {
    if (originalLocalStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
      return;
    }
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it("keeps scope A and scope B records isolated", async () => {
    await backupChatSession(scopeA, session({ id: "s-1", query: "a-query" }));
    await backupChatMessage(scopeA, message({ id: "m-1", sessionId: "s-1", content: "a-message" }));
    await backupChatSession(scopeB, session({ id: "s-1", query: "b-query" }));
    await backupChatMessage(scopeB, message({ id: "m-1", sessionId: "s-1", content: "b-message" }));

    const a = await loadChatBackup(scopeA);
    const b = await loadChatBackup(scopeB);

    expect(a.sessions).toHaveLength(1);
    expect(a.sessions[0]?.query).toBe("a-query");
    expect(a.messagesBySessionId["s-1"]?.[0]?.content).toBe("a-message");

    expect(b.sessions).toHaveLength(1);
    expect(b.sessions[0]?.query).toBe("b-query");
    expect(b.messagesBySessionId["s-1"]?.[0]?.content).toBe("b-message");
  });

  it("clearing scope A leaves scope B bytes untouched", async () => {
    await backupChatSession(scopeB, session({ id: "s-b", query: "b-query" }));
    await backupChatMessage(scopeB, message({ id: "m-b", sessionId: "s-b", content: "b-message" }));

    // Snapshot every key that belongs to scope B before scope A ever exists.
    const bBytesBefore = storage.snapshot();
    expect(Object.keys(bBytesBefore).length).toBeGreaterThan(0);

    await backupChatSession(scopeA, session({ id: "s-a", query: "a-query" }));
    await backupChatMessage(scopeA, message({ id: "m-a", sessionId: "s-a", content: "a-message" }));

    await clearChatBackup(scopeA);

    // Every byte recorded for scope B must be exactly as it was.
    for (const [key, value] of Object.entries(bBytesBefore)) {
      expect(storage.getItem(key)).toBe(value);
    }

    const a = await loadChatBackup(scopeA);
    expect(a.sessions).toHaveLength(0);
    expect(Object.keys(a.messagesBySessionId)).toHaveLength(0);

    const b = await loadChatBackup(scopeB);
    expect(b.sessions).toHaveLength(1);
    expect(b.sessions[0]?.query).toBe("b-query");
  });

  it("retains write order and recovers after a rejected write", async () => {
    const p1 = backupChatMessage(scopeA, message({ id: "m-1", sequence: 1, createdAt: 1000 }));

    // The next write that carries m-bad fails once; the one queued after it must
    // still run against a healthy store.
    storage.failNextWriteContaining('"id":"m-bad"');
    const p2 = backupChatMessage(scopeA, message({ id: "m-bad", sequence: 2, createdAt: 2000 }));
    const p3 = backupChatMessage(scopeA, message({ id: "m-2", sequence: 3, createdAt: 3000 }));

    await expect(p2).rejects.toThrow();
    await expect(p1).resolves.toBe(true);
    await expect(p3).resolves.toBe(true);

    const snapshot = await loadChatBackup(scopeA);
    const restored = snapshot.messagesBySessionId["s-1"] ?? [];
    expect(restored.map((item) => item.id)).toEqual(["m-1", "m-2"]);
  });

  it("migrates only legacy sessions owned by the scope prefix, once", async () => {
    await withTemporaryIndexedDb(async () => {
      const ownedSession = session({ id: "user-a:owned", query: "owned" });
      const strangerSession = session({ id: "user-b:stranger", query: "stranger" });
      storage.setItem(LEGACY_SESSIONS_KEY, JSON.stringify([ownedSession, strangerSession]));
      storage.setItem(
        LEGACY_MESSAGES_KEY,
        JSON.stringify([
          message({ id: "mo-1", sessionId: "user-a:owned", content: "mine" }),
          message({ id: "ms-1", sessionId: "user-b:stranger", content: "theirs" }),
        ]),
      );

      const first = await loadChatBackup(legacyScope);
      expect(first.sessions.map((item) => item.id)).toEqual(["user-a:owned"]);
      expect(first.messagesBySessionId["user-a:owned"]?.[0]?.content).toBe("mine");
      expect(first.messagesBySessionId["user-b:stranger"]).toBeUndefined();

      // Clearing installs a tombstone; the legacy rows still exist but must not
      // resurrect on the next load.
      await clearChatBackup(legacyScope);
      const afterClear = await loadChatBackup(legacyScope);
      expect(afterClear.sessions).toHaveLength(0);
      expect(Object.keys(afterClear.messagesBySessionId)).toHaveLength(0);
    });
  });

  it("rejects invalid scopes on every public operation", async () => {
    const empty = { key: "", legacySessionPrefix: "x:" } as ChatBackupScope;
    const noPrefix = { key: "ok", legacySessionPrefix: "" } as ChatBackupScope;
    const ambiguous = { key: "a\u0000b", legacySessionPrefix: "a:" } as ChatBackupScope;

    await expect(backupChatSession(empty, session())).rejects.toThrow();
    await expect(backupChatMessage(noPrefix, message())).rejects.toThrow();
    await expect(loadChatBackup(null as unknown as ChatBackupScope)).rejects.toThrow();
    await expect(
      backupChatSnapshot(empty, { sessions: [], messagesBySessionId: {} }),
    ).rejects.toThrow();
    await expect(clearChatBackup(undefined as unknown as ChatBackupScope)).rejects.toThrow();
    await expect(migrateChatBackupScope(empty, scopeB)).rejects.toThrow();
    await expect(loadChatBackup(ambiguous)).rejects.toThrow();
  });

  it("propagates both thrown and silently ignored removals", async () => {
    await backupChatSession(scopeA, session({ id: "s-a" }));
    storage.failNextRemove("gitstarrecall.chat.backup.sessions.v2.user-a");
    await expect(clearChatBackup(scopeA)).rejects.toThrow("Failed to clear");

    await backupChatSession(scopeA, session({ id: "s-a" }));
    storage.ignoreNextRemove("gitstarrecall.chat.backup.sessions.v2.user-a");
    await expect(clearChatBackup(scopeA)).rejects.toThrow("Failed to clear");
  });

  it("migrates scope-owned records and rewrites prefixed ids idempotently", async () => {
    await backupChatSession(scopeA, session({ id: "user-a:chat", query: "carry me" }));
    await backupChatMessage(
      scopeA,
      message({ id: "m-1", sessionId: "user-a:chat", content: "carried message" }),
    );

    await migrateChatBackupScope(scopeA, scopeB);

    const target = await loadChatBackup(scopeB);
    expect(target.sessions.map((item) => item.id)).toEqual(["user-b:chat"]);
    expect(target.messagesBySessionId["user-b:chat"]?.[0]?.content).toBe("carried message");
    expect(target.messagesBySessionId["user-b:chat"]?.[0]?.sessionId).toBe("user-b:chat");

    const source = await loadChatBackup(scopeA);
    expect(source.sessions).toHaveLength(0);

    // Idempotent: a second migration is a no-op and does not throw.
    await migrateChatBackupScope(scopeA, scopeB);
    const targetAgain = await loadChatBackup(scopeB);
    expect(targetAgain.sessions.map((item) => item.id)).toEqual(["user-b:chat"]);
  });

  it("preserves target data on id collision during scope migration", async () => {
    await backupChatSession(scopeA, session({ id: "user-a:chat", query: "source wins?" }));
    await backupChatMessage(
      scopeA,
      message({ id: "same-message", sessionId: "user-a:chat", content: "source" }),
    );
    await backupChatSession(scopeB, session({ id: "user-b:chat", query: "target keeps" }));
    await backupChatMessage(
      scopeB,
      message({ id: "same-message", sessionId: "user-b:chat", content: "target keeps" }),
    );

    await migrateChatBackupScope(scopeA, scopeB);

    const target = await loadChatBackup(scopeB);
    const collided = target.sessions.find((item) => item.id === "user-b:chat");
    expect(collided?.query).toBe("target keeps");
    expect(target.messagesBySessionId["user-b:chat"]?.[0]?.content).toBe("target keeps");
  });

  it("retains the source if persisting the migration target fails", async () => {
    await backupChatSession(scopeA, session({ id: "user-a:chat", query: "source" }));
    storage.failNextWriteContaining('"id":"user-b:chat"');

    await expect(migrateChatBackupScope(scopeA, scopeB)).rejects.toThrow();

    const source = await loadChatBackup(scopeA);
    expect(source.sessions.map((item) => item.id)).toEqual(["user-a:chat"]);
  });

  it("bounds scoped message backups", async () => {
    const seeded = Array.from({ length: 5000 }, (_, index) =>
      message({
        id: `m-${index}`,
        sequence: index + 1,
        createdAt: 1000 + index,
        content: `message-${index}`,
      }),
    );
    storage.setItem(SCOPED_MESSAGES_KEY_A, JSON.stringify(seeded));

    await backupChatMessage(
      scopeA,
      message({ id: "m-5000", sequence: 5001, createdAt: 1000 + 5000, content: "newest" }),
    );

    const snapshot = await loadChatBackup(scopeA);
    const restored = snapshot.messagesBySessionId["s-1"] ?? [];
    expect(restored).toHaveLength(5000);
    expect(restored.at(-1)?.id).toBe("m-5000");
    expect(restored.some((item) => item.id === "m-0")).toBe(false);
  });

  it("merges snapshots without discarding earlier scoped records", async () => {
    await backupChatSession(scopeA, session({ id: "existing", query: "existing" }));

    await backupChatSnapshot(scopeA, {
      sessions: [session({ id: "incoming", query: "incoming" })],
      messagesBySessionId: {},
    });

    const snapshot = await loadChatBackup(scopeA);
    expect(snapshot.sessions.map((item) => item.id).sort()).toEqual(["existing", "incoming"]);
  });

  it("bounds sessions within one scope without pruning another", async () => {
    const seeded = Array.from({ length: 200 }, (_, index) =>
      session({ id: `s-${index}`, updatedAt: 1000 + index }),
    );
    storage.setItem("gitstarrecall.chat.backup.sessions.v2.user-a", JSON.stringify(seeded));
    await backupChatSession(scopeB, session({ id: "b-only", query: "keep" }));

    await backupChatSession(scopeA, session({ id: "s-200", updatedAt: 1200 }));

    const a = await loadChatBackup(scopeA);
    const b = await loadChatBackup(scopeB);
    expect(a.sessions).toHaveLength(200);
    expect(a.sessions.some((item) => item.id === "s-0")).toBe(false);
    expect(b.sessions.map((item) => item.id)).toEqual(["b-only"]);
  });

  it("rejects legacy migration when the v1 payload is malformed and migrates after repair", async () => {
    await withTemporaryIndexedDb(async () => {
      const legacyMessagesBytes = JSON.stringify([
        message({ id: "mo-1", sessionId: "user-a:owned", content: "mine" }),
      ]);
      storage.setItem(LEGACY_SESSIONS_KEY, "{not-json");
      storage.setItem(LEGACY_MESSAGES_KEY, legacyMessagesBytes);

      await expect(loadChatBackup(legacyScope)).rejects.toThrow(/legacy/i);

      // The v1 bytes are untouched and no permanent marker was installed, so the
      // legacy rows are still reachable by a later attempt.
      expect(storage.getItem(LEGACY_SESSIONS_KEY)).toBe("{not-json");
      expect(storage.getItem(LEGACY_MESSAGES_KEY)).toBe(legacyMessagesBytes);
      expect(storage.getItem(LEGACY_MIGRATED_KEY)).toBeNull();
      expect(storage.getItem("gitstarrecall.chat.backup.sessions.v2.legacy-user")).toBeNull();

      storage.setItem(
        LEGACY_SESSIONS_KEY,
        JSON.stringify([session({ id: "user-a:owned", query: "owned" })]),
      );

      const recovered = await loadChatBackup(legacyScope);
      expect(recovered.sessions.map((item) => item.id)).toEqual(["user-a:owned"]);
      expect(recovered.messagesBySessionId["user-a:owned"]?.[0]?.content).toBe("mine");
      expect(storage.getItem(LEGACY_MIGRATED_KEY)).toBe("1");
    });
  });

  it("rejects a transient legacy v1 read failure and migrates on retry", async () => {
    await withTemporaryIndexedDb(async () => {
      const legacySessionsBytes = JSON.stringify([session({ id: "user-a:owned", query: "owned" })]);
      const legacyMessagesBytes = JSON.stringify([
        message({ id: "mo-1", sessionId: "user-a:owned", content: "mine" }),
      ]);
      storage.setItem(LEGACY_SESSIONS_KEY, legacySessionsBytes);
      storage.setItem(LEGACY_MESSAGES_KEY, legacyMessagesBytes);

      storage.failNextRead(LEGACY_SESSIONS_KEY);
      await expect(loadChatBackup(legacyScope)).rejects.toThrow(/legacy/i);

      expect(storage.getItem(LEGACY_SESSIONS_KEY)).toBe(legacySessionsBytes);
      expect(storage.getItem(LEGACY_MESSAGES_KEY)).toBe(legacyMessagesBytes);
      expect(storage.getItem(LEGACY_MIGRATED_KEY)).toBeNull();

      const recovered = await loadChatBackup(legacyScope);
      expect(recovered.sessions.map((item) => item.id)).toEqual(["user-a:owned"]);
      expect(recovered.messagesBySessionId["user-a:owned"]?.[0]?.content).toBe("mine");
      expect(storage.getItem(LEGACY_MIGRATED_KEY)).toBe("1");
    });
  });

  it("refuses to overwrite v2 keys when the scoped payload is malformed", async () => {
    const messagesBytes = JSON.stringify([message({ id: "m-keep", sessionId: "s-keep" })]);
    storage.setItem(SCOPED_SESSIONS_KEY_A, "not-json{");
    storage.setItem(SCOPED_MESSAGES_KEY_A, messagesBytes);

    await expect(backupChatSession(scopeA, session({ id: "s-new" }))).rejects.toThrow(
      /scoped chat backup/i,
    );
    await expect(backupChatMessage(scopeA, message({ id: "m-new" }))).rejects.toThrow(
      /scoped chat backup/i,
    );
    await expect(
      backupChatSnapshot(scopeA, {
        sessions: [session({ id: "s-new" })],
        messagesBySessionId: {},
      }),
    ).rejects.toThrow(/scoped chat backup/i);
    await expect(loadChatBackup(scopeA)).rejects.toThrow(/scoped chat backup/i);

    // Both v2 keys are byte-identical: nothing was silently rewritten from an
    // empty read.
    expect(storage.getItem(SCOPED_SESSIONS_KEY_A)).toBe("not-json{");
    expect(storage.getItem(SCOPED_MESSAGES_KEY_A)).toBe(messagesBytes);

    storage.setItem(SCOPED_SESSIONS_KEY_A, JSON.stringify([session({ id: "s-keep" })]));
    await expect(backupChatSession(scopeA, session({ id: "s-new" }))).resolves.toBe(true);

    const snapshot = await loadChatBackup(scopeA);
    expect(snapshot.sessions.map((item) => item.id).sort()).toEqual(["s-keep", "s-new"]);
    expect(snapshot.messagesBySessionId["s-keep"]?.[0]?.id).toBe("m-keep");
  });

  it("rejects a one-shot scoped getItem failure and succeeds on retry", async () => {
    await backupChatSession(scopeA, session({ id: "s-existing", query: "existing" }));
    const sessionsBytes = storage.getItem(SCOPED_SESSIONS_KEY_A);
    const messagesBytes = storage.getItem(SCOPED_MESSAGES_KEY_A);
    expect(sessionsBytes).not.toBeNull();

    storage.failNextRead(SCOPED_SESSIONS_KEY_A);
    await expect(backupChatSession(scopeA, session({ id: "s-new" }))).rejects.toThrow(
      /scoped chat backup/i,
    );

    expect(storage.getItem(SCOPED_SESSIONS_KEY_A)).toBe(sessionsBytes);
    expect(storage.getItem(SCOPED_MESSAGES_KEY_A)).toBe(messagesBytes);

    await expect(backupChatSession(scopeA, session({ id: "s-new" }))).resolves.toBe(true);
    const snapshot = await loadChatBackup(scopeA);
    expect(snapshot.sessions.map((item) => item.id).sort()).toEqual(["s-existing", "s-new"]);
  });

  it("refuses to report a clear when no storage API is available", async () => {
    expect(typeof indexedDB).toBe("undefined");
    await backupChatSession(scopeA, session({ id: "s-a", query: "keep" }));
    const before = storage.snapshot();

    delete (globalThis as { localStorage?: Storage }).localStorage;
    await expect(clearChatBackup(scopeA)).rejects.toThrow(/no usable chat backup storage/i);
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

    // No marker was written and no key was removed.
    expect(storage.snapshot()).toEqual(before);
  });

  it("refuses to report a clear when the localStorage API is malformed", async () => {
    expect(typeof indexedDB).toBe("undefined");
    await backupChatSession(scopeA, session({ id: "s-a", query: "keep" }));
    const before = storage.snapshot();

    // Read-only shim: `setItem`/`removeItem` are missing, so no deletion is possible.
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: (key: string) => storage.getItem(key) } as unknown as Storage,
      configurable: true,
    });
    await expect(clearChatBackup(scopeA)).rejects.toThrow(/no usable chat backup storage/i);
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

    expect(storage.snapshot()).toEqual(before);
    const survivors = await loadChatBackup(scopeA);
    expect(survivors.sessions.map((item) => item.id)).toEqual(["s-a"]);
  });

  it("rejects the clear and keeps records when localStorage disappears mid deletion", async () => {
    expect(typeof indexedDB).toBe("undefined");
    const backing = new MemoryStorage();
    let localStorageVisible = true;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        if (!localStorageVisible) {
          throw new DOMException("localStorage access denied", "SecurityError");
        }
        return backing;
      },
    });
    backing.setItem(MIGRATION_MARKER_KEY_A, "1");
    await backupChatSession(scopeA, session({ id: "a", query: "a" }));
    await backupChatMessage(scopeA, message({ id: "ma", sessionId: "a" }));

    // localStorage vanishes once the deletion marker is committed: after the
    // capability proof, before the scoped rows are removed.
    backing.afterNextWrite(MIGRATION_MARKER_KEY_A, () => {
      localStorageVisible = false;
    });

    const failure = await clearChatBackup(scopeA).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((item) => (item as Error).message)).toContain(
      "A required chat backup backend became unavailable during scoped deletion",
    );

    // The clear must not have removed the rows it could no longer verify.
    localStorageVisible = true;
    const survivors = await loadChatBackup(scopeA);
    expect(survivors.sessions.map((item) => item.id)).toEqual(["a"]);
    expect(survivors.messagesBySessionId.a?.map((item) => item.id)).toEqual(["ma"]);
  });

  it("treats throwing storage accessors as unavailable capabilities", async () => {
    expect(typeof indexedDB).toBe("undefined");

    try {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        get: () => {
          throw new DOMException("IndexedDB access denied", "SecurityError");
        },
      });
      await expect(
        backupChatSession(scopeA, session({ id: "s-local", query: "local fallback" })),
      ).resolves.toBe(true);

      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get: () => {
          throw new DOMException("localStorage access denied", "SecurityError");
        },
      });
      await expect(clearChatBackup(scopeA)).rejects.toThrow(/no usable chat backup storage/i);
    } finally {
      delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    }
  });
});

function openDatabase(name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Deletion of ${name} was blocked`));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function seedLegacyIndexedDb(
  sessions: ChatSessionRecord[],
  messages: ChatMessageRecord[],
): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(BACKUP_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("chat_sessions", { keyPath: "id" });
      request.result.createObjectStore("chat_messages", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction(["chat_sessions", "chat_messages"], "readwrite");
  for (const record of sessions) transaction.objectStore("chat_sessions").put(record);
  for (const record of messages) transaction.objectStore("chat_messages").put(record);
  await transactionDone(transaction);
  database.close();
}

async function withTemporaryIndexedDb<T>(operation: () => Promise<T>): Promise<T> {
  const originalIndexedDb = globalThis.indexedDB;
  const originalKeyRange = globalThis.IDBKeyRange;
  Object.defineProperty(globalThis, "indexedDB", {
    value: new IDBFactory(),
    configurable: true,
  });
  Object.defineProperty(globalThis, "IDBKeyRange", {
    value: FakeIDBKeyRange,
    configurable: true,
  });
  try {
    return await operation();
  } finally {
    await deleteDatabase(BACKUP_DB_NAME).catch(() => undefined);
    if (originalIndexedDb === undefined)
      delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    else
      Object.defineProperty(globalThis, "indexedDB", {
        value: originalIndexedDb,
        configurable: true,
      });
    if (originalKeyRange === undefined)
      delete (globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange;
    else
      Object.defineProperty(globalThis, "IDBKeyRange", {
        value: originalKeyRange,
        configurable: true,
      });
  }
}

describe("scoped chat backup IndexedDB storage", () => {
  let originalIndexedDb: IDBFactory | undefined;
  let originalKeyRange: typeof IDBKeyRange | undefined;
  let originalLocalStorage: Storage | undefined;

  beforeEach(async () => {
    originalIndexedDb = globalThis.indexedDB;
    originalKeyRange = globalThis.IDBKeyRange;
    originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "indexedDB", {
      value: new IDBFactory(),
      configurable: true,
    });
    Object.defineProperty(globalThis, "IDBKeyRange", {
      value: FakeIDBKeyRange,
      configurable: true,
    });
    installStorage();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await deleteDatabase(BACKUP_DB_NAME).catch(() => undefined);
    if (originalIndexedDb === undefined)
      delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    else
      Object.defineProperty(globalThis, "indexedDB", {
        value: originalIndexedDb,
        configurable: true,
      });
    if (originalKeyRange === undefined)
      delete (globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange;
    else
      Object.defineProperty(globalThis, "IDBKeyRange", {
        value: originalKeyRange,
        configurable: true,
      });
    if (originalLocalStorage === undefined)
      delete (globalThis as { localStorage?: Storage }).localStorage;
    else
      Object.defineProperty(globalThis, "localStorage", {
        value: originalLocalStorage,
        configurable: true,
      });
  });

  it("upgrades a v1 database, creates scoped indexes, and migrates only owned legacy rows once", async () => {
    await seedLegacyIndexedDb(
      [
        session({ id: "user-a:owned", query: "owned" }),
        session({ id: "user-b:other", query: "other" }),
      ],
      [
        message({ id: "mine", sessionId: "user-a:owned", content: "mine" }),
        message({ id: "theirs", sessionId: "user-b:other", content: "theirs" }),
      ],
    );

    const migrated = await loadChatBackup(legacyScope);
    expect(migrated.sessions.map((item) => item.id)).toEqual(["user-a:owned"]);
    expect(migrated.messagesBySessionId["user-a:owned"]?.map((item) => item.id)).toEqual(["mine"]);

    const database = await openDatabase(BACKUP_DB_NAME);
    expect(database.version).toBe(2);
    expect(Array.from(database.objectStoreNames)).toEqual(
      expect.arrayContaining([
        "chat_sessions",
        "chat_messages",
        "chat_sessions_v2",
        "chat_messages_v2",
        "chat_backup_metadata",
      ]),
    );
    const transaction = database.transaction(
      ["chat_sessions", "chat_sessions_v2", "chat_messages_v2", "chat_backup_metadata"],
      "readonly",
    );
    expect(Array.from(transaction.objectStore("chat_sessions_v2").indexNames)).toEqual(
      expect.arrayContaining(["by_backup_scope", "by_backup_scope_updated_at"]),
    );
    expect(Array.from(transaction.objectStore("chat_messages_v2").indexNames)).toEqual(
      expect.arrayContaining([
        "by_backup_scope",
        "by_backup_scope_session",
        "by_backup_scope_created_at",
      ]),
    );
    const marker = await new Promise<unknown>((resolve, reject) => {
      const request = transaction
        .objectStore("chat_backup_metadata")
        .get("gitstarrecall.chat.backup.legacy-migrated.v2.legacy-user");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const legacyCount = await new Promise<number>((resolve, reject) => {
      const request = transaction.objectStore("chat_sessions").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await transactionDone(transaction);
    database.close();
    expect(marker).toMatchObject({ key: expect.any(String), migratedAt: expect.any(Number) });
    expect(legacyCount).toBe(2);

    await clearChatBackup(legacyScope);
    expect((await loadChatBackup(legacyScope)).sessions).toHaveLength(0);
  });

  it("clears one IndexedDB scope without changing another", async () => {
    await backupChatSession(scopeA, session({ id: "a", query: "a" }));
    await backupChatMessage(scopeA, message({ id: "ma", sessionId: "a" }));
    await backupChatSession(scopeB, session({ id: "b", query: "b" }));
    await backupChatMessage(scopeB, message({ id: "mb", sessionId: "b" }));

    await clearChatBackup(scopeA);

    expect((await loadChatBackup(scopeA)).sessions).toHaveLength(0);
    const other = await loadChatBackup(scopeB);
    expect(other.sessions.map((item) => item.id)).toEqual(["b"]);
    expect(other.messagesBySessionId.b?.map((item) => item.id)).toEqual(["mb"]);
  });

  it("rejects the clear when a captured backend disappears after the capability proof", async () => {
    const storage = installStorage();
    await backupChatSession(scopeA, session({ id: "a", query: "a" }));
    await backupChatMessage(scopeA, message({ id: "ma", sessionId: "a" }));

    const factory = globalThis.indexedDB;
    let indexedDbVisible = true;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get: () => {
        if (!indexedDbVisible) {
          throw new DOMException("IndexedDB access denied", "SecurityError");
        }
        return factory;
      },
    });

    // Hide IndexedDB right after the deletion marker lands in localStorage, then
    // restore it before the final backend-history write. Both bookend writes
    // therefore observe a healthy backend while the deletion itself does not.
    storage.afterNextWrite(MIGRATION_MARKER_KEY_A, () => {
      indexedDbVisible = false;
    });
    storage.afterNextRemove(SCOPED_MESSAGES_KEY_A, () => {
      indexedDbVisible = true;
    });

    const failure = await clearChatBackup(scopeA).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((item) => (item as Error).message)).toContain(
      "A required chat backup backend became unavailable during scoped deletion",
    );
    // The skipped backend still holds the scoped rows, so reporting success
    // would have let them resurface on the next load.
    expect(indexedDbVisible).toBe(true);
    const survivors = await loadChatBackup(scopeA);
    expect(survivors.sessions.map((item) => item.id)).toEqual(["a"]);
  });

  it("uses count-based writes under the limit and prunes exactly the oldest overflow", async () => {
    await backupChatSession(scopeA, session({ id: "marker", updatedAt: 0 }));
    const getAllSpy = vi.spyOn(FakeIDBObjectStore.prototype, "getAll");
    for (let index = 0; index < 20; index += 1) {
      await backupChatSession(scopeA, session({ id: `s-${index}`, updatedAt: 1000 + index }));
    }
    expect(getAllSpy).not.toHaveBeenCalled();
    getAllSpy.mockRestore();

    const database = await openDatabase(BACKUP_DB_NAME);
    const transaction = database.transaction("chat_sessions_v2", "readwrite");
    const store = transaction.objectStore("chat_sessions_v2");
    for (let index = 20; index < 200; index += 1) {
      store.put({
        ...session({ id: `s-${index}`, updatedAt: 1000 + index }),
        backupKey: `user-a\u0000s-${index}`,
        backupScope: "user-a",
      });
    }
    await transactionDone(transaction);
    database.close();

    await backupChatSession(scopeA, session({ id: "newest", updatedAt: 9999 }));
    const bounded = await loadChatBackup(scopeA);
    expect(bounded.sessions).toHaveLength(200);
    expect(bounded.sessions.some((item) => item.id === "marker")).toBe(false);
    expect(bounded.sessions.some((item) => item.id === "newest")).toBe(true);
  });

  it("keeps exactly the newest 5000 messages in an IndexedDB scope", async () => {
    await backupChatMessage(scopeA, message({ id: "oldest", sessionId: "chat", createdAt: 0 }));
    const database = await openDatabase(BACKUP_DB_NAME);
    const transaction = database.transaction("chat_messages_v2", "readwrite");
    const store = transaction.objectStore("chat_messages_v2");
    for (let index = 1; index < 5000; index += 1) {
      store.put({
        ...message({ id: `m-${index}`, sessionId: "chat", createdAt: 1000 + index }),
        backupKey: `user-a\u0000m-${index}`,
        backupScope: "user-a",
      });
    }
    await transactionDone(transaction);
    database.close();

    await backupChatMessage(
      scopeA,
      message({ id: "newest", sessionId: "chat", createdAt: 999999 }),
    );
    const messages = (await loadChatBackup(scopeA)).messagesBySessionId.chat ?? [];
    expect(messages).toHaveLength(5000);
    expect(messages.some((item) => item.id === "oldest")).toBe(false);
    expect(messages.at(-1)?.id).toBe("newest");
  });

  it("rejects an IndexedDB read failure without overwriting a local fallback", async () => {
    const storage = installStorage();
    await backupChatSession(scopeA, session({ id: "existing", query: "existing" }));
    const before = storage.snapshot();
    vi.spyOn(FakeIDBIndex.prototype, "getAll").mockImplementationOnce(() => {
      throw new Error("simulated IndexedDB read failure");
    });

    await expect(
      backupChatSnapshot(scopeA, {
        sessions: [session({ id: "new", query: "new" })],
        messagesBySessionId: {},
      }),
    ).rejects.toThrow(/IndexedDB/i);
    expect(storage.snapshot()).toEqual(before);
  });

  it("aborts the write transaction when limit enforcement fails", async () => {
    await backupChatSession(scopeA, session({ id: "existing", query: "existing" }));
    const storage = globalThis.localStorage;
    delete (globalThis as { localStorage?: Storage }).localStorage;
    vi.spyOn(FakeIDBIndex.prototype, "count").mockImplementation(() => {
      throw new Error("simulated limit failure");
    });

    await expect(
      backupChatSession(scopeA, session({ id: "uncommitted", query: "must roll back" })),
    ).rejects.toThrow(/limit failure/i);
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

    const after = await loadChatBackup(scopeA);
    expect(after.sessions.map((item) => item.id)).toEqual(["existing"]);
  });

  it("retains the source when the IndexedDB migration target write fails", async () => {
    await backupChatSession(scopeA, session({ id: "user-a:chat", query: "source" }));
    const originalPut = FakeIDBObjectStore.prototype.put;
    vi.spyOn(FakeIDBObjectStore.prototype, "put").mockImplementation(function (
      this: InstanceType<typeof FakeIDBObjectStore>,
      value,
      key,
    ) {
      if ((value as { backupKey?: string }).backupKey === "user-b\u0000user-b:chat") {
        throw new Error("simulated target failure");
      }
      return originalPut.call(this, value, key);
    });

    await expect(migrateChatBackupScope(scopeA, scopeB)).rejects.toThrow();
    vi.restoreAllMocks();
    expect((await loadChatBackup(scopeA)).sessions.map((item) => item.id)).toEqual(["user-a:chat"]);
  });

  it("detects same-id target corruption and retains the migration source", async () => {
    await backupChatSession(scopeA, session({ id: "user-a:chat", query: "original" }));
    const originalPut = FakeIDBObjectStore.prototype.put;
    let corrupted = false;
    vi.spyOn(FakeIDBObjectStore.prototype, "put").mockImplementation(function (
      this: InstanceType<typeof FakeIDBObjectStore>,
      value,
      key,
    ) {
      const request = originalPut.call(this, value, key);
      if (!corrupted && (value as { backupKey?: string }).backupKey === "user-b\u0000user-b:chat") {
        corrupted = true;
        originalPut.call(this, { ...(value as object), query: "corrupted" }, key);
      }
      return request;
    });

    await expect(migrateChatBackupScope(scopeA, scopeB)).rejects.toThrow(/verification failed/i);
    vi.restoreAllMocks();
    const source = await loadChatBackup(scopeA);
    expect(source.sessions).toEqual([session({ id: "user-a:chat", query: "original" })]);
  });

  it("fails closed when known IndexedDB data is temporarily unavailable during clear", async () => {
    const storage = installStorage();
    const scope: ChatBackupScope = { key: "alternating-idb", legacySessionPrefix: "aidb:" };
    const factory = globalThis.indexedDB;
    await backupChatSession(scope, session({ id: "aidb:chat", query: "must survive" }));

    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    await expect(clearChatBackup(scope)).rejects.toThrow(/known IndexedDB backend is unavailable/i);

    Object.defineProperty(globalThis, "indexedDB", { value: factory, configurable: true });
    expect((await loadChatBackup(scope)).sessions.map((item) => item.id)).toEqual(["aidb:chat"]);
    await clearChatBackup(scope);
    expect(storage.getItem("gitstarrecall.chat.backup.sessions.v2.alternating-idb")).toBeNull();
  });

  it("does not mark local legacy data migrated while IndexedDB is unavailable", async () => {
    const storage = globalThis.localStorage;
    const scope: ChatBackupScope = { key: "legacy-local-hidden", legacySessionPrefix: "llh:" };
    storage.setItem(
      LEGACY_SESSIONS_KEY,
      JSON.stringify([session({ id: "llh:chat", query: "legacy local" })]),
    );
    const factory = globalThis.indexedDB;
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;

    await expect(loadChatBackup(scope)).rejects.toThrow(/IndexedDB is unavailable/i);
    expect(
      storage.getItem("gitstarrecall.chat.backup.legacy-migrated.v2.legacy-local-hidden"),
    ).toBeNull();

    Object.defineProperty(globalThis, "indexedDB", { value: factory, configurable: true });
    expect((await loadChatBackup(scope)).sessions.map((item) => item.id)).toEqual(["llh:chat"]);
  });

  it("does not mark IndexedDB legacy data migrated while localStorage is unavailable", async () => {
    const scope: ChatBackupScope = { key: "legacy-idb-hidden", legacySessionPrefix: "lih:" };
    await seedLegacyIndexedDb(
      [session({ id: "lih:chat", query: "legacy idb" })],
      [message({ id: "lih-message", sessionId: "lih:chat" })],
    );
    const storage = globalThis.localStorage;
    delete (globalThis as { localStorage?: Storage }).localStorage;

    await expect(loadChatBackup(scope)).rejects.toThrow(/localStorage is unavailable/i);

    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    const recovered = await loadChatBackup(scope);
    expect(recovered.sessions.map((item) => item.id)).toEqual(["lih:chat"]);
    expect(recovered.messagesBySessionId["lih:chat"]?.map((item) => item.id)).toEqual([
      "lih-message",
    ]);
  });

  it("fails closed when prior local fallback data may be temporarily unavailable", async () => {
    const storage = installStorage();
    const scope: ChatBackupScope = { key: "alternating-local", legacySessionPrefix: "alocal:" };
    const factory = globalThis.indexedDB;
    await loadChatBackup(scope);
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    await backupChatSession(scope, session({ id: "alocal:chat", query: "must survive" }));

    Object.defineProperty(globalThis, "indexedDB", { value: factory, configurable: true });
    delete (globalThis as { localStorage?: Storage }).localStorage;
    await expect(clearChatBackup(scope)).rejects.toThrow(/prior backend use cannot be excluded/i);

    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    expect((await loadChatBackup(scope)).sessions.map((item) => item.id)).toEqual(["alocal:chat"]);
  });

  it("retains a migration source when one of its known backends disappears", async () => {
    installStorage();
    const from: ChatBackupScope = { key: "migration-hidden", legacySessionPrefix: "hidden:" };
    const to: ChatBackupScope = { key: "migration-target", legacySessionPrefix: "target:" };
    const factory = globalThis.indexedDB;
    await backupChatSession(from, session({ id: "hidden:chat", query: "source" }));

    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    await expect(migrateChatBackupScope(from, to)).rejects.toThrow(
      /known IndexedDB backend is unavailable/i,
    );

    Object.defineProperty(globalThis, "indexedDB", { value: factory, configurable: true });
    expect((await loadChatBackup(from)).sessions.map((item) => item.id)).toEqual(["hidden:chat"]);
    expect((await loadChatBackup(to)).sessions).toHaveLength(0);
  });

  it("rejects clear from a stale empty proof after a hidden-backend write", async () => {
    const storage = globalThis.localStorage;
    const scope: ChatBackupScope = { key: "stale-empty-clear", legacySessionPrefix: "sec:" };
    const factory = globalThis.indexedDB;
    await clearChatBackup(scope);

    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    await expect(
      backupChatSession(scope, session({ id: "sec:chat", query: "newer local write" })),
    ).rejects.toThrow(/proof replica is unavailable/i);

    Object.defineProperty(globalThis, "indexedDB", { value: factory, configurable: true });
    delete (globalThis as { localStorage?: Storage }).localStorage;
    await expect(clearChatBackup(scope)).rejects.toThrow(/localStorage backend is unavailable/i);

    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    expect((await loadChatBackup(scope)).sessions.map((item) => item.id)).toEqual(["sec:chat"]);
  });

  it("rejects migration from a stale empty proof and retains the hidden source", async () => {
    const storage = globalThis.localStorage;
    const from: ChatBackupScope = { key: "stale-empty-source", legacySessionPrefix: "ses:" };
    const to: ChatBackupScope = { key: "stale-empty-target", legacySessionPrefix: "set:" };
    const factory = globalThis.indexedDB;
    await clearChatBackup(from);

    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    await expect(
      backupChatSession(from, session({ id: "ses:chat", query: "newer source" })),
    ).rejects.toThrow(/proof replica is unavailable/i);

    Object.defineProperty(globalThis, "indexedDB", { value: factory, configurable: true });
    delete (globalThis as { localStorage?: Storage }).localStorage;
    await expect(migrateChatBackupScope(from, to)).rejects.toThrow(
      /localStorage backend is unavailable/i,
    );

    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    expect((await loadChatBackup(from)).sessions.map((item) => item.id)).toEqual(["ses:chat"]);
    expect((await loadChatBackup(to)).sessions).toHaveLength(0);
  });

  it("rejects conflicting equal-generation backend proofs deterministically", async () => {
    const scope: ChatBackupScope = { key: "conflicting-proof", legacySessionPrefix: "conflict:" };
    await loadChatBackup(scope);
    const key = "gitstarrecall.chat.backup.backends.v2.conflicting-proof";
    globalThis.localStorage.setItem(
      key,
      JSON.stringify({
        generation: 7,
        authorities: ["local-storage"],
        replicas: ["indexeddb", "local-storage"],
      }),
    );
    const database = await openDatabase(BACKUP_DB_NAME);
    const transaction = database.transaction("chat_backup_metadata", "readwrite");
    transaction.objectStore("chat_backup_metadata").put({
      key,
      generation: 7,
      authorities: ["indexeddb"],
      replicas: ["indexeddb", "local-storage"],
      updatedAt: Date.now(),
    });
    await transactionDone(transaction);
    database.close();

    await expect(clearChatBackup(scope)).rejects.toThrow(/conflict at the newest generation/i);
    await expect(clearChatBackup(scope)).rejects.toThrow(/conflict at the newest generation/i);
    expect(globalThis.localStorage.getItem(key)).toContain('"local-storage"');
  });

  it("promotes and bounds stale local fallback records when IndexedDB returns", async () => {
    const storage = installStorage();
    const scope: ChatBackupScope = { key: "promotion", legacySessionPrefix: "promotion:" };
    const factory = globalThis.indexedDB;
    await loadChatBackup(scope);
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    await backupChatMessage(
      scope,
      message({ id: "oldest", sessionId: "promotion:chat", createdAt: 0 }),
    );
    storage.setItem(
      "gitstarrecall.chat.backup.messages.v2.promotion",
      JSON.stringify(
        Array.from({ length: 5000 }, (_, index) =>
          message({
            id: `fallback-${index}`,
            sessionId: "promotion:chat",
            createdAt: 1000 + index,
          }),
        ),
      ),
    );

    Object.defineProperty(globalThis, "indexedDB", { value: factory, configurable: true });
    await backupChatMessage(
      scope,
      message({ id: "newest", sessionId: "promotion:chat", createdAt: 999999 }),
    );
    const restored = (await loadChatBackup(scope)).messagesBySessionId["promotion:chat"] ?? [];
    expect(restored).toHaveLength(5000);
    expect(restored.some((item) => item.id === "fallback-0")).toBe(false);
    expect(restored.at(-1)?.id).toBe("newest");
    expect(storage.getItem("gitstarrecall.chat.backup.messages.v2.promotion")).toBeNull();
  });

  it("times out a blocked database upgrade and later recovers", async () => {
    await seedLegacyIndexedDb([], []);
    const blocker = await openDatabase(BACKUP_DB_NAME, 1);
    await expect(loadChatBackup(scopeA)).rejects.toThrow(/timed out opening/i);
    blocker.close();
    // The timed-out open request is not cancellable. Let its late success run;
    // openBackupDb closes that connection before the retry.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(loadChatBackup(scopeA)).resolves.toMatchObject({ sessions: [] });
  }, 8000);
});
