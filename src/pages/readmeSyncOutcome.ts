import type { RepoRecord, RepoSyncState } from "../db/types";
import type { GitHubStarredRepo, RepoReadmeRecord } from "../github/types";
import type { IndexingStatus } from "../sync/status";

function preservedReadmeFields(
  previous: RepoRecord | undefined,
  readme: RepoReadmeRecord,
): Pick<RepoRecord, "readmeUrl" | "readmeText" | "readmeEtag" | "readmeLastModified" | "checksum"> {
  return {
    readmeUrl: previous?.readmeUrl ?? readme.readmeUrl,
    readmeText: previous?.readmeText ?? readme.readmeText,
    readmeEtag: readme.readmeEtag ?? previous?.readmeEtag ?? null,
    readmeLastModified: readme.readmeLastModified ?? previous?.readmeLastModified ?? null,
    checksum: previous?.checksum ?? readme.checksum,
  };
}

export function applyReadmeOutcome(
  record: RepoRecord,
  readme: RepoReadmeRecord,
  previous: RepoRecord | undefined,
): RepoRecord {
  if (readme.outcome === "transient_failure") {
    return {
      ...record,
      ...preservedReadmeFields(previous, readme),
      readmeRetryRequired: true,
    };
  }

  if (readme.outcome === "not_modified") {
    return {
      ...record,
      ...preservedReadmeFields(previous, readme),
      checksum: readme.checksum ?? previous?.checksum ?? null,
      readmeRetryRequired: false,
    };
  }

  return {
    ...record,
    readmeUrl: readme.readmeUrl,
    readmeText: readme.readmeText,
    readmeEtag: readme.readmeEtag,
    readmeLastModified: readme.readmeLastModified,
    checksum: readme.checksum,
    readmeRetryRequired: false,
  };
}

export function readmeOutcomeCanChangeChunks(outcome: RepoReadmeRecord["outcome"]): boolean {
  return outcome === "success" || outcome === "not_modified" || outcome === "not_found";
}

export function mapStarredRepoToRecord(repo: GitHubStarredRepo, syncedAt: number): RepoRecord {
  return {
    id: repo.id,
    fullName: repo.full_name,
    name: repo.name,
    description: repo.description,
    topics: repo.topics ?? [],
    language: repo.language,
    htmlUrl: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    updatedAt: repo.updated_at,
    readmeUrl: null,
    readmeText: null,
    readmeEtag: null,
    readmeLastModified: null,
    checksum: null,
    readmeRetryRequired: false,
    lastSyncedAt: syncedAt,
  };
}

export function toRepoSyncState(record: RepoRecord): RepoSyncState {
  return {
    id: record.id,
    fullName: record.fullName,
    description: record.description,
    topics: record.topics,
    language: record.language,
    updatedAt: record.updatedAt,
    stars: record.stars,
    forks: record.forks,
    readmeUrl: record.readmeUrl,
    readmeText: record.readmeText,
    readmeEtag: record.readmeEtag,
    readmeLastModified: record.readmeLastModified,
    checksum: record.checksum,
    readmeRetryRequired: record.readmeRetryRequired,
  };
}

export function toPreviousReadmeStateByRepoId(states: RepoSyncState[]): Map<
  number,
  {
    checksum: string | null;
    readmeUrl: string | null;
    readmeText: string | null;
    readmeEtag: string | null;
    readmeLastModified: string | null;
  }
> {
  return new Map(
    states.map((state) => [
      state.id,
      {
        checksum: state.checksum,
        readmeUrl: state.readmeUrl ?? null,
        readmeText: state.readmeText ?? null,
        readmeEtag: state.readmeEtag ?? null,
        readmeLastModified: state.readmeLastModified ?? null,
      },
    ]),
  );
}

export type ReadmeBatchTransition = {
  record: RepoRecord;
  syncState: RepoSyncState;
  shouldUpsert: boolean;
  shouldRechunk: boolean;
};

export function applyReadmeBatchTransition(input: {
  remoteRepo: GitHubStarredRepo;
  readme: RepoReadmeRecord;
  localRepo: RepoRecord | undefined;
  metadataChanged: boolean;
  syncedAt: number;
}): ReadmeBatchTransition {
  const { remoteRepo, readme, localRepo, metadataChanged, syncedAt } = input;
  const record = applyReadmeOutcome(
    mapStarredRepoToRecord(remoteRepo, syncedAt),
    readme,
    localRepo,
  );
  const readmeStateChanged = localRepo
    ? localRepo.readmeUrl !== record.readmeUrl ||
      localRepo.readmeText !== record.readmeText ||
      localRepo.readmeEtag !== record.readmeEtag ||
      localRepo.readmeLastModified !== record.readmeLastModified ||
      localRepo.checksum !== record.checksum ||
      Boolean(localRepo.readmeRetryRequired) !== Boolean(record.readmeRetryRequired)
    : true;

  return {
    record,
    syncState: toRepoSyncState(record),
    shouldUpsert: !localRepo || readmeStateChanged || metadataChanged,
    shouldRechunk:
      (!localRepo || localRepo.checksum !== record.checksum) &&
      readmeOutcomeCanChangeChunks(readme.outcome),
  };
}

type CompletionStatus = Pick<
  IndexingStatus,
  | "phase"
  | "primaryStage"
  | "readmeActive"
  | "chunkingActive"
  | "embeddingActive"
  | "embeddingWindowed"
  | "repoTotal"
  | "readmesTarget"
  | "readmesCompleted"
  | "chunkingTarget"
  | "chunkingCompleted"
  | "readmesMissing"
  | "readmesFailed"
  | "chunkTotal"
  | "embeddingsCreated"
  | "embeddingTarget"
>;

export function buildSyncCompletion(input: {
  totalRepos: number;
  fetchedPages: number;
  candidateCount: number;
  changedCount: number;
  removedCount: number;
  records: RepoReadmeRecord[];
  missingCount: number;
  failedCount: number;
  repoCount: number;
  chunkCount: number;
  embeddingCount: number;
  pendingEmbeddings: boolean;
  pipelineV2: boolean;
  readmeP95LatencyMs: number;
}): { status: CompletionStatus; summary: string } {
  const hasReadmeRetries = input.failedCount > 0;
  const readmeCount = input.records.filter(
    (record) => record.outcome === "success" || record.outcome === "not_modified",
  ).length;
  const status: CompletionStatus = {
    phase: input.pendingEmbeddings
      ? "Preparing embeddings for unindexed chunks"
      : hasReadmeRetries
        ? `Sync incomplete: ${input.failedCount} README retries pending`
        : "Sync complete",
    primaryStage: input.pendingEmbeddings
      ? "embedding-init"
      : hasReadmeRetries
        ? "failed"
        : "complete",
    readmeActive: false,
    chunkingActive: false,
    embeddingActive: input.pendingEmbeddings,
    embeddingWindowed: false,
    repoTotal: input.totalRepos,
    readmesTarget: input.candidateCount,
    readmesCompleted: input.candidateCount,
    chunkingTarget: input.candidateCount,
    chunkingCompleted: input.candidateCount - input.failedCount,
    readmesMissing: input.missingCount,
    readmesFailed: input.failedCount,
    chunkTotal: input.chunkCount,
    embeddingsCreated: input.pendingEmbeddings ? 0 : input.embeddingCount,
    embeddingTarget: 0,
  };
  const summary =
    `${hasReadmeRetries ? "Sync incomplete" : "Sync complete"}: ${input.totalRepos} stars scanned (${input.fetchedPages} pages), ` +
    `${input.changedCount} changed/new, ${input.removedCount} removed. ` +
    `READMEs fetched: ${readmeCount}, missing: ${input.missingCount}, failed: ${input.failedCount}. ` +
    `Local DB: ${input.repoCount} repos, ${input.chunkCount} chunks, ${input.embeddingCount} embeddings. ` +
    `Pipeline: ${input.pipelineV2 ? "batch-v2" : "legacy"} · README p95 ${Math.round(input.readmeP95LatencyMs)}ms.`;
  return { status, summary };
}

export function buildIncompleteSyncResult(input: {
  failedCount: number;
  candidateCount: number;
  repoCount: number;
  chunkCount: number;
  embeddingCount: number;
}): { status: Partial<IndexingStatus>; summary: string } {
  return {
    status: {
      phase: `Sync incomplete: ${input.failedCount} README retries pending`,
      primaryStage: "failed",
      readmeActive: false,
      chunkingActive: false,
      embeddingActive: false,
      embeddingWindowed: false,
      readmesFailed: input.failedCount,
      chunkingCompleted: input.candidateCount - input.failedCount,
    },
    summary:
      `Sync incomplete: ${input.failedCount} README retries pending; known local content was preserved. ` +
      `Local DB: ${input.repoCount} repos, ${input.chunkCount} chunks, ${input.embeddingCount} embeddings.`,
  };
}
