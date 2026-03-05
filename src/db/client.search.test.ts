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

  it("throws on query/index embedding dimension mismatch", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb);

    await localDb.upsertRepos([
      {
        id: 1,
        fullName: "acme/a",
        name: "a",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/a",
        stars: 1,
        forks: 1,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "hello",
        checksum: "x",
        lastSyncedAt: Date.now(),
      },
    ]);
    await localDb.upsertChunks([
      { id: "c1", repoId: 1, chunkId: "c1", text: "hello world", source: "readme", createdAt: Date.now() },
    ]);
    await localDb.upsertEmbeddings([
      {
        id: "e1",
        chunkId: "c1",
        model: "test-model",
        dimension: 3,
        vectorBlob: toBlob(new Float32Array([0.1, 0.2, 0.3])),
        createdAt: Date.now(),
      },
    ]);

    await expect(localDb.findSimilarChunks(new Float32Array([0.1, 0.2]), 10)).rejects.toThrow(
      "Embedding dimension mismatch",
    );
  });

  it("returns dominant embedding model for metadata repair", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb);

    await localDb.upsertRepos([
      {
        id: 1,
        fullName: "acme/a",
        name: "a",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/a",
        stars: 1,
        forks: 1,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "hello",
        checksum: "x",
        lastSyncedAt: Date.now(),
      },
    ]);
    await localDb.upsertChunks([
      { id: "c1", repoId: 1, chunkId: "c1", text: "hello world", source: "readme", createdAt: Date.now() },
      { id: "c2", repoId: 1, chunkId: "c2", text: "second", source: "readme", createdAt: Date.now() + 1 },
      { id: "c3", repoId: 1, chunkId: "c3", text: "third", source: "readme", createdAt: Date.now() + 2 },
    ]);
    await localDb.upsertEmbeddings([
      {
        id: "e1",
        chunkId: "c1",
        model: "mxbai-embed-large:latest",
        dimension: 3,
        vectorBlob: toBlob(new Float32Array([0.1, 0.2, 0.3])),
        createdAt: Date.now(),
      },
      {
        id: "e2",
        chunkId: "c2",
        model: "mxbai-embed-large:latest",
        dimension: 3,
        vectorBlob: toBlob(new Float32Array([0.1, 0.2, 0.3])),
        createdAt: Date.now(),
      },
      {
        id: "e3",
        chunkId: "c3",
        model: "Xenova/all-MiniLM-L6-v2",
        dimension: 3,
        vectorBlob: toBlob(new Float32Array([0.2, 0.2, 0.1])),
        createdAt: Date.now(),
      },
    ]);

    expect(localDb.getDominantEmbeddingModel()).toBe("mxbai-embed-large:latest");
  });

  it("returns finite scores when index contains zero-norm vectors", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb);

    await localDb.upsertRepos([
      {
        id: 1,
        fullName: "acme/zero",
        name: "zero",
        description: "zero norm vectors",
        topics: ["test"],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/zero",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "legacyneedle",
        checksum: "zero-1",
        lastSyncedAt: Date.now(),
      },
    ]);
    await localDb.upsertChunks([
      {
        id: "zero-chunk",
        repoId: 1,
        chunkId: "zero-chunk",
        text: "legacyneedle",
        source: "readme",
        createdAt: 1,
      },
    ]);
    await localDb.upsertEmbeddings([
      {
        id: "zero-embedding",
        chunkId: "zero-chunk",
        model: "test-model",
        dimension: 3,
        vectorBlob: toBlob(new Float32Array([0, 0, 0])),
        createdAt: 1,
      },
    ]);

    const results = await localDb.findSimilarChunks(new Float32Array([1, 0, 0]), 10, { queryText: "legacyneedle" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((item) => Number.isFinite(item.score))).toBe(true);
  });

  it("does not trigger lexical safety-net for tiny corpus when dense confidence is high", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb);

    await localDb.upsertRepos([
      {
        id: 1,
        fullName: "acme/r1",
        name: "r1",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/r1",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "alpha",
        checksum: "a",
        lastSyncedAt: 1,
      },
      {
        id: 2,
        fullName: "acme/r2",
        name: "r2",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/r2",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "beta",
        checksum: "b",
        lastSyncedAt: 1,
      },
      {
        id: 3,
        fullName: "acme/r3",
        name: "r3",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/r3",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "gamma",
        checksum: "c",
        lastSyncedAt: 1,
      },
    ]);

    await localDb.upsertChunks([
      {
        id: "c1",
        repoId: 1,
        chunkId: "c1",
        text: "alpha/v1.2.3 build:2026 dense hit",
        source: "readme",
        createdAt: 1,
      },
      { id: "c2", repoId: 2, chunkId: "c2", text: "beta dense hit", source: "readme", createdAt: 2 },
      { id: "c3", repoId: 3, chunkId: "c3", text: "gamma dense hit", source: "readme", createdAt: 3 },
    ]);
    await localDb.upsertEmbeddings([
      { id: "e1", chunkId: "c1", model: "test-model", dimension: 3, vectorBlob: toBlob(new Float32Array([1, 0, 0])), createdAt: 1 },
      { id: "e2", chunkId: "c2", model: "test-model", dimension: 3, vectorBlob: toBlob(new Float32Array([0.2, 0.8, 0])), createdAt: 2 },
      { id: "e3", chunkId: "c3", model: "test-model", dimension: 3, vectorBlob: toBlob(new Float32Array([0.1, 0.1, 0.9])), createdAt: 3 },
    ]);

    let diagnosticsTriggered = true;
    await localDb.findSimilarChunks(new Float32Array([1, 0, 0]), 10, {
      queryText: "alpha",
      onDiagnostics(payload) {
        diagnosticsTriggered = payload.lexicalTriggered;
      },
    });

    expect(diagnosticsTriggered).toBe(false);
  });

  it("keeps denseSuspicious and lexicalTriggered distinct for rare-token-triggered lexical branch", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb);

    await localDb.upsertRepos([
      {
        id: 1,
        fullName: "acme/r1",
        name: "r1",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/r1",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "alpha",
        checksum: "a",
        lastSyncedAt: 1,
      },
      {
        id: 2,
        fullName: "acme/r2",
        name: "r2",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/r2",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "beta",
        checksum: "b",
        lastSyncedAt: 1,
      },
      {
        id: 3,
        fullName: "acme/r3",
        name: "r3",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/r3",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "gamma",
        checksum: "c",
        lastSyncedAt: 1,
      },
    ]);

    await localDb.upsertChunks([
      {
        id: "c1",
        repoId: 1,
        chunkId: "c1",
        text: "alpha/v1.2.3 build:2026 dense hit",
        source: "readme",
        createdAt: 1,
      },
      { id: "c2", repoId: 2, chunkId: "c2", text: "beta dense hit", source: "readme", createdAt: 2 },
      { id: "c3", repoId: 3, chunkId: "c3", text: "gamma dense hit", source: "readme", createdAt: 3 },
    ]);
    await localDb.upsertEmbeddings([
      { id: "e1", chunkId: "c1", model: "test-model", dimension: 3, vectorBlob: toBlob(new Float32Array([1, 0, 0])), createdAt: 1 },
      { id: "e2", chunkId: "c2", model: "test-model", dimension: 3, vectorBlob: toBlob(new Float32Array([0.2, 0.8, 0])), createdAt: 2 },
      { id: "e3", chunkId: "c3", model: "test-model", dimension: 3, vectorBlob: toBlob(new Float32Array([0.1, 0.1, 0.9])), createdAt: 3 },
    ]);

    let lexicalTriggered = false;
    let denseSuspicious = true;
    let reason: string | null = null;
    await localDb.findSimilarChunks(new Float32Array([1, 1, 0]), 10, {
      queryText: "alpha/v1.2.3 build:2026",
      onDiagnostics(payload) {
        lexicalTriggered = payload.lexicalTriggered;
        denseSuspicious = payload.denseSuspicious;
        reason = payload.lexicalTriggerReason;
      },
    });

    expect(lexicalTriggered).toBe(true);
    expect(denseSuspicious).toBe(false);
    expect(reason).toBe("rare_token_query");
  });

  it("skips rare-token lexical trigger when dense top-1 is highly confident", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb);

    await localDb.upsertRepos([
      {
        id: 1,
        fullName: "acme/r1",
        name: "r1",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/r1",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "alpha",
        checksum: "a",
        lastSyncedAt: 1,
      },
      {
        id: 2,
        fullName: "acme/r2",
        name: "r2",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/r2",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "beta",
        checksum: "b",
        lastSyncedAt: 1,
      },
      {
        id: 3,
        fullName: "acme/r3",
        name: "r3",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/r3",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "gamma",
        checksum: "c",
        lastSyncedAt: 1,
      },
    ]);

    await localDb.upsertChunks([
      {
        id: "c1",
        repoId: 1,
        chunkId: "c1",
        text: "alpha/v1.2.3 build:2026 dense hit",
        source: "readme",
        createdAt: 1,
      },
      { id: "c2", repoId: 2, chunkId: "c2", text: "beta dense hit", source: "readme", createdAt: 2 },
      { id: "c3", repoId: 3, chunkId: "c3", text: "gamma dense hit", source: "readme", createdAt: 3 },
    ]);
    await localDb.upsertEmbeddings([
      { id: "e1", chunkId: "c1", model: "test-model", dimension: 3, vectorBlob: toBlob(new Float32Array([1, 0, 0])), createdAt: 1 },
      { id: "e2", chunkId: "c2", model: "test-model", dimension: 3, vectorBlob: toBlob(new Float32Array([0.2, 0.8, 0])), createdAt: 2 },
      { id: "e3", chunkId: "c3", model: "test-model", dimension: 3, vectorBlob: toBlob(new Float32Array([0.1, 0.1, 0.9])), createdAt: 3 },
    ]);

    let lexicalTriggered = true;
    let reason: string | null = "rare_token_query";
    await localDb.findSimilarChunks(new Float32Array([1, 0, 0]), 10, {
      queryText: "alpha/v1.2.3 build:2026",
      onDiagnostics(payload) {
        lexicalTriggered = payload.lexicalTriggered;
        reason = payload.lexicalTriggerReason;
      },
    });

    expect(lexicalTriggered).toBe(false);
    expect(reason).toBeNull();
  });

  it("lexical safety-net can recover relevant older chunks from outside the recent window", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb);

    await localDb.upsertRepos([
      {
        id: 1,
        fullName: "acme/legacy",
        name: "legacy",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/legacy",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "legacyneedle",
        checksum: "legacy",
        lastSyncedAt: 1,
      },
      {
        id: 2,
        fullName: "acme/recent",
        name: "recent",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/recent",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "recent",
        checksum: "recent",
        lastSyncedAt: 1,
      },
    ]);

    await localDb.upsertChunks([
      {
        id: "legacy-0",
        repoId: 1,
        chunkId: "legacy-0",
        text: "legacy/needle v1.2.3 retrieval target",
        source: "readme",
        createdAt: 1,
      },
    ]);
    await localDb.upsertEmbeddings([
      {
        id: "legacy-e0",
        chunkId: "legacy-0",
        model: "test-model",
        dimension: 3,
        vectorBlob: toBlob(new Float32Array([-1, 0, 0])),
        createdAt: 1,
      },
    ]);

    const recentChunks: Array<{
      id: string;
      repoId: number;
      chunkId: string;
      text: string;
      source: string;
      createdAt: number;
    }> = [];
    const recentEmbeddings: Array<{
      id: string;
      chunkId: string;
      model: string;
      dimension: number;
      vectorBlob: Uint8Array;
      createdAt: number;
    }> = [];

    for (let i = 0; i < 4300; i += 1) {
      const id = `recent-${i}`;
      recentChunks.push({
        id,
        repoId: 2,
        chunkId: id,
        text: `unrelated text ${i}`,
        source: "readme",
        createdAt: 10 + i,
      });
      recentEmbeddings.push({
        id: `recent-e-${i}`,
        chunkId: id,
        model: "test-model",
        dimension: 3,
        vectorBlob: toBlob(new Float32Array([1, 0, 0])),
        createdAt: 10 + i,
      });
    }

    await localDb.upsertChunks(recentChunks);
    await localDb.upsertEmbeddings(recentEmbeddings);

    const results = await localDb.findSimilarChunks(new Float32Array([1, 0, 0]), 20, {
      queryText: "legacy/needle v1.2.3",
    });
    expect(results.some((item) => item.chunkId === "legacy-0")).toBe(true);
  });

  it("uses fused relevance in MMR so lexical-only candidates remain competitive", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const localDb = createLocalDatabase(rawDb);

    const now = Date.now();
    await localDb.upsertRepos([
      {
        id: 1,
        fullName: "acme/dense-1",
        name: "dense-1",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/dense-1",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "dense alpha",
        checksum: "dense-1",
        lastSyncedAt: now,
      },
      {
        id: 2,
        fullName: "acme/dense-2",
        name: "dense-2",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/dense-2",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "dense beta",
        checksum: "dense-2",
        lastSyncedAt: now + 1,
      },
      {
        id: 3,
        fullName: "acme/dense-3",
        name: "dense-3",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/dense-3",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "dense gamma",
        checksum: "dense-3",
        lastSyncedAt: now + 2,
      },
      {
        id: 4,
        fullName: "acme/lexical",
        name: "lexical",
        description: null,
        topics: [],
        language: "TypeScript",
        htmlUrl: "https://github.com/acme/lexical",
        stars: 1,
        forks: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: null,
        readmeText: "pkg/foo:v1.2.3 sha256:abcd retrieval target",
        checksum: "lexical",
        lastSyncedAt: now + 3,
      },
    ]);

    await localDb.upsertChunks([
      { id: "dense-1", repoId: 1, chunkId: "dense-1", text: "generic dense alpha", source: "readme", createdAt: 1 },
      { id: "dense-2", repoId: 2, chunkId: "dense-2", text: "generic dense beta", source: "readme", createdAt: 2 },
      { id: "dense-3", repoId: 3, chunkId: "dense-3", text: "generic dense gamma", source: "readme", createdAt: 3 },
      {
        id: "a-lexical",
        repoId: 4,
        chunkId: "a-lexical",
        text: "pkg/foo:v1.2.3 sha256:abcd retrieval target",
        source: "readme",
        createdAt: 4,
      },
    ]);

    await localDb.upsertEmbeddings([
      {
        id: "dense-e1",
        chunkId: "dense-1",
        model: "test-model",
        dimension: 3,
        vectorBlob: toBlob(new Float32Array([1, 0, 0])),
        createdAt: 1,
      },
      {
        id: "dense-e2",
        chunkId: "dense-2",
        model: "test-model",
        dimension: 3,
        vectorBlob: toBlob(new Float32Array([0.2, 0.98, 0])),
        createdAt: 2,
      },
      {
        id: "dense-e3",
        chunkId: "dense-3",
        model: "test-model",
        dimension: 3,
        vectorBlob: toBlob(new Float32Array([0.1, 0, 0.995])),
        createdAt: 3,
      },
      {
        id: "lex-e1",
        chunkId: "a-lexical",
        model: "test-model",
        dimension: 3,
        vectorBlob: toBlob(new Float32Array([-1, 0, 0])),
        createdAt: 4,
      },
    ]);

    let lexicalTriggered = false;
    const results = await localDb.findSimilarChunks(new Float32Array([1, 0, 0]), 3, {
      queryText: "pkg/foo:v1.2.3 sha256:abcd",
      tuning: {
        fetchK: 4,
        topK: 3,
        mmrLambda: 1,
        maxChunksPerRepo: 3,
      },
      onDiagnostics(payload) {
        lexicalTriggered = payload.lexicalTriggered;
      },
    });

    expect(lexicalTriggered).toBe(true);
    expect(results.map((item) => item.chunkId)).toContain("a-lexical");
  });
});
