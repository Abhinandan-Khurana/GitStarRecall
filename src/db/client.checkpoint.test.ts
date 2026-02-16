import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";
import { LocalDatabase, runSchema } from "./client";
import type { EmbeddingRecord } from "./types";

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => `node_modules/sql.js/dist/${file}`,
  });
});

function createLocalDatabase(database: Database, everyEmbeddings: number, everyMs: number): LocalDatabase {
  return new LocalDatabase({
    sql: SQL,
    db: database,
    storageMode: "memory",
    embeddingCheckpointPolicy: {
      everyEmbeddings,
      everyMs,
    },
  });
}

function vectorBlobFromNumber(seed: number): Uint8Array {
  const vec = new Float32Array([seed, seed + 0.5, seed + 1, seed + 1.5]);
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

function makeEmbedding(chunkId: string, seed: number): EmbeddingRecord {
  return {
    id: `emb-${chunkId}`,
    chunkId,
    model: "test-model",
    dimension: 4,
    vectorBlob: vectorBlobFromNumber(seed),
    createdAt: Date.now(),
  };
}

describe("LocalDatabase embedding checkpoint policy", () => {
  it("flushes automatically when pending embeddings reach threshold", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb, 3, 60_000);

    await localDb.upsertRepos([
      {
        id: 1,
        fullName: "acme/repo",
        name: "repo",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/repo",
        stars: 1,
        forks: 0,
        updatedAt: "2026-02-16T00:00:00Z",
        readmeUrl: null,
        readmeText: null,
        checksum: "c1",
        lastSyncedAt: Date.now(),
      },
    ]);

    await localDb.upsertChunks([
      { id: "c1", repoId: 1, chunkId: "c1", text: "one", source: "readme", createdAt: Date.now() },
      { id: "c2", repoId: 1, chunkId: "c2", text: "two", source: "readme", createdAt: Date.now() },
      { id: "c3", repoId: 1, chunkId: "c3", text: "three", source: "readme", createdAt: Date.now() },
    ]);

    await localDb.upsertEmbeddings([makeEmbedding("c1", 1)]);
    const statusAfterOne = localDb.getEmbeddingCheckpointStatus();
    expect(statusAfterOne.pendingEmbeddings).toBe(1);
    expect(statusAfterOne.lastCheckpointAt).toBeNull();

    await localDb.upsertEmbeddings([makeEmbedding("c2", 2), makeEmbedding("c3", 3)]);
    const statusAfterThreshold = localDb.getEmbeddingCheckpointStatus();
    expect(statusAfterThreshold.pendingEmbeddings).toBe(0);
    expect(statusAfterThreshold.lastCheckpointAt).not.toBeNull();
  });

  it("flushes pending embeddings when explicitly requested", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb, 999, 60_000);

    await localDb.upsertRepos([
      {
        id: 10,
        fullName: "acme/repo-two",
        name: "repo-two",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/repo-two",
        stars: 1,
        forks: 0,
        updatedAt: "2026-02-16T00:00:00Z",
        readmeUrl: null,
        readmeText: null,
        checksum: "c2",
        lastSyncedAt: Date.now(),
      },
    ]);

    await localDb.upsertChunks([
      { id: "x1", repoId: 10, chunkId: "x1", text: "alpha", source: "readme", createdAt: Date.now() },
    ]);

    await localDb.upsertEmbeddings([makeEmbedding("x1", 10)]);
    const beforeFlush = localDb.getEmbeddingCheckpointStatus();
    expect(beforeFlush.pendingEmbeddings).toBe(1);
    expect(beforeFlush.lastCheckpointAt).toBeNull();

    const flushed = await localDb.flushPendingEmbeddingCheckpoint();
    expect(flushed).toBe(true);

    const afterFlush = localDb.getEmbeddingCheckpointStatus();
    expect(afterFlush.pendingEmbeddings).toBe(0);
    expect(afterFlush.lastCheckpointAt).not.toBeNull();
  });
});

