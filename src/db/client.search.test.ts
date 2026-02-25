import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";
import { LocalDatabase, runSchema } from "./client";

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => `node_modules/sql.js/dist/${file}`,
  });
});

function createLocalDatabase(database: Database): LocalDatabase {
  return new LocalDatabase({ sql: SQL, db: database, storageMode: "memory" });
}

function toBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

describe("LocalDatabase semantic search", () => {
  it("returns hydrated results for top chunk matches", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb);

    await localDb.upsertRepos([
      {
        id: 1,
        fullName: "acme/graphql-security",
        name: "graphql-security",
        description: "GraphQL security tests and fuzzing",
        topics: ["graphql", "security", "testing"],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/graphql-security",
        stars: 42,
        forks: 8,
        updatedAt: "2026-02-16T00:00:00Z",
        readmeUrl: "https://github.com/acme/graphql-security/blob/main/README.md",
        readmeText: "GraphQL security tests with payloads and scanners",
        checksum: "checksum-1",
        lastSyncedAt: Date.now(),
      },
    ]);

    await localDb.upsertChunks([
      {
        id: "chunk-1",
        repoId: 1,
        chunkId: "chunk-1",
        text: "GraphQL security tests and introspection hardening",
        source: "readme",
        createdAt: Date.now(),
      },
    ]);

    const vector = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    await localDb.upsertEmbeddings([
      {
        id: "embedding-1",
        chunkId: "chunk-1",
        model: "test-model",
        dimension: vector.length,
        vectorBlob: toBlob(vector),
        createdAt: Date.now(),
      },
    ]);

    const results = await localDb.findSimilarChunks(new Float32Array([0.1, 0.2, 0.3, 0.4]), 10);
    expect(results).toHaveLength(1);
    expect(results[0]?.chunkId).toBe("chunk-1");
    expect(results[0]?.repoFullName).toBe("acme/graphql-security");
  });

  it("searchV2 returns diversified top results across repositories", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb);
    const now = Date.now();

    await localDb.upsertRepos([
      {
        id: 10,
        fullName: "a/alpha",
        name: "alpha",
        description: "alpha repo",
        topics: ["security"],
        language: "TypeScript",
        htmlUrl: "https://github.com/a/alpha",
        stars: 1,
        forks: 0,
        updatedAt: "2026-02-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "alpha",
        checksum: "alpha",
        lastSyncedAt: now,
      },
      {
        id: 20,
        fullName: "b/beta",
        name: "beta",
        description: "beta repo",
        topics: ["security"],
        language: "TypeScript",
        htmlUrl: "https://github.com/b/beta",
        stars: 1,
        forks: 0,
        updatedAt: "2026-02-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "beta",
        checksum: "beta",
        lastSyncedAt: now,
      },
    ]);

    await localDb.upsertChunks([
      { id: "c-10-1", repoId: 10, chunkId: "c-10-1", text: "alpha match 1", source: "readme", createdAt: now + 1 },
      { id: "c-10-2", repoId: 10, chunkId: "c-10-2", text: "alpha match 2", source: "readme", createdAt: now + 2 },
      { id: "c-10-3", repoId: 10, chunkId: "c-10-3", text: "alpha match 3", source: "readme", createdAt: now + 3 },
      { id: "c-20-1", repoId: 20, chunkId: "c-20-1", text: "beta match 1", source: "readme", createdAt: now + 4 },
    ]);

    await localDb.upsertEmbeddings([
      {
        id: "e-10-1",
        chunkId: "c-10-1",
        model: "Xenova/bge-base-en-v1.5",
        dimension: 4,
        vectorBlob: toBlob(new Float32Array([1, 0, 0, 0])),
        createdAt: now + 10,
      },
      {
        id: "e-10-2",
        chunkId: "c-10-2",
        model: "Xenova/bge-base-en-v1.5",
        dimension: 4,
        vectorBlob: toBlob(new Float32Array([0.98, 0.01, 0.01, 0])),
        createdAt: now + 11,
      },
      {
        id: "e-10-3",
        chunkId: "c-10-3",
        model: "Xenova/bge-base-en-v1.5",
        dimension: 4,
        vectorBlob: toBlob(new Float32Array([0.97, 0.02, 0.01, 0])),
        createdAt: now + 12,
      },
      {
        id: "e-20-1",
        chunkId: "c-20-1",
        model: "Xenova/bge-base-en-v1.5",
        dimension: 4,
        vectorBlob: toBlob(new Float32Array([0.92, 0.06, 0.02, 0])),
        createdAt: now + 13,
      },
    ]);

    await localDb.rebuildRepoCentroids({
      repoIds: [10, 20],
      model: "Xenova/bge-base-en-v1.5",
      dimension: 4,
    });

    const results = await localDb.searchV2({
      queryVector: new Float32Array([1, 0, 0, 0]),
      model: "Xenova/bge-base-en-v1.5",
      dimension: 4,
      topK: 4,
      candidateRepoLimit: 2,
      rerankLimit: 4,
      perRepoCap: 2,
    });

    expect(results.length).toBeGreaterThan(1);
    const repoIds = new Set(results.map((item) => item.repoId));
    expect(repoIds.has(10)).toBe(true);
    expect(repoIds.has(20)).toBe(true);
  });
});
