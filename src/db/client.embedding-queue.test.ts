import initSqlJs, { type SqlJsStatic } from "sql.js";
import { beforeAll, describe, expect, test } from "vitest";
import { LocalDatabase, runSchema } from "./client";

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => `node_modules/sql.js/dist/${file}`,
  });
});

function createDatabase(): LocalDatabase {
  const rawDb = new SQL.Database();
  runSchema(rawDb);
  return new LocalDatabase({
    sql: SQL,
    db: rawDb,
    storageMode: "memory",
  });
}

describe("LocalDatabase pending embedding queue", () => {
  test("upserts embeddings before a legacy database has a unique chunk index", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    rawDb.run("DROP INDEX idx_embeddings_chunk_id_unique;");
    rawDb.run(`
      INSERT INTO repos (
        id, full_name, name, topics_json, html_url, stars, forks, updated_at, last_synced_at
      ) VALUES (1, 'repo/legacy', 'legacy', '[]', 'https://github.com/repo/legacy', 0, 0, '2026-01-01', 1);
    `);
    rawDb.run(
      "INSERT INTO chunks (id, repo_id, chunk_id, text, source, created_at) VALUES ('c-legacy', 1, 'c-legacy', 'legacy', 'readme', 1);",
    );
    rawDb.run(
      "INSERT INTO embeddings (id, chunk_id, model, dimension, vector_blob, created_at) VALUES (?, ?, ?, ?, ?, ?);",
      ["e-old", "c-legacy", "old-model", 2, new Uint8Array(new Float32Array([1, 2]).buffer), 1],
    );
    const database = new LocalDatabase({ sql: SQL, db: rawDb, storageMode: "memory" });

    await database.upsertEmbeddings([
      {
        id: "e-new",
        chunkId: "c-legacy",
        model: "new-model",
        dimension: 2,
        vectorBlob: new Uint8Array(new Float32Array([3, 4]).buffer),
        createdAt: 2,
      },
    ]);

    expect(rawDb.exec("SELECT id, model FROM embeddings;")[0]?.values).toEqual([
      ["e-new", "new-model"],
    ]);
  });

  test("lists pending chunks in created_at order and excludes embedded chunks", async () => {
    const database = createDatabase();
    const now = Date.now();
    await database.upsertRepos([
      {
        id: 1,
        fullName: "a/one",
        name: "one",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/a/one",
        stars: 10,
        forks: 1,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "alpha",
        checksum: "1",
        lastSyncedAt: now,
      },
      {
        id: 2,
        fullName: "b/two",
        name: "two",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/b/two",
        stars: 20,
        forks: 2,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "beta",
        checksum: "2",
        lastSyncedAt: now,
      },
    ]);
    await database.upsertChunks([
      { id: "c-1", repoId: 1, chunkId: "c-1", text: "one", source: "readme", createdAt: now + 1 },
      { id: "c-2", repoId: 2, chunkId: "c-2", text: "two", source: "readme", createdAt: now + 2 },
      { id: "c-3", repoId: 1, chunkId: "c-3", text: "three", source: "readme", createdAt: now + 3 },
    ]);
    await database.upsertEmbeddings([
      {
        id: "e-1",
        chunkId: "c-2",
        model: "mini",
        dimension: 3,
        vectorBlob: new Uint8Array(new Float32Array([1, 2, 3]).buffer),
        createdAt: now + 10,
      },
    ]);

    const pending = database.listPendingChunksForEmbedding();
    expect(pending.map((chunk) => chunk.id)).toEqual(["c-1", "c-3"]);
    expect(database.getPendingEmbeddingChunkCount()).toBe(2);
  });

  test("clearEmbeddings removes vectors and repopulates pending queue", async () => {
    const database = createDatabase();
    const now = Date.now();
    await database.upsertRepos([
      {
        id: 1,
        fullName: "repo/one",
        name: "one",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/repo/one",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "alpha",
        checksum: "one",
        lastSyncedAt: now,
      },
    ]);
    await database.upsertChunks([
      { id: "c-1", repoId: 1, chunkId: "c-1", text: "one", source: "readme", createdAt: now + 1 },
      { id: "c-2", repoId: 1, chunkId: "c-2", text: "two", source: "readme", createdAt: now + 2 },
    ]);
    await database.upsertEmbeddings([
      {
        id: "e-1",
        chunkId: "c-1",
        model: "mini",
        dimension: 3,
        vectorBlob: new Uint8Array(new Float32Array([1, 2, 3]).buffer),
        createdAt: now + 10,
      },
      {
        id: "e-2",
        chunkId: "c-2",
        model: "mini",
        dimension: 3,
        vectorBlob: new Uint8Array(new Float32Array([4, 5, 6]).buffer),
        createdAt: now + 11,
      },
    ]);

    expect(database.getEmbeddingCount()).toBe(2);
    await database.clearEmbeddings();
    expect(database.getEmbeddingCount()).toBe(0);
    expect(database.getPendingEmbeddingChunkCount()).toBe(2);
    expect(database.listPendingChunksForEmbedding().map((chunk) => chunk.id)).toEqual([
      "c-1",
      "c-2",
    ]);
  });
});
