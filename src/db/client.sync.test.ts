import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";
import { LocalDatabase, runSchema } from "./client";

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => `node_modules/sql.js/dist/${file}`,
  });
});

function localDatabase(rawDb: Database): LocalDatabase {
  return new LocalDatabase({ sql: SQL, db: rawDb, storageMode: "memory" });
}

describe("LocalDatabase sync state", () => {
  it("adds retry state to an existing database without replacing repository data", () => {
    const rawDb = new SQL.Database();
    rawDb.run(`
      CREATE TABLE repos (
        id INTEGER PRIMARY KEY,
        full_name TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        topics_json TEXT NOT NULL DEFAULT '[]',
        language TEXT,
        html_url TEXT NOT NULL,
        stars INTEGER NOT NULL DEFAULT 0,
        forks INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        readme_url TEXT,
        readme_text TEXT,
        readme_etag TEXT,
        readme_last_modified TEXT,
        checksum TEXT,
        last_synced_at INTEGER NOT NULL
      );
      INSERT INTO repos VALUES (
        1, 'owner/repo', 'repo', 'description', '["sync"]', 'TypeScript',
        'https://github.com/owner/repo', 7, 3, '2026-01-01T00:00:00Z',
        'https://github.com/owner/repo/blob/main/README.md', 'known README',
        '"etag"', 'Mon, 23 Feb 2026 00:00:00 GMT', 'known-checksum', 123
      );
    `);

    runSchema(rawDb);
    runSchema(rawDb);

    const columns = rawDb.exec("PRAGMA table_info(repos);")[0]?.values ?? [];
    expect(columns.filter((row) => row[1] === "readme_retry_required")).toHaveLength(1);
    expect(localDatabase(rawDb).listRepos()[0]).toMatchObject({
      readmeText: "known README",
      checksum: "known-checksum",
      readmeRetryRequired: false,
    });
  });

  it("preserves known README fields while recording metadata and retry state", async () => {
    const rawDb = new SQL.Database();
    runSchema(rawDb);
    const database = localDatabase(rawDb);
    await database.upsertRepos([
      {
        id: 1,
        fullName: "owner/repo",
        name: "repo",
        description: "old description",
        topics: ["sync"],
        language: "TypeScript",
        htmlUrl: "https://github.com/owner/repo",
        stars: 7,
        forks: 3,
        updatedAt: "2026-01-01T00:00:00Z",
        readmeUrl: "https://github.com/owner/repo/blob/main/README.md",
        readmeText: "known README",
        readmeEtag: '"etag"',
        readmeLastModified: "Mon, 23 Feb 2026 00:00:00 GMT",
        checksum: "known-checksum",
        readmeRetryRequired: false,
        lastSyncedAt: 123,
      },
    ]);

    await database.upsertRepos([
      {
        id: 1,
        fullName: "owner/repo",
        name: "repo",
        description: "new description",
        topics: ["sync"],
        language: "TypeScript",
        htmlUrl: "https://github.com/owner/repo",
        stars: 8,
        forks: 4,
        updatedAt: "2026-02-01T00:00:00Z",
        readmeUrl: null,
        readmeText: null,
        readmeEtag: null,
        readmeLastModified: null,
        checksum: null,
        readmeRetryRequired: true,
        lastSyncedAt: 456,
      },
    ]);

    expect(database.listRepos()[0]).toMatchObject({
      description: "new description",
      stars: 8,
      forks: 4,
      updatedAt: "2026-02-01T00:00:00Z",
      readmeUrl: "https://github.com/owner/repo/blob/main/README.md",
      readmeText: "known README",
      readmeEtag: '"etag"',
      readmeLastModified: "Mon, 23 Feb 2026 00:00:00 GMT",
      checksum: "known-checksum",
      readmeRetryRequired: true,
    });
    expect(database.listRepoSyncState()[0]).toMatchObject({
      stars: 8,
      forks: 4,
      readmeRetryRequired: true,
      readmeText: "known README",
    });
  });
});
