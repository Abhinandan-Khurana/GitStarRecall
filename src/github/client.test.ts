import { createGitHubApiClient } from "./client";
import type { GitHubStarredRepo } from "./types";

function makeRepo(id: number): GitHubStarredRepo {
  return {
    id,
    node_id: `node-${id}`,
    name: `repo-${id}`,
    full_name: `owner/repo-${id}`,
    private: false,
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
  });
});
