import type {
  FetchStarsProgress,
  FetchReadmesResult,
  FetchStarredResult,
  GitHubAuthenticatedUser,
  GitHubRateLimit,
  ReadmeFetchStats,
  ReadmeFetchProgress,
  GitHubStarredRepo,
  RepoReadmeRecord,
} from "./types";
import { canonicalChecksumInput, sha256Hex } from "./checksum";
import { normalizeGitHubToken } from "../lib/normalizeGitHubToken";

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
  minConcurrency?: number;
  maxConcurrency?: number;
  batchSize?: number;
  previousSyncStateByRepoId?: Map<
    number,
    {
      checksum: string | null;
      readmeUrl?: string | null;
      readmeText?: string | null;
      readmeEtag: string | null;
      readmeLastModified: string | null;
    }
  >;
  onProgress?: (progress: ReadmeFetchProgress) => void;
  onBatch?: (
    records: RepoReadmeRecord[],
    progress: ReadmeFetchProgress,
    stats: ReadmeFetchStats,
  ) => Promise<void> | void;
};

const API_BASE_URL = "https://api.github.com";
const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_README_CONCURRENCY = 6;
const MAX_RETRY_DELAY_MS = 30_000;

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

function getRetryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");

  if (retryAfter) {
    const parsed = Number(retryAfter);

    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.min(parsed * 1000, MAX_RETRY_DELAY_MS);
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(Math.max(retryAt - Date.now(), 0), MAX_RETRY_DELAY_MS);
    }
  }

  const reset = response?.headers.get("x-ratelimit-reset");
  if (reset) {
    const resetMs = Number(reset) * 1000;

    if (Number.isFinite(resetMs)) {
      return Math.min(Math.max(resetMs - Date.now() + 500, 1000), MAX_RETRY_DELAY_MS);
    }
  }

  // bounded exponential backoff with jitter
  const base = Math.min(2 ** attempt * 1000, 30000);
  return Math.min(Math.floor(base + Math.random() * 300), MAX_RETRY_DELAY_MS);
}

function shouldRetry(response: Response): boolean {
  if (response.status >= 500 && response.status <= 599) {
    return true;
  }

  if (response.status === 429) {
    return true;
  }

  if (response.status !== 403) {
    return false;
  }

  const remaining = response.headers.get("x-ratelimit-remaining");
  return remaining === "0";
}

function isRateLimitedResponse(response: Response): boolean {
  return response.status === 429 || (response.status === 403 && shouldRetry(response));
}

function computeAverageLatency(latencies: number[]): number {
  if (latencies.length === 0) {
    return 0;
  }
  const total = latencies.reduce((sum, value) => sum + value, 0);
  return total / latencies.length;
}

function computePercentile(latencies: number[], percentile: number): number {
  if (latencies.length === 0) {
    return 0;
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1),
  );
  return sorted[rank] ?? 0;
}

class AdaptiveConcurrency {
  private current: number;

  constructor(
    private readonly min: number,
    private readonly max: number,
    initial: number,
  ) {
    this.current = Math.max(this.min, Math.min(this.max, Math.trunc(initial)));
  }

  onWindow(stats: { errorRate: number; p95Ms: number; rateLimited: boolean }): void {
    if (stats.rateLimited || stats.errorRate > 0.12) {
      this.current = Math.max(this.min, Math.floor(this.current * 0.7));
      return;
    }

    if (stats.p95Ms < 900 && stats.errorRate < 0.03) {
      this.current = Math.min(this.max, this.current + 1);
    }
  }

  value(): number {
    return this.current;
  }
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

function assertAuthenticatedUser(payload: unknown): asserts payload is GitHubAuthenticatedUser {
  if (!payload || typeof payload !== "object") {
    throw new Error("GitHub user response had unexpected payload");
  }

  const candidate = payload as Partial<GitHubAuthenticatedUser>;
  if (
    !Number.isFinite(candidate.id) ||
    typeof candidate.login !== "string" ||
    !candidate.login.trim()
  ) {
    throw new Error("GitHub user response was missing id/login");
  }
}

type GitHubReadmePayload = {
  content: string;
  encoding: "base64";
  html_url?: string | null;
};

function assertReadmePayload(payload: unknown): asserts payload is GitHubReadmePayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("GitHub README response had unexpected payload");
  }

  const candidate = payload as Partial<GitHubReadmePayload>;
  if (typeof candidate.content !== "string" || candidate.encoding !== "base64") {
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
  headers?: Record<string, string>;
  onRetry?: (meta: {
    status: number;
    waitMs: number;
    attempt: number;
    rateLimited: boolean;
  }) => void;
}): Promise<Response> {
  let attempt = 0;

  while (true) {
    let response: Response;
    try {
      response = await args.fetchImpl(args.url, {
        method: "GET",
        signal: args.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          Authorization: `Bearer ${args.accessToken}`,
          ...(args.headers ?? {}),
        },
      });
    } catch (error) {
      if (args.signal?.aborted || attempt >= args.maxRetries) {
        throw error;
      }

      const waitMs = getRetryDelayMs(null, attempt);
      args.logger.warn("transient network failure, backing off", {
        attempt: attempt + 1,
        waitMs,
      });
      args.onRetry?.({
        status: 0,
        waitMs,
        attempt: attempt + 1,
        rateLimited: false,
      });
      await sleep(waitMs);
      attempt += 1;
      continue;
    }

    if (response.ok || response.status === 304 || response.status === 404) {
      return response;
    }

    if (response.status === 401) {
      throw new Error(
        "GitHub authorization failed (401). Check: token is a raw PAT or OAuth token (no 'Bearer ' prefix when pasting); token is not expired or revoked (see github.com/settings/tokens).",
      );
    }

    if (!shouldRetry(response) || attempt >= args.maxRetries) {
      throw new Error(`GitHub request failed (${response.status})`);
    }

    const waitMs = getRetryDelayMs(response, attempt);

    args.logger.warn("transient GitHub response, backing off", {
      attempt: attempt + 1,
      status: response.status,
      waitMs,
    });
    args.onRetry?.({
      status: response.status,
      waitMs,
      attempt: attempt + 1,
      rateLimited: isRateLimitedResponse(response),
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

  async function fetchAuthenticatedUser(): Promise<GitHubAuthenticatedUser> {
    const response = await requestWithBackoff({
      url: `${API_BASE_URL}/user`,
      fetchImpl,
      accessToken: authToken,
      logger,
      maxRetries,
    });
    const payload = (await response.json()) as unknown;
    assertAuthenticatedUser(payload);
    return {
      id: Number(payload.id),
      login: payload.login.trim(),
    };
  }

  async function fetchAllStarredRepos(
    options: FetchStarredOptions = {},
  ): Promise<FetchStarredResult> {
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
      const publicRepos = payload.filter((repo) => !repo.private);
      const filteredPrivateCount = payload.length - publicRepos.length;

      repos.push(...publicRepos);
      fetchedPages += 1;
      options.onProgress?.({
        fetchedPages,
        totalReposSoFar: repos.length,
        latestPageCount: publicRepos.length,
      });

      logger.debug("fetched stars page", {
        page: fetchedPages,
        count: publicRepos.length,
        filteredPrivateCount,
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
    const initialConcurrency = options.concurrency ?? DEFAULT_README_CONCURRENCY;
    const minConcurrency = Math.max(1, options.minConcurrency ?? 4);
    const maxConcurrency = Math.max(minConcurrency, options.maxConcurrency ?? 20);
    const batchSize = Math.max(1, options.batchSize ?? 40);
    const concurrencyController = new AdaptiveConcurrency(
      minConcurrency,
      maxConcurrency,
      Math.max(minConcurrency, Math.min(maxConcurrency, initialConcurrency)),
    );
    const records: RepoReadmeRecord[] = [];
    let missingCount = 0;
    let failedCount = 0;
    let completed = 0;
    let succeeded = 0;
    let retryCount = 0;
    let rateLimitHits = 0;
    const latenciesMs: number[] = [];
    let windowCompleted = 0;
    let windowFailed = 0;
    let windowRateLimited = false;
    let cooldownUntil = 0;
    let batchQueue = Promise.resolve();
    let batchBuffer: RepoReadmeRecord[] = [];

    let cursor = 0;

    const createProgress = (): ReadmeFetchProgress => ({
      completed,
      total: repos.length,
      missingCount,
      failedCount,
    });

    const createStats = (): ReadmeFetchStats => ({
      requested: repos.length,
      succeeded,
      missing: missingCount,
      failed: failedCount,
      retryCount,
      rateLimitHits,
      avgLatencyMs: computeAverageLatency(latenciesMs),
      p95LatencyMs: computePercentile(latenciesMs, 95),
    });

    const reportProgress = () => {
      options.onProgress?.(createProgress());
    };

    const flushBatch = (force: boolean) => {
      if (!options.onBatch) {
        return;
      }
      if (!force && batchBuffer.length < batchSize) {
        return;
      }
      const next = batchBuffer;
      batchBuffer = [];
      if (next.length === 0) {
        return;
      }
      batchQueue = batchQueue.then(async () => {
        await options.onBatch?.(next, createProgress(), createStats());
      });
    };

    const applyAdaptiveWindow = () => {
      const windowSize = 24;
      if (windowCompleted < windowSize) {
        return;
      }
      const windowErrorRate = windowFailed / Math.max(1, windowCompleted);
      const windowStart = Math.max(latenciesMs.length - windowCompleted, 0);
      const windowLatencies = latenciesMs.slice(windowStart);
      const p95Ms = computePercentile(windowLatencies, 95);
      concurrencyController.onWindow({
        errorRate: windowErrorRate,
        p95Ms,
        rateLimited: windowRateLimited,
      });
      windowCompleted = 0;
      windowFailed = 0;
      windowRateLimited = false;
    };

    const buildReadmeRecord = async (params: {
      repo: GitHubStarredRepo;
      readmeText: string | null;
      readmeUrl: string | null;
      readmeEtag: string | null;
      readmeLastModified: string | null;
      checksum: string | null;
      missingReadme: boolean;
      notModified: boolean;
      outcome: RepoReadmeRecord["outcome"];
    }): Promise<RepoReadmeRecord> => {
      return {
        repoId: params.repo.id,
        outcome: params.outcome,
        readmeUrl: params.readmeUrl,
        readmeText: params.readmeText,
        readmeEtag: params.readmeEtag,
        readmeLastModified: params.readmeLastModified,
        checksum: params.checksum,
        missingReadme: params.missingReadme,
        notModified: params.notModified,
      };
    };

    const fetchSingleReadme = async (repo: GitHubStarredRepo) => {
      const startedAt = performance.now();
      const previous = options.previousSyncStateByRepoId?.get(repo.id);
      const conditionalHeaders: Record<string, string> = {};
      if (previous?.readmeEtag) {
        conditionalHeaders["If-None-Match"] = previous.readmeEtag;
      }
      if (previous?.readmeLastModified) {
        conditionalHeaders["If-Modified-Since"] = previous.readmeLastModified;
      }
      let readmeFailed = false;
      let rateLimited = false;

      try {
        const response = await requestWithBackoff({
          url: `${API_BASE_URL}/repos/${repo.full_name}/readme`,
          fetchImpl,
          accessToken: authToken,
          signal: options.signal,
          logger,
          maxRetries,
          headers: conditionalHeaders,
          onRetry: (meta) => {
            retryCount += 1;
            if (meta.rateLimited) {
              rateLimitHits += 1;
              rateLimited = true;
            }
          },
        });

        const latencyMs = performance.now() - startedAt;
        const readmeEtag = response.headers.get("etag");
        const readmeLastModified = response.headers.get("last-modified");

        if (response.status === 404) {
          const emptyHash = await sha256Hex("");
          const checksum = await sha256Hex(canonicalChecksumInput(repo, emptyHash));
          const record = await buildReadmeRecord({
            repo,
            readmeText: null,
            readmeUrl: null,
            readmeEtag: null,
            readmeLastModified: null,
            checksum,
            missingReadme: true,
            notModified: false,
            outcome: "not_found",
          });
          return { record, latencyMs, failed: false, rateLimited };
        }

        if (response.status === 304) {
          const record = await buildReadmeRecord({
            repo,
            readmeText: previous?.readmeText ?? null,
            readmeUrl: previous?.readmeUrl ?? null,
            readmeEtag: readmeEtag ?? previous?.readmeEtag ?? null,
            readmeLastModified: readmeLastModified ?? previous?.readmeLastModified ?? null,
            checksum: previous?.checksum ?? null,
            missingReadme: false,
            notModified: true,
            outcome: "not_modified",
          });
          return { record, latencyMs, failed: false, rateLimited };
        }

        const payload = (await response.json()) as GitHubReadmePayload;
        assertReadmePayload(payload);
        const readmeText = decodeBase64Utf8(payload.content);
        const readmeSha256 = await sha256Hex(readmeText);
        const checksum = await sha256Hex(canonicalChecksumInput(repo, readmeSha256));
        const record = await buildReadmeRecord({
          repo,
          readmeText,
          readmeUrl: payload.html_url ?? null,
          readmeEtag,
          readmeLastModified,
          checksum,
          missingReadme: false,
          notModified: false,
          outcome: "success",
        });
        return { record, latencyMs, failed: false, rateLimited };
      } catch (err) {
        if (options.signal?.aborted) {
          throw err;
        }
        readmeFailed = true;
        logger.warn("README fetch error", {
          repo: repo.full_name,
          error: err instanceof Error ? err.message : String(err),
        });
        const latencyMs = performance.now() - startedAt;
        const record = await buildReadmeRecord({
          repo,
          readmeText: previous?.readmeText ?? null,
          readmeUrl: previous?.readmeUrl ?? null,
          readmeEtag: previous?.readmeEtag ?? null,
          readmeLastModified: previous?.readmeLastModified ?? null,
          checksum: previous?.checksum ?? null,
          missingReadme: false,
          notModified: false,
          outcome: "transient_failure",
        });
        return { record, latencyMs, failed: readmeFailed, rateLimited };
      }
    };

    const processRepo = async (repo: GitHubStarredRepo) => {
      if (cooldownUntil > Date.now()) {
        await sleep(cooldownUntil - Date.now());
      }

      const result = await fetchSingleReadme(repo);
      records.push(result.record);
      batchBuffer.push(result.record);
      latenciesMs.push(result.latencyMs);
      completed += 1;
      windowCompleted += 1;

      if (result.record.outcome === "success" || result.record.outcome === "not_modified") {
        succeeded += 1;
      }
      if (result.record.outcome === "not_found") {
        missingCount += 1;
      }
      if (result.failed) {
        failedCount += 1;
        windowFailed += 1;
      }
      if (result.rateLimited) {
        windowRateLimited = true;
      }

      if (result.rateLimited && windowFailed >= 3) {
        cooldownUntil = Date.now() + 1500;
      }

      flushBatch(false);
      reportProgress();
      applyAdaptiveWindow();
    };

    await new Promise<void>((resolve, reject) => {
      let running = 0;
      let ended = false;
      const launch = () => {
        if (ended) {
          return;
        }
        while (running < concurrencyController.value() && cursor < repos.length) {
          const repo = repos[cursor];
          cursor += 1;
          running += 1;
          void processRepo(repo)
            .catch((error) => {
              ended = true;
              reject(error);
            })
            .finally(() => {
              running -= 1;
              if (ended) {
                return;
              }
              if (cursor >= repos.length && running === 0) {
                ended = true;
                resolve();
                return;
              }
              launch();
            });
        }
      };

      if (repos.length === 0) {
        resolve();
        return;
      }
      launch();
    });
    flushBatch(true);
    await batchQueue;

    logger.debug("README fetch complete", {
      total: repos.length,
      fetched: records.length,
      missing: missingCount,
      failed: failedCount,
      retryCount,
      rateLimitHits,
      avgLatencyMs: Number(computeAverageLatency(latenciesMs).toFixed(2)),
      p95LatencyMs: Number(computePercentile(latenciesMs, 95).toFixed(2)),
    });

    return { records, missingCount, failedCount };
  }

  return {
    fetchAuthenticatedUser,
    fetchAllStarredRepos,
    fetchReadmes,
  };
}
