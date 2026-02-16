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
  checksum: string;
  missingReadme: boolean;
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
