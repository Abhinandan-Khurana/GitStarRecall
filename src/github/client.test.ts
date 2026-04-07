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
    expect(result.records.filter((record) => record.missingReadme)).toHaveLength(2);
    expect(result.records.every((record) => record.notModified === false)).toBe(true);
    expect(result.records.every((record) => "readmeEtag" in record)).toBe(true);
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
    expect(notModified?.checksum).toBe("previous-checksum");
    expect(notModified?.readmeEtag).toBe('"etag-10"');
    const modified = result.records.find((record) => record.repoId === 11);
    expect(modified?.notModified).toBe(false);
    expect(modified?.readmeText).toContain("fresh readme");
  });
});
