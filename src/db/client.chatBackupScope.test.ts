import initSqlJs, { type SqlJsStatic } from "sql.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatBackupScope } from "./chatBackup";

const backupMocks = vi.hoisted(() => ({
  backupChatSession: vi.fn().mockResolvedValue(true),
  backupChatMessage: vi.fn().mockResolvedValue(true),
  clearChatBackup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./chatBackup", () => backupMocks);

import { LocalDatabase, getScopedDatabaseStorageKey, runSchema } from "./client";

let SQL: SqlJsStatic;
const originalLocalStorage = globalThis.localStorage;

class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();
  get length() {
    return this.entries.size;
  }
  clear() {
    this.entries.clear();
  }
  getItem(key: string) {
    return this.entries.get(key) ?? null;
  }
  key(index: number) {
    return [...this.entries.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.entries.delete(key);
  }
  setItem(key: string, value: string) {
    this.entries.set(key, value);
  }
}

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => `node_modules/sql.js/dist/${file}`,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
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
});

function createDatabase(chatBackupScope: ChatBackupScope): LocalDatabase {
  const raw = new SQL.Database();
  runSchema(raw);
  return new LocalDatabase({
    sql: SQL,
    db: raw,
    storageMode: "memory",
    scopeKey: "auth:github:immutable",
    chatBackupScope,
  });
}

function readPersistedDatabase(scopeKey: string) {
  const encoded = localStorage.getItem(getScopedDatabaseStorageKey(scopeKey));
  expect(encoded).not.toBeNull();
  const bytes = Uint8Array.from(atob(encoded ?? ""), (character) => character.charCodeAt(0));
  return new SQL.Database(bytes);
}

describe("LocalDatabase chat backup scope", () => {
  it("captures an immutable scope and passes it to session and message backups", async () => {
    const suppliedScope = {
      key: "chat:github:42",
      legacySessionPrefix: "chat:github:42:",
    };
    const database = createDatabase(suppliedScope);
    suppliedScope.key = "chat:attacker";
    suppliedScope.legacySessionPrefix = "chat:attacker:";

    const session = {
      id: "chat:github:42:session",
      query: "query",
      createdAt: 100,
      updatedAt: 100,
    };
    await database.upsertChatSession(session);
    await database.addChatMessage({
      id: "message",
      sessionId: session.id,
      role: "user",
      content: "hello",
      sequence: 1,
      createdAt: 101,
    });

    const expectedScope = {
      key: "chat:github:42",
      legacySessionPrefix: "chat:github:42:",
    };
    expect(backupMocks.backupChatSession).toHaveBeenCalledWith(expectedScope, session);
    expect(backupMocks.backupChatMessage).toHaveBeenCalledWith(
      expectedScope,
      expect.objectContaining({ id: "message", sessionId: session.id }),
    );

    await database.clearAllData();
    expect(backupMocks.clearChatBackup).toHaveBeenCalledWith(expectedScope);
    database.releaseWriterLeaseForTests();
  });

  it("keeps a session durable and reports when its auxiliary backup rejects", async () => {
    backupMocks.backupChatSession.mockRejectedValueOnce(new Error("backup unavailable"));
    const scope = { key: "chat:github:42", legacySessionPrefix: "chat:github:42:" };
    const raw = new SQL.Database();
    runSchema(raw);
    const database = new LocalDatabase({
      sql: SQL,
      db: raw,
      storageMode: "local-storage",
      scopeKey: "auth:github:session-durability",
      chatBackupScope: scope,
    });

    await expect(
      database.upsertChatSession({
        id: "chat:github:42:session",
        query: "durable",
        createdAt: 100,
        updatedAt: 100,
      }),
    ).resolves.toBeUndefined();

    const persisted = readPersistedDatabase("auth:github:session-durability");
    expect(persisted.exec("SELECT query FROM chat_sessions;")[0]?.values).toEqual([["durable"]]);
    persisted.close();
    expect(localStorage.getItem("gitstarrecall.local_logs.v2.github%3A42")).toContain(
      "chat_session_backup_failed",
    );
    database.releaseWriterLeaseForTests();
  });

  it("keeps a message durable and reports when its auxiliary backup rejects", async () => {
    const scope = { key: "chat:github:42", legacySessionPrefix: "chat:github:42:" };
    const raw = new SQL.Database();
    runSchema(raw);
    const database = new LocalDatabase({
      sql: SQL,
      db: raw,
      storageMode: "local-storage",
      scopeKey: "auth:github:message-durability",
      chatBackupScope: scope,
    });
    await database.upsertChatSession({
      id: "chat:github:42:session",
      query: "durable",
      createdAt: 100,
      updatedAt: 100,
    });
    backupMocks.backupChatMessage.mockRejectedValueOnce(new Error("backup unavailable"));

    await expect(
      database.addChatMessage({
        id: "message",
        sessionId: "chat:github:42:session",
        role: "assistant",
        content: "persisted",
        sequence: 1,
        createdAt: 101,
      }),
    ).resolves.toBeUndefined();

    const persisted = readPersistedDatabase("auth:github:message-durability");
    expect(persisted.exec("SELECT content FROM chat_messages;")[0]?.values).toEqual([
      ["persisted"],
    ]);
    persisted.close();
    expect(localStorage.getItem("gitstarrecall.local_logs.v2.github%3A42")).toContain(
      "chat_message_backup_failed",
    );
    database.releaseWriterLeaseForTests();
  });
});
