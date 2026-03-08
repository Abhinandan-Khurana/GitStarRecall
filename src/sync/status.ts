export type SyncPrimaryStage =
  | "fetch-stars"
  | "diff"
  | "readmes"
  | "chunking"
  | "embedding-init"
  | "embedding"
  | "complete"
  | "failed";

export interface IndexingStatus {
  phase: string;
  primaryStage: SyncPrimaryStage;
  readmeActive: boolean;
  chunkingActive: boolean;
  embeddingActive: boolean;
  embeddingWindowed: boolean;
  startedAt: number;
  repoTotal: number;
  readmesTarget: number;
  readmesCompleted: number;
  chunkingTarget: number;
  chunkingCompleted: number;
  readmesMissing: number;
  readmesFailed: number;
  chunkTotal: number;
  embeddingsCreated: number;
  embeddingTarget: number;
  duplicateEmbeddingHits: number;
  elapsedSeconds?: number;
}

export function getReadmePhaseLabel(isInitialSync: boolean, candidateCount: number): string {
  const scope = isInitialSync ? "starred repositories" : "new or updated repositories";
  return `Fetching READMEs for ${scope} (${candidateCount})`;
}

export function getReadmeProgressLabel(
  isInitialSync: boolean,
  completed: number,
  total: number,
  p95LatencyMs?: number,
): string {
  const scope = isInitialSync ? "starred READMEs" : "updated READMEs";
  const base = `Fetching ${scope}… ${completed}/${total}`;
  if (p95LatencyMs == null) {
    return base;
  }
  return `${base} · p95 ${Math.round(p95LatencyMs)}ms`;
}

export function getChunkingPhaseLabel(isInitialSync: boolean): string {
  return isInitialSync ? "Chunking repositories" : "Chunking updated repositories";
}

export function getChunkingProgressLabel(isInitialSync: boolean): string {
  return isInitialSync ? "Chunking repositories…" : "Chunking updated repositories…";
}
