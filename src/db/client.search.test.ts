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
});

