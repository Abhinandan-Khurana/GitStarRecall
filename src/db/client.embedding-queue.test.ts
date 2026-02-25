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

function makeVectorBlob(dimension: number): Uint8Array {
  const vector = new Float32Array(dimension);
  for (let i = 0; i < dimension; i += 1) {
    vector[i] = (i + 1) / dimension;
  }
  return new Uint8Array(vector.buffer);
}

describe("LocalDatabase pending embedding queue", () => {
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
    expect(database.listPendingChunksForEmbedding().map((chunk) => chunk.id)).toEqual(["c-1", "c-2"]);
  });

  test("getDistinctEmbeddingModels returns unique models in stable order", async () => {
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
      {
        id: 2,
        fullName: "repo/two",
        name: "two",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/repo/two",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "beta",
        checksum: "two",
        lastSyncedAt: now,
      },
    ]);
    await database.upsertChunks([
      { id: "c-1", repoId: 1, chunkId: "c-1", text: "one", source: "readme", createdAt: now + 1 },
      { id: "c-2", repoId: 2, chunkId: "c-2", text: "two", source: "readme", createdAt: now + 2 },
      { id: "c-3", repoId: 2, chunkId: "c-3", text: "three", source: "readme", createdAt: now + 3 },
    ]);
    await database.upsertEmbeddings([
      {
        id: "e-1",
        chunkId: "c-1",
        model: "Xenova/all-MiniLM-L6-v2",
        dimension: 384,
        vectorBlob: makeVectorBlob(384),
        createdAt: now + 10,
      },
      {
        id: "e-2",
        chunkId: "c-2",
        model: "Xenova/bge-base-en-v1.5",
        dimension: 768,
        vectorBlob: makeVectorBlob(768),
        createdAt: now + 11,
      },
      {
        id: "e-3",
        chunkId: "c-3",
        model: "Xenova/all-MiniLM-L6-v2",
        dimension: 384,
        vectorBlob: makeVectorBlob(384),
        createdAt: now + 12,
      },
    ]);

    expect(database.getDistinctEmbeddingModels()).toEqual([
      "Xenova/all-MiniLM-L6-v2",
      "Xenova/bge-base-en-v1.5",
    ]);
    expect(database.getDistinctEmbeddingDimensions()).toEqual([384, 768]);
    expect(database.getEmbeddingDimensionHistogram("Xenova/all-MiniLM-L6-v2")).toEqual([
      { dimension: 384, count: 2 },
    ]);
  });

  test("assertSearchCompatible rejects mixed dimensions", async () => {
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
        model: "Xenova/bge-base-en-v1.5",
        dimension: 384,
        vectorBlob: new Uint8Array(new Float32Array(Array(384).fill(0).map((_, i) => i / 384)).buffer),
        createdAt: now + 10,
      },
      {
        id: "e-2",
        chunkId: "c-2",
        model: "Xenova/bge-base-en-v1.5",
        dimension: 768,
        vectorBlob: new Uint8Array(new Float32Array(Array(768).fill(0).map((_, i) => i / 768)).buffer),
        createdAt: now + 11,
      },
    ]);

    expect(() =>
      database.assertSearchCompatible(
        { model: "Xenova/bge-base-en-v1.5", dimension: 768 },
        768,
      )).toThrow("mixed dimensions");
  });

  test("upsertEmbeddings rejects malformed vector size", async () => {
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
    ]);

    await expect(
      database.upsertEmbeddings([
        {
          id: "e-1",
          chunkId: "c-1",
          model: "Xenova/bge-base-en-v1.5",
          dimension: 4,
          vectorBlob: new Uint8Array(new Float32Array([1, 2, 3]).buffer),
          createdAt: now + 10,
        },
      ]),
    ).rejects.toThrow("vector blob length");
  });
});
