import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { DATABASE_SCHEMA_SQL } from "./schema";
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

const DB_NAME = "gitstarrecall.sqlite";
const LOCAL_STORAGE_KEY = "gitstarrecall.sqlite.base64";
const DEFAULT_EMBEDDING_CHECKPOINT_EVERY_EMBEDDINGS = 256;
const DEFAULT_EMBEDDING_CHECKPOINT_EVERY_MS = 3000;

let sqlPromise: Promise<SqlJsStatic> | null = null;
let dbPromise: Promise<LocalDatabase> | null = null;

type EmbeddingCheckpointPolicy = {
  everyEmbeddings: number;
  everyMs: number;
};

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

async function loadBytesFromOpfs(): Promise<Uint8Array | null> {
  if (!isOpfsSupported()) {
    return null;
  }

  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(DB_NAME);
    const file = await handle.getFile();
    const arrayBuffer = await file.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch {
    return null;
  }
}

async function writeBytesToOpfs(bytes: Uint8Array): Promise<boolean> {
  if (!isOpfsSupported()) {
    return false;
  }

  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(DB_NAME, { create: true });
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

async function clearOpfsFile(): Promise<void> {
  if (!isOpfsSupported()) {
    return;
  }

  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(DB_NAME);
  } catch {
    // noop: best effort
  }
}

function loadBytesFromLocalStorage(): Uint8Array | null {
  const encoded = localStorage.getItem(LOCAL_STORAGE_KEY);

  if (!encoded) {
    return null;
  }

  try {
    return fromBase64(encoded);
  } catch {
    return null;
  }
}

function writeBytesToLocalStorage(bytes: Uint8Array): void {
  localStorage.setItem(LOCAL_STORAGE_KEY, toBase64(bytes));
}

function clearLocalStorageBytes(): void {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
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

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class LocalDatabase {
  private sql: SqlJsStatic;
  private db: Database;
  private _storageMode: StorageMode;
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
    embeddingCheckpointPolicy?: EmbeddingCheckpointPolicy;
  }) {
    this.sql = args.sql;
    this.db = args.db;
    this._storageMode = args.storageMode;
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
      INNER JOIN chunks c ON CAST(c.id AS TEXT) = CAST(e.chunk_id AS TEXT);
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

  async findSimilarChunks(queryVector: Float32Array, limit: number = 10): Promise<SearchResult[]> {
    // 1. Use in-memory cache of decoded embedding vectors for repeated queries.
    const vectors = this.ensureVectorIndexCache();
    if (vectors.length === 0) {
      return [];
    }
    const scores: { chunkId: string; score: number }[] = [];

    // 2. Compute similarity
    for (const entry of vectors) {
      const { chunkId, vector } = entry;
      const score = cosineSimilarity(queryVector, vector);
      scores.push({ chunkId, score });
    }

    // 3. Sort and slice
    scores.sort((a, b) => b.score - a.score);
    const topChunks = scores.slice(0, limit);

    if (topChunks.length === 0) {
      return [];
    }

    // 4. Hydrate with text and repo info.
    // Use SQL literals instead of bind params because some browser/sql.js environments
    // in this app have shown unstable bind behavior (NULL coercion).
    const chunkIdLiterals = topChunks.map((item) => toSqlStringLiteral(item.chunkId)).join(",");
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
      return [];
    }

    const detailsMap = new Map<
      string,
      Omit<SearchResult, "chunkId" | "score">
    >();
    const [detailsTable] = detailsResult;
    for (const row of detailsTable.values) {
      detailsMap.set(String(row[0]), {
        text: String(row[1]),
        repoId: Number(row[2]),
        repoName: String(row[3]),
        repoFullName: String(row[4]),
        repoDescription: row[5] ? String(row[5]) : null,
        repoUrl: String(row[6]),
        language: row[7] == null ? null : String(row[7]),
        topics: JSON.parse(String(row[8] ?? "[]")) as string[],
        updatedAt: String(row[9]),
      });
    }

    // 5. Construct final result preserving score order
    return topChunks
      .map((tc) => {
        const details = detailsMap.get(tc.chunkId);
        if (!details) return null;
        return {
          chunkId: tc.chunkId,
          score: tc.score,
          ...details,
        };
      })
      .filter((item): item is SearchResult => item !== null);
  }

  private async persist(): Promise<void> {
    const bytes = this.db.export();

    if (this._storageMode === "opfs") {
      const written = await writeBytesToOpfs(bytes);

      if (written) {
        return;
      }

      this._storageMode = "local-storage";
    }

    if (this._storageMode === "local-storage") {
      writeBytesToLocalStorage(bytes);
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
        updated_at, readme_url, readme_text, checksum, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        readme_url = excluded.readme_url,
        readme_text = excluded.readme_text,
        checksum = excluded.checksum,
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
          repo.checksum,
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
        updated_at, readme_url, readme_text, checksum, last_synced_at
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
      checksum: row[12] == null ? null : String(row[12]),
      lastSyncedAt: Number(row[13]),
    }));
  }

  listRepoSyncState(): RepoSyncState[] {
    const result = this.db.exec(`
      SELECT id, full_name, description, topics_json, language, updated_at, checksum
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
      checksum: row[6] == null ? null : String(row[6]),
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
        ON CAST(e.chunk_id AS TEXT) = CAST(c.id AS TEXT)
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
        ON CAST(e.chunk_id AS TEXT) = CAST(c.id AS TEXT)
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

    await clearOpfsFile();
    clearLocalStorageBytes();
    await this.persist();
  }
}

export async function getLocalDatabase(): Promise<LocalDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const sql = await getSql();
      const embeddingCheckpointPolicy = getEmbeddingCheckpointPolicyFromEnv();
      const createFreshDatabase = async () => {
        const db = new sql.Database();
        runSchema(db);

        const storageMode: StorageMode = isOpfsSupported() ? "opfs" : "local-storage";
        const localDb = new LocalDatabase({ sql, db, storageMode, embeddingCheckpointPolicy });
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

      const opfsBytes = await loadBytesFromOpfs();

      if (opfsBytes) {
        try {
          const db = new sql.Database(opfsBytes);
          runSchema(db);
          return new LocalDatabase({ sql, db, storageMode: "opfs", embeddingCheckpointPolicy });
        } catch {
          await clearOpfsFile();
          return createFreshDatabase();
        }
      }

      const localBytes = loadBytesFromLocalStorage();
      if (localBytes) {
        try {
          const db = new sql.Database(localBytes);
          runSchema(db);
          return new LocalDatabase({ sql, db, storageMode: "local-storage", embeddingCheckpointPolicy });
        } catch {
          clearLocalStorageBytes();
          return createFreshDatabase();
        }
      }

      return createFreshDatabase();
    })();
  }

  return dbPromise;
}
