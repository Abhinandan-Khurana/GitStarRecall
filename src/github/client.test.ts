import { createGitHubApiClient } from "./client";
import type { GitHubStarredRepo } from "./types";

function makeRepo(id: number, isPrivate = false): GitHubStarredRepo {
  return {
    id,
    node_id: `node-${id}`,
    name: `repo-${id}`,
    full_name: `owner/repo-${id}`,
    private: isPrivate,
    html_url: `https://github.com/owner/repo-${id}`,
    description: `repo ${id}`,
    stargazers_count: id,
    forks_count: 0,
    language: "TypeScript",
    topics: ["test"],
    updated_at: "2026-01-01T00:00:00Z",
    owner: { login: "owner" },
  };
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

describe("github client integration", () => {
  test("fetchAuthenticatedUser resolves the stable GitHub account identity", async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/user")) {
        return jsonResponse({ id: 42, login: "octocat" });
      }
      return jsonResponse({ message: "Not Found" }, { status: 404 });
    }) as typeof fetch;

    const client = createGitHubApiClient({
      accessToken: "token",
      fetchImpl,
      logger: {
        debug: () => undefined,
        warn: () => undefined,
      },
    });

    await expect(client.fetchAuthenticatedUser()).resolves.toEqual({
      id: 42,
      login: "octocat",
    });
  });

  test("fetchAllStarredRepos follows Link rel=next until final page", async () => {
    const page1Repos = Array.from({ length: 100 }, (_, index) => makeRepo(index + 1));
    const page2Repos = Array.from({ length: 20 }, (_, index) => makeRepo(index + 101));

    const fetchImpl: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      const parsed = new URL(url);
      const page = parsed.searchParams.get("page");

      if (page === "1") {
        return jsonResponse(page1Repos, {
          headers: {
            link: '<https://api.github.com/user/starred?per_page=100&page=2>; rel="next"',
          },
        });
      }

      if (page === "2") {
        return jsonResponse(page2Repos);
      }

      return jsonResponse([], { status: 404 });
    }) as typeof fetch;

    const client = createGitHubApiClient({
      accessToken: "token",
      fetchImpl,
      logger: {
        debug: () => undefined,
        warn: () => undefined,
      },
    });

    const result = await client.fetchAllStarredRepos({
      previousRepoIds: [1, 9999],
    });

    expect(result.fetchedPages).toBe(2);
    expect(result.repos).toHaveLength(120);
    expect(result.removedRepoIds).toEqual([9999]);
  });

  test("fetchAllStarredRepos excludes private repositories from results", async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      const parsed = new URL(url);
      const page = parsed.searchParams.get("page");

      if (page === "1") {
        return jsonResponse([makeRepo(1, false), makeRepo(2, true), makeRepo(3, false)]);
      }

      return jsonResponse([], { status: 404 });
    }) as typeof fetch;

    const client = createGitHubApiClient({
      accessToken: "token",
      fetchImpl,
      logger: {
        debug: () => undefined,
        warn: () => undefined,
      },
    });

    const result = await client.fetchAllStarredRepos({
      previousRepoIds: [1, 2, 3],
    });

    expect(result.repos.map((repo) => repo.id)).toEqual([1, 3]);
    expect(result.removedRepoIds).toEqual([2]);
  });

  test("fetchReadmes handles success, missing README, and failed responses", async () => {
    const repos = [makeRepo(1), makeRepo(2), makeRepo(3)];
    const readmeBase64 = btoa("# hello");

    const fetchImpl: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/repos/owner/repo-1/readme")) {
        return jsonResponse({
          content: readmeBase64,
          encoding: "base64",
          html_url: "https://github.com/owner/repo-1/blob/main/README.md",
        });
      }

      if (url.endsWith("/repos/owner/repo-2/readme")) {
        return jsonResponse({ message: "Not Found" }, { status: 404 });
      }

      return jsonResponse({ message: "Server Error" }, { status: 500 });
    }) as typeof fetch;

    const client = createGitHubApiClient({
      accessToken: "token",
      fetchImpl,
      maxRetries: 0,
      logger: {
        debug: () => undefined,
        warn: () => undefined,
      },
    });
    const result = await client.fetchReadmes(repos);

    expect(result.records).toHaveLength(3);
    expect(result.missingCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.records.some((record) => (record.readmeText ?? "").includes("hello"))).toBe(true);
    expect(result.records.filter((record) => record.missingReadme)).toHaveLength(1);
    expect(result.records.every((record) => record.notModified === false)).toBe(true);
    expect(result.records.every((record) => "readmeEtag" in record)).toBe(true);
    expect(
      Object.fromEntries(result.records.map((record) => [record.repoId, record.outcome])),
    ).toEqual({
      1: "success",
      2: "not_found",
      3: "transient_failure",
    });
  });

  test("fetchReadmes retries a transient server failure and honors Retry-After", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ message: "Unavailable" }, { status: 503, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          content: btoa("recovered"),
          encoding: "base64",
          html_url: "https://github.com/owner/repo-20/blob/main/README.md",
        }),
      );
    const client = createGitHubApiClient({
      accessToken: "token",
      fetchImpl,
      maxRetries: 1,
      logger: { debug: () => undefined, warn: () => undefined },
    });

    const result = await client.fetchReadmes([makeRepo(20)], {
      concurrency: 1,
      minConcurrency: 1,
      maxConcurrency: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.records[0]?.outcome).toBe("success");
    expect(result.records[0]?.readmeText).toBe("recovered");
  });

  test("fetchReadmes honors an HTTP-date Retry-After beyond the fallback cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    try {
      const warn = vi.fn();
      const retryAt = new Date(Date.now() + 120_000).toUTCString();
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse(
            { message: "Unavailable" },
            { status: 503, headers: { "retry-after": retryAt } },
          ),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            content: btoa("date retry recovered"),
            encoding: "base64",
            html_url: "https://github.com/owner/repo-25/blob/main/README.md",
          }),
        );
      const client = createGitHubApiClient({
        accessToken: "token",
        fetchImpl,
        maxRetries: 1,
        logger: { debug: () => undefined, warn },
      });

      const resultPromise = client.fetchReadmes([makeRepo(25)]);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(90_000);
      const result = await resultPromise;

      expect(warn).toHaveBeenCalledWith(
        "transient GitHub response, backing off",
        expect.objectContaining({ waitMs: 120_000 }),
      );
      expect(result.records[0]?.outcome).toBe("success");
    } finally {
      vi.useRealTimers();
    }
  });

  test("fetchReadmes aborts a long server-directed retry wait without retrying", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse(
            { message: "Rate limited" },
            { status: 429, headers: { "retry-after": "3600" } },
          ),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            content: btoa("should not be fetched"),
            encoding: "base64",
          }),
        );
      const client = createGitHubApiClient({
        accessToken: "token",
        fetchImpl,
        maxRetries: 1,
        logger: { debug: () => undefined, warn: () => undefined },
      });

      const resultPromise = client.fetchReadmes([makeRepo(29)], {
        signal: controller.signal,
        concurrency: 1,
        minConcurrency: 1,
        maxConcurrency: 1,
      });
      const rejection = expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      controller.abort();
      await rejection;
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("fetchReadmes aborts the shared adaptive cooldown before starting another request", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse(
            { message: "Rate limited" },
            { status: 429, headers: { "retry-after": "0" } },
          ),
        );
      const client = createGitHubApiClient({
        accessToken: "token",
        fetchImpl,
        maxRetries: 1,
        logger: { debug: () => undefined, warn: () => undefined },
      });

      const resultPromise = client.fetchReadmes(
        [makeRepo(30), makeRepo(31), makeRepo(32), makeRepo(33)],
        {
          signal: controller.signal,
          concurrency: 1,
          minConcurrency: 1,
          maxConcurrency: 1,
        },
      );
      for (let attempt = 0; attempt < 30 && fetchImpl.mock.calls.length < 6; attempt += 1) {
        await vi.runOnlyPendingTimersAsync();
      }
      expect(fetchImpl).toHaveBeenCalledTimes(6);

      const rejection = expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
      controller.abort();
      await rejection;
      await vi.advanceTimersByTimeAsync(1_500);

      expect(fetchImpl).toHaveBeenCalledTimes(6);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("fetchReadmes honors the rate-limit reset header when Retry-After is absent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    try {
      const warn = vi.fn();
      const resetSeconds = Math.floor((Date.now() + 120_000) / 1_000);
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse(
            { message: "Unavailable" },
            { status: 503, headers: { "x-ratelimit-reset": String(resetSeconds) } },
          ),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            content: btoa("rate reset recovered"),
            encoding: "base64",
            html_url: "https://github.com/owner/repo-26/blob/main/README.md",
          }),
        );
      const client = createGitHubApiClient({
        accessToken: "token",
        fetchImpl,
        maxRetries: 1,
        logger: { debug: () => undefined, warn },
      });

      const resultPromise = client.fetchReadmes([makeRepo(26)]);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(90_500);
      const result = await resultPromise;

      expect(warn).toHaveBeenCalledWith(
        "transient GitHub response, backing off",
        expect.objectContaining({ waitMs: 120_500 }),
      );
      expect(result.records[0]?.outcome).toBe("success");
    } finally {
      vi.useRealTimers();
    }
  });

  test("fetchReadmes caps client-chosen exponential backoff at 30 seconds", async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.999);
    try {
      const warn = vi.fn();
      const fetchImpl = vi.fn<typeof fetch>();
      for (let attempt = 0; attempt < 6; attempt += 1) {
        fetchImpl.mockResolvedValueOnce(jsonResponse({ message: "Unavailable" }, { status: 503 }));
      }
      fetchImpl.mockResolvedValueOnce(
        jsonResponse({
          content: btoa("fallback recovered"),
          encoding: "base64",
          html_url: "https://github.com/owner/repo-27/blob/main/README.md",
        }),
      );
      const client = createGitHubApiClient({
        accessToken: "token",
        fetchImpl,
        maxRetries: 6,
        logger: { debug: () => undefined, warn },
      });

      const resultPromise = client.fetchReadmes([makeRepo(27)]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;
      const waits = warn.mock.calls.map(([, meta]) => Number(meta?.waitMs));

      expect(waits).toHaveLength(6);
      expect(Math.max(...waits)).toBe(30_000);
      expect(waits.at(-1)).toBe(30_000);
      expect(result.records[0]?.outcome).toBe("success");
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test("fetchReadmes recomputes a 304 checksum from current metadata and preserved bytes", async () => {
    const readmeText = "preserved README";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          content: btoa(readmeText),
          encoding: "base64",
          html_url: "https://github.com/owner/repo-28/blob/main/README.md",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const client = createGitHubApiClient({
      accessToken: "token",
      fetchImpl,
      logger: { debug: () => undefined, warn: () => undefined },
    });
    const before = { ...makeRepo(28), description: "before" };
    const after = { ...before, description: "after" };
    const initial = (await client.fetchReadmes([before])).records[0];

    const metadataChanged = (
      await client.fetchReadmes([after], {
        previousSyncStateByRepoId: new Map([[28, initial!]]),
      })
    ).records[0];
    const unchanged = (
      await client.fetchReadmes([after], {
        previousSyncStateByRepoId: new Map([[28, metadataChanged!]]),
      })
    ).records[0];

    expect(metadataChanged).toMatchObject({ outcome: "not_modified", readmeText });
    expect(metadataChanged?.checksum).not.toBe(initial?.checksum);
    expect(unchanged?.checksum).toBe(metadataChanged?.checksum);
  });

  test("fetchReadmes preserves previous README state after transient retry exhaustion", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: "Unavailable" }, { status: 503 }));
    const client = createGitHubApiClient({
      accessToken: "token",
      fetchImpl,
      maxRetries: 0,
      logger: { debug: () => undefined, warn: () => undefined },
    });

    const result = await client.fetchReadmes([makeRepo(21)], {
      previousSyncStateByRepoId: new Map([
        [
          21,
          {
            checksum: "known-checksum",
            readmeUrl: "https://github.com/owner/repo-21/blob/main/README.md",
            readmeText: "known-good README",
            readmeEtag: '"known-etag"',
            readmeLastModified: "Mon, 23 Feb 2026 00:00:00 GMT",
          },
        ],
      ]),
    });

    expect(result.failedCount).toBe(1);
    expect(result.missingCount).toBe(0);
    expect(result.records[0]).toMatchObject({
      outcome: "transient_failure",
      readmeUrl: "https://github.com/owner/repo-21/blob/main/README.md",
      readmeText: "known-good README",
      readmeEtag: '"known-etag"',
      readmeLastModified: "Mon, 23 Feb 2026 00:00:00 GMT",
      checksum: "known-checksum",
      missingReadme: false,
    });
  });

  test("fetchReadmes turns a 404 into stable known-empty state", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: "Not Found" }, { status: 404 }));
    const client = createGitHubApiClient({
      accessToken: "token",
      fetchImpl,
      maxRetries: 0,
      logger: { debug: () => undefined, warn: () => undefined },
    });

    const result = await client.fetchReadmes([makeRepo(24)], {
      previousSyncStateByRepoId: new Map([
        [
          24,
          {
            checksum: "old-checksum",
            readmeUrl: "https://github.com/owner/repo-24/blob/main/README.md",
            readmeText: "removed README",
            readmeEtag: '"old-etag"',
            readmeLastModified: "Mon, 23 Feb 2026 00:00:00 GMT",
          },
        ],
      ]),
    });

    expect(result.missingCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.records[0]).toMatchObject({
      outcome: "not_found",
      readmeUrl: null,
      readmeText: null,
      readmeEtag: null,
      readmeLastModified: null,
      missingReadme: true,
      notModified: false,
    });
    expect(result.records[0]?.checksum).not.toBe("old-checksum");
  });

  test("fetchReadmes treats a malformed success payload as transient and preserves prior data", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: "unexpected" }));
    const client = createGitHubApiClient({
      accessToken: "token",
      fetchImpl,
      maxRetries: 0,
      logger: { debug: () => undefined, warn: () => undefined },
    });

    const result = await client.fetchReadmes([makeRepo(23)], {
      previousSyncStateByRepoId: new Map([
        [
          23,
          {
            checksum: "known-checksum",
            readmeUrl: "https://github.com/owner/repo-23/blob/main/README.md",
            readmeText: "known-good README",
            readmeEtag: '"known-etag"',
            readmeLastModified: "Mon, 23 Feb 2026 00:00:00 GMT",
          },
        ],
      ]),
    });

    expect(result.failedCount).toBe(1);
    expect(result.records[0]).toMatchObject({
      outcome: "transient_failure",
      readmeText: "known-good README",
      checksum: "known-checksum",
    });
  });

  test("fetchReadmes retries a transient network failure within the configured bound", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new TypeError("connection reset"))
        .mockResolvedValueOnce(
          jsonResponse({
            content: btoa("network recovered"),
            encoding: "base64",
            html_url: "https://github.com/owner/repo-22/blob/main/README.md",
          }),
        );
      const client = createGitHubApiClient({
        accessToken: "token",
        fetchImpl,
        maxRetries: 1,
        logger: { debug: () => undefined, warn: () => undefined },
      });

      const resultPromise = client.fetchReadmes([makeRepo(22)]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(result.records[0]?.outcome).toBe("success");
    } finally {
      vi.useRealTimers();
    }
  });

  test("fetchReadmes preserves prior data when a network failure exhausts retries", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("connection reset"));
    const client = createGitHubApiClient({
      accessToken: "token",
      fetchImpl,
      maxRetries: 0,
      logger: { debug: () => undefined, warn: () => undefined },
    });

    const result = await client.fetchReadmes([makeRepo(27)], {
      previousSyncStateByRepoId: new Map([
        [
          27,
          {
            checksum: "known-checksum",
            readmeUrl: "https://github.com/owner/repo-27/blob/main/README.md",
            readmeText: "known-good README",
            readmeEtag: '"known-etag"',
            readmeLastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
          },
        ],
      ]),
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.records[0]).toMatchObject({
      outcome: "transient_failure",
      checksum: "known-checksum",
      readmeText: "known-good README",
    });
  });

  test("fetchReadmes supports conditional revalidation and batch callbacks", async () => {
    const repos = [makeRepo(10), makeRepo(11)];
    const readmeBase64 = btoa("fresh readme");
    const capturedHeaders: string[] = [];
    let batchCalls = 0;

    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const headers = new Headers(init?.headers);
      const ifNoneMatch = headers.get("if-none-match");
      if (ifNoneMatch) {
        capturedHeaders.push(ifNoneMatch);
      }

      if (url.endsWith("/repos/owner/repo-10/readme")) {
        return new Response(null, {
          status: 304,
          headers: { etag: '"etag-10"', "last-modified": "Mon, 23 Feb 2026 00:00:00 GMT" },
        });
      }

      return jsonResponse(
        {
          content: readmeBase64,
          encoding: "base64",
          html_url: "https://github.com/owner/repo-11/blob/main/README.md",
        },
        {
          headers: { etag: '"etag-11"', "last-modified": "Mon, 23 Feb 2026 00:00:00 GMT" },
        },
      );
    }) as typeof fetch;

    const client = createGitHubApiClient({
      accessToken: "token",
      fetchImpl,
      logger: {
        debug: () => undefined,
        warn: () => undefined,
      },
    });

    const result = await client.fetchReadmes(repos, {
      batchSize: 1,
      previousSyncStateByRepoId: new Map([
        [
          10,
          {
            checksum: "previous-checksum",
            readmeUrl: "https://github.com/owner/repo-10/blob/main/README.md",
            readmeText: "previous readme",
            readmeEtag: '"etag-10"',
            readmeLastModified: "Mon, 22 Feb 2026 00:00:00 GMT",
          },
        ],
      ]),
      onBatch: async () => {
        batchCalls += 1;
      },
    });

    expect(batchCalls).toBeGreaterThanOrEqual(2);
    expect(capturedHeaders).toContain('"etag-10"');
    const notModified = result.records.find((record) => record.repoId === 10);
    expect(notModified?.notModified).toBe(true);
    expect(notModified?.checksum).not.toBe("previous-checksum");
    expect(notModified?.outcome).toBe("not_modified");
    expect(notModified?.readmeText).toBe("previous readme");
    expect(notModified?.readmeEtag).toBe('"etag-10"');
    const modified = result.records.find((record) => record.repoId === 11);
    expect(modified?.notModified).toBe(false);
    expect(modified?.outcome).toBe("success");
    expect(modified?.readmeText).toContain("fresh readme");
  });
});
