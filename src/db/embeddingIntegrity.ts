import type { Database } from "sql.js";

export const EMBEDDING_CHUNK_UNIQUE_INDEX_NAME = "idx_embeddings_chunk_id_unique";
// Mirrors the index_meta key that the embedding pipeline writes for the active model.
export const EMBEDDING_MODEL_META_KEY = "embedding_active_model";
export const EMBEDDING_DIMENSION_META_KEY = "embedding_active_dimension";
export const EMBEDDING_REINDEX_REQUIRED_META_KEY = "embedding_reindex_required";

export type EmbeddingReadinessStatus = "empty" | "ready" | "degraded";

export type EmbeddingHealthIssue =
  | "missing_coverage"
  | "invalid_vectors"
  | "orphan_vectors"
  | "duplicate_vectors"
  | "mixed_models"
  | "mixed_dimensions"
  | "missing_model_metadata"
  | "model_mismatch"
  | "missing_dimension_metadata"
  | "invalid_dimension_metadata"
  | "dimension_mismatch"
  | "reindex_required";

export type EmbeddingHealth = {
  status: EmbeddingReadinessStatus;
  chunkCount: number;
  embeddingCount: number;
  validEmbeddingCount: number;
  coveredChunkCount: number;
  model: string | null;
  dimension: number | null;
  expectedModel: string | null;
  expectedDimension: number | null;
  issues: EmbeddingHealthIssue[];
};

// A vector row is only usable when its declared dimension is a positive integer,
// its blob is exactly dimension * 4 bytes (one float32 per component), its
// timestamp is a positive integer, and it still points at an existing chunk.
const VALID_EMBEDDING_PREDICATE = `
  typeof(e.dimension) = 'integer'
  AND e.dimension > 0
  AND typeof(e.vector_blob) = 'blob'
  AND length(e.vector_blob) = e.dimension * 4
  AND typeof(e.created_at) = 'integer'
  AND e.created_at > 0
  AND EXISTS (SELECT 1 FROM chunks c WHERE c.id = e.chunk_id)
`;

const EMBEDDING_COLUMNS = [
  ["id", "TEXT"],
  ["chunk_id", "TEXT"],
  ["model", "TEXT"],
  ["dimension", "INTEGER"],
  ["vector_blob", "BLOB"],
  ["created_at", "INTEGER"],
] as const;

const INDEX_META_COLUMNS = [
  ["key", "TEXT"],
  ["value", "TEXT"],
  ["updated_at", "INTEGER"],
] as const;

function readColumns(
  database: Database,
  table: string,
): Array<{ name: string; type: string; primaryKeyPosition: number }> {
  const result = database.exec(`PRAGMA table_info(${table});`);
  if (result.length === 0) {
    return [];
  }
  return result[0].values.map((row) => ({
    name: String(row[1]),
    type: String(row[2]).toUpperCase(),
    primaryKeyPosition: Number(row[5]),
  }));
}

function requiresCanonicalRebuild(
  columns: Array<{ name: string; type: string; primaryKeyPosition: number }>,
  required: ReadonlyArray<readonly [string, string]>,
  table: string,
): boolean {
  const names = columns.map((column) => column.name);
  const uniqueNames = new Set(names);
  if (uniqueNames.size !== names.length) {
    throw new Error(`Cannot safely migrate ${table}: ambiguous duplicate columns`);
  }
  const missing = required.map(([name]) => name).filter((name) => !uniqueNames.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Cannot safely migrate ${table}: missing required columns ${missing.join(", ")}`,
    );
  }
  const requiredTypes = new Map(required);
  return (
    columns.length !== required.length ||
    columns.some((column) => requiredTypes.get(column.name) !== column.type) ||
    columns.find((column) => column.name === required[0][0])?.primaryKeyPosition !== 1
  );
}

function createCanonicalEmbeddingsTable(database: Database, name: string): void {
  database.run(`
    CREATE TABLE ${name} (
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

function createCanonicalIndexMetaTable(database: Database, name: string): void {
  database.run(`
    CREATE TABLE ${name} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function rebuildEmbeddingsPreservingValidData(database: Database): boolean {
  const replacement = "embeddings_v014_rebuild";
  const sourceRowCount = readCount(database, "SELECT COUNT(*) FROM embeddings;");
  createCanonicalEmbeddingsTable(database, replacement);
  database.run(`
    INSERT INTO ${replacement} (id, chunk_id, model, dimension, vector_blob, created_at)
    SELECT e.id, e.chunk_id, e.model, CAST(e.dimension AS INTEGER), e.vector_blob, CAST(e.created_at AS INTEGER)
    FROM embeddings e
    WHERE typeof(e.id) = 'text' AND TRIM(e.id) <> ''
      AND typeof(e.chunk_id) = 'text' AND TRIM(e.chunk_id) <> ''
      AND typeof(e.model) = 'text' AND TRIM(e.model) <> ''
      AND typeof(e.dimension) IN ('integer', 'text')
      AND CAST(e.dimension AS INTEGER) > 0
      AND CAST(e.dimension AS REAL) = CAST(e.dimension AS INTEGER)
      AND typeof(e.vector_blob) = 'blob'
      AND length(e.vector_blob) = CAST(e.dimension AS INTEGER) * 4
      AND typeof(e.created_at) IN ('integer', 'text')
      AND CAST(e.created_at AS REAL) = CAST(e.created_at AS INTEGER)
      AND CAST(e.created_at AS INTEGER) > 0
      AND EXISTS (SELECT 1 FROM chunks c WHERE c.id = e.chunk_id);
  `);
  const preservedRowCount = readCount(database, `SELECT COUNT(*) FROM ${replacement};`);
  database.run("DROP TABLE embeddings;");
  database.run(`ALTER TABLE ${replacement} RENAME TO embeddings;`);
  return sourceRowCount === preservedRowCount;
}

function rebuildIndexMetaPreservingValidData(database: Database): void {
  const replacement = "index_meta_v014_rebuild";
  createCanonicalIndexMetaTable(database, replacement);
  database.run(`
    INSERT INTO ${replacement} (key, value, updated_at)
    SELECT m.key, m.value, CAST(m.updated_at AS INTEGER)
    FROM index_meta m
    WHERE typeof(m.key) = 'text' AND TRIM(m.key) <> ''
      AND typeof(m.value) = 'text'
      AND typeof(m.updated_at) IN ('integer', 'text')
      AND CAST(m.updated_at AS REAL) = CAST(m.updated_at AS INTEGER)
      AND NOT EXISTS (
        SELECT 1 FROM index_meta newer
        WHERE newer.key = m.key
          AND typeof(newer.value) = 'text'
          AND typeof(newer.updated_at) IN ('integer', 'text')
          AND CAST(newer.updated_at AS REAL) = CAST(newer.updated_at AS INTEGER)
          AND (
            CAST(newer.updated_at AS INTEGER) > CAST(m.updated_at AS INTEGER)
            OR (
              CAST(newer.updated_at AS INTEGER) = CAST(m.updated_at AS INTEGER)
              AND newer.rowid < m.rowid
            )
          )
      );
  `);
  database.run("DROP TABLE index_meta;");
  database.run(`ALTER TABLE ${replacement} RENAME TO index_meta;`);
}

function reconcileEmbeddingRows(database: Database): boolean {
  let rowsChanged = false;
  database.run(`
    DELETE FROM embeddings
    WHERE NOT (
      typeof(dimension) = 'integer'
      AND dimension > 0
      AND typeof(vector_blob) = 'blob'
      AND length(vector_blob) = dimension * 4
      AND typeof(created_at) = 'integer'
      AND created_at > 0
    );
  `);
  rowsChanged = rowsChanged || readCount(database, "SELECT changes();") > 0;
  database.run("DELETE FROM embeddings WHERE chunk_id NOT IN (SELECT id FROM chunks);");
  rowsChanged = rowsChanged || readCount(database, "SELECT changes();") > 0;
  database.run(`
    DELETE FROM embeddings
    WHERE EXISTS (
      SELECT 1 FROM embeddings AS better
      WHERE better.chunk_id = embeddings.chunk_id
        AND (
          better.created_at > embeddings.created_at
          OR (better.created_at = embeddings.created_at AND better.id < embeddings.id)
        )
    );
  `);
  rowsChanged = rowsChanged || readCount(database, "SELECT changes();") > 0;
  const indexes = database.exec("SELECT name, \"unique\" FROM pragma_index_list('embeddings');");
  const namedIndex = indexes[0]?.values.find(
    (row) => String(row[0]) === EMBEDDING_CHUNK_UNIQUE_INDEX_NAME,
  );
  if (namedIndex && Number(namedIndex[1]) !== 1) {
    database.run(`DROP INDEX ${EMBEDDING_CHUNK_UNIQUE_INDEX_NAME};`);
  }
  database.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${EMBEDDING_CHUNK_UNIQUE_INDEX_NAME} ON embeddings(chunk_id);`,
  );
  database.run("DROP INDEX IF EXISTS idx_embeddings_chunk_id;");
  return rowsChanged;
}

function readCount(database: Database, query: string): number {
  const result = database.exec(query);
  if (result.length === 0 || result[0].values.length === 0) {
    return 0;
  }
  return Number(result[0].values[0][0] ?? 0);
}

/**
 * Idempotently repairs the embeddings table: it removes invalid and orphan
 * vectors, deterministically keeps only the newest valid vector per chunk, and
 * then — after cleanup — installs a distinctly named UNIQUE(chunk_id) index so
 * that chunk_id becomes a durable upsert conflict target.
 */
export function reconcileEmbeddingIntegrity(database: Database): void {
  database.run("BEGIN");
  try {
    if (reconcileEmbeddingRows(database)) {
      setReindexRequiredMarker(database);
    }
    database.run("COMMIT");
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  }
}

function hasReindexRequiredMarker(database: Database): boolean {
  return (
    readCount(
      database,
      `SELECT COUNT(*) FROM index_meta WHERE key = '${EMBEDDING_REINDEX_REQUIRED_META_KEY}';`,
    ) > 0
  );
}

function setReindexRequiredMarker(database: Database): boolean {
  database.run(
    `INSERT INTO index_meta (key, value, updated_at)
     VALUES (?, '1', CAST(strftime('%s','now') AS INTEGER) * 1000)
     ON CONFLICT(key) DO NOTHING;`,
    [EMBEDDING_REINDEX_REQUIRED_META_KEY],
  );
  return readCount(database, "SELECT changes();") > 0;
}

/**
 * Canonicalizes legacy embeddings/index metadata without ever dropping data
 * merely because a table looks unfamiliar. Rebuilds are allowed only when all
 * canonical source columns are unambiguous; otherwise the transaction fails and
 * the caller can leave the persisted snapshot byte-for-byte untouched.
 */
export function ensureEmbeddingIntegritySchema(database: Database): boolean {
  database.run("BEGIN");
  try {
    const embeddingColumns = readColumns(database, "embeddings");
    let sourceRowsFullyPreserved = true;
    const embeddingsRebuilt = requiresCanonicalRebuild(
      embeddingColumns,
      EMBEDDING_COLUMNS,
      "embeddings",
    );
    if (embeddingsRebuilt) {
      sourceRowsFullyPreserved = rebuildEmbeddingsPreservingValidData(database);
    }

    const indexMetaColumns = readColumns(database, "index_meta");
    const indexMetaRebuilt = requiresCanonicalRebuild(
      indexMetaColumns,
      INDEX_META_COLUMNS,
      "index_meta",
    );
    if (indexMetaRebuilt) {
      rebuildIndexMetaPreservingValidData(database);
    }

    const inferredLegacyDimension = sourceRowsFullyPreserved
      ? inferSafeLegacyDimensionBackfill(database)
      : null;
    const rowsChanged = reconcileEmbeddingRows(database);
    const markerInserted =
      !sourceRowsFullyPreserved || rowsChanged ? setReindexRequiredMarker(database) : false;
    if (inferredLegacyDimension !== null) {
      database.run(
        `INSERT INTO index_meta (key, value, updated_at)
         VALUES (?, ?, CAST(strftime('%s','now') AS INTEGER) * 1000)
         ON CONFLICT(key) DO NOTHING;`,
        [EMBEDDING_DIMENSION_META_KEY, String(inferredLegacyDimension)],
      );
    }
    database.run("COMMIT");
    return (
      embeddingsRebuilt ||
      indexMetaRebuilt ||
      rowsChanged ||
      markerInserted ||
      inferredLegacyDimension !== null
    );
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  }
}

function inferSafeLegacyDimensionBackfill(database: Database): number | null {
  if (hasReindexRequiredMarker(database) || readExpectedDimension(database).state !== "missing") {
    return null;
  }
  const health = getEmbeddingHealth(database);
  if (
    health.chunkCount === 0 ||
    health.embeddingCount !== health.chunkCount ||
    health.validEmbeddingCount !== health.embeddingCount ||
    health.coveredChunkCount !== health.chunkCount ||
    health.model === null ||
    health.dimension === null ||
    health.expectedModel === null ||
    health.expectedModel !== health.model ||
    health.issues.some((issue) => issue !== "missing_dimension_metadata")
  ) {
    return null;
  }
  return health.dimension;
}

function readExpectedModel(database: Database): string | null {
  const result = database.exec("SELECT value FROM index_meta WHERE key = ? LIMIT 1;", [
    EMBEDDING_MODEL_META_KEY,
  ]);
  if (result.length === 0 || result[0].values.length === 0) {
    return null;
  }
  const value = result[0].values[0][0];
  if (value == null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readExpectedDimension(database: Database): {
  value: number | null;
  state: "valid" | "missing" | "invalid";
} {
  const result = database.exec("SELECT value FROM index_meta WHERE key = ? LIMIT 1;", [
    EMBEDDING_DIMENSION_META_KEY,
  ]);
  if (result.length === 0 || result[0].values.length === 0) {
    return { value: null, state: "missing" };
  }
  const raw = String(result[0].values[0][0] ?? "").trim();
  if (!/^[1-9]\d*$/.test(raw)) {
    return { value: null, state: "invalid" };
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return { value: null, state: "invalid" };
  }
  return { value, state: "valid" };
}

/**
 * Computes a compact readiness summary over the embeddings/chunks tables. An
 * index is only "ready" when every chunk is covered by exactly one valid vector
 * of a single model and dimension, matching valid expected model and dimension
 * metadata. Anything else is "degraded" (with the failing reasons), and an index
 * with no chunks and no vectors is "empty".
 */
export function getEmbeddingHealth(database: Database): EmbeddingHealth {
  const chunkCount = readCount(database, "SELECT COUNT(*) FROM chunks;");
  const embeddingCount = readCount(database, "SELECT COUNT(*) FROM embeddings;");
  const validEmbeddingCount = readCount(
    database,
    `SELECT COUNT(*) FROM embeddings e WHERE ${VALID_EMBEDDING_PREDICATE};`,
  );
  const orphanCount = readCount(
    database,
    "SELECT COUNT(*) FROM embeddings e WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.id = e.chunk_id);",
  );
  const invalidShapeCount = readCount(
    database,
    `SELECT COUNT(*) FROM embeddings e
     WHERE EXISTS (SELECT 1 FROM chunks c WHERE c.id = e.chunk_id)
       AND NOT (
         typeof(e.dimension) = 'integer'
         AND e.dimension > 0
         AND typeof(e.vector_blob) = 'blob'
         AND length(e.vector_blob) = e.dimension * 4
         AND typeof(e.created_at) = 'integer'
         AND e.created_at > 0
       );`,
  );
  const coveredChunkCount = readCount(
    database,
    `SELECT COUNT(DISTINCT e.chunk_id) FROM embeddings e WHERE ${VALID_EMBEDDING_PREDICATE};`,
  );
  const duplicateChunkCount = readCount(
    database,
    `SELECT COUNT(*) FROM (
       SELECT e.chunk_id FROM embeddings e
       WHERE ${VALID_EMBEDDING_PREDICATE}
       GROUP BY e.chunk_id
       HAVING COUNT(*) > 1
     );`,
  );

  const modelResult = database.exec(
    `SELECT DISTINCT e.model FROM embeddings e WHERE ${VALID_EMBEDDING_PREDICATE};`,
  );
  const models = modelResult.length === 0 ? [] : modelResult[0].values.map((row) => String(row[0]));
  const dimensionResult = database.exec(
    `SELECT DISTINCT e.dimension FROM embeddings e WHERE ${VALID_EMBEDDING_PREDICATE};`,
  );
  const dimensions =
    dimensionResult.length === 0 ? [] : dimensionResult[0].values.map((row) => Number(row[0]));

  const model = models.length === 1 ? models[0] : null;
  const dimension = dimensions.length === 1 ? dimensions[0] : null;
  const expectedModel = readExpectedModel(database);
  const expectedDimensionResult = readExpectedDimension(database);
  const expectedDimension = expectedDimensionResult.value;
  const reindexRequired = hasReindexRequiredMarker(database);

  const issues: EmbeddingHealthIssue[] = [];
  if (orphanCount > 0) {
    issues.push("orphan_vectors");
  }
  if (invalidShapeCount > 0) {
    issues.push("invalid_vectors");
  }
  if (duplicateChunkCount > 0) {
    issues.push("duplicate_vectors");
  }
  if (coveredChunkCount < chunkCount) {
    issues.push("missing_coverage");
  }
  if (models.length > 1) {
    issues.push("mixed_models");
  }
  if (dimensions.length > 1) {
    issues.push("mixed_dimensions");
  }
  if (validEmbeddingCount > 0 && expectedModel === null) {
    issues.push("missing_model_metadata");
  }
  if (expectedModel !== null && model !== null && expectedModel !== model) {
    issues.push("model_mismatch");
  }
  if (validEmbeddingCount > 0 && expectedDimensionResult.state === "missing") {
    issues.push("missing_dimension_metadata");
  }
  if (validEmbeddingCount > 0 && expectedDimensionResult.state === "invalid") {
    issues.push("invalid_dimension_metadata");
  }
  if (expectedDimension !== null && dimension !== null && expectedDimension !== dimension) {
    issues.push("dimension_mismatch");
  }
  if (reindexRequired) {
    issues.push("reindex_required");
  }

  let status: EmbeddingReadinessStatus;
  if (chunkCount === 0 && embeddingCount === 0) {
    status = "empty";
  } else if (issues.length === 0) {
    status = "ready";
  } else {
    status = "degraded";
  }

  return {
    status,
    chunkCount,
    embeddingCount,
    validEmbeddingCount,
    coveredChunkCount,
    model,
    dimension,
    expectedModel,
    expectedDimension,
    issues,
  };
}
