import type {
  FetchStarsProgress,
  FetchReadmesResult,
  FetchStarredResult,
  GitHubRateLimit,
  ReadmeFetchProgress,
  GitHubStarredRepo,
  RepoReadmeRecord,
} from "./types";
import { canonicalChecksumInput, sha256Hex } from "./checksum";

type Logger = {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
};

type CreateGitHubApiClientArgs = {
  accessToken: string;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  maxRetries?: number;
  perPage?: number;
  maxPages?: number;
};

type FetchStarredOptions = {
  signal?: AbortSignal;
  previousRepoIds?: number[];
  onProgress?: (progress: FetchStarsProgress) => void;
};

type FetchReadmesOptions = {
  signal?: AbortSignal;
  concurrency?: number;
  onProgress?: (progress: ReadmeFetchProgress) => void;
};

const API_BASE_URL = "https://api.github.com";
const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_README_CONCURRENCY = 6;

function normalizeGitHubToken(rawToken: string): string {
  let token = rawToken.trim();
  token = token.replace(/^bearer\s+/i, "");
  token = token.replace(/^token\s+/i, "");
  token = token.replace(/^['"]+|['"]+$/g, "").trim();
  return token;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRateLimit(headers: Headers): GitHubRateLimit {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");

  return {
    limit: limit ? Number(limit) : null,
    remaining: remaining ? Number(remaining) : null,
    resetAt: reset ? Number(reset) * 1000 : null,
  };
}

function getRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");

  if (retryAfter) {
    const parsed = Number(retryAfter);

    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed * 1000;
    }
  }

  const reset = response.headers.get("x-ratelimit-reset");
  if (reset) {
    const resetMs = Number(reset) * 1000;

    if (Number.isFinite(resetMs)) {
      return Math.max(resetMs - Date.now() + 500, 1000);
    }
  }

  // bounded exponential backoff with jitter
  const base = Math.min(2 ** attempt * 1000, 30000);
  return Math.floor(base + Math.random() * 300);
}

function shouldRetry(response: Response): boolean {
  if (response.status === 429) {
    return true;
  }

  if (response.status !== 403) {
    return false;
  }

  const remaining = response.headers.get("x-ratelimit-remaining");
  return remaining === "0";
}

function extractNextLink(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }

  const parts = headerValue.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    const match = trimmed.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (match && match[2] === "next") {
      return match[1];
    }
  }

  return null;
}

function createDefaultLogger(): Logger {
  const enabled = import.meta.env.DEV;

  return {
    debug: (message, meta) => {
      if (enabled) {
        console.debug(`[github-api] ${message}`, meta ?? {});
      }
    },
    warn: (message, meta) => {
      if (enabled) {
        console.warn(`[github-api] ${message}`, meta ?? {});
      }
    },
  };
}

function assertJsonArray(payload: unknown): asserts payload is GitHubStarredRepo[] {
  if (!Array.isArray(payload)) {
    throw new Error("GitHub response was not an array");
  }
}

type GitHubReadmePayload = {
  content?: string;
  encoding?: string;
  html_url?: string | null;
};

function assertReadmePayload(payload: unknown): asserts payload is GitHubReadmePayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("GitHub README response had unexpected payload");
  }
}

function decodeBase64Utf8(content: string): string {
  const compact = content.replace(/\n/g, "");
  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder().decode(bytes);
}

async function requestWithBackoff(args: {
  url: string;
  fetchImpl: typeof fetch;
  accessToken: string;
  signal?: AbortSignal;
  logger: Logger;
  maxRetries: number;
}): Promise<Response> {
  let attempt = 0;

  while (true) {
    const response = await args.fetchImpl(args.url, {
      method: "GET",
      signal: args.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${args.accessToken}`,
      },
    });

    if (response.ok) {
      return response;
    }

    if (response.status === 401) {
      throw new Error(
        "GitHub authorization failed (401). Use raw token only (no 'Bearer ' prefix) and ensure scopes allow /user/starred.",
      );
    }

    if (!shouldRetry(response) || attempt >= args.maxRetries) {
      throw new Error(`GitHub request failed (${response.status})`);
    }

    const waitMs = getRetryDelayMs(response, attempt);

    args.logger.warn("rate-limited, backing off", {
      attempt: attempt + 1,
      status: response.status,
      waitMs,
    });

    await sleep(waitMs);
    attempt += 1;
  }
}

export function detectRemovedRepoIds(
  previousRepoIds: number[],
  currentRepos: GitHubStarredRepo[],
): number[] {
  const currentIds = new Set(currentRepos.map((repo) => repo.id));
  return previousRepoIds.filter((id) => !currentIds.has(id));
}

export function createGitHubApiClient(args: CreateGitHubApiClientArgs) {
  let fetchImpl: typeof fetch;
  if (args.fetchImpl) {
    fetchImpl = args.fetchImpl;
  } else if (typeof globalThis.fetch === "function") {
    fetchImpl = globalThis.fetch.bind(globalThis) as typeof fetch;
  } else {
    throw new Error("Fetch API is not available in this environment");
  }

  const logger = args.logger ?? createDefaultLogger();
  const maxRetries = args.maxRetries ?? DEFAULT_MAX_RETRIES;
  const perPage = args.perPage ?? DEFAULT_PER_PAGE;
  const maxPages = args.maxPages;
  const authToken = normalizeGitHubToken(args.accessToken);

  if (!authToken) {
    throw new Error("GitHub access token is required");
  }

  if (perPage <= 0 || perPage > 100) {
    throw new Error("perPage must be between 1 and 100");
  }

  if (maxPages !== undefined && maxPages <= 0) {
    throw new Error("maxPages must be greater than 0");
  }

  async function fetchAllStarredRepos(options: FetchStarredOptions = {}): Promise<FetchStarredResult> {
    const repos: GitHubStarredRepo[] = [];
    let nextUrl: string | null = `${API_BASE_URL}/user/starred?per_page=${perPage}&page=1`;
    let fetchedPages = 0;
    let lastRateLimit: GitHubRateLimit = {
      limit: null,
      remaining: null,
      resetAt: null,
    };

    while (nextUrl) {
      if (maxPages !== undefined && fetchedPages >= maxPages) {
        logger.warn("max page limit reached while fetching stars", {
          maxPages,
          total: repos.length,
        });
        break;
      }

      const url = nextUrl;
      const response = await requestWithBackoff({
        url,
        fetchImpl,
        accessToken: authToken,
        signal: options.signal,
        logger,
        maxRetries,
      });

      lastRateLimit = parseRateLimit(response.headers);
      const payload = (await response.json()) as unknown;
      assertJsonArray(payload);

      repos.push(...payload);
      fetchedPages += 1;
      options.onProgress?.({
        fetchedPages,
        totalReposSoFar: repos.length,
        latestPageCount: payload.length,
      });

      logger.debug("fetched stars page", {
        page: fetchedPages,
        count: payload.length,
        total: repos.length,
        remaining: lastRateLimit.remaining,
      });

      // Follow GitHub pagination links until there is no `rel="next"`.
      // This fetches through to the true last starred repo page.
      nextUrl = extractNextLink(response.headers.get("link"));
    }

    const removedRepoIds = detectRemovedRepoIds(options.previousRepoIds ?? [], repos);

    return {
      repos,
      removedRepoIds,
      fetchedPages,
      rateLimit: lastRateLimit,
    };
  }

  async function fetchReadmes(
    repos: GitHubStarredRepo[],
    options: FetchReadmesOptions = {},
  ): Promise<FetchReadmesResult> {
    const concurrency = options.concurrency ?? DEFAULT_README_CONCURRENCY;
    const records: RepoReadmeRecord[] = [];
    let missingCount = 0;
    let failedCount = 0;
    let completed = 0;

    // Concurrency-limited pool: process at most `concurrency` repos at once.
    let cursor = 0;

    const reportProgress = () => {
      options.onProgress?.({
        completed,
        total: repos.length,
        missingCount,
        failedCount,
      });
    };

    async function next(): Promise<void> {
      while (cursor < repos.length) {
        const index = cursor;
        cursor += 1;
        const repo = repos[index];

        const url = `${API_BASE_URL}/repos/${repo.full_name}/readme`;

        try {
          const response = await fetchImpl(url, {
            method: "GET",
            signal: options.signal,
            headers: {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              Authorization: `Bearer ${authToken}`,
            },
          });

          if (response.status === 404) {
            const emptyHash = await sha256Hex("");
            const checksum = await sha256Hex(canonicalChecksumInput(repo, emptyHash));
            records.push({
              repoId: repo.id,
              readmeUrl: null,
              readmeText: null,
              checksum,
              missingReadme: true,
            });
            missingCount += 1;
            completed += 1;
            reportProgress();

            logger.debug("no README for repo", { repo: repo.full_name });
            continue;
          }

          if (response.status === 429 || (response.status === 403 && shouldRetry(response))) {
            // Rate-limited during README fetch — use backoff then retry this repo.
            const retried = await requestWithBackoff({
              url,
              fetchImpl,
              accessToken: authToken,
              signal: options.signal,
              logger,
              maxRetries,
            });

            const payload = (await retried.json()) as unknown;
            assertReadmePayload(payload);

            const readmeText =
              payload.content && payload.encoding === "base64"
                ? decodeBase64Utf8(payload.content)
                : null;

            const readmeSha256 = await sha256Hex(readmeText ?? "");
            const checksum = await sha256Hex(canonicalChecksumInput(repo, readmeSha256));

            records.push({
              repoId: repo.id,
              readmeUrl: payload.html_url ?? null,
              readmeText,
              checksum,
              missingReadme: readmeText === null,
            });

            if (readmeText === null) {
              missingCount += 1;
            }

            completed += 1;
            reportProgress();
            continue;
          }

          if (!response.ok) {
            logger.warn("README fetch failed", {
              repo: repo.full_name,
              status: response.status,
            });
            const emptyHash = await sha256Hex("");
            const checksum = await sha256Hex(canonicalChecksumInput(repo, emptyHash));
            records.push({
              repoId: repo.id,
              readmeUrl: null,
              readmeText: null,
              checksum,
              missingReadme: true,
            });
            failedCount += 1;
            completed += 1;
            reportProgress();
            continue;
          }

          const payload = (await response.json()) as unknown;
          assertReadmePayload(payload);

          const readmeText =
            payload.content && payload.encoding === "base64"
              ? decodeBase64Utf8(payload.content)
              : null;

          const readmeSha256 = await sha256Hex(readmeText ?? "");
          const checksum = await sha256Hex(canonicalChecksumInput(repo, readmeSha256));

          records.push({
            repoId: repo.id,
            readmeUrl: payload.html_url ?? null,
            readmeText,
            checksum,
            missingReadme: readmeText === null,
          });

          if (readmeText === null) {
            missingCount += 1;
          }

          completed += 1;
          reportProgress();

          logger.debug("fetched README", {
            repo: repo.full_name,
            length: readmeText?.length ?? 0,
          });
        } catch (err) {
          if (options.signal?.aborted) {
            throw err;
          }

          logger.warn("README fetch error", {
            repo: repo.full_name,
            error: err instanceof Error ? err.message : String(err),
          });

          const emptyHash = await sha256Hex("");
          const checksum = await sha256Hex(canonicalChecksumInput(repo, emptyHash));
          records.push({
            repoId: repo.id,
            readmeUrl: null,
            readmeText: null,
            checksum,
            missingReadme: true,
          });
          failedCount += 1;
          completed += 1;
          reportProgress();
        }
      }
    }

    // Launch `concurrency` workers in parallel.
    const workers = Array.from({ length: Math.min(concurrency, repos.length) }, () => next());
    await Promise.all(workers);

    logger.debug("README fetch complete", {
      total: repos.length,
      fetched: records.length,
      missing: missingCount,
      failed: failedCount,
    });

    return { records, missingCount, failedCount };
  }

  return {
    fetchAllStarredRepos,
    fetchReadmes,
  };
}
