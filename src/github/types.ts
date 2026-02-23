export type GitHubStarredRepo = {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics?: string[];
  updated_at: string;
  owner: {
    login: string;
    avatar_url?: string;
  };
};

export type GitHubRateLimit = {
  limit: number | null;
  remaining: number | null;
  resetAt: number | null;
};

export type FetchStarredResult = {
  repos: GitHubStarredRepo[];
  removedRepoIds: number[];
  fetchedPages: number;
  rateLimit: GitHubRateLimit;
};

export type FetchStarsProgress = {
  fetchedPages: number;
  totalReposSoFar: number;
  latestPageCount: number;
};

export type RepoReadmeRecord = {
  repoId: number;
  readmeUrl: string | null;
  readmeText: string | null;
  readmeEtag: string | null;
  readmeLastModified: string | null;
  checksum: string;
  missingReadme: boolean;
  notModified: boolean;
};

export type FetchReadmesResult = {
  records: RepoReadmeRecord[];
  missingCount: number;
  failedCount: number;
};

export type ReadmeFetchProgress = {
  completed: number;
  total: number;
  missingCount: number;
  failedCount: number;
};

export type ReadmeFetchStats = {
  requested: number;
  succeeded: number;
  missing: number;
  failed: number;
  retryCount: number;
  rateLimitHits: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
};
