import { describe, expect, it } from "vitest";
import type { RepoRecord } from "../db/types";
import type { GitHubStarredRepo, RepoReadmeRecord } from "../github/types";
import {
  applyReadmeBatchTransition,
  applyReadmeOutcome,
  buildIncompleteSyncResult,
  buildSyncCompletion,
  mapStarredRepoToRecord,
  readmeOutcomeCanChangeChunks,
  toPreviousReadmeStateByRepoId,
  toRepoSyncState,
} from "./readmeSyncOutcome";

function repo(overrides: Partial<RepoRecord> = {}): RepoRecord {
  return {
    id: 1,
    fullName: "owner/repo",
    name: "repo",
    description: null,
    topics: [],
    language: "TypeScript",
    htmlUrl: "https://github.com/owner/repo",
    stars: 1,
    forks: 1,
    updatedAt: "2026-01-01T00:00:00Z",
    readmeUrl: "https://github.com/owner/repo/blob/main/README.md",
    readmeText: "known good bytes",
    readmeEtag: '"etag-old"',
    readmeLastModified: "Mon, 01 Jan 2026 00:00:00 GMT",
    checksum: "checksum-old",
    readmeRetryRequired: false,
    lastSyncedAt: 1,
    ...overrides,
  };
}

function readme(
  outcome: RepoReadmeRecord["outcome"],
  overrides: Partial<RepoReadmeRecord> = {},
): RepoReadmeRecord {
  return {
    repoId: 1,
    outcome,
    readmeUrl: null,
    readmeText: null,
    readmeEtag: null,
    readmeLastModified: null,
    checksum: null,
    missingReadme: outcome === "not_found",
    notModified: outcome === "not_modified",
    ...overrides,
  };
}

function remoteRepo(overrides: Partial<GitHubStarredRepo> = {}): GitHubStarredRepo {
  return {
    id: 1,
    node_id: "R_1",
    name: "repo",
    full_name: "owner/repo",
    private: false,
    html_url: "https://github.com/owner/repo",
    description: "updated description",
    stargazers_count: 2,
    forks_count: 3,
    language: "TypeScript",
    topics: ["search"],
    updated_at: "2026-02-01T00:00:00Z",
    owner: { login: "owner" },
    ...overrides,
  };
}

describe("README sync outcome integration", () => {
  it("preserves every known README field and requests retry after a transient failure", () => {
    const previous = repo();
    const result = applyReadmeOutcome(
      repo({ stars: 2, readmeText: null, checksum: null }),
      readme("transient_failure"),
      previous,
    );

    expect(result).toMatchObject({
      stars: 2,
      readmeUrl: previous.readmeUrl,
      readmeText: previous.readmeText,
      readmeEtag: previous.readmeEtag,
      readmeLastModified: previous.readmeLastModified,
      checksum: previous.checksum,
      readmeRetryRequired: true,
    });
    expect(readmeOutcomeCanChangeChunks("transient_failure")).toBe(false);
  });

  it("preserves README bytes and clears retry state for not-modified responses", () => {
    const previous = repo({ readmeRetryRequired: true });
    const result = applyReadmeOutcome(
      repo({ readmeText: null, checksum: null }),
      readme("not_modified", { readmeEtag: '"etag-new"' }),
      previous,
    );

    expect(result.readmeText).toBe("known good bytes");
    expect(result.checksum).toBe("checksum-old");
    expect(result.readmeEtag).toBe('"etag-new"');
    expect(result.readmeRetryRequired).toBe(false);
    expect(readmeOutcomeCanChangeChunks("not_modified")).toBe(true);
  });

  it("creates a stable known-empty README state for not-found responses", () => {
    const result = applyReadmeOutcome(
      repo(),
      readme("not_found", { checksum: "checksum-empty" }),
      repo({ readmeRetryRequired: true }),
    );

    expect(result).toMatchObject({
      readmeUrl: null,
      readmeText: null,
      checksum: "checksum-empty",
      readmeRetryRequired: false,
    });
    expect(readmeOutcomeCanChangeChunks("not_found")).toBe(true);
  });

  it("replaces README state after a successful fetch", () => {
    const result = applyReadmeOutcome(
      repo(),
      readme("success", {
        readmeUrl: "https://github.com/owner/repo/blob/main/README.md",
        readmeText: "new bytes",
        readmeEtag: '"etag-new"',
        readmeLastModified: "Tue, 02 Jan 2026 00:00:00 GMT",
        checksum: "checksum-new",
      }),
      repo({ readmeRetryRequired: true }),
    );

    expect(result).toMatchObject({
      readmeText: "new bytes",
      readmeEtag: '"etag-new"',
      checksum: "checksum-new",
      readmeRetryRequired: false,
    });
    expect(readmeOutcomeCanChangeChunks("success")).toBe(true);
  });

  it("maps GitHub metadata and persisted records into sync snapshots", () => {
    const mapped = mapStarredRepoToRecord(remoteRepo({ topics: undefined }), 42);
    expect(mapped).toMatchObject({
      id: 1,
      fullName: "owner/repo",
      topics: [],
      stars: 2,
      forks: 3,
      readmeRetryRequired: false,
      lastSyncedAt: 42,
    });

    const syncState = toRepoSyncState(repo({ stars: 9, forks: 8, readmeRetryRequired: true }));
    expect(syncState).toMatchObject({ stars: 9, forks: 8, readmeRetryRequired: true });
    expect(toPreviousReadmeStateByRepoId([syncState]).get(1)).toEqual({
      checksum: "checksum-old",
      readmeUrl: "https://github.com/owner/repo/blob/main/README.md",
      readmeText: "known good bytes",
      readmeEtag: '"etag-old"',
      readmeLastModified: "Mon, 01 Jan 2026 00:00:00 GMT",
    });
  });

  it("upserts metadata but preserves chunks after a transient README failure", () => {
    const transition = applyReadmeBatchTransition({
      remoteRepo: remoteRepo(),
      readme: readme("transient_failure"),
      localRepo: repo(),
      metadataChanged: true,
      syncedAt: 42,
    });

    expect(transition.shouldUpsert).toBe(true);
    expect(transition.shouldRechunk).toBe(false);
    expect(transition.record).toMatchObject({
      description: "updated description",
      readmeText: "known good bytes",
      checksum: "checksum-old",
      readmeRetryRequired: true,
    });
    expect(transition.syncState).toEqual(toRepoSyncState(transition.record));
  });

  it("rechunks checksum-changing outcomes and skips an unchanged 304", () => {
    const success = applyReadmeBatchTransition({
      remoteRepo: remoteRepo(),
      readme: readme("success", { readmeText: "new", checksum: "checksum-new" }),
      localRepo: repo(),
      metadataChanged: false,
      syncedAt: 42,
    });
    const unchanged = applyReadmeBatchTransition({
      remoteRepo: remoteRepo(),
      readme: readme("not_modified"),
      localRepo: repo(),
      metadataChanged: false,
      syncedAt: 42,
    });
    const metadataChanged304 = applyReadmeBatchTransition({
      remoteRepo: remoteRepo(),
      readme: readme("not_modified", { checksum: "checksum-current-metadata" }),
      localRepo: repo(),
      metadataChanged: true,
      syncedAt: 42,
    });
    const initial = applyReadmeBatchTransition({
      remoteRepo: remoteRepo(),
      readme: readme("not_found", { checksum: "empty" }),
      localRepo: undefined,
      metadataChanged: true,
      syncedAt: 42,
    });

    expect(success).toMatchObject({ shouldUpsert: true, shouldRechunk: true });
    expect(unchanged).toMatchObject({ shouldUpsert: false, shouldRechunk: false });
    expect(metadataChanged304).toMatchObject({
      shouldUpsert: true,
      shouldRechunk: true,
      record: { readmeText: "known good bytes", checksum: "checksum-current-metadata" },
    });
    expect(initial).toMatchObject({ shouldUpsert: true, shouldRechunk: true });
  });

  it("builds complete, embedding-pending, and retry-pending presentation states", () => {
    const base = {
      totalRepos: 20,
      fetchedPages: 2,
      candidateCount: 4,
      changedCount: 2,
      removedCount: 1,
      records: [readme("success"), readme("not_modified")],
      missingCount: 1,
      failedCount: 0,
      repoCount: 20,
      chunkCount: 50,
      embeddingCount: 49,
      pendingEmbeddings: false,
      pipelineV2: true,
      readmeP95LatencyMs: 10.6,
    };
    const complete = buildSyncCompletion(base);
    expect(complete.status).toMatchObject({
      phase: "Sync complete",
      primaryStage: "complete",
      embeddingActive: false,
      embeddingsCreated: 49,
      chunkingCompleted: 4,
    });
    expect(complete.summary).toContain("READMEs fetched: 2");
    expect(complete.summary).toContain("Pipeline: batch-v2 · README p95 11ms");

    const embedding = buildSyncCompletion({ ...base, pendingEmbeddings: true, pipelineV2: false });
    expect(embedding.status).toMatchObject({
      phase: "Preparing embeddings for unindexed chunks",
      primaryStage: "embedding-init",
      embeddingActive: true,
      embeddingsCreated: 0,
    });
    expect(embedding.summary).toContain("Pipeline: legacy");

    const retry = buildSyncCompletion({ ...base, failedCount: 2 });
    expect(retry.status).toMatchObject({
      phase: "Sync incomplete: 2 README retries pending",
      primaryStage: "failed",
      chunkingCompleted: 2,
      readmesFailed: 2,
    });
  });

  it("builds the post-embedding incomplete result without claiming success", () => {
    expect(
      buildIncompleteSyncResult({
        failedCount: 2,
        candidateCount: 5,
        repoCount: 10,
        chunkCount: 30,
        embeddingCount: 29,
      }),
    ).toEqual({
      status: {
        phase: "Sync incomplete: 2 README retries pending",
        primaryStage: "failed",
        readmeActive: false,
        chunkingActive: false,
        embeddingActive: false,
        embeddingWindowed: false,
        readmesFailed: 2,
        chunkingCompleted: 3,
      },
      summary:
        "Sync incomplete: 2 README retries pending; known local content was preserved. Local DB: 10 repos, 30 chunks, 29 embeddings.",
    });
  });
});
