import initSqlJs, { type SqlJsStatic } from "sql.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  LocalDatabase,
  getLocalDatabase,
  getScopedDatabaseFileName,
  getScopedDatabaseStorageKey,
  migrateLocalDatabaseScope,
  runSchema,
  setLocalDatabaseScope,
} from "./client";

class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

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

let SQL: SqlJsStatic;
let originalLocalStorage: Storage | undefined;

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => `node_modules/sql.js/dist/${file}`,
  });
});

beforeEach(() => {
  originalLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
  setLocalDatabaseScope("anon");
});

afterEach(() => {
  if (originalLocalStorage === undefined) {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  } else {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  }
  setLocalDatabaseScope("anon");
});

describe("database scope naming", () => {
  it("uses anon names for the anonymous scope", () => {
    expect(getScopedDatabaseFileName("anon")).toBe("gitstarrecall.sqlite");
    expect(getScopedDatabaseStorageKey("anon")).toBe("gitstarrecall.sqlite.base64.anon");
  });

  it("sanitizes authenticated scope keys", () => {
    expect(getScopedDatabaseFileName("auth:abc/123")).toBe("gitstarrecall.auth:abc_123.sqlite");
    expect(getScopedDatabaseStorageKey("auth:abc/123")).toBe("gitstarrecall.sqlite.base64.auth:abc_123");
  });

  it("migrates legacy token-scoped local data into the stable auth scope", async () => {
    const legacyScope = "token:legacy";
    const nextScope = "auth:github:42";
    const legacyChatScope = "chat:legacy";
    const nextChatScope = "chat:github:42";
    const legacySessionId = `${legacyChatScope}:session-1`;
    const now = Date.now();

    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const legacyDb = new LocalDatabase({
      sql: SQL,
      db: rawDb,
      storageMode: "local-storage",
      scopeKey: legacyScope,
    });

    await legacyDb.upsertRepos([
      {
        id: 1,
        fullName: "owner/repo",
        name: "repo",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/owner/repo",
        stars: 1,
        forks: 0,
        updatedAt: "2026-03-09T00:00:00Z",
        readmeUrl: null,
        readmeText: "hello",
        checksum: "checksum",
        lastSyncedAt: now,
      },
    ]);
    await legacyDb.upsertChatSession({
      id: legacySessionId,
      query: "restore me",
      createdAt: now,
      updatedAt: now,
    });
    await legacyDb.addChatMessage({
      id: "message-1",
      sessionId: legacySessionId,
      role: "user",
      content: "hello",
      sequence: 1,
      createdAt: now,
    });
    await legacyDb.upsertIndexMeta({
      key: `session_context_ids:${legacySessionId}`,
      value: JSON.stringify(["chunk-1"]),
      updatedAt: now,
    });

    expect(localStorage.getItem(getScopedDatabaseStorageKey(legacyScope))).not.toBeNull();

    const migrated = await migrateLocalDatabaseScope({
      fromScopeKey: legacyScope,
      toScopeKey: nextScope,
      fromChatScopeKey: legacyChatScope,
      toChatScopeKey: nextChatScope,
    });

    expect(migrated).toBe(true);
    expect(localStorage.getItem(getScopedDatabaseStorageKey(legacyScope))).toBeNull();
    expect(localStorage.getItem(getScopedDatabaseStorageKey(nextScope))).not.toBeNull();

    setLocalDatabaseScope(nextScope);
    const migratedDb = await getLocalDatabase();
    expect(migratedDb.getRepoCount()).toBe(1);
    expect(migratedDb.listChatSessions()).toEqual([
      {
        id: `${nextChatScope}:session-1`,
        query: "restore me",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    expect(migratedDb.listChatMessages(`${nextChatScope}:session-1`)).toEqual([
      {
        id: "message-1",
        sessionId: `${nextChatScope}:session-1`,
        role: "user",
        content: "hello",
        sequence: 1,
        createdAt: now,
      },
    ]);
    expect(migratedDb.getIndexMetaValue(`session_context_ids:${nextChatScope}:session-1`)).toBe(
      JSON.stringify(["chunk-1"]),
    );
  });
});
