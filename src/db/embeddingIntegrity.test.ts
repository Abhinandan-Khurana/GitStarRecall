import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";
import { LocalDatabase, runSchema } from "./client";
import { DATABASE_SCHEMA_SQL } from "./schema";
import {
  EMBEDDING_CHUNK_UNIQUE_INDEX_NAME,
  EMBEDDING_DIMENSION_META_KEY,
  EMBEDDING_MODEL_META_KEY,
  EMBEDDING_REINDEX_REQUIRED_META_KEY,
  ensureEmbeddingIntegritySchema,
  getEmbeddingHealth,
  reconcileEmbeddingIntegrity,
} from "./embeddingIntegrity";

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => `node_modules/sql.js/dist/${file}`,
  });
});

function blobOfDimension(dimension: number, seed = 1): Uint8Array {
  const vec = new Float32Array(dimension).fill(seed);
  return new Uint8Array(vec.buffer.slice(0));
}

function insertChunk(db: Database, id: string): void {
  db.run(
    "INSERT INTO chunks (id, repo_id, chunk_id, text, source, created_at) VALUES (?, 1, ?, 'text', 'readme', 1);",
    [id, id],
  );
}

function insertRepo(db: Database): void {
  db.run(
    `INSERT INTO repos (id, full_name, name, description, topics_json, language, html_url, stars, forks, updated_at, last_synced_at)
     VALUES (1, 'acme/repo', 'repo', NULL, '[]', 'TypeScript', 'https://example.com', 0, 0, '2026-01-01T00:00:00Z', 1);`,
  );
}

function insertEmbedding(
  db: Database,
  args: {
    id: string;
    chunkId: string;
    model?: string;
    dimension?: number;
    blob?: Uint8Array;
    createdAt?: number;
  },
): void {
  const dimension = args.dimension ?? 4;
  const blob = args.blob ?? blobOfDimension(dimension);
  db.run(
    "INSERT INTO embeddings (id, chunk_id, model, dimension, vector_blob, created_at) VALUES (?, ?, ?, ?, ?, ?);",
    [args.id, args.chunkId, args.model ?? "model-a", dimension, blob, args.createdAt ?? 1],
  );
}

function embeddingRows(db: Database): Array<{ id: string; chunkId: string; model: string }> {
  const result = db.exec("SELECT id, chunk_id, model FROM embeddings ORDER BY id;");
  if (result.length === 0) {
    return [];
  }
  return result[0].values.map((row) => ({
    id: String(row[0]),
    chunkId: String(row[1]),
    model: String(row[2]),
  }));
}

function freshDb(): Database {
  const db = new SQL.Database();
  db.run(DATABASE_SCHEMA_SQL);
  return db;
}

function setExpectedProfile(db: Database, model: string, dimension: string): void {
  db.run("INSERT INTO index_meta (key, value, updated_at) VALUES (?, ?, 1), (?, ?, 1);", [
    EMBEDDING_MODEL_META_KEY,
    model,
    EMBEDDING_DIMENSION_META_KEY,
    dimension,
  ]);
}

function getDimensionMetadata(db: Database): string | null {
  const result = db.exec("SELECT value FROM index_meta WHERE key = ?;", [
    EMBEDDING_DIMENSION_META_KEY,
  ]);
  return result[0]?.values[0]?.[0] == null ? null : String(result[0].values[0][0]);
}

function hasReindexMarker(db: Database): boolean {
  return (
    db.exec("SELECT 1 FROM index_meta WHERE key = ?;", [EMBEDDING_REINDEX_REQUIRED_META_KEY])[0]
      ?.values.length > 0
  );
}

describe("reconcileEmbeddingIntegrity", () => {
  it("removes orphan vectors whose chunk no longer exists", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertEmbedding(db, { id: "e-live", chunkId: "c-1" });
    // Orphans only exist in legacy data written without FK enforcement.
    db.run("PRAGMA foreign_keys = OFF;");
    insertEmbedding(db, { id: "e-orphan", chunkId: "missing" });
    db.run("PRAGMA foreign_keys = ON;");

    reconcileEmbeddingIntegrity(db);

    expect(embeddingRows(db).map((row) => row.id)).toEqual(["e-live"]);
    db.close();
  });

  it("removes vectors with non-positive dimension or mismatched blob length", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertChunk(db, "c-2");
    insertChunk(db, "c-3");
    insertEmbedding(db, { id: "e-ok", chunkId: "c-1", dimension: 4 });
    insertEmbedding(db, {
      id: "e-zero-dim",
      chunkId: "c-2",
      dimension: 0,
      blob: new Uint8Array(0),
    });
    // dimension says 8 (32 bytes) but blob only holds 4 floats (16 bytes)
    insertEmbedding(db, {
      id: "e-bad-len",
      chunkId: "c-3",
      dimension: 8,
      blob: blobOfDimension(4),
    });

    reconcileEmbeddingIntegrity(db);

    expect(embeddingRows(db).map((row) => row.id)).toEqual(["e-ok"]);
    db.close();
  });

  it("retains the newest valid vector per chunk with a deterministic id tie-break", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    // Newest by created_at wins.
    insertEmbedding(db, { id: "e-old", chunkId: "c-1", createdAt: 10 });
    insertEmbedding(db, { id: "e-new", chunkId: "c-1", createdAt: 20 });
    // Tie on created_at -> smallest id wins deterministically.
    insertChunk(db, "c-2");
    insertEmbedding(db, { id: "e-bbb", chunkId: "c-2", createdAt: 5 });
    insertEmbedding(db, { id: "e-aaa", chunkId: "c-2", createdAt: 5 });

    reconcileEmbeddingIntegrity(db);

    const rows = embeddingRows(db);
    expect(rows.filter((row) => row.chunkId === "c-1").map((row) => row.id)).toEqual(["e-new"]);
    expect(rows.filter((row) => row.chunkId === "c-2").map((row) => row.id)).toEqual(["e-aaa"]);
    db.close();
  });

  it("removes a corrupt text timestamp before it can outrank the newest valid vector", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertEmbedding(db, { id: "e-valid", chunkId: "c-1", createdAt: 20 });
    db.run(
      "INSERT INTO embeddings (id, chunk_id, model, dimension, vector_blob, created_at) VALUES (?, ?, ?, ?, ?, ?);",
      ["e-corrupt", "c-1", "model-a", 4, blobOfDimension(4), "zzzz"],
    );

    reconcileEmbeddingIntegrity(db);

    expect(embeddingRows(db).map((row) => row.id)).toEqual(["e-valid"]);
    db.close();
  });

  it("is idempotent across repeated runs", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", createdAt: 1 });
    insertEmbedding(db, { id: "e-2", chunkId: "c-1", createdAt: 2 });

    reconcileEmbeddingIntegrity(db);
    const afterFirst = embeddingRows(db);
    reconcileEmbeddingIntegrity(db);
    const afterSecond = embeddingRows(db);

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond.map((row) => row.id)).toEqual(["e-2"]);
    db.close();
  });

  it("creates a distinctly named UNIQUE(chunk_id) index only after cleanup", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", createdAt: 1 });
    insertEmbedding(db, { id: "e-2", chunkId: "c-1", createdAt: 2 });

    reconcileEmbeddingIntegrity(db);

    const indexes = db.exec("SELECT name, \"unique\" FROM pragma_index_list('embeddings');")[0];
    const byName = new Map(indexes.values.map((row) => [String(row[0]), Number(row[1])]));
    // The new unique index exists and is distinct from the legacy non-unique index name.
    expect(byName.get(EMBEDDING_CHUNK_UNIQUE_INDEX_NAME)).toBe(1);
    expect(EMBEDDING_CHUNK_UNIQUE_INDEX_NAME).not.toBe("idx_embeddings_chunk_id");
    expect(byName.has("idx_embeddings_chunk_id")).toBe(false);

    // The unique constraint is now enforced against duplicate chunk_id inserts.
    expect(() => insertEmbedding(db, { id: "e-dup", chunkId: "c-1", createdAt: 3 })).toThrow();
    db.close();
  });
});

describe("embedding integrity schema migration", () => {
  it("backfills a coherent pre-v0.14 corpus once without resetting embeddings", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertChunk(db, "c-2");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", model: "model-a", dimension: 4 });
    insertEmbedding(db, { id: "e-2", chunkId: "c-2", model: "model-a", dimension: 4 });
    db.run("INSERT INTO index_meta (key, value, updated_at) VALUES (?, ?, 1);", [
      EMBEDDING_MODEL_META_KEY,
      "model-a",
    ]);

    expect(runSchema(db)).toBe(true);
    expect(getDimensionMetadata(db)).toBe("4");
    expect(getEmbeddingHealth(db).status).toBe("ready");
    expect(embeddingRows(db).map((row) => row.id)).toEqual(["e-1", "e-2"]);
    expect(runSchema(db)).toBe(false);
    expect(getDimensionMetadata(db)).toBe("4");
    db.close();
  });

  it.each(["partial", "mixed-model", "mixed-dimension", "invalid", "orphan", "duplicate"] as const)(
    "does not backfill a %s legacy corpus",
    (scenario) => {
      const db = freshDb();
      insertRepo(db);
      insertChunk(db, "c-1");
      if (scenario === "partial") {
        insertChunk(db, "c-2");
        insertEmbedding(db, { id: "e-1", chunkId: "c-1" });
      } else if (scenario === "mixed-model") {
        insertChunk(db, "c-2");
        insertEmbedding(db, { id: "e-1", chunkId: "c-1", model: "model-a" });
        insertEmbedding(db, { id: "e-2", chunkId: "c-2", model: "model-b" });
      } else if (scenario === "mixed-dimension") {
        insertChunk(db, "c-2");
        insertEmbedding(db, { id: "e-1", chunkId: "c-1", dimension: 4 });
        insertEmbedding(db, { id: "e-2", chunkId: "c-2", dimension: 8 });
      } else if (scenario === "invalid") {
        insertEmbedding(db, {
          id: "e-invalid",
          chunkId: "c-1",
          dimension: 4,
          blob: blobOfDimension(3),
        });
      } else if (scenario === "orphan") {
        insertEmbedding(db, { id: "e-1", chunkId: "c-1" });
        db.run("PRAGMA foreign_keys = OFF;");
        insertEmbedding(db, { id: "e-orphan", chunkId: "missing" });
        db.run("PRAGMA foreign_keys = ON;");
      } else {
        insertEmbedding(db, { id: "e-1", chunkId: "c-1", createdAt: 1 });
        insertEmbedding(db, { id: "e-duplicate", chunkId: "c-1", createdAt: 2 });
      }
      db.run("INSERT INTO index_meta (key, value, updated_at) VALUES (?, ?, 1);", [
        EMBEDDING_MODEL_META_KEY,
        "model-a",
      ]);

      const cleanupRequired = ["invalid", "orphan", "duplicate"].includes(scenario);
      expect(runSchema(db)).toBe(cleanupRequired);
      expect(getDimensionMetadata(db)).toBeNull();
      expect(hasReindexMarker(db)).toBe(cleanupRequired);
      db.close();
    },
  );

  it.each(["duplicate", "orphan", "invalid", "lossy-rebuild"] as const)(
    "durably blocks later backfill after cleaning a %s corpus",
    (scenario) => {
      const db = freshDb();
      insertRepo(db);
      insertChunk(db, "c-1");
      if (scenario === "lossy-rebuild") {
        db.run("DROP TABLE embeddings;");
        db.run(`
          CREATE TABLE embeddings (
            id TEXT PRIMARY KEY,
            chunk_id TEXT NOT NULL,
            model TEXT NOT NULL,
            dimension TEXT NOT NULL,
            vector_blob BLOB NOT NULL,
            created_at INTEGER NOT NULL
          );
        `);
        insertEmbedding(db, { id: "e-valid", chunkId: "c-1" });
        db.run("INSERT INTO embeddings VALUES (?, ?, ?, ?, ?, ?);", [
          "e-invalid",
          "c-1",
          "model-a",
          "bad",
          blobOfDimension(4),
          2,
        ]);
      } else {
        insertEmbedding(db, { id: "e-valid", chunkId: "c-1", createdAt: 1 });
        if (scenario === "duplicate") {
          insertEmbedding(db, { id: "e-duplicate", chunkId: "c-1", createdAt: 2 });
        } else if (scenario === "orphan") {
          db.run("PRAGMA foreign_keys = OFF;");
          insertEmbedding(db, { id: "e-orphan", chunkId: "missing" });
          db.run("PRAGMA foreign_keys = ON;");
        } else {
          insertChunk(db, "c-invalid");
          insertEmbedding(db, {
            id: "e-invalid",
            chunkId: "c-invalid",
            dimension: 4,
            blob: blobOfDimension(3),
          });
        }
      }
      db.run("INSERT INTO index_meta (key, value, updated_at) VALUES (?, ?, 1);", [
        EMBEDDING_MODEL_META_KEY,
        "model-a",
      ]);

      expect(runSchema(db)).toBe(true);
      expect(hasReindexMarker(db)).toBe(true);
      expect(getDimensionMetadata(db)).toBeNull();
      const persisted = db.export();
      db.close();

      const reopened = new SQL.Database(persisted);
      expect(runSchema(reopened)).toBe(false);
      expect(hasReindexMarker(reopened)).toBe(true);
      expect(getDimensionMetadata(reopened)).toBeNull();
      expect(getEmbeddingHealth(reopened).issues).toContain("reindex_required");
      reopened.close();
    },
  );

  it("rebuilds compatible canonical columns transactionally and preserves valid embeddings and metadata", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    db.run("DROP TABLE embeddings;");
    db.run(`
      CREATE TABLE embeddings (
        id TEXT PRIMARY KEY,
        chunk_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimension TEXT NOT NULL,
        vector_blob BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    insertEmbedding(db, { id: "e-valid", chunkId: "c-1", createdAt: 10 });
    db.run("DROP TABLE index_meta;");
    db.run(
      "CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);",
    );
    db.run("INSERT INTO index_meta VALUES ('embedding_active_model', 'model-a', 11);");

    ensureEmbeddingIntegritySchema(db);

    expect(embeddingRows(db)).toEqual([{ id: "e-valid", chunkId: "c-1", model: "model-a" }]);
    expect(db.exec("SELECT key, value FROM index_meta ORDER BY key;")[0].values).toEqual([
      [EMBEDDING_DIMENSION_META_KEY, "4"],
      [EMBEDDING_MODEL_META_KEY, "model-a"],
    ]);
    expect(db.exec("PRAGMA table_info(embeddings);")[0].values.map((row) => row[2])).toContain(
      "INTEGER",
    );
    expect(db.exec("PRAGMA table_info(index_meta);")[0].values.map((row) => row[2])).toContain(
      "INTEGER",
    );
    db.close();
  });

  it("throws without changing an incompatible embeddings table when a required column is missing", () => {
    const db = freshDb();
    db.run("DROP TABLE embeddings;");
    db.run(
      "CREATE TABLE embeddings (id TEXT PRIMARY KEY, chunk_id TEXT, model TEXT, dimension INTEGER, created_at INTEGER);",
    );
    db.run("INSERT INTO embeddings VALUES ('e-1', 'c-1', 'model-a', 4, 1);");

    expect(() => ensureEmbeddingIntegritySchema(db)).toThrow(
      "missing required columns vector_blob",
    );
    expect(db.exec("SELECT * FROM embeddings;")[0].values).toEqual([
      ["e-1", "c-1", "model-a", 4, 1],
    ]);
    expect(db.exec("PRAGMA table_info(embeddings);")[0].values.map((row) => row[1])).toEqual([
      "id",
      "chunk_id",
      "model",
      "dimension",
      "created_at",
    ]);
    db.close();
  });

  it("throws without changing index metadata when a required column is missing", () => {
    const db = freshDb();
    db.run("DROP TABLE index_meta;");
    db.run("CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    db.run("INSERT INTO index_meta VALUES ('keep', 'me');");

    expect(() => ensureEmbeddingIntegritySchema(db)).toThrow("missing required columns updated_at");
    expect(db.exec("SELECT * FROM index_meta;")[0].values).toEqual([["keep", "me"]]);
    db.close();
  });

  it("runs idempotently through the application schema entrypoint", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", createdAt: 1 });
    insertEmbedding(db, { id: "e-2", chunkId: "c-1", createdAt: 2 });

    runSchema(db);
    const first = db.export();
    runSchema(db);

    expect(embeddingRows(db).map((row) => row.id)).toEqual(["e-2"]);
    expect(db.export()).toEqual(first);
    db.close();
  });

  it("replaces the current vector for a chunk through the unique chunk upsert", async () => {
    const db = new SQL.Database();
    runSchema(db);
    insertRepo(db);
    insertChunk(db, "c-1");
    const local = new LocalDatabase({
      sql: SQL,
      db,
      storageMode: "memory",
      scopeKey: "embedding-replace",
    });

    await local.upsertEmbeddings([
      {
        id: "e-old",
        chunkId: "c-1",
        model: "old-model",
        dimension: 4,
        vectorBlob: blobOfDimension(4, 1),
        createdAt: 1,
      },
    ]);
    await local.upsertEmbeddings([
      {
        id: "e-new",
        chunkId: "c-1",
        model: "new-model",
        dimension: 4,
        vectorBlob: blobOfDimension(4, 2),
        createdAt: 2,
      },
    ]);

    expect(embeddingRows(db)).toEqual([{ id: "e-new", chunkId: "c-1", model: "new-model" }]);
    expect(local.getEmbeddingCount()).toBe(1);
  });

  it("clears the durable reindex marker only through the explicit metadata mutation", async () => {
    const db = new SQL.Database();
    runSchema(db);
    insertRepo(db);
    insertChunk(db, "c-1");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", model: "model-a", dimension: 4 });
    setExpectedProfile(db, "model-a", "4");
    db.run("INSERT INTO index_meta (key, value, updated_at) VALUES (?, '1', 1);", [
      EMBEDDING_REINDEX_REQUIRED_META_KEY,
    ]);
    const local = new LocalDatabase({
      sql: SQL,
      db,
      storageMode: "memory",
      scopeKey: "embedding-reindex-marker",
    });

    expect(local.getEmbeddingHealth().issues).toEqual(["reindex_required"]);
    await local.clearIndexMetaValue(EMBEDDING_REINDEX_REQUIRED_META_KEY);
    expect(local.getEmbeddingHealth().status).toBe("ready");
  });

  it("rejects non-integer dimensions and vector blobs whose length disagrees", async () => {
    const db = new SQL.Database();
    runSchema(db);
    insertRepo(db);
    insertChunk(db, "c-1");
    const local = new LocalDatabase({
      sql: SQL,
      db,
      storageMode: "memory",
      scopeKey: "embedding-validation",
    });

    await expect(
      local.upsertEmbeddings([
        {
          id: "e-fraction",
          chunkId: "c-1",
          model: "model-a",
          dimension: 1.5,
          vectorBlob: blobOfDimension(1),
          createdAt: 1,
        },
      ]),
    ).rejects.toThrow("Invalid embedding dimension");
    await expect(
      local.upsertEmbeddings([
        {
          id: "e-short",
          chunkId: "c-1",
          model: "model-a",
          dimension: 4,
          vectorBlob: blobOfDimension(3),
          createdAt: 1,
        },
      ]),
    ).rejects.toThrow("Invalid embedding vector length");
    await expect(
      local.upsertEmbeddings([
        {
          id: "e-fractional-time",
          chunkId: "c-1",
          model: "model-a",
          dimension: 4,
          vectorBlob: blobOfDimension(4),
          createdAt: 1.5,
        },
      ]),
    ).rejects.toThrow("Invalid embedding created_at");
    expect(local.getEmbeddingCount()).toBe(0);
  });
});

describe("getEmbeddingHealth", () => {
  it("reports empty when there are no chunks or embeddings", () => {
    const db = freshDb();
    const health = getEmbeddingHealth(db);
    expect(health.status).toBe("empty");
    expect(health.issues).toEqual([]);
    db.close();
  });

  it("reports ready when every chunk has exactly one valid vector of a single model and dimension", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertChunk(db, "c-2");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", model: "model-a", dimension: 4 });
    insertEmbedding(db, { id: "e-2", chunkId: "c-2", model: "model-a", dimension: 4 });
    setExpectedProfile(db, "model-a", "4");

    const health = getEmbeddingHealth(db);
    expect(health.status).toBe("ready");
    expect(health.issues).toEqual([]);
    expect(health.model).toBe("model-a");
    expect(health.dimension).toBe(4);
    expect(health.expectedDimension).toBe(4);
    expect(health.coveredChunkCount).toBe(2);
    db.close();
  });

  it("reports invalid, orphan, and duplicate vectors instead of treating positive counts as ready", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", createdAt: 1 });
    insertEmbedding(db, { id: "e-duplicate", chunkId: "c-1", createdAt: 2 });
    insertChunk(db, "c-invalid");
    insertEmbedding(db, {
      id: "e-invalid",
      chunkId: "c-invalid",
      dimension: 4,
      blob: blobOfDimension(3),
    });
    db.run("PRAGMA foreign_keys = OFF;");
    insertEmbedding(db, { id: "e-orphan", chunkId: "missing" });
    db.run("PRAGMA foreign_keys = ON;");

    const health = getEmbeddingHealth(db);
    expect(health.status).toBe("degraded");
    expect(health.issues).toEqual(
      expect.arrayContaining([
        "invalid_vectors",
        "orphan_vectors",
        "duplicate_vectors",
        "missing_coverage",
      ]),
    );
    expect(health.embeddingCount).toBe(4);
    expect(health.validEmbeddingCount).toBe(2);
    expect(health.coveredChunkCount).toBe(1);
    db.close();
  });

  it("reports degraded with missing_coverage when a chunk lacks a vector", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertChunk(db, "c-2");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1" });

    const health = getEmbeddingHealth(db);
    expect(health.status).toBe("degraded");
    expect(health.issues).toContain("missing_coverage");
    db.close();
  });

  it("reports degraded when vectors exist without expected model metadata", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", model: "model-a" });

    const health = getEmbeddingHealth(db);
    expect(health.status).toBe("degraded");
    expect(health.issues).toContain("missing_model_metadata");
    db.close();
  });

  it("reports degraded when expected dimension metadata is missing", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", model: "model-a", dimension: 4 });
    db.run("INSERT INTO index_meta (key, value, updated_at) VALUES (?, ?, 1);", [
      EMBEDDING_MODEL_META_KEY,
      "model-a",
    ]);

    const health = getEmbeddingHealth(db);
    expect(health.status).toBe("degraded");
    expect(health.issues).toContain("missing_dimension_metadata");
    expect(health.expectedDimension).toBeNull();
    db.close();
  });

  it("reports degraded when expected dimension metadata is invalid", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", model: "model-a", dimension: 4 });
    setExpectedProfile(db, "model-a", "4.5");

    const health = getEmbeddingHealth(db);
    expect(health.status).toBe("degraded");
    expect(health.issues).toContain("invalid_dimension_metadata");
    expect(health.expectedDimension).toBeNull();
    db.close();
  });

  it("reports degraded when a uniform vector dimension mismatches expected metadata", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertChunk(db, "c-2");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", model: "model-a", dimension: 8 });
    insertEmbedding(db, { id: "e-2", chunkId: "c-2", model: "model-a", dimension: 8 });
    setExpectedProfile(db, "model-a", "4");

    const health = getEmbeddingHealth(db);
    expect(health.status).toBe("degraded");
    expect(health.issues).toContain("dimension_mismatch");
    expect(health.dimension).toBe(8);
    expect(health.expectedDimension).toBe(4);
    db.close();
  });

  it("rejects a corrupt text timestamp from valid coverage and readiness", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    db.run(
      "INSERT INTO embeddings (id, chunk_id, model, dimension, vector_blob, created_at) VALUES (?, ?, ?, ?, ?, ?);",
      ["e-corrupt", "c-1", "model-a", 4, blobOfDimension(4), "zzzz"],
    );
    setExpectedProfile(db, "model-a", "4");

    const health = getEmbeddingHealth(db);
    expect(health.status).toBe("degraded");
    expect(health.issues).toContain("invalid_vectors");
    expect(health.issues).toContain("missing_coverage");
    expect(health.validEmbeddingCount).toBe(0);
    db.close();
  });

  it("reports degraded with mixed_models when vectors span multiple models", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertChunk(db, "c-2");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", model: "model-a" });
    insertEmbedding(db, { id: "e-2", chunkId: "c-2", model: "model-b" });

    const health = getEmbeddingHealth(db);
    expect(health.status).toBe("degraded");
    expect(health.issues).toContain("mixed_models");
    expect(health.model).toBeNull();
    db.close();
  });

  it("reports degraded with mixed_dimensions when vectors span multiple dimensions", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertChunk(db, "c-2");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", dimension: 4 });
    insertEmbedding(db, { id: "e-2", chunkId: "c-2", dimension: 8 });

    const health = getEmbeddingHealth(db);
    expect(health.status).toBe("degraded");
    expect(health.issues).toContain("mixed_dimensions");
    expect(health.dimension).toBeNull();
    db.close();
  });

  it("reports degraded with model_mismatch when expected metadata differs from the stored model", () => {
    const db = freshDb();
    insertRepo(db);
    insertChunk(db, "c-1");
    insertEmbedding(db, { id: "e-1", chunkId: "c-1", model: "model-a" });
    db.run("INSERT INTO index_meta (key, value, updated_at) VALUES (?, ?, 1);", [
      EMBEDDING_MODEL_META_KEY,
      "model-expected",
    ]);

    const health = getEmbeddingHealth(db);
    expect(health.status).toBe("degraded");
    expect(health.issues).toContain("model_mismatch");
    expect(health.expectedModel).toBe("model-expected");
    db.close();
  });
});
