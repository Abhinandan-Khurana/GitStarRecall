import initSqlJs, { type SqlJsStatic } from "sql.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
let originalNavigator: Navigator | undefined;

class MemoryOpfsRoot {
  private files = new Map<string, { bytes: Uint8Array; lastModified: number }>();

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.files.get(name);
    if (existing) {
      return new MemoryOpfsFileHandle(existing);
    }
    if (options?.create) {
      const created = { bytes: new Uint8Array(), lastModified: Date.now() };
      this.files.set(name, created);
      return new MemoryOpfsFileHandle(created);
    }
    throw new Error("File not found");
  }

  async removeEntry(name: string): Promise<void> {
    this.files.delete(name);
  }
}

class MemoryOpfsFileHandle {
  constructor(private readonly state: { bytes: Uint8Array; lastModified: number }) {}

  async getFile() {
    return {
      arrayBuffer: async () => {
        const buffer = new ArrayBuffer(this.state.bytes.byteLength);
        new Uint8Array(buffer).set(this.state.bytes);
        return buffer;
      },
      lastModified: this.state.lastModified,
    };
  }

  async createWritable() {
    let nextBytes = this.state.bytes;
    return {
      write: async (value: ArrayBuffer | Uint8Array) => {
        nextBytes = value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
      },
      close: async () => {
        this.state.bytes = nextBytes;
        this.state.lastModified = Date.now();
      },
    };
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function createSchemaFailureSnapshot(): Uint8Array {
  const rawDb = new SQL.Database();
  rawDb.run("CREATE VIEW repos AS SELECT 1 AS id;");
  const bytes = rawDb.export();
  rawDb.close();
  return bytes;
}

function createHealthySnapshot(repoId: number): Uint8Array {
  const rawDb = new SQL.Database();
  runSchema(rawDb);
  rawDb.run(
    `INSERT INTO repos (
      id, full_name, name, topics_json, html_url, stars, forks, updated_at,
      checksum, readme_retry_required, last_synced_at
    ) VALUES (?, ?, ?, '[]', ?, 0, 0, '2026-07-26T00:00:00Z', ?, 0, 1);`,
    [
      repoId,
      `owner/repo-${repoId}`,
      `repo-${repoId}`,
      `https://github.com/owner/repo-${repoId}`,
      `checksum-${repoId}`,
    ],
  );
  const bytes = rawDb.export();
  rawDb.close();
  return bytes;
}

async function seedRepoDatabase(args: {
  scopeKey: string;
  storageMode: "opfs" | "local-storage";
  repoId: number;
  lastSyncedAt: number;
}): Promise<void> {
  const rawDb = new SQL.Database();
  runSchema(rawDb);
  const database = new LocalDatabase({
    sql: SQL,
    db: rawDb,
    storageMode: args.storageMode,
    scopeKey: args.scopeKey,
  });

  await database.upsertRepos([
    {
      id: args.repoId,
      fullName: `owner/repo-${args.repoId}`,
      name: `repo-${args.repoId}`,
      description: null,
      topics: [],
      language: "TypeScript",
      htmlUrl: `https://github.com/owner/repo-${args.repoId}`,
      stars: 1,
      forks: 0,
      updatedAt: "2026-03-09T00:00:00Z",
      readmeUrl: null,
      readmeText: `repo ${args.repoId}`,
      checksum: `checksum-${args.repoId}`,
      lastSyncedAt: args.lastSyncedAt,
    },
  ]);
}

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => `node_modules/sql.js/dist/${file}`,
  });
});

beforeEach(() => {
  originalLocalStorage = globalThis.localStorage;
  originalNavigator = globalThis.navigator;
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
  if (originalNavigator === undefined) {
    delete (globalThis as { navigator?: Navigator }).navigator;
  } else {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
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
    expect(getScopedDatabaseStorageKey("auth:abc/123")).toBe(
      "gitstarrecall.sqlite.base64.auth:abc_123",
    );
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

  it("cleans up the legacy snapshot when the stable target already exists", async () => {
    const legacyScope = "token:legacy";
    const nextScope = "auth:github:42";

    localStorage.setItem(
      getScopedDatabaseStorageKey(legacyScope),
      encodeBase64(new Uint8Array([1, 2, 3])),
    );
    localStorage.setItem(
      getScopedDatabaseStorageKey(nextScope),
      encodeBase64(new Uint8Array([4, 5, 6])),
    );

    const migrated = await migrateLocalDatabaseScope({
      fromScopeKey: legacyScope,
      toScopeKey: nextScope,
    });

    expect(migrated).toBe(false);
    expect(localStorage.getItem(getScopedDatabaseStorageKey(legacyScope))).toBeNull();
    expect(localStorage.getItem(getScopedDatabaseStorageKey(nextScope))).not.toBeNull();
  });

  it("clears unreadable legacy snapshots and allows migration to fall through", async () => {
    const legacyScope = "token:broken";
    const nextScope = "auth:github:42";

    localStorage.setItem(
      getScopedDatabaseStorageKey(legacyScope),
      encodeBase64(new Uint8Array([1, 2, 3])),
    );

    const migrated = await migrateLocalDatabaseScope({
      fromScopeKey: legacyScope,
      toScopeKey: nextScope,
    });

    expect(migrated).toBe(false);
    expect(localStorage.getItem(getScopedDatabaseStorageKey(legacyScope))).toBeNull();
    expect(localStorage.getItem(getScopedDatabaseStorageKey(nextScope))).toBeNull();
  });

  it("prefers the fresher local-storage snapshot when OPFS contains an older copy", async () => {
    const sourceScope = "auth:github:freshness";
    const opfsRoot = new MemoryOpfsRoot();
    const nowSpy = vi.spyOn(Date, "now");
    Object.defineProperty(globalThis, "navigator", {
      value: {
        storage: {
          getDirectory: async () => opfsRoot,
        },
      },
      configurable: true,
    });

    nowSpy.mockReturnValue(1_000);
    await seedRepoDatabase({
      scopeKey: sourceScope,
      storageMode: "opfs",
      repoId: 1,
      lastSyncedAt: 1_000,
    });
    nowSpy.mockReturnValue(2_000);
    await seedRepoDatabase({
      scopeKey: sourceScope,
      storageMode: "local-storage",
      repoId: 2,
      lastSyncedAt: 2_000,
    });

    setLocalDatabaseScope(sourceScope);
    const database = await getLocalDatabase();

    expect(database.listRepos().map((repo) => repo.id)).toEqual([2]);
    nowSpy.mockRestore();
  });

  it("preserves a local-storage snapshot when schema initialization fails and retries later", async () => {
    const scopeKey = "auth:github:migration-failure-local";
    const storageKey = getScopedDatabaseStorageKey(scopeKey);
    const originalEncoded = encodeBase64(createSchemaFailureSnapshot());
    localStorage.setItem(storageKey, originalEncoded);
    setLocalDatabaseScope(scopeKey);

    await expect(getLocalDatabase()).rejects.toThrow(
      "Failed to open or migrate the local database. Stored data was preserved",
    );
    expect(localStorage.getItem(storageKey)).toBe(originalEncoded);

    localStorage.setItem(storageKey, encodeBase64(createHealthySnapshot(91)));
    const recovered = await getLocalDatabase();
    expect(recovered.listRepos().map((repo) => repo.id)).toEqual([91]);
  });

  it("preserves an OPFS snapshot when schema initialization fails", async () => {
    const scopeKey = "auth:github:migration-failure-opfs";
    const opfsRoot = new MemoryOpfsRoot();
    Object.defineProperty(globalThis, "navigator", {
      value: {
        storage: {
          getDirectory: async () => opfsRoot,
        },
      },
      configurable: true,
    });
    const originalBytes = createSchemaFailureSnapshot();
    const handle = await opfsRoot.getFileHandle(getScopedDatabaseFileName(scopeKey), {
      create: true,
    });
    const writable = await handle.createWritable();
    await writable.write(originalBytes);
    await writable.close();
    setLocalDatabaseScope(scopeKey);

    await expect(getLocalDatabase()).rejects.toThrow(
      "Failed to open or migrate the local database. Stored data was preserved",
    );
    const preserved = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    expect(preserved).toEqual(originalBytes);
  });
});
