import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  LocalDatabase,
  LocalDatabaseWriterLeaseError,
  getScopedDatabaseFileName,
  getScopedDatabaseStorageKey,
  runSchema,
} from "./client";
import type { RepoRecord } from "./types";

class MemoryStorage implements Storage {
  protected entries = new Map<string, string>();

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

class FailingStorage extends MemoryStorage {
  constructor(private failuresRemaining: number) {
    super();
  }

  override setItem(key: string, value: string): void {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new DOMException("quota exceeded", "QuotaExceededError");
    }
    super.setItem(key, value);
  }
}

class ControlledOpfsRoot {
  private files = new Map<string, Uint8Array>();
  private closeGates: Array<Promise<void>> = [];
  private removeEntryFailure: unknown = null;
  closeCount = 0;

  delayNextClose(gate: Promise<void>): void {
    this.closeGates.push(gate);
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) {
      throw new Error("File not found");
    }
    if (!this.files.has(name)) {
      this.files.set(name, new Uint8Array());
    }

    return {
      getFile: async () => ({
        arrayBuffer: async () => this.copy(this.files.get(name) ?? new Uint8Array()).buffer,
        lastModified: Date.now(),
      }),
      createWritable: async () => {
        let pending: Uint8Array<ArrayBufferLike> = new Uint8Array();
        return {
          write: async (value: ArrayBuffer | Uint8Array) => {
            pending = this.copy(value instanceof Uint8Array ? value : new Uint8Array(value));
          },
          close: async () => {
            this.closeCount += 1;
            const gate = this.closeGates.shift();
            if (gate) await gate;
            this.files.set(name, pending);
          },
        };
      },
    };
  }

  failNextRemoveEntry(error: unknown): void {
    this.removeEntryFailure = error;
  }

  async removeEntry(name: string): Promise<void> {
    if (this.removeEntryFailure !== null) {
      const failure = this.removeEntryFailure;
      this.removeEntryFailure = null;
      throw failure;
    }
    if (!this.files.has(name)) {
      throw new DOMException(`${name} not found`, "NotFoundError");
    }
    this.files.delete(name);
  }

  read(name: string): Uint8Array {
    return this.copy(this.files.get(name) ?? new Uint8Array());
  }

  private copy(bytes: Uint8Array): Uint8Array {
    const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
    copy.set(bytes);
    return copy;
  }
}

class ExclusiveIfAvailableLocks {
  private held = new Set<string>();

  async request(
    name: string,
    _options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: object | null) => Promise<void>,
  ): Promise<void> {
    if (this.held.has(name)) {
      await callback(null);
      return;
    }

    this.held.add(name);
    try {
      await callback({ name, mode: "exclusive" });
    } finally {
      this.held.delete(name);
    }
  }

  isHeld(name: string): boolean {
    return this.held.has(name);
  }
}

let SQL: SqlJsStatic;
const originalLocalStorage = globalThis.localStorage;
const originalNavigator = globalThis.navigator;

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (file) => `node_modules/sql.js/dist/${file}` });
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: originalLocalStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
  });
});

function rawDatabase(): Database {
  const database = new SQL.Database();
  runSchema(database);
  return database;
}

function repo(id: number): RepoRecord {
  return {
    id,
    fullName: `owner/repo-${id}`,
    name: `repo-${id}`,
    description: null,
    topics: [],
    language: "TypeScript",
    htmlUrl: `https://github.com/owner/repo-${id}`,
    stars: id,
    forks: 0,
    updatedAt: "2026-07-26T00:00:00Z",
    readmeUrl: null,
    readmeText: `repo ${id}`,
    checksum: `checksum-${id}`,
    lastSyncedAt: id,
  };
}

function repoIdsFromSnapshot(bytes: Uint8Array): number[] {
  const database = new SQL.Database(bytes);
  try {
    const result = database.exec("SELECT id FROM repos ORDER BY id ASC;");
    return result.length === 0 ? [] : result[0].values.map((row) => Number(row[0]));
  } finally {
    database.close();
  }
}

function installOpfs(root: ControlledOpfsRoot, locks?: ExclusiveIfAvailableLocks): void {
  Object.defineProperty(globalThis, "navigator", {
    value: {
      storage: { getDirectory: async () => root },
      ...(locks ? { locks } : {}),
    },
    configurable: true,
  });
}

describe("LocalDatabase durability ordering", () => {
  it("serializes export and delayed OPFS close so the latest mutation is durable", async () => {
    const scopeKey = "auth:durability-order";
    const root = new ControlledOpfsRoot();
    let releaseFirstClose: () => void = () => {};
    const firstCloseGate = new Promise<void>((resolve) => {
      releaseFirstClose = resolve;
    });
    root.delayNextClose(firstCloseGate);
    installOpfs(root);
    const database = new LocalDatabase({
      sql: SQL,
      db: rawDatabase(),
      storageMode: "opfs",
      scopeKey,
    });

    const first = database.upsertRepos([repo(1)]);
    await vi.waitFor(() => expect(root.closeCount).toBe(1));
    const second = database.upsertRepos([repo(2)]);
    await Promise.resolve();
    expect(root.closeCount).toBe(1);

    releaseFirstClose();
    await Promise.all([first, second]);

    expect(root.closeCount).toBe(2);
    expect(repoIdsFromSnapshot(root.read(getScopedDatabaseFileName(scopeKey)))).toEqual([1, 2]);
  });

  it("returns a write's own failure and recovers the serialization tail", async () => {
    const scopeKey = "auth:durability-recovery";
    const storage = new FailingStorage(1);
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    const database = new LocalDatabase({
      sql: SQL,
      db: rawDatabase(),
      storageMode: "local-storage",
      scopeKey,
    });

    await expect(database.upsertRepos([repo(1)])).rejects.toThrow(
      "Unable to persist local database",
    );
    await expect(database.upsertRepos([repo(2)])).resolves.toBeUndefined();

    const encoded = storage.getItem(getScopedDatabaseStorageKey(scopeKey));
    expect(encoded).not.toBeNull();
    const bytes = Uint8Array.from(atob(encoded ?? ""), (character) => character.charCodeAt(0));
    expect(repoIdsFromSnapshot(bytes)).toEqual([1, 2]);
  });

  it("rejects terminal browser persistence failures but preserves explicit memory mode", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: new FailingStorage(Number.POSITIVE_INFINITY),
      configurable: true,
    });
    const durable = new LocalDatabase({
      sql: SQL,
      db: rawDatabase(),
      storageMode: "local-storage",
      scopeKey: "auth:durability-terminal",
    });
    const memory = new LocalDatabase({ sql: SQL, db: rawDatabase(), storageMode: "memory" });

    await expect(durable.upsertRepos([repo(1)])).rejects.toThrow(
      "Unable to persist local database",
    );
    await expect(memory.upsertRepos([repo(2)])).resolves.toBeUndefined();
    expect(memory.listRepos().map((item) => item.id)).toEqual([2]);
  });

  it("orders clear after earlier persistence so stale bytes cannot resurrect", async () => {
    const scopeKey = "auth:durability-clear";
    const root = new ControlledOpfsRoot();
    let releaseFirstClose: () => void = () => {};
    root.delayNextClose(
      new Promise<void>((resolve) => {
        releaseFirstClose = resolve;
      }),
    );
    installOpfs(root);
    const database = new LocalDatabase({
      sql: SQL,
      db: rawDatabase(),
      storageMode: "opfs",
      scopeKey,
    });

    const mutation = database.upsertRepos([repo(1)]);
    await vi.waitFor(() => expect(root.closeCount).toBe(1));
    const clear = database.clearAllData();
    expect(database.listRepos().map((item) => item.id)).toEqual([1]);

    releaseFirstClose();
    await Promise.all([mutation, clear]);

    expect(repoIdsFromSnapshot(root.read(getScopedDatabaseFileName(scopeKey)))).toEqual([]);
    expect(database.listRepos()).toEqual([]);
  });

  it("fails clearAllData when the OPFS snapshot cannot be removed", async () => {
    const scopeKey = "auth:durability-clear-opfs-failure";
    const root = new ControlledOpfsRoot();
    installOpfs(root);
    const database = new LocalDatabase({
      sql: SQL,
      db: rawDatabase(),
      storageMode: "opfs",
      scopeKey,
    });

    await database.upsertRepos([repo(1)]);
    expect(repoIdsFromSnapshot(root.read(getScopedDatabaseFileName(scopeKey)))).toEqual([1]);

    root.failNextRemoveEntry(new DOMException("removal blocked", "NoModificationAllowedError"));
    await expect(database.clearAllData()).rejects.toThrow(/removal blocked/);

    // Deletion genuinely did not happen, so it must not have reported success.
    // The empty replacement snapshot is never written, so nothing can later beat
    // the surviving bytes in freshness arbitration.
    expect(repoIdsFromSnapshot(root.read(getScopedDatabaseFileName(scopeKey)))).toEqual([1]);
  });

  it("treats an already absent OPFS snapshot as a successful clear", async () => {
    const scopeKey = "auth:durability-clear-opfs-absent";
    const root = new ControlledOpfsRoot();
    installOpfs(root);
    const database = new LocalDatabase({
      sql: SQL,
      db: rawDatabase(),
      storageMode: "opfs",
      scopeKey,
    });

    // No snapshot was ever written, so removeEntry reports NotFoundError.
    await expect(database.clearAllData()).resolves.toBeUndefined();
    expect(database.listRepos()).toEqual([]);
  });

  it("admits a mutation invoked after clear only after the replacement database is durable", async () => {
    const scopeKey = "auth:durability-clear-then-write";
    const root = new ControlledOpfsRoot();
    let releaseFirstClose: () => void = () => {};
    root.delayNextClose(
      new Promise<void>((resolve) => {
        releaseFirstClose = resolve;
      }),
    );
    installOpfs(root);
    const database = new LocalDatabase({
      sql: SQL,
      db: rawDatabase(),
      storageMode: "opfs",
      scopeKey,
    });

    const olderMutation = database.upsertRepos([repo(1)]);
    await vi.waitFor(() => expect(root.closeCount).toBe(1));
    const clear = database.clearAllData();
    const laterMutation = database.upsertRepos([repo(2)]);

    expect(database.listRepos().map((item) => item.id)).toEqual([1]);
    releaseFirstClose();
    await Promise.all([olderMutation, clear, laterMutation]);

    expect(database.listRepos().map((item) => item.id)).toEqual([2]);
    expect(repoIdsFromSnapshot(root.read(getScopedDatabaseFileName(scopeKey)))).toEqual([2]);
  });
});

describe("LocalDatabase exclusive writer lease", () => {
  it("allows empty deletes without a writer lease", async () => {
    const scopeKey = "auth:empty-delete-without-lease";
    const locks = new ExclusiveIfAvailableLocks();
    const root = new ControlledOpfsRoot();
    installOpfs(root, locks);
    const holder = new LocalDatabase({
      sql: SQL,
      db: rawDatabase(),
      storageMode: "opfs",
      scopeKey,
    });
    const leaseName = `gitstarrecall:database-writer:${scopeKey}`;
    await vi.waitFor(() => expect(locks.isHeld(leaseName)).toBe(true));
    const blocked = new LocalDatabase({
      sql: SQL,
      db: rawDatabase(),
      storageMode: "opfs",
      scopeKey,
    });

    await expect(blocked.deleteReposByIds([])).resolves.toBeUndefined();
    await expect(blocked.deleteChunksByRepoIds([])).resolves.toBeUndefined();
    await expect(blocked.deleteReposByIds([1])).rejects.toBeInstanceOf(
      LocalDatabaseWriterLeaseError,
    );

    holder.releaseWriterLeaseForTests();
    await vi.waitFor(() => expect(locks.isHeld(leaseName)).toBe(false));
  });

  it("fails a second writer closed before changing SQL and releases explicitly", async () => {
    const scopeKey = "auth:exclusive-writer";
    const locks = new ExclusiveIfAvailableLocks();
    const root = new ControlledOpfsRoot();
    installOpfs(root, locks);
    Object.defineProperty(globalThis, "localStorage", {
      value: new MemoryStorage(),
      configurable: true,
    });
    const first = new LocalDatabase({ sql: SQL, db: rawDatabase(), storageMode: "opfs", scopeKey });
    const second = new LocalDatabase({
      sql: SQL,
      db: rawDatabase(),
      storageMode: "opfs",
      scopeKey,
    });

    await first.upsertRepos([repo(1)]);
    await expect(second.upsertRepos([repo(2)])).rejects.toBeInstanceOf(
      LocalDatabaseWriterLeaseError,
    );
    expect(second.listRepos()).toEqual([]);

    first.releaseWriterLeaseForTests();
    await vi.waitFor(() =>
      expect(locks.isHeld(`gitstarrecall:database-writer:${scopeKey}`)).toBe(false),
    );
    const replacement = new LocalDatabase({
      sql: SQL,
      db: rawDatabase(),
      storageMode: "opfs",
      scopeKey,
    });
    await expect(replacement.upsertRepos([repo(3)])).resolves.toBeUndefined();
    replacement.releaseWriterLeaseForTests();
  });
});
