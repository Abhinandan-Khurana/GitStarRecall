import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { DATABASE_SCHEMA_SQL } from "./schema";
import { backupChatMessage, backupChatSession, clearChatBackup } from "./chatBackup";
import { reciprocalRankFusion } from "../search/fusion";
import { lexicalOverlapScore, countRareLikeTokens } from "../search/lexical";
import { mmrSelect, type DenseCandidate } from "../search/rerank";
import { cosineSimilaritySafe } from "../search/vectorMath";
import type {
  ChatMessageRecord,
  ChatSessionRecord,
  ChunkRecord,
  EmbeddingRecord,
  IndexMetaRecord,
  RepoRecord,
  RepoSyncState,
  SearchResult,
  StorageMode,
} from "./types";

const DB_NAME_PREFIX = "gitstarrecall";
const LOCAL_STORAGE_KEY_PREFIX = "gitstarrecall.sqlite.base64";
const LOCAL_STORAGE_UPDATED_AT_KEY_PREFIX = "gitstarrecall.sqlite.updated-at";
const DEFAULT_EMBEDDING_CHECKPOINT_EVERY_EMBEDDINGS = 256;
const DEFAULT_EMBEDDING_CHECKPOINT_EVERY_MS = 3000;

let sqlPromise: Promise<SqlJsStatic> | null = null;
let currentDatabaseScopeKey = "anon";
const dbPromiseByScope = new Map<string, Promise<LocalDatabase>>();

type EmbeddingCheckpointPolicy = {
  everyEmbeddings: number;
  everyMs: number;
};

type SqlRowValue = string | number | Uint8Array | null;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function isOpfsSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.storage?.getDirectory);
}

function normalizeDatabaseScopeKey(scopeKey: string): string {
  const trimmed = String(scopeKey ?? "").trim();
  if (!trimmed) {
    return "anon";
  }
  return trimmed.replace(/[^a-z0-9:_-]/gi, "_");
}

export function getScopedDatabaseFileName(scopeKey: string): string {
  const normalized = normalizeDatabaseScopeKey(scopeKey);
  return normalized === "anon"
    ? `${DB_NAME_PREFIX}.sqlite`
    : `${DB_NAME_PREFIX}.${normalized}.sqlite`;
}

export function getScopedDatabaseStorageKey(scopeKey: string): string {
  return `${LOCAL_STORAGE_KEY_PREFIX}.${normalizeDatabaseScopeKey(scopeKey)}`;
}

function getScopedDatabaseUpdatedAtStorageKey(scopeKey: string): string {
  return `${LOCAL_STORAGE_UPDATED_AT_KEY_PREFIX}.${normalizeDatabaseScopeKey(scopeKey)}`;
}

async function loadBytesFromOpfs(scopeKey: string): Promise<Uint8Array | null> {
  if (!isOpfsSupported()) {
    return null;
  }

  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(getScopedDatabaseFileName(scopeKey));
    const file = await handle.getFile();
    const arrayBuffer = await file.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch {
    return null;
  }
}

async function getOpfsLastModified(scopeKey: string): Promise<number | null> {
  if (!isOpfsSupported()) {
    return null;
  }

  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(getScopedDatabaseFileName(scopeKey));
    const file = await handle.getFile();
    return Number.isFinite(file.lastModified) ? file.lastModified : null;
  } catch {
    return null;
  }
}

async function writeBytesToOpfs(bytes: Uint8Array, scopeKey: string): Promise<boolean> {
  if (!isOpfsSupported()) {
    return false;
  }

  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(getScopedDatabaseFileName(scopeKey), { create: true });
    const writable = await handle.createWritable();
    const stableBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(stableBuffer).set(bytes);
    await writable.write(stableBuffer);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

async function clearOpfsFile(scopeKey: string): Promise<void> {
  if (!isOpfsSupported()) {
    return;
  }

  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(getScopedDatabaseFileName(scopeKey));
  } catch {
    // noop: best effort
  }
}

function loadBytesFromLocalStorage(scopeKey: string): Uint8Array | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const encoded = localStorage.getItem(getScopedDatabaseStorageKey(scopeKey));

  if (!encoded) {
    return null;
  }

  try {
    return fromBase64(encoded);
  } catch {
    return null;
  }
}

function loadLocalStorageUpdatedAt(scopeKey: string): number | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const raw = localStorage.getItem(getScopedDatabaseUpdatedAtStorageKey(scopeKey));
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function writeBytesToLocalStorage(bytes: Uint8Array, scopeKey: string): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(getScopedDatabaseStorageKey(scopeKey), toBase64(bytes));
  localStorage.setItem(getScopedDatabaseUpdatedAtStorageKey(scopeKey), String(Date.now()));
}

function clearLocalStorageBytes(scopeKey: string): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.removeItem(getScopedDatabaseStorageKey(scopeKey));
  localStorage.removeItem(getScopedDatabaseUpdatedAtStorageKey(scopeKey));
}

type PersistedScopeSnapshot = {
  bytes: Uint8Array;
  storageMode: Extract<StorageMode, "opfs" | "local-storage">;
  modifiedAt: number | null;
};

function readSingleNumericResult(database: Database, query: string): number | null {
  try {
    const result = database.exec(query);
    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }

    const value = Number(result[0].values[0]?.[0] ?? NaN);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function computeSnapshotFreshness(bytes: Uint8Array): Promise<number | null> {
  try {
    const sql = await getSql();
    const database = new sql.Database(bytes);
    try {
      const candidates = [
        readSingleNumericResult(database, "SELECT MAX(updated_at) FROM chat_sessions;"),
        readSingleNumericResult(database, "SELECT MAX(created_at) FROM chat_messages;"),
        readSingleNumericResult(database, "SELECT MAX(updated_at) FROM index_meta;"),
        readSingleNumericResult(database, "SELECT MAX(last_synced_at) FROM repos;"),
      ].filter((value): value is number => value !== null);

      return candidates.length > 0 ? Math.max(...candidates) : null;
    } finally {
      database.close();
    }
  } catch {
    return null;
  }
}

async function readPersistedScopeSnapshot(scopeKey: string): Promise<PersistedScopeSnapshot | null> {
  const opfsBytes = await loadBytesFromOpfs(scopeKey);
  const localBytes = loadBytesFromLocalStorage(scopeKey);
  const opfsSnapshot = opfsBytes
    ? {
      bytes: opfsBytes,
      storageMode: "opfs" as const,
      modifiedAt: await getOpfsLastModified(scopeKey),
    }
    : null;
  const localSnapshot = localBytes
    ? {
      bytes: localBytes,
      storageMode: "local-storage" as const,
      modifiedAt: loadLocalStorageUpdatedAt(scopeKey),
    }
    : null;

  if (!opfsSnapshot) {
    return localSnapshot;
  }

  if (!localSnapshot) {
    return opfsSnapshot;
  }

  const [opfsFreshness, localFreshness] = await Promise.all([
    computeSnapshotFreshness(opfsSnapshot.bytes),
    computeSnapshotFreshness(localSnapshot.bytes),
  ]);

  if (opfsFreshness !== null || localFreshness !== null) {
    if ((localFreshness ?? Number.NEGATIVE_INFINITY) > (opfsFreshness ?? Number.NEGATIVE_INFINITY)) {
      return localSnapshot;
    }
    if ((opfsFreshness ?? Number.NEGATIVE_INFINITY) > (localFreshness ?? Number.NEGATIVE_INFINITY)) {
      return opfsSnapshot;
    }
  }

  if ((localSnapshot.modifiedAt ?? Number.NEGATIVE_INFINITY) > (opfsSnapshot.modifiedAt ?? Number.NEGATIVE_INFINITY)) {
    return localSnapshot;
  }

  return opfsSnapshot;
}

async function writePersistedScopeSnapshot(
  bytes: Uint8Array,
  scopeKey: string,
  preferredStorageMode: Extract<StorageMode, "opfs" | "local-storage">,
): Promise<Extract<StorageMode, "opfs" | "local-storage">> {
  if (preferredStorageMode === "opfs") {
    const opfsWritten = await writeBytesToOpfs(bytes, scopeKey);
    if (opfsWritten) {
      clearLocalStorageBytes(scopeKey);
      return "opfs";
    }
  }

  try {
    writeBytesToLocalStorage(bytes, scopeKey);
    return "local-storage";
  } catch {
    const opfsWritten = await writeBytesToOpfs(bytes, scopeKey);
    if (opfsWritten) {
      clearLocalStorageBytes(scopeKey);
      return "opfs";
    }
    throw new Error(`Unable to persist local database for scope ${scopeKey}`);
  }
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.max(1, Math.trunc(parsed));
}

function readEnvPositiveInt(name: string, fallback: number): number {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env;
  if (!env) {
    return fallback;
  }

  return normalizePositiveInt(env[name], fallback);
}

function getEmbeddingCheckpointPolicyFromEnv(): EmbeddingCheckpointPolicy {
  return {
    everyEmbeddings: readEnvPositiveInt(
      "VITE_DB_CHECKPOINT_EVERY_EMBEDDINGS",
      DEFAULT_EMBEDDING_CHECKPOINT_EVERY_EMBEDDINGS,
    ),
    everyMs: readEnvPositiveInt("VITE_DB_CHECKPOINT_EVERY_MS", DEFAULT_EMBEDDING_CHECKPOINT_EVERY_MS),
  };
}

async function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: () => wasmUrl,
    });
  }

  return sqlPromise;
}

type TableColumnInfo = {
  name: string;
  type: string;
  notNull: boolean;
};

function getTableColumns(database: Database, tableName: string): TableColumnInfo[] {
  const columnsResult = database.exec(`PRAGMA table_info(${tableName});`);
  if (columnsResult.length === 0) {
    return [];
  }

  return columnsResult[0].values.map((row) => ({
    name: String(row[1]),
    type: String(row[2]).toUpperCase(),
    notNull: Number(row[3]) === 1,
  }));
}

function getTableSql(database: Database, tableName: string): string {
  const tableSqlResult = database.exec(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name = ?;`,
    [tableName],
  );

  if (tableSqlResult.length === 0 || tableSqlResult[0].values.length === 0) {
    return "";
  }

  return String(tableSqlResult[0].values[0][0] ?? "");
}

function tableExists(database: Database, tableName: string): boolean {
  const result = database.exec(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1;`,
    [tableName],
  );

  return result.length > 0 && result[0].values.length > 0;
}

function createCanonicalChatTables(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT NOT NULL PRIMARY KEY,
      query TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT NOT NULL PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
  `);
  database.run("CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);");
  database.run("CREATE INDEX IF NOT EXISTS idx_chat_messages_order ON chat_messages(session_id, created_at, sequence);");
}

function hasChatMessagesForeignKey(database: Database): boolean {
  const fkResult = database.exec("PRAGMA foreign_key_list(chat_messages);");
  if (fkResult.length === 0) {
    return false;
  }

  return fkResult[0].values.some((row) => {
    const targetTable = String(row[2]);
    const fromColumn = String(row[3]);
    const toColumn = String(row[4]);
    const onDelete = String(row[6]).toUpperCase();

    return (
      targetTable === "chat_sessions" &&
      fromColumn === "session_id" &&
      toColumn === "id" &&
      onDelete === "CASCADE"
    );
  });
}

function isChatSessionsCompatible(database: Database): boolean {
  const columns = getTableColumns(database, "chat_sessions");
  const byName = new Map(columns.map((column) => [column.name, column]));
  return (
    byName.get("id")?.type === "TEXT" &&
    byName.get("query")?.type === "TEXT" &&
    byName.get("created_at")?.type === "INTEGER" &&
    byName.get("updated_at")?.type === "INTEGER" &&
    byName.get("id")?.notNull === true &&
    byName.get("query")?.notNull === true &&
    byName.get("created_at")?.notNull === true &&
    byName.get("updated_at")?.notNull === true
  );
}

function isChatMessagesCompatible(database: Database): boolean {
  const columns = getTableColumns(database, "chat_messages");
  const byName = new Map(columns.map((column) => [column.name, column]));
  const tableSql = getTableSql(database, "chat_messages").toLowerCase().replace(/\s+/g, " ");
  const hasRoleCheck = tableSql.includes("role in ('user','assistant','system')");

  return (
    byName.get("id")?.type === "TEXT" &&
    byName.get("session_id")?.type === "TEXT" &&
    byName.get("role")?.type === "TEXT" &&
    byName.get("content")?.type === "TEXT" &&
    byName.get("sequence")?.type === "INTEGER" &&
    byName.get("created_at")?.type === "INTEGER" &&
    byName.get("id")?.notNull === true &&
    byName.get("session_id")?.notNull === true &&
    byName.get("role")?.notNull === true &&
    byName.get("content")?.notNull === true &&
    byName.get("sequence")?.notNull === true &&
    byName.get("created_at")?.notNull === true &&
    hasRoleCheck &&
    hasChatMessagesForeignKey(database)
  );
}

function rebuildChatTablesPreservingData(database: Database): void {
  const nowMsExpr = "CAST(strftime('%s','now') AS INTEGER) * 1000";
  database.run("PRAGMA foreign_keys = OFF;");
  try {
    database.run("BEGIN");
    database.run("DROP TABLE IF EXISTS chat_messages_old;");
    database.run("DROP TABLE IF EXISTS chat_sessions_old;");

    if (tableExists(database, "chat_messages")) {
      database.run("ALTER TABLE chat_messages RENAME TO chat_messages_old;");
    } else {
      database.run(`
        CREATE TABLE chat_messages_old (
          id TEXT,
          session_id TEXT,
          role TEXT,
          content TEXT,
          sequence INTEGER,
          created_at INTEGER
        );
      `);
    }

    if (tableExists(database, "chat_sessions")) {
      database.run("ALTER TABLE chat_sessions RENAME TO chat_sessions_old;");
    } else {
      database.run(`
        CREATE TABLE chat_sessions_old (
          id TEXT,
          query TEXT,
          created_at INTEGER,
          updated_at INTEGER
        );
      `);
    }

    database.run("DROP TABLE IF EXISTS chat_messages;");
    database.run("DROP TABLE IF EXISTS chat_sessions;");
    createCanonicalChatTables(database);

    const legacySessionColumns = new Set(
      getTableColumns(database, "chat_sessions_old").map((column) => column.name),
    );
    const legacySessionIdExpr = legacySessionColumns.has("id") ? "TRIM(COALESCE(s.id, ''))" : "''";
    const legacySessionQueryExpr = legacySessionColumns.has("query") ? "COALESCE(s.query, '')" : "''";
    const legacySessionCreatedRawExpr = legacySessionColumns.has("created_at")
      ? "CASE WHEN CAST(s.created_at AS INTEGER) > 0 THEN CAST(s.created_at AS INTEGER) ELSE NULL END"
      : "NULL";
    const legacySessionUpdatedRawExpr = legacySessionColumns.has("updated_at")
      ? "CASE WHEN CAST(s.updated_at AS INTEGER) > 0 THEN CAST(s.updated_at AS INTEGER) ELSE NULL END"
      : "NULL";
    const legacySessionCreatedExpr = `COALESCE(${legacySessionCreatedRawExpr}, ${legacySessionUpdatedRawExpr}, ${nowMsExpr})`;
    const legacySessionUpdatedExpr = `COALESCE(${legacySessionUpdatedRawExpr}, ${legacySessionCreatedRawExpr}, ${nowMsExpr})`;

    database.run(`
      INSERT OR REPLACE INTO chat_sessions (id, query, created_at, updated_at)
      SELECT
        ${legacySessionIdExpr},
        ${legacySessionQueryExpr},
        ${legacySessionCreatedExpr},
        ${legacySessionUpdatedExpr}
      FROM chat_sessions_old s
      WHERE ${legacySessionIdExpr} <> '';
    `);

    const legacyMessageColumns = new Set(
      getTableColumns(database, "chat_messages_old").map((column) => column.name),
    );
    const legacyMessageIdExpr = legacyMessageColumns.has("id") ? "TRIM(COALESCE(m.id, ''))" : "''";
    const legacyMessageSessionExpr = legacyMessageColumns.has("session_id")
      ? "TRIM(COALESCE(m.session_id, ''))"
      : "''";
    const legacyMessageRoleExpr = legacyMessageColumns.has("role")
      ? "CASE WHEN m.role IN ('user','assistant','system') THEN m.role ELSE 'user' END"
      : "'user'";
    const legacyMessageContentExpr = legacyMessageColumns.has("content") ? "COALESCE(m.content, '')" : "''";
    const legacyMessageSequenceRawExpr = legacyMessageColumns.has("sequence")
      ? "CAST(m.sequence AS INTEGER)"
      : "1";
    const legacyMessageSequenceExpr = `CASE WHEN ${legacyMessageSequenceRawExpr} IS NULL OR ${legacyMessageSequenceRawExpr} < 1 THEN 1 ELSE ${legacyMessageSequenceRawExpr} END`;
    const legacyMessageCreatedRawExpr = legacyMessageColumns.has("created_at")
      ? "CASE WHEN CAST(m.created_at AS INTEGER) > 0 THEN CAST(m.created_at AS INTEGER) ELSE NULL END"
      : "NULL";
    const legacyMessageCreatedExpr = `COALESCE(${legacyMessageCreatedRawExpr}, ${nowMsExpr})`;

    database.run(`
      INSERT OR REPLACE INTO chat_messages (id, session_id, role, content, sequence, created_at)
      SELECT
        ${legacyMessageIdExpr},
        ${legacyMessageSessionExpr},
        ${legacyMessageRoleExpr},
        ${legacyMessageContentExpr},
        ${legacyMessageSequenceExpr},
        ${legacyMessageCreatedExpr}
      FROM chat_messages_old m
      JOIN chat_sessions s ON s.id = ${legacyMessageSessionExpr}
      WHERE ${legacyMessageIdExpr} <> ''
        AND ${legacyMessageSessionExpr} <> '';
    `);

    database.run("DROP TABLE IF EXISTS chat_messages_old;");
    database.run("DROP TABLE IF EXISTS chat_sessions_old;");
    database.run("COMMIT");
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  } finally {
    database.run("PRAGMA foreign_keys = ON;");
  }
}

function normalizeChatRows(database: Database): void {
  const nowMsExpr = "CAST(strftime('%s','now') AS INTEGER) * 1000";
  database.run(`
    UPDATE chat_sessions
    SET
      query = COALESCE(query, ''),
      created_at = COALESCE(
        CASE WHEN CAST(created_at AS INTEGER) > 0 THEN CAST(created_at AS INTEGER) ELSE NULL END,
        CASE WHEN CAST(updated_at AS INTEGER) > 0 THEN CAST(updated_at AS INTEGER) ELSE NULL END,
        ${nowMsExpr}
      ),
      updated_at = COALESCE(
        CASE WHEN CAST(updated_at AS INTEGER) > 0 THEN CAST(updated_at AS INTEGER) ELSE NULL END,
        CASE WHEN CAST(created_at AS INTEGER) > 0 THEN CAST(created_at AS INTEGER) ELSE NULL END,
        ${nowMsExpr}
      );
  `);
  database.run(`
    UPDATE chat_messages
    SET
      session_id = TRIM(COALESCE(session_id, '')),
      role = CASE WHEN role IN ('user','assistant','system') THEN role ELSE 'user' END,
      content = COALESCE(content, ''),
      sequence = CASE
        WHEN CAST(sequence AS INTEGER) IS NULL OR CAST(sequence AS INTEGER) < 1 THEN 1
        ELSE CAST(sequence AS INTEGER)
      END,
      created_at = COALESCE(
        CASE WHEN CAST(created_at AS INTEGER) > 0 THEN CAST(created_at AS INTEGER) ELSE NULL END,
        ${nowMsExpr}
      );
  `);
  database.run("DELETE FROM chat_sessions WHERE TRIM(COALESCE(id, '')) = '';");
  database.run("DELETE FROM chat_messages WHERE TRIM(COALESCE(id, '')) = '';");
  database.run("DELETE FROM chat_messages WHERE TRIM(COALESCE(session_id, '')) = '';");
  database.run("DELETE FROM chat_messages WHERE session_id NOT IN (SELECT id FROM chat_sessions);");
}

function ensureChatSchema(database: Database): void {
  const chatMessageColumns = new Set(
    getTableColumns(database, "chat_messages").map((column) => column.name),
  );
  if (chatMessageColumns.size > 0 && !chatMessageColumns.has("sequence")) {
    database.run("ALTER TABLE chat_messages ADD COLUMN sequence INTEGER NOT NULL DEFAULT 1;");
  }

  if (!isChatSessionsCompatible(database) || !isChatMessagesCompatible(database)) {
    rebuildChatTablesPreservingData(database);
  }

  createCanonicalChatTables(database);
  normalizeChatRows(database);
}

export function runSchema(database: Database): void {
  database.run(DATABASE_SCHEMA_SQL);
  // Lightweight migration: older local DBs may not have new columns.
  const repoColumnsResult = database.exec("PRAGMA table_info(repos);");
  const repoColumns =
    repoColumnsResult.length > 0
      ? new Set(repoColumnsResult[0].values.map((row) => String(row[1])))
      : new Set<string>();

  if (!repoColumns.has("readme_text")) {
    database.run("ALTER TABLE repos ADD COLUMN readme_text TEXT;");
  }
  if (!repoColumns.has("readme_etag")) {
    database.run("ALTER TABLE repos ADD COLUMN readme_etag TEXT;");
  }
  if (!repoColumns.has("readme_last_modified")) {
    database.run("ALTER TABLE repos ADD COLUMN readme_last_modified TEXT;");
  }
  if (!repoColumns.has("readme_retry_required")) {
    database.run("ALTER TABLE repos ADD COLUMN readme_retry_required INTEGER NOT NULL DEFAULT 0;");
  }

  ensureChatSchema(database);

  // Self-heal embeddings schema if an older local DB used incompatible column types.
  const embeddingsColumnsResult = database.exec("PRAGMA table_info(embeddings);");
  const embeddingsInfo =
    embeddingsColumnsResult.length > 0
      ? embeddingsColumnsResult[0].values.map((row) => ({
          name: String(row[1]),
          type: String(row[2]).toUpperCase(),
        }))
      : [];

  const embeddingsTypeByName = new Map(embeddingsInfo.map((column) => [column.name, column.type]));
  const embeddingsCompatible =
    embeddingsTypeByName.get("id") === "TEXT" &&
    embeddingsTypeByName.get("chunk_id") === "TEXT" &&
    embeddingsTypeByName.get("model") === "TEXT" &&
    embeddingsTypeByName.get("dimension") === "INTEGER" &&
    embeddingsTypeByName.get("vector_blob") === "BLOB" &&
    embeddingsTypeByName.get("created_at") === "INTEGER";

  if (!embeddingsCompatible) {
    database.run("DROP TABLE IF EXISTS embeddings;");
    database.run(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        chunk_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimension INTEGER NOT NULL,
        vector_blob BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
      );
    `);
  }

  // Self-heal index_meta shape if an older/corrupt local DB exists.
  const indexMetaColumnsResult = database.exec("PRAGMA table_info(index_meta);");
  const indexMetaColumns =
    indexMetaColumnsResult.length > 0
      ? new Set(indexMetaColumnsResult[0].values.map((row) => String(row[1])))
      : new Set<string>();
  if (!indexMetaColumns.has("key") || !indexMetaColumns.has("value") || !indexMetaColumns.has("updated_at")) {
    database.run("DROP TABLE IF EXISTS index_meta;");
    database.run(`
      CREATE TABLE IF NOT EXISTS index_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  const timestamp = Math.trunc(numericValue);
  if (timestamp <= 0) {
    return fallback;
  }

  return timestamp;
}

function toSqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function rewriteScopedChatSessionIds(
  database: Database,
  fromChatScopeKey: string | null | undefined,
  toChatScopeKey: string | null | undefined,
): void {
  const fromScope = String(fromChatScopeKey ?? "").trim();
  const toScope = String(toChatScopeKey ?? "").trim();
  if (!fromScope || !toScope || fromScope === toScope) {
    return;
  }

  const fromPrefix = `${fromScope}:`;
  const rows = database.exec(
    `SELECT id FROM chat_sessions WHERE id LIKE ${toSqlStringLiteral(`${fromPrefix}%`)};`,
  );
  if (rows.length === 0 || rows[0].values.length === 0) {
    return;
  }

  const sessionIdPairs = rows[0].values
    .map((row) => String(row[0] ?? ""))
    .filter((value) => value.startsWith(fromPrefix))
    .map((oldSessionId) => ({
      oldSessionId,
      newSessionId: `${toScope}:${oldSessionId.slice(fromPrefix.length)}`,
    }));

  if (sessionIdPairs.length === 0) {
    return;
  }

  database.run("PRAGMA foreign_keys = OFF;");
  try {
    database.run("BEGIN");
    for (const { oldSessionId, newSessionId } of sessionIdPairs) {
      const oldIdLiteral = toSqlStringLiteral(oldSessionId);
      const newIdLiteral = toSqlStringLiteral(newSessionId);
      database.run(
        `UPDATE chat_messages SET session_id = ${newIdLiteral} WHERE session_id = ${oldIdLiteral};`,
      );
      if (tableExists(database, "session_context_items")) {
        database.run(
          `UPDATE session_context_items SET session_id = ${newIdLiteral} WHERE session_id = ${oldIdLiteral};`,
        );
      }
      database.run(`UPDATE chat_sessions SET id = ${newIdLiteral} WHERE id = ${oldIdLiteral};`);

      const oldMetaKey = `session_context_ids:${oldSessionId}`;
      const newMetaKey = `session_context_ids:${newSessionId}`;
      database.run(
        `UPDATE index_meta SET key = ${toSqlStringLiteral(newMetaKey)} WHERE key = ${toSqlStringLiteral(oldMetaKey)};`,
      );
    }
    database.run("COMMIT");
  } catch (error) {
    try {
      database.run("ROLLBACK");
    } catch {
      // noop: best-effort rollback after migration failure
    }
    throw error;
  } finally {
    database.run("PRAGMA foreign_keys = ON;");
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stablePositiveHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

type SearchTuning = {
  fetchK: number;
  topK: number;
  mmrLambda: number;
  maxChunksPerRepo: number;
  lexicalTop1Threshold: number;
  lexicalTop5MeanThreshold: number;
  lexicalHighConfidenceBypassTop1: number;
};

type LexicalTriggerReason =
  | "low_top1"
  | "low_top5_mean"
  | "low_repo_diversity"
  | "rare_token_query";

type SearchDiagnostics = {
  queryDim: number;
  sampledIndexDims: number[];
  fetchK: number;
  topK: number;
  mmrLambda: number;
  maxChunksPerRepo: number;
  denseSuspicious: boolean;
  lexicalTriggered: boolean;
  lexicalTriggerReason: LexicalTriggerReason | null;
  denseTopScores: number[];
  lexicalScanLimit: number;
  lexicalPoolRecentCount: number;
  lexicalPoolBroadCount: number;
  lexicalPoolOldestCount: number;
  lexicalPoolDedupedCount: number;
  corpusRepoCount: number;
  corpusChunkCount: number;
  rerankVectorMismatchPairs: number;
  rerankCapOverrideCount: number;
};

type SearchOptions = {
  tuning?: Partial<SearchTuning>;
  queryText?: string;
  onDiagnostics?: (payload: SearchDiagnostics) => void;
};

type SearchResultDetails = {
  text: string;
  repoId: number;
  repoName: string;
  repoFullName: string;
  repoDescription: string | null;
  repoUrl: string;
  language: string | null;
  topics: string[];
  updatedAt: string;
};

const DEFAULT_SEARCH_TUNING: SearchTuning = {
  fetchK: 150,
  topK: 20,
  mmrLambda: 0.72,
  maxChunksPerRepo: 2,
  lexicalTop1Threshold: 0.22,
  lexicalTop5MeanThreshold: 0.18,
  lexicalHighConfidenceBypassTop1: 0.8,
};

export class LocalDatabase {
  private sql: SqlJsStatic;
  private db: Database;
  private _storageMode: StorageMode;
  private scopeKey: string;
  private vectorIndexCache: Array<{ chunkId: string; vector: Float32Array }> | null = null;
  private vectorIndexCacheCount = -1;
  private embeddingCheckpointPolicy: EmbeddingCheckpointPolicy;
  private pendingEmbeddingsSinceCheckpoint = 0;
  private pendingEmbeddingsStartedAt = 0;
  private lastEmbeddingCheckpointAt: number | null = null;

  constructor(args: {
    sql: SqlJsStatic;
    db: Database;
    storageMode: StorageMode;
    scopeKey?: string;
    embeddingCheckpointPolicy?: EmbeddingCheckpointPolicy;
  }) {
    this.sql = args.sql;
    this.db = args.db;
    this._storageMode = args.storageMode;
    this.scopeKey = normalizeDatabaseScopeKey(args.scopeKey ?? "anon");
    this.embeddingCheckpointPolicy = {
      everyEmbeddings: normalizePositiveInt(
        args.embeddingCheckpointPolicy?.everyEmbeddings,
        DEFAULT_EMBEDDING_CHECKPOINT_EVERY_EMBEDDINGS,
      ),
      everyMs: normalizePositiveInt(
        args.embeddingCheckpointPolicy?.everyMs,
        DEFAULT_EMBEDDING_CHECKPOINT_EVERY_MS,
      ),
    };
  }

  get storageMode(): StorageMode {
    return this._storageMode;
  }

  private ensureVectorIndexCache(): Array<{ chunkId: string; vector: Float32Array }> {
    const currentCount = this.getEmbeddingCount();
    if (this.vectorIndexCache && this.vectorIndexCacheCount === currentCount) {
      return this.vectorIndexCache;
    }

    const result = this.db.exec(`
      SELECT e.chunk_id, e.vector_blob
      FROM embeddings e
      INNER JOIN chunks c ON c.id = e.chunk_id;
    `);
    if (result.length === 0) {
      this.vectorIndexCache = [];
      this.vectorIndexCacheCount = 0;
      return this.vectorIndexCache;
    }

    const [table] = result;
    this.vectorIndexCache = table.values.map((row) => {
      const chunkId = String(row[0]);
      const blob = row[1] as Uint8Array;
      const vector = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
      return { chunkId, vector };
    });
    this.vectorIndexCacheCount = this.vectorIndexCache.length;
    return this.vectorIndexCache;
  }

  private normalizeSearchTuning(limit: number, overrides?: Partial<SearchTuning>): SearchTuning {
    const fallbackTopK = Math.max(1, Math.trunc(limit));
    const topK = normalizePositiveInt(overrides?.topK, fallbackTopK);
    return {
      fetchK: normalizePositiveInt(overrides?.fetchK, Math.max(DEFAULT_SEARCH_TUNING.fetchK, topK * 6)),
      topK,
      mmrLambda: Number.isFinite(overrides?.mmrLambda)
        ? Math.max(0, Math.min(1, Number(overrides?.mmrLambda)))
        : DEFAULT_SEARCH_TUNING.mmrLambda,
      maxChunksPerRepo: normalizePositiveInt(overrides?.maxChunksPerRepo, DEFAULT_SEARCH_TUNING.maxChunksPerRepo),
      lexicalTop1Threshold: Number.isFinite(overrides?.lexicalTop1Threshold)
        ? Number(overrides?.lexicalTop1Threshold)
        : DEFAULT_SEARCH_TUNING.lexicalTop1Threshold,
      lexicalTop5MeanThreshold: Number.isFinite(overrides?.lexicalTop5MeanThreshold)
        ? Number(overrides?.lexicalTop5MeanThreshold)
        : DEFAULT_SEARCH_TUNING.lexicalTop5MeanThreshold,
      lexicalHighConfidenceBypassTop1: Number.isFinite(overrides?.lexicalHighConfidenceBypassTop1)
        ? Number(overrides?.lexicalHighConfidenceBypassTop1)
        : DEFAULT_SEARCH_TUNING.lexicalHighConfidenceBypassTop1,
    };
  }

  private hydrateChunkDetails(chunkIds: string[]): Map<string, SearchResultDetails> {
    if (chunkIds.length === 0) {
      return new Map();
    }
    const chunkIdLiterals = chunkIds.map((item) => toSqlStringLiteral(item)).join(",");
    const detailsResult = this.db.exec(`
      SELECT
        c.id,
        c.text,
        r.id as repo_id,
        r.name,
        r.full_name,
        r.description,
        r.html_url,
        r.language,
        r.topics_json,
        r.updated_at
      FROM chunks c
      JOIN repos r ON c.repo_id = r.id
      WHERE c.id IN (${chunkIdLiterals})
    `);
    if (detailsResult.length === 0) {
      return new Map();
    }

    const map = new Map<string, SearchResultDetails>();
    const [table] = detailsResult;
    for (const row of table.values) {
      map.set(String(row[0]), {
        text: String(row[1]),
        repoId: Number(row[2]),
        repoName: String(row[3]),
        repoFullName: String(row[4]),
        repoDescription: row[5] == null ? null : String(row[5]),
        repoUrl: String(row[6]),
        language: row[7] == null ? null : String(row[7]),
        topics: JSON.parse(String(row[8] ?? "[]")) as string[],
        updatedAt: String(row[9]),
      });
    }
    return map;
  }

  private computeLexicalCandidates(
    queryText: string,
    fetchK: number,
    totalChunkCount: number,
  ): {
    candidates: Array<{ chunkId: string; score: number }>;
    scanLimit: number;
    recentCount: number;
    broadCount: number;
    oldestCount: number;
    dedupedCount: number;
  } {
    const scanLimit = clamp(Math.trunc(fetchK * 20), 2000, 12000);
    if (totalChunkCount <= 0) {
      return {
        candidates: [],
        scanLimit,
        recentCount: 0,
        broadCount: 0,
        oldestCount: 0,
        dedupedCount: 0,
      };
    }

    const recentLimit = clamp(Math.trunc(scanLimit * 0.2), 200, scanLimit);
    const oldestLimit = clamp(Math.trunc(scanLimit * 0.2), 200, scanLimit - recentLimit);
    const broadLimit = Math.max(0, scanLimit - recentLimit - oldestLimit);

    const recentRows = this.db.exec(`
      SELECT c.id, c.text
      FROM chunks c
      ORDER BY c.created_at DESC
      LIMIT ${recentLimit};
    `);
    const oldestRows = this.db.exec(`
      SELECT c.id, c.text
      FROM chunks c
      ORDER BY c.created_at ASC
      LIMIT ${oldestLimit};
    `);

    let broadRows: Array<{ values: SqlRowValue[][] }> = [];
    if (broadLimit > 0) {
      // Prefer sampling from the interior slice (excluding explicit oldest/newest windows)
      // to maximize unique lexical coverage and reduce hash-dependent overlap variance.
      const interiorStart = Math.min(oldestLimit, totalChunkCount);
      const interiorEndExclusive = Math.max(interiorStart, totalChunkCount - recentLimit);
      const interiorSpan = Math.max(0, interiorEndExclusive - interiorStart);
      if (interiorSpan > 0) {
        const interiorLimit = Math.min(broadLimit, interiorSpan);
        const maxInteriorOffset = Math.max(0, interiorSpan - interiorLimit);
        const interiorOffset = maxInteriorOffset > 0 ? stablePositiveHash(queryText) % (maxInteriorOffset + 1) : 0;
        const offset = interiorStart + interiorOffset;
        broadRows = this.db.exec(`
          SELECT c.id, c.text
          FROM chunks c
          ORDER BY c.created_at ASC
          LIMIT ${interiorLimit}
          OFFSET ${offset};
        `);
      } else {
        const maxOffset = Math.max(0, totalChunkCount - broadLimit);
        const offset = maxOffset > 0 ? stablePositiveHash(queryText) % (maxOffset + 1) : 0;
        broadRows = this.db.exec(`
          SELECT c.id, c.text
          FROM chunks c
          ORDER BY c.created_at ASC
          LIMIT ${broadLimit}
          OFFSET ${offset};
        `);
      }
    }

    const dedupedRows = new Map<string, string>();
    const consumeRows = (rows: Array<{ values: SqlRowValue[][] }>): number => {
      if (rows.length === 0) {
        return 0;
      }
      let inserted = 0;
      const [table] = rows;
      for (const row of table.values) {
        const chunkId = String(row[0]);
        if (dedupedRows.has(chunkId)) {
          continue;
        }
        dedupedRows.set(chunkId, String(row[1] ?? ""));
        inserted += 1;
      }
      return inserted;
    };

    const recentCount = consumeRows(recentRows);
    const oldestCount = consumeRows(oldestRows);
    const broadCount = consumeRows(broadRows);

    const scored: Array<{ chunkId: string; score: number }> = [];
    for (const [chunkId, text] of dedupedRows.entries()) {
      const score = lexicalOverlapScore(queryText, text);
      if (score > 0) {
        scored.push({ chunkId, score });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
    return {
      candidates: scored.slice(0, Math.max(20, Math.trunc(fetchK / 2))),
      scanLimit,
      recentCount,
      broadCount,
      oldestCount,
      dedupedCount: dedupedRows.size,
    };
  }

  private shouldTriggerLexicalSafetyNet(params: {
    denseTopScores: number[];
    topDenseLexicalOverlap: number;
    uniqueRepoCountTop20: number;
    totalRepoCount: number;
    totalChunkCount: number;
    queryText: string;
    tuning: SearchTuning;
  }): { trigger: boolean; reason: LexicalTriggerReason | null } {
    const top1 = params.denseTopScores[0] ?? 0;
    const top5 = params.denseTopScores.slice(0, 5);
    const top5Mean = top5.length === 0 ? 0 : top5.reduce((sum, value) => sum + value, 0) / top5.length;
    if (top1 < params.tuning.lexicalTop1Threshold) {
      return { trigger: true, reason: "low_top1" };
    }
    if (top5Mean < params.tuning.lexicalTop5MeanThreshold) {
      return { trigger: true, reason: "low_top5_mean" };
    }
    if (params.uniqueRepoCountTop20 < 6) {
      const corpusLargeEnough = params.totalRepoCount >= 6 && params.totalChunkCount >= 20;
      const denseConfident = top1 >= params.tuning.lexicalHighConfidenceBypassTop1;
      if (corpusLargeEnough && !denseConfident) {
        return { trigger: true, reason: "low_repo_diversity" };
      }
    }
    if (countRareLikeTokens(params.queryText) >= 2) {
      const denseConfident = top1 >= params.tuning.lexicalHighConfidenceBypassTop1;
      const denseLexicallyAligned = params.topDenseLexicalOverlap > 0;
      // Rare-token queries still run lexical recovery when dense top-1 has no literal token overlap,
      // even if semantic confidence is high.
      if (!denseConfident || !denseLexicallyAligned) {
        return { trigger: true, reason: "rare_token_query" };
      }
    }
    return { trigger: false, reason: null };
  }

  async findSimilarChunks(queryVector: Float32Array, limit: number = 10, options?: SearchOptions): Promise<SearchResult[]> {
    const tuning = this.normalizeSearchTuning(limit, options?.tuning);
    const vectors = this.ensureVectorIndexCache();
    if (vectors.length === 0) {
      return [];
    }

    const sampledIndexDims: number[] = [];
    const dimSet = new Set<number>();
    for (let i = 0; i < vectors.length; i += 1) {
      const dim = vectors[i]?.vector.length ?? 0;
      dimSet.add(dim);
      if (sampledIndexDims.length < 12) {
        sampledIndexDims.push(dim);
      }
    }
    if (dimSet.size > 1) {
      throw new Error(`Index has mixed embedding dimensions: ${Array.from(dimSet).join(", ")}. Re-index required.`);
    }
    const onlyDim = sampledIndexDims[0] ?? 0;
    if (onlyDim > 0 && queryVector.length !== onlyDim) {
      throw new Error(
        `Embedding dimension mismatch (query=${queryVector.length}, index=${onlyDim}). Use same model and rebuild embeddings.`,
      );
    }

    const vectorByChunkId = new Map<string, Float32Array>();
    const denseScores: Array<{ chunkId: string; score: number }> = [];
    for (const entry of vectors) {
      vectorByChunkId.set(entry.chunkId, entry.vector);
      const score = cosineSimilaritySafe(queryVector, entry.vector, "throw");
      denseScores.push({
        chunkId: entry.chunkId,
        score,
      });
    }

    denseScores.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
    const denseTop = denseScores.slice(0, tuning.fetchK);
    const denseTopChunkIds = denseTop.map((item) => item.chunkId);
    const detailsMap = this.hydrateChunkDetails(denseTopChunkIds);

    const denseTopScores = denseTop.slice(0, 5).map((item) => item.score);
    const uniqueRepoTop20 = new Set(
      denseTop
        .slice(0, 20)
        .map((item) => detailsMap.get(item.chunkId)?.repoId)
        .filter((value): value is number => value != null),
    ).size;

    const queryText = options?.queryText?.trim() ?? "";
    const topDenseText = denseTop.length > 0 ? detailsMap.get(denseTop[0]?.chunkId ?? "")?.text ?? "" : "";
    const topDenseLexicalOverlap =
      queryText.length > 0 && topDenseText.length > 0 ? lexicalOverlapScore(queryText, topDenseText) : 0;
    const totalRepoCount = this.getRepoCount();
    const totalChunkCount = this.getChunkCount();
    const lexicalDecision = queryText
      ? this.shouldTriggerLexicalSafetyNet({
          denseTopScores,
          topDenseLexicalOverlap,
          uniqueRepoCountTop20: uniqueRepoTop20,
          totalRepoCount,
          totalChunkCount,
          queryText,
          tuning,
        })
      : { trigger: false, reason: null };

    const denseScoreById = new Map(denseTop.map((item) => [item.chunkId, item.score]));
    let relevanceScoreById = denseScoreById;
    let candidateOrder = denseTop.map((item) => item.chunkId);
    let lexicalScanLimit = 0;
    let lexicalPoolRecentCount = 0;
    let lexicalPoolBroadCount = 0;
    let lexicalPoolOldestCount = 0;
    let lexicalPoolDedupedCount = 0;
    if (lexicalDecision.trigger && queryText) {
      const lexical = this.computeLexicalCandidates(queryText, tuning.fetchK, totalChunkCount);
      lexicalScanLimit = lexical.scanLimit;
      lexicalPoolRecentCount = lexical.recentCount;
      lexicalPoolBroadCount = lexical.broadCount;
      lexicalPoolOldestCount = lexical.oldestCount;
      lexicalPoolDedupedCount = lexical.dedupedCount;
      const fused = reciprocalRankFusion([
        denseTop.map((item) => ({ id: item.chunkId })),
        lexical.candidates.map((item) => ({ id: item.chunkId })),
      ]);
      candidateOrder = fused.slice(0, tuning.fetchK).map((item) => item.id);
      const fusedTopScore = fused[0]?.score ?? 0;
      relevanceScoreById =
        fusedTopScore > 0
          ? new Map(fused.map((item) => [item.id, item.score / fusedTopScore]))
          : new Map();
    }

    const candidateDetailsMap = this.hydrateChunkDetails(candidateOrder);
    const candidates: DenseCandidate[] = [];
    for (const chunkId of candidateOrder) {
      const details = candidateDetailsMap.get(chunkId);
      const vector = vectorByChunkId.get(chunkId);
      if (!details || !vector) {
        continue;
      }
      candidates.push({
        chunkId,
        repoId: details.repoId,
        vector,
        denseScore: relevanceScoreById.get(chunkId) ?? denseScoreById.get(chunkId) ?? 0,
      });
    }

    let rerankVectorMismatchPairs = 0;
    const ranked = mmrSelect({
      candidates,
      topK: tuning.topK,
      lambda: tuning.mmrLambda,
      maxChunksPerRepo: tuning.maxChunksPerRepo,
      onVectorMismatch: () => {
        rerankVectorMismatchPairs += 1;
      },
    });
    const rerankCapOverrideCount = ranked.reduce(
      (sum, item) => sum + (item.capOverride ? 1 : 0),
      0,
    );

    const diagnostics: SearchDiagnostics = {
      queryDim: queryVector.length,
      sampledIndexDims,
      fetchK: tuning.fetchK,
      topK: tuning.topK,
      mmrLambda: tuning.mmrLambda,
      maxChunksPerRepo: tuning.maxChunksPerRepo,
      denseSuspicious:
        lexicalDecision.reason === "low_top1" ||
        lexicalDecision.reason === "low_top5_mean" ||
        lexicalDecision.reason === "low_repo_diversity",
      lexicalTriggered: lexicalDecision.trigger,
      lexicalTriggerReason: lexicalDecision.reason,
      denseTopScores,
      lexicalScanLimit,
      lexicalPoolRecentCount,
      lexicalPoolBroadCount,
      lexicalPoolOldestCount,
      lexicalPoolDedupedCount,
      corpusRepoCount: totalRepoCount,
      corpusChunkCount: totalChunkCount,
      rerankVectorMismatchPairs,
      rerankCapOverrideCount,
    };
    options?.onDiagnostics?.(diagnostics);

    return ranked
      .map((item) => {
        const details = candidateDetailsMap.get(item.chunkId);
        if (!details) {
          return null;
        }
        return {
          chunkId: item.chunkId,
          score: item.score,
          denseScore: item.denseScore,
          ...details,
        };
      })
      .filter((item): item is SearchResult => item !== null)
      .slice(0, tuning.topK);
  }

  private async persist(): Promise<void> {
    const bytes = this.db.export();

    if (this._storageMode === "opfs") {
      const written = await writeBytesToOpfs(bytes, this.scopeKey);

      if (written) {
        return;
      }

      this._storageMode = "local-storage";
    }

    if (this._storageMode === "local-storage") {
      try {
        writeBytesToLocalStorage(bytes, this.scopeKey);
      } catch {
        // localStorage quota can be exceeded for large DB snapshots; degrade to in-memory
        // mode instead of failing the active operation.
        this._storageMode = "memory";
      }
    }
  }

  private shouldCheckpointEmbeddings(now: number): boolean {
    if (this.pendingEmbeddingsSinceCheckpoint <= 0) {
      return false;
    }

    if (this.pendingEmbeddingsSinceCheckpoint >= this.embeddingCheckpointPolicy.everyEmbeddings) {
      return true;
    }

    const checkpointBaseline =
      this.lastEmbeddingCheckpointAt ?? (this.pendingEmbeddingsStartedAt > 0 ? this.pendingEmbeddingsStartedAt : now);
    return now - checkpointBaseline >= this.embeddingCheckpointPolicy.everyMs;
  }

  private noteEmbeddingWrites(count: number): void {
    if (count <= 0) {
      return;
    }

    if (this.pendingEmbeddingsSinceCheckpoint === 0) {
      this.pendingEmbeddingsStartedAt = Date.now();
    }
    this.pendingEmbeddingsSinceCheckpoint += count;
  }

  getEmbeddingCheckpointStatus(): {
    lastCheckpointAt: number | null;
    pendingEmbeddings: number;
    everyEmbeddings: number;
    everyMs: number;
  } {
    return {
      lastCheckpointAt: this.lastEmbeddingCheckpointAt,
      pendingEmbeddings: this.pendingEmbeddingsSinceCheckpoint,
      everyEmbeddings: this.embeddingCheckpointPolicy.everyEmbeddings,
      everyMs: this.embeddingCheckpointPolicy.everyMs,
    };
  }

  async flushPendingEmbeddingCheckpoint(): Promise<boolean> {
    if (this.pendingEmbeddingsSinceCheckpoint <= 0) {
      return false;
    }

    await this.persist();
    this.pendingEmbeddingsSinceCheckpoint = 0;
    this.pendingEmbeddingsStartedAt = 0;
    this.lastEmbeddingCheckpointAt = Date.now();
    return true;
  }

  async upsertRepos(repos: RepoRecord[]): Promise<void> {
    const statement = this.db.prepare(`
      INSERT INTO repos (
        id, full_name, name, description, topics_json, language, html_url, stars, forks,
        updated_at, readme_url, readme_text, readme_etag, readme_last_modified, checksum,
        readme_retry_required, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        full_name = excluded.full_name,
        name = excluded.name,
        description = excluded.description,
        topics_json = excluded.topics_json,
        language = excluded.language,
        html_url = excluded.html_url,
        stars = excluded.stars,
        forks = excluded.forks,
        updated_at = excluded.updated_at,
        readme_url = CASE WHEN excluded.readme_retry_required = 1 THEN repos.readme_url ELSE excluded.readme_url END,
        readme_text = CASE WHEN excluded.readme_retry_required = 1 THEN repos.readme_text ELSE excluded.readme_text END,
        readme_etag = CASE WHEN excluded.readme_retry_required = 1 THEN repos.readme_etag ELSE excluded.readme_etag END,
        readme_last_modified = CASE WHEN excluded.readme_retry_required = 1 THEN repos.readme_last_modified ELSE excluded.readme_last_modified END,
        checksum = CASE WHEN excluded.readme_retry_required = 1 THEN repos.checksum ELSE excluded.checksum END,
        readme_retry_required = excluded.readme_retry_required,
        last_synced_at = excluded.last_synced_at;
    `);

    try {
      this.db.run("BEGIN");

      repos.forEach((repo) => {
        statement.run([
          repo.id,
          repo.fullName,
          repo.name,
          repo.description,
          JSON.stringify(repo.topics),
          repo.language,
          repo.htmlUrl,
          repo.stars,
          repo.forks,
          repo.updatedAt,
          repo.readmeUrl,
          repo.readmeText,
          repo.readmeEtag ?? null,
          repo.readmeLastModified ?? null,
          repo.checksum,
          repo.readmeRetryRequired ? 1 : 0,
          repo.lastSyncedAt,
        ]);
      });

      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    } finally {
      statement.free();
    }

    await this.persist();
  }

  listRepos(): RepoRecord[] {
    const result = this.db.exec(`
      SELECT
        id, full_name, name, description, topics_json, language, html_url, stars, forks,
        updated_at, readme_url, readme_text, readme_etag, readme_last_modified, checksum,
        readme_retry_required, last_synced_at
      FROM repos
      ORDER BY id ASC;
    `);

    if (result.length === 0) {
      return [];
    }

    const [table] = result;
    return table.values.map((row) => ({
      id: Number(row[0]),
      fullName: String(row[1]),
      name: String(row[2]),
      description: row[3] == null ? null : String(row[3]),
      topics: JSON.parse(String(row[4])) as string[],
      language: row[5] == null ? null : String(row[5]),
      htmlUrl: String(row[6]),
      stars: Number(row[7]),
      forks: Number(row[8]),
      updatedAt: String(row[9]),
      readmeUrl: row[10] == null ? null : String(row[10]),
      readmeText: row[11] == null ? null : String(row[11]),
      readmeEtag: row[12] == null ? null : String(row[12]),
      readmeLastModified: row[13] == null ? null : String(row[13]),
      checksum: row[14] == null ? null : String(row[14]),
      readmeRetryRequired: Number(row[15]) === 1,
      lastSyncedAt: Number(row[16]),
    }));
  }

  listRepoSyncState(): RepoSyncState[] {
    const result = this.db.exec(`
      SELECT id, full_name, description, topics_json, language, updated_at, stars, forks,
        readme_url, readme_text, readme_etag, readme_last_modified, checksum, readme_retry_required
      FROM repos
      ORDER BY id ASC;
    `);

    if (result.length === 0) {
      return [];
    }

    const [table] = result;
    return table.values.map((row) => ({
      id: Number(row[0]),
      fullName: String(row[1]),
      description: row[2] == null ? null : String(row[2]),
      topics: JSON.parse(String(row[3] ?? "[]")) as string[],
      language: row[4] == null ? null : String(row[4]),
      updatedAt: String(row[5]),
      stars: Number(row[6]),
      forks: Number(row[7]),
      readmeUrl: row[8] == null ? null : String(row[8]),
      readmeText: row[9] == null ? null : String(row[9]),
      readmeEtag: row[10] == null ? null : String(row[10]),
      readmeLastModified: row[11] == null ? null : String(row[11]),
      checksum: row[12] == null ? null : String(row[12]),
      readmeRetryRequired: Number(row[13]) === 1,
    }));
  }

  getRepoCount(): number {
    const result = this.db.exec("SELECT COUNT(*) AS count FROM repos;");

    if (result.length === 0 || result[0].values.length === 0) {
      return 0;
    }

    return Number(result[0].values[0][0]);
  }

  getChunkCount(): number {
    const result = this.db.exec("SELECT COUNT(*) AS count FROM chunks;");

    if (result.length === 0 || result[0].values.length === 0) {
      return 0;
    }

    return Number(result[0].values[0][0]);
  }

  getChunksToEmbed(limit: number): ChunkRecord[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 10;
    const query = `
      SELECT c.id, c.repo_id, c.chunk_id, c.text, c.source, c.created_at
      FROM chunks c
      LEFT JOIN embeddings e
        ON e.chunk_id = c.id
      WHERE e.chunk_id IS NULL
      ORDER BY c.created_at ASC
      LIMIT ${safeLimit};
    `;

    let result;
    try {
      result = this.db.exec(query);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (!message.includes("datatype mismatch")) {
        throw error;
      }

      // Some legacy local DBs can carry incompatible embeddings affinity.
      // Recreate embeddings table and retry chunk selection once.
      this.recreateEmbeddingsTable();
      result = this.db.exec(query);
    }

    if (result.length === 0) {
      return [];
    }

    const [table] = result;
    return table.values.map((row) => ({
      id: String(row[0]),
      repoId: Number(row[1]),
      chunkId: String(row[2]),
      text: String(row[3]),
      source: String(row[4]),
      createdAt: Number(row[5]),
    }));
  }

  getPendingEmbeddingChunkCount(): number {
    const result = this.db.exec(`
      SELECT COUNT(*)
      FROM chunks c
      LEFT JOIN embeddings e
        ON e.chunk_id = c.id
      WHERE e.chunk_id IS NULL;
    `);

    if (result.length === 0 || result[0].values.length === 0) {
      return 0;
    }

    return Number(result[0].values[0][0]);
  }

  getEmbeddingCount(): number {
    const result = this.db.exec("SELECT COUNT(*) AS count FROM embeddings;");

    if (result.length === 0 || result[0].values.length === 0) {
      return 0;
    }

    return Number(result[0].values[0][0]);
  }

  getDominantEmbeddingModel(): string | null {
    const result = this.db.exec(`
      SELECT model, COUNT(*) AS count
      FROM embeddings
      WHERE TRIM(COALESCE(model, '')) <> ''
      GROUP BY model
      ORDER BY count DESC, model ASC
      LIMIT 1;
    `);

    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }

    const model = result[0].values[0]?.[0];
    return model == null ? null : String(model);
  }

  async clearEmbeddings(): Promise<void> {
    this.db.run("DELETE FROM embeddings;");
    this.vectorIndexCache = null;
    this.vectorIndexCacheCount = -1;
    this.pendingEmbeddingsSinceCheckpoint = 0;
    this.pendingEmbeddingsStartedAt = 0;
    this.lastEmbeddingCheckpointAt = null;
    await this.persist();
  }

  private recreateEmbeddingsTable(): void {
    this.db.run("DROP TABLE IF EXISTS embeddings;");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        chunk_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimension INTEGER NOT NULL,
        vector_blob BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
      );
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_embeddings_chunk_id ON embeddings(chunk_id);");
  }

  listPendingChunksForEmbedding(args?: { limit?: number; repoIds?: number[] }): ChunkRecord[] {
    const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.trunc(Number(args?.limit))) : null;
    const repoIds = (args?.repoIds ?? []).filter((id) => Number.isFinite(id));
    const whereRepo =
      repoIds.length > 0
        ? ` AND c.repo_id IN (${repoIds.map((id) => Math.trunc(id)).join(",")})`
        : "";
    const limitClause = limit == null ? "" : ` LIMIT ${limit}`;
    const query = `
      SELECT c.id, c.repo_id, c.chunk_id, c.text, c.source, c.created_at
      FROM chunks c
      LEFT JOIN embeddings e
        ON e.chunk_id = c.id
      WHERE e.chunk_id IS NULL${whereRepo}
      ORDER BY c.created_at ASC${limitClause};
    `;
    const result = this.db.exec(query);
    if (result.length === 0) {
      return [];
    }

    const [table] = result;
    return table.values.map((row) => ({
      id: String(row[0]),
      repoId: Number(row[1]),
      chunkId: String(row[2]),
      text: String(row[3]),
      source: String(row[4]),
      createdAt: Number(row[5]),
    }));
  }

  getIndexMetaValue(key: string): string | null {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey) {
      return null;
    }

    const result = this.db.exec(
      `
      SELECT value
      FROM index_meta
      WHERE key = ?
      LIMIT 1;
      `,
      [normalizedKey],
    );
    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }
    const value = result[0].values[0]?.[0];
    return value == null ? null : String(value);
  }

  getPendingChunksQueryPlan(): string {
    const result = this.db.exec(`
      EXPLAIN QUERY PLAN
      SELECT c.id
      FROM chunks c
      LEFT JOIN embeddings e ON e.chunk_id = c.id
      WHERE e.chunk_id IS NULL
      ORDER BY c.created_at ASC;
    `);
    if (result.length === 0) {
      return "";
    }
    return result[0].values.map((row) => row.map((col) => String(col)).join("|")).join(" || ");
  }

  private rebuildChatTablesPreservingData(): void {
    rebuildChatTablesPreservingData(this.db);
  }

  private getEmbeddingsTableDiagnostic(): string {
    const tableSqlResult = this.db.exec(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='embeddings';`,
    );
    const tableSql =
      tableSqlResult.length > 0 && tableSqlResult[0].values.length > 0
        ? String(tableSqlResult[0].values[0][0] ?? "")
        : "";

    const columnsResult = this.db.exec("PRAGMA table_info(embeddings);");
    const columns =
      columnsResult.length > 0
        ? columnsResult[0].values
            .map((row) => `${String(row[1])}:${String(row[2])}`)
            .join(",")
        : "none";

    return `embeddings_table_sql=${tableSql}; embeddings_columns=${columns}`;
  }

  private getChatSessionsTableDiagnostic(): string {
    const tableSqlResult = this.db.exec(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_sessions';`,
    );
    const tableSql =
      tableSqlResult.length > 0 && tableSqlResult[0].values.length > 0
        ? String(tableSqlResult[0].values[0][0] ?? "")
        : "";

    const columnsResult = this.db.exec("PRAGMA table_info(chat_sessions);");
    const columns =
      columnsResult.length > 0
        ? columnsResult[0].values
            .map((row) => `${String(row[1])}:${String(row[2])}:notnull=${String(row[3])}`)
            .join(",")
        : "none";

    const triggerResult = this.db.exec(
      `SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name='chat_sessions';`,
    );
    const triggers =
      triggerResult.length > 0
        ? triggerResult[0].values
            .map((row) => `${String(row[0])}:${String(row[1] ?? "")}`)
            .join(" || ")
        : "none";

    return `chat_sessions_table_sql=${tableSql}; chat_sessions_columns=${columns}; chat_sessions_triggers=${triggers}`;
  }

  private getChatMessagesTableDiagnostic(): string {
    const tableSqlResult = this.db.exec(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_messages';`,
    );
    const tableSql =
      tableSqlResult.length > 0 && tableSqlResult[0].values.length > 0
        ? String(tableSqlResult[0].values[0][0] ?? "")
        : "";

    const columnsResult = this.db.exec("PRAGMA table_info(chat_messages);");
    const columns =
      columnsResult.length > 0
        ? columnsResult[0].values
            .map((row) => `${String(row[1])}:${String(row[2])}:notnull=${String(row[3])}`)
            .join(",")
        : "none";

    const fkResult = this.db.exec("PRAGMA foreign_key_list(chat_messages);");
    const fks =
      fkResult.length > 0
        ? fkResult[0].values
            .map(
              (row) =>
                `${String(row[2])}.${String(row[3])}->${String(row[4])}:on_delete=${String(row[6])}`,
            )
            .join(",")
        : "none";

    const triggerResult = this.db.exec(
      `SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name='chat_messages';`,
    );
    const triggers =
      triggerResult.length > 0
        ? triggerResult[0].values
            .map((row) => `${String(row[0])}:${String(row[1] ?? "")}`)
            .join(" || ")
        : "none";

    return `chat_messages_table_sql=${tableSql}; chat_messages_columns=${columns}; chat_messages_fk=${fks}; chat_messages_triggers=${triggers}`;
  }

  private getSqlBindingDiagnostic(value: unknown): string {
    const bindValue =
      value == null
        ? null
        : typeof value === "number" || typeof value === "string"
          ? value
          : String(value);
    const probe = this.db.exec(
      "SELECT typeof(?) AS t, (? IS NULL) AS is_null, quote(?) AS q;",
      [bindValue, bindValue, bindValue],
    );
    if (probe.length === 0 || probe[0].values.length === 0) {
      return "bind_probe=none";
    }

    const [type, isNull, quoted] = probe[0].values[0];
    return `bind_type=${String(type)} bind_is_null=${String(isNull)} bind_quote=${String(quoted)}`;
  }

  private chatSessionExists(sessionId: string): boolean {
    const idLiteral = toSqlStringLiteral(sessionId);
    const exists = this.db.exec(`SELECT 1 FROM chat_sessions WHERE id = ${idLiteral} LIMIT 1;`);
    return exists.length > 0 && exists[0].values.length > 0;
  }

  private ensureSessionExistsForMessage(sessionId: string, fallbackNow: number): void {
    const now = normalizeTimestamp(Date.now(), 1);
    const safeNow = normalizeTimestamp(fallbackNow, now);
    const sessionIdLiteral = toSqlStringLiteral(sessionId);
    const nowMsExpr = "CAST(strftime('%s','now') AS INTEGER) * 1000";

    const ensureOnce = () => {
      this.db.run(
        `
        INSERT INTO chat_sessions (id, query, created_at, updated_at)
        SELECT
          ${sessionIdLiteral},
          '',
          COALESCE(${safeNow}, ${nowMsExpr}),
          COALESCE(${safeNow}, ${nowMsExpr})
        WHERE NOT EXISTS (SELECT 1 FROM chat_sessions WHERE id = ${sessionIdLiteral});
      `,
      );

      this.db.run(
        `
        UPDATE chat_sessions
        SET
          query = COALESCE(query, ''),
          created_at = COALESCE(created_at, COALESCE(${safeNow}, ${nowMsExpr})),
          updated_at = COALESCE(updated_at, COALESCE(${safeNow}, created_at, ${nowMsExpr}))
        WHERE id = ${sessionIdLiteral};
      `,
      );
    };

    try {
      ensureOnce();
      if (this.chatSessionExists(sessionId)) {
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const shouldHeal =
        message.includes("not null constraint failed: chat_sessions.created_at") ||
        message.includes("not null constraint failed: chat_sessions.id") ||
        message.includes("datatype mismatch") ||
        message.includes("no such table: chat_sessions");
      if (!shouldHeal) {
        throw error;
      }
    }

    this.rebuildChatTablesPreservingData();
    try {
      ensureOnce();
    } catch (retryError) {
      const sessionDiagnostic = this.getChatSessionsTableDiagnostic();
      const createdBind = this.getSqlBindingDiagnostic(safeNow);
      throw new Error(
        `${retryError instanceof Error ? retryError.message : String(retryError)} | ` +
          `ensure_session_id=${sessionId} ensure_now=${String(safeNow)} | ` +
          `${sessionDiagnostic}; created_at_${createdBind}`,
      );
    }

    if (!this.chatSessionExists(sessionId)) {
      const sessionDiagnostic = this.getChatSessionsTableDiagnostic();
      throw new Error(`chat session still missing after ensure: ${sessionId} | ${sessionDiagnostic}`);
    }
  }

  private runEmbeddingUpsert(
    embeddings: Array<
      EmbeddingRecord & {
        dimension: number;
        createdAt: number;
        vectorBlob: Uint8Array;
      }
    >,
  ): void {
    const statement = this.db.prepare(`
      INSERT INTO embeddings (id, chunk_id, model, dimension, vector_blob, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        chunk_id = excluded.chunk_id,
        model = excluded.model,
        dimension = excluded.dimension,
        vector_blob = excluded.vector_blob,
        created_at = excluded.created_at;
    `);

    try {
      this.db.run("BEGIN");
      embeddings.forEach((embedding) => {
        statement.run([
          embedding.id,
          embedding.chunkId,
          embedding.model,
          embedding.dimension,
          embedding.vectorBlob,
          embedding.createdAt,
        ]);
      });
      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    } finally {
      statement.free();
    }
  }

  private runChatSessionUpsert(args: {
    id: string;
    query: string;
    createdAt: number;
    updatedAt: number;
  }): void {
    const idLiteral = toSqlStringLiteral(args.id);
    const queryLiteral = toSqlStringLiteral(args.query);
    const nowMsExpr = "CAST(strftime('%s','now') AS INTEGER) * 1000";
    this.db.run(`
      INSERT INTO chat_sessions (id, query, created_at, updated_at)
      VALUES (
        ${idLiteral},
        COALESCE(${queryLiteral}, ''),
        COALESCE(${args.createdAt}, ${nowMsExpr}),
        COALESCE(${args.updatedAt}, ${args.createdAt}, ${nowMsExpr})
      )
      ON CONFLICT(id) DO UPDATE SET
        query = COALESCE(excluded.query, chat_sessions.query, ''),
        created_at = COALESCE(chat_sessions.created_at, excluded.created_at, ${nowMsExpr}),
        updated_at = COALESCE(excluded.updated_at, chat_sessions.updated_at, chat_sessions.created_at, ${nowMsExpr});
    `);
  }

  private runChatMessageUpsert(args: {
    id: string;
    sessionId: string;
    role: ChatMessageRecord["role"];
    content: string;
    sequence: number;
    createdAt: number;
  }): void {
    const idLiteral = toSqlStringLiteral(args.id);
    const sessionIdLiteral = toSqlStringLiteral(args.sessionId);
    const roleLiteral = toSqlStringLiteral(args.role);
    const contentLiteral = toSqlStringLiteral(args.content);

    this.db.run(`
      INSERT INTO chat_messages (id, session_id, role, content, sequence, created_at)
      SELECT
        ${idLiteral},
        s.id,
        ${roleLiteral},
        COALESCE(${contentLiteral}, ''),
        ${args.sequence},
        ${args.createdAt}
      FROM chat_sessions s
      WHERE s.id = ${sessionIdLiteral}
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id,
        role = excluded.role,
        content = COALESCE(excluded.content, ''),
        sequence = excluded.sequence,
        created_at = excluded.created_at;
    `);
  }

  async upsertChunks(chunks: ChunkRecord[]): Promise<void> {
    const statement = this.db.prepare(`
      INSERT INTO chunks (id, repo_id, chunk_id, text, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        repo_id = excluded.repo_id,
        chunk_id = excluded.chunk_id,
        text = excluded.text,
        source = excluded.source,
        created_at = excluded.created_at;
    `);

    try {
      this.db.run("BEGIN");
      chunks.forEach((chunk) => {
        statement.run([
          chunk.id,
          chunk.repoId,
          chunk.chunkId,
          chunk.text,
          chunk.source,
          chunk.createdAt,
        ]);
      });
      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    } finally {
      statement.free();
    }

    this.vectorIndexCache = null;
    this.vectorIndexCacheCount = -1;
    await this.persist();
  }

  async deleteReposByIds(repoIds: number[]): Promise<void> {
    if (repoIds.length === 0) {
      return;
    }

    const placeholders = repoIds.map(() => "?").join(",");
    this.db.run(`DELETE FROM repos WHERE id IN (${placeholders});`, repoIds);
    this.vectorIndexCache = null;
    this.vectorIndexCacheCount = -1;
    await this.persist();
  }

  async deleteChunksByRepoIds(repoIds: number[]): Promise<void> {
    if (repoIds.length === 0) {
      return;
    }

    const placeholders = repoIds.map(() => "?").join(",");
    this.db.run(`DELETE FROM chunks WHERE repo_id IN (${placeholders});`, repoIds);
    this.vectorIndexCache = null;
    this.vectorIndexCacheCount = -1;
    await this.persist();
  }

  async upsertEmbeddings(embeddings: EmbeddingRecord[]): Promise<void> {
    const normalized = embeddings.map((embedding) => {
      const dimension = Number(embedding.dimension);
      const createdAt = Number(embedding.createdAt);
      const vectorBlob =
        embedding.vectorBlob instanceof Uint8Array
          ? embedding.vectorBlob
          : new Uint8Array(embedding.vectorBlob);

      if (!Number.isFinite(dimension) || dimension <= 0) {
        throw new Error(`Invalid embedding dimension for chunk ${embedding.chunkId}`);
      }

      if (!Number.isFinite(createdAt) || createdAt <= 0) {
        throw new Error(`Invalid embedding created_at for chunk ${embedding.chunkId}`);
      }

      return {
        ...embedding,
        dimension: Math.trunc(dimension),
        createdAt: Math.trunc(createdAt),
        vectorBlob,
      };
    });

    if (normalized.length === 0) {
      return;
    }

    try {
      this.runEmbeddingUpsert(normalized);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const shouldHeal = message.includes("datatype mismatch") || message.includes("no such table");
      if (!shouldHeal) {
        throw error;
      }

      // Heal legacy/corrupt local schema and retry once.
      this.recreateEmbeddingsTable();

      try {
        this.runEmbeddingUpsert(normalized);
      } catch (retryError) {
        const diagnostic = this.getEmbeddingsTableDiagnostic();
        throw new Error(
          `${retryError instanceof Error ? retryError.message : String(retryError)} | ${diagnostic}`,
        );
      }
    }

    this.vectorIndexCache = null;
    this.vectorIndexCacheCount = -1;
    this.noteEmbeddingWrites(normalized.length);
    if (this.shouldCheckpointEmbeddings(Date.now())) {
      await this.flushPendingEmbeddingCheckpoint();
    }
  }

  async upsertIndexMeta(record: IndexMetaRecord): Promise<void> {
    const key = String(record.key ?? "").trim();
    const value = record.value == null ? "" : String(record.value);
    const now = normalizeTimestamp(Date.now(), 1);
    const updatedAt = normalizeTimestamp(record.updatedAt, now);

    if (!key) {
      throw new Error("index_meta key is required");
    }

    this.db.run(
      `
      INSERT INTO index_meta (key, value, updated_at)
      VALUES (?, COALESCE(?, ''), COALESCE(?, CAST(strftime('%s','now') AS INTEGER) * 1000))
      ON CONFLICT(key) DO UPDATE SET
        value = COALESCE(excluded.value, ''),
        updated_at = COALESCE(excluded.updated_at, CAST(strftime('%s','now') AS INTEGER) * 1000);
    `,
      [key, value, updatedAt],
    );

    await this.persist();
  }

  async upsertChatSession(session: ChatSessionRecord): Promise<void> {
    const id = String(session.id ?? "").trim();
    const query = session.query == null ? "" : String(session.query).trim();
    const now = normalizeTimestamp(Date.now(), 1);
    const createdAt = normalizeTimestamp(session.createdAt, now);
    const updatedAt = normalizeTimestamp(session.updatedAt, createdAt);

    if (!id) {
      throw new Error("chat session id is required");
    }
    const upsertArgs = { id, query, createdAt, updatedAt };

    try {
      this.runChatSessionUpsert(upsertArgs);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const shouldHeal =
        message.includes("not null constraint failed: chat_sessions.created_at") ||
        message.includes("not null constraint failed: chat_sessions.id") ||
        message.includes("datatype mismatch") ||
        message.includes("no such table: chat_sessions");
      if (!shouldHeal) {
        throw error;
      }

      this.rebuildChatTablesPreservingData();
      try {
        this.runChatSessionUpsert(upsertArgs);
      } catch (retryError) {
        const diagnostic = this.getChatSessionsTableDiagnostic();
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} | retry=${retryError instanceof Error ? retryError.message : String(retryError)} | ` +
            `chat_session_id=${id} created_at=${String(createdAt)} updated_at=${String(updatedAt)} | ` +
            `${diagnostic}`,
        );
      }
    }

    if (!this.chatSessionExists(id)) {
      try {
        this.runChatSessionUpsert(upsertArgs);
      } catch (fallbackError) {
        const sessionDiagnostic = this.getChatSessionsTableDiagnostic();
        const createdBindDiagnostic = this.getSqlBindingDiagnostic(createdAt);
        const updatedBindDiagnostic = this.getSqlBindingDiagnostic(updatedAt);
        throw new Error(
          `${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)} | ` +
            `fallback_chat_session_id=${id} fallback_created_at=${String(createdAt)} fallback_updated_at=${String(updatedAt)} | ` +
            `${sessionDiagnostic}; created_at_${createdBindDiagnostic}; updated_at_${updatedBindDiagnostic}`,
        );
      }

      if (!this.chatSessionExists(id)) {
        const sessionDiagnostic = this.getChatSessionsTableDiagnostic();
        throw new Error(`chat session missing after fallback upsert: ${id} | ${sessionDiagnostic}`);
      }
    }

    await backupChatSession({
      id,
      query,
      createdAt,
      updatedAt,
    });

    await this.persist();
  }

  listChatSessions(): ChatSessionRecord[] {
    const result = this.db.exec(`
      SELECT id, query, created_at, updated_at
      FROM chat_sessions
      ORDER BY updated_at DESC;
    `);

    if (result.length === 0) {
      return [];
    }

    const [table] = result;
    return table.values.map((row) => ({
      id: String(row[0]),
      query: row[1] == null ? "" : String(row[1]),
      createdAt: Number.isFinite(Number(row[2])) ? Number(row[2]) : Date.now(),
      updatedAt: Number.isFinite(Number(row[3])) ? Number(row[3]) : Date.now(),
    }));
  }

  listChatMessages(sessionId: string): ChatMessageRecord[] {
    const normalizedSessionId = String(sessionId ?? "").trim();
    if (!normalizedSessionId) {
      return [];
    }

    const sessionIdLiteral = toSqlStringLiteral(normalizedSessionId);
    const result = this.db.exec(
      `
      SELECT id, session_id, role, content, sequence, created_at
      FROM chat_messages
      WHERE session_id = ${sessionIdLiteral}
      ORDER BY created_at ASC, sequence ASC;
    `,
    );

    if (result.length === 0) {
      return [];
    }

    const [table] = result;
    return table.values.map((row) => ({
      id: String(row[0]),
      sessionId: String(row[1]),
      role: String(row[2]) as ChatMessageRecord["role"],
      content: String(row[3]),
      sequence: Number(row[4]),
      createdAt: Number(row[5]),
    }));
  }

  getNextChatMessageSequence(sessionId: string): number {
    const normalizedSessionId = String(sessionId ?? "").trim();
    if (!normalizedSessionId) {
      return 1;
    }

    const sessionIdLiteral = toSqlStringLiteral(normalizedSessionId);
    const result = this.db.exec(
      `
      SELECT COALESCE(MAX(sequence), 0)
      FROM chat_messages
      WHERE session_id = ${sessionIdLiteral};
    `,
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return 1;
    }

    return Number(result[0].values[0][0]) + 1;
  }

  async addChatMessage(message: ChatMessageRecord): Promise<void> {
    const id = String(message.id ?? "").trim();
    const sessionId = String(message.sessionId ?? "").trim();
    const role: ChatMessageRecord["role"] =
      message.role === "assistant" || message.role === "system" ? message.role : "user";
    const content = message.content == null ? "" : String(message.content);
    const sequenceRaw = Number(message.sequence);
    const sequence = Number.isFinite(sequenceRaw) ? Math.max(1, Math.trunc(sequenceRaw)) : 1;
    const now = normalizeTimestamp(Date.now(), 1);
    const createdAt = normalizeTimestamp(message.createdAt, now);

    if (!id || !sessionId) {
      throw new Error("chat message id/session_id is required");
    }

    this.ensureSessionExistsForMessage(sessionId, createdAt);
    if (!this.chatSessionExists(sessionId)) {
      throw new Error(`chat session missing before message insert (post-heal): ${sessionId}`);
    }

    const upsertArgs = { id, sessionId, role, content, sequence, createdAt };

    try {
      this.runChatMessageUpsert(upsertArgs);
      const changesResult = this.db.exec("SELECT changes();");
      const changes =
        changesResult.length > 0 && changesResult[0].values.length > 0
          ? Number(changesResult[0].values[0][0])
          : 0;
      if (!Number.isFinite(changes) || changes < 1) {
        throw new Error(`chat message insert did not affect rows for session_id=${sessionId}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const shouldHeal =
        message.includes("not null constraint failed: chat_messages.session_id") ||
        message.includes("datatype mismatch") ||
        message.includes("no such table: chat_messages") ||
        message.includes("foreign key constraint failed") ||
        message.includes("chat message insert did not affect rows");

      if (!shouldHeal) {
        throw error;
      }

      this.rebuildChatTablesPreservingData();
      this.ensureSessionExistsForMessage(sessionId, createdAt);
      if (!this.chatSessionExists(sessionId)) {
        throw new Error(`chat session missing after heal: ${sessionId}`);
      }

      try {
        this.runChatMessageUpsert(upsertArgs);
        const changesResult = this.db.exec("SELECT changes();");
        const changes =
          changesResult.length > 0 && changesResult[0].values.length > 0
            ? Number(changesResult[0].values[0][0])
            : 0;
        if (!Number.isFinite(changes) || changes < 1) {
          throw new Error(`chat message insert did not affect rows for session_id=${sessionId}`);
        }
      } catch (retryError) {
        const chatMessagesDiagnostic = this.getChatMessagesTableDiagnostic();
        const chatSessionsDiagnostic = this.getChatSessionsTableDiagnostic();
        throw new Error(
          `${retryError instanceof Error ? retryError.message : String(retryError)} | ` +
            `chat_message_id=${id} chat_session_id=${sessionId} role=${role} sequence=${String(sequence)} created_at=${String(createdAt)} | ` +
            `${chatMessagesDiagnostic}; ${chatSessionsDiagnostic}`,
        );
      }
    }

    await backupChatMessage({
      id,
      sessionId,
      role,
      content,
      sequence,
      createdAt,
    });

    await this.persist();
  }

  async clearAllData(): Promise<void> {
    this.db.close();
    this.db = new this.sql.Database();
    runSchema(this.db);
    this.vectorIndexCache = null;
    this.vectorIndexCacheCount = -1;
    this.pendingEmbeddingsSinceCheckpoint = 0;
    this.pendingEmbeddingsStartedAt = 0;
    this.lastEmbeddingCheckpointAt = null;

    await clearOpfsFile(this.scopeKey);
    clearLocalStorageBytes(this.scopeKey);
    await clearChatBackup();
    await this.persist();
  }
}

export async function migrateLocalDatabaseScope(args: {
  fromScopeKey: string;
  toScopeKey: string;
  fromChatScopeKey?: string | null;
  toChatScopeKey?: string | null;
}): Promise<boolean> {
  async function clearLegacyScopeSnapshot(scopeKey: string): Promise<void> {
    await clearOpfsFile(scopeKey);
    clearLocalStorageBytes(scopeKey);
    dbPromiseByScope.delete(scopeKey);
  }

  function isUnreadableLegacySnapshotError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return (
      message.includes("file is not a database") ||
      message.includes("not a database") ||
      message.includes("database disk image is malformed") ||
      message.includes("malformed")
    );
  }

  const fromScopeKey = normalizeDatabaseScopeKey(args.fromScopeKey);
  const toScopeKey = normalizeDatabaseScopeKey(args.toScopeKey);

  if (fromScopeKey === toScopeKey) {
    return false;
  }

  const existingTarget = await readPersistedScopeSnapshot(toScopeKey);
  if (existingTarget) {
    await clearLegacyScopeSnapshot(fromScopeKey);
    return false;
  }

  const sourceSnapshot = await readPersistedScopeSnapshot(fromScopeKey);
  if (!sourceSnapshot) {
    return false;
  }

  try {
    const sql = await getSql();
    const database = new sql.Database(sourceSnapshot.bytes);
    try {
      runSchema(database);
      rewriteScopedChatSessionIds(database, args.fromChatScopeKey, args.toChatScopeKey);
      const migratedBytes = database.export();
      await writePersistedScopeSnapshot(migratedBytes, toScopeKey, sourceSnapshot.storageMode);
    } finally {
      database.close();
    }
  } catch (error) {
    if (isUnreadableLegacySnapshotError(error)) {
      await clearLegacyScopeSnapshot(fromScopeKey);
      return false;
    }
    throw new Error(
      `Failed to migrate local database scope from ${fromScopeKey} to ${toScopeKey}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await clearLegacyScopeSnapshot(fromScopeKey);
  dbPromiseByScope.delete(toScopeKey);
  return true;
}

export function setLocalDatabaseScope(scopeKey: string): void {
  currentDatabaseScopeKey = normalizeDatabaseScopeKey(scopeKey);
}

export async function getLocalDatabase(): Promise<LocalDatabase> {
  const scopeKey = currentDatabaseScopeKey;
  const existingPromise = dbPromiseByScope.get(scopeKey);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = (async () => {
      const sql = await getSql();
      const embeddingCheckpointPolicy = getEmbeddingCheckpointPolicyFromEnv();
      const createFreshDatabase = async () => {
        const db = new sql.Database();
        runSchema(db);

        const storageMode: StorageMode = isOpfsSupported() ? "opfs" : "local-storage";
        const localDb = new LocalDatabase({
          sql,
          db,
          storageMode,
          scopeKey,
          embeddingCheckpointPolicy,
        });
        try {
          await localDb.upsertIndexMeta({
            key: "db_created_at",
            value: String(Date.now()),
            updatedAt: Date.now(),
          });
        } catch {
          // Non-fatal: metadata row should not block app startup.
        }
        return localDb;
      };

      const persistedSnapshot = await readPersistedScopeSnapshot(scopeKey);
      if (persistedSnapshot) {
        let db: Database | null = null;
        try {
          db = new sql.Database(persistedSnapshot.bytes);
          runSchema(db);
          return new LocalDatabase({
            sql,
            db,
            storageMode: persistedSnapshot.storageMode,
            scopeKey,
            embeddingCheckpointPolicy,
          });
        } catch (error) {
          db?.close();
          throw new Error(
            `Failed to open or migrate the local database. Stored data was preserved: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
      }

      return createFreshDatabase();
    })();

  dbPromiseByScope.set(scopeKey, promise);
  try {
    return await promise;
  } catch (error) {
    if (dbPromiseByScope.get(scopeKey) === promise) {
      dbPromiseByScope.delete(scopeKey);
    }
    throw error;
  }
}
