import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";
import { LocalDatabase, runSchema } from "./client";

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => `node_modules/sql.js/dist/${file}`,
  });
});

function getSingleNumber(database: Database, sql: string): number {
  const result = database.exec(sql);
  if (result.length === 0 || result[0].values.length === 0) {
    return 0;
  }

  return Number(result[0].values[0][0]);
}

function createLocalDatabase(database: Database): LocalDatabase {
  return new LocalDatabase({ sql: SQL, db: database, storageMode: "memory" });
}

describe("LocalDatabase chat schema hardening", () => {
  it("rebuilds legacy chat tables and drops invalid/orphan messages", async () => {
    const rawDb = new SQL.Database();
    rawDb.run("PRAGMA foreign_keys = OFF;");
    rawDb.run(`
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        query TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
    rawDb.run(`
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        role TEXT,
        content TEXT,
        created_at INTEGER
      );
    `);
    rawDb.run(
      `INSERT INTO chat_sessions (id, query, created_at, updated_at) VALUES ('s-valid', 'legacy', 1700000000000, 1700000000500);`,
    );
    rawDb.run(
      `INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES ('m-null', NULL, 'user', 'bad null session', 1700000000600);`,
    );
    rawDb.run(
      `INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES ('m-orphan', 'missing-session', 'user', 'orphan', 1700000000700);`,
    );
    rawDb.run("PRAGMA foreign_keys = ON;");

    runSchema(rawDb);

    const blankSessionCount = getSingleNumber(
      rawDb,
      "SELECT COUNT(*) FROM chat_messages WHERE session_id IS NULL OR TRIM(COALESCE(session_id, '')) = '';",
    );
    const orphanCount = getSingleNumber(
      rawDb,
      "SELECT COUNT(*) FROM chat_messages WHERE session_id NOT IN (SELECT id FROM chat_sessions);",
    );

    expect(blankSessionCount).toBe(0);
    expect(orphanCount).toBe(0);

    const localDb = createLocalDatabase(rawDb);
    await localDb.upsertChatSession({
      id: "s-new",
      query: "new query",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await localDb.addChatMessage({
      id: "m-new",
      sessionId: "s-new",
      role: "user",
      content: "hello",
      sequence: 1,
      createdAt: Date.now(),
    });

    expect(localDb.listChatMessages("s-new")).toHaveLength(1);
  });

  it("restores required chat_messages foreign key when missing", () => {
    const rawDb = new SQL.Database();
    rawDb.run(`
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    rawDb.run(`
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    runSchema(rawDb);

    const fkResult = rawDb.exec("PRAGMA foreign_key_list(chat_messages);");
    const hasExpectedFk =
      fkResult.length > 0 &&
      fkResult[0].values.some((row) => {
        return (
          String(row[2]) === "chat_sessions" &&
          String(row[3]) === "session_id" &&
          String(row[4]) === "id" &&
          String(row[6]).toUpperCase() === "CASCADE"
        );
      });

    expect(hasExpectedFk).toBe(true);
  });

  it("self-heals when a stale trigger causes NOT NULL session_id failures", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);

    rawDb.run(`
      CREATE TRIGGER chat_messages_nullify_session
      AFTER INSERT ON chat_messages
      BEGIN
        UPDATE chat_messages SET session_id = NULL WHERE id = NEW.id;
      END;
    `);

    const localDb = createLocalDatabase(rawDb);
    await localDb.upsertChatSession({
      id: "s-trigger",
      query: "trigger test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await localDb.addChatMessage({
      id: "m-trigger",
      sessionId: "s-trigger",
      role: "user",
      content: "message",
      sequence: 1,
      createdAt: Date.now(),
    });

    const triggerCount = getSingleNumber(
      rawDb,
      "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='chat_messages';",
    );

    expect(triggerCount).toBe(0);
    expect(localDb.listChatMessages("s-trigger")).toHaveLength(1);
  });

  it("fails fast with clear error when session id is blank", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb);

    await expect(
      localDb.addChatMessage({
        id: "m-blank",
        sessionId: "   ",
        role: "user",
        content: "invalid",
        sequence: 1,
        createdAt: Date.now(),
      }),
    ).rejects.toThrow("chat message id/session_id is required");
  });

  it("self-heals missing session row before inserting message", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb);

    await localDb.addChatMessage({
      id: "m-recover-session",
      sessionId: "s-recovered",
      role: "user",
      content: "recovered insert",
      sequence: 1,
      createdAt: Date.now(),
    });

    const sessions = localDb.listChatSessions();
    const recoveredSession = sessions.find((session) => session.id === "s-recovered");
    expect(recoveredSession).toBeTruthy();
    expect(localDb.listChatMessages("s-recovered")).toHaveLength(1);
  });
});
