export type RepoRecord = {
  id: number;
  fullName: string;
  name: string;
  description: string | null;
  topics: string[];
  language: string | null;
  htmlUrl: string;
  stars: number;
  forks: number;
  updatedAt: string;
  readmeUrl: string | null;
  readmeText: string | null;
  readmeEtag?: string | null;
  readmeLastModified?: string | null;
  checksum: string | null;
  readmeRetryRequired?: boolean;
  lastSyncedAt: number;
};

export type RepoSyncState = {
  id: number;
  fullName: string;
  description: string | null;
  topics: string[];
  language: string | null;
  updatedAt: string;
  stars?: number;
  forks?: number;
  readmeUrl?: string | null;
  readmeText?: string | null;
  readmeEtag?: string | null;
  readmeLastModified?: string | null;
  checksum: string | null;
  readmeRetryRequired?: boolean;
};

export type ChunkRecord = {
  id: string;
  repoId: number;
  chunkId: string;
  text: string;
  source: string;
  createdAt: number;
};

export type EmbeddingRecord = {
  id: string;
  chunkId: string;
  model: string;
  dimension: number;
  vectorBlob: Uint8Array;
  createdAt: number;
};

export type IndexMetaRecord = {
  key: string;
  value: string;
  updatedAt: number;
};

export type ChatSessionRecord = {
  id: string;
  query: string;
  createdAt: number;
  updatedAt: number;
};

export type ChatMessageRecord = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  sequence: number;
  createdAt: number;
};

export type RepoTagRecord = {
  id: string;
  name: string;
  color: string | null;
  createdAt: number;
};

export type RepoTagAssignmentRecord = {
  repoId: number;
  tagId: string;
  createdAt: number;
};

export type SessionContextItemRecord = {
  id: string;
  sessionId: string;
  repoId: number | null;
  chunkId: string | null;
  position: number;
  createdAt: number;
};

export type StorageMode = "opfs" | "local-storage" | "memory";

export type SearchResult = {
  chunkId: string;
  repoId: number;
  score: number;
  denseScore: number;
  text: string;
  repoName: string;
  repoFullName: string;
  repoDescription: string | null;
  repoUrl: string;
  language: string | null;
  topics: string[];
  updatedAt: string;
};

export type SearchFilters = {
  language?: string;
  topic?: string;
  updatedWithinDays?: number;
};
