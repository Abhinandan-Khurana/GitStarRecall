import { canonicalChecksumInput, sha256Hex } from "./checksum";
import type { GitHubStarredRepo } from "./types";

function makeRepo(overrides: Partial<GitHubStarredRepo> = {}): GitHubStarredRepo {
  return {
    id: 1,
    node_id: "node-1",
    name: "repo",
    full_name: "owner/repo",
    private: false,
    html_url: "https://github.com/owner/repo",
    description: "desc",
    stargazers_count: 1,
    forks_count: 1,
    language: "TypeScript",
    topics: ["zeta", "alpha"],
    updated_at: "2026-01-01T00:00:00Z",
    owner: { login: "owner" },
    ...overrides,
  };
}

describe("github checksum helpers", () => {
  test("canonicalChecksumInput has stable topic ordering", () => {
    const repoA = makeRepo({ topics: ["zeta", "alpha"] });
    const repoB = makeRepo({ topics: ["alpha", "zeta"] });

    const inputA = canonicalChecksumInput(repoA, "readme-hash");
    const inputB = canonicalChecksumInput(repoB, "readme-hash");

    expect(inputA).toBe(inputB);
    expect(inputA).toContain("topics:alpha,zeta");
  });

  test("sha256Hex is deterministic for canonical input", async () => {
    const repo = makeRepo();
    const canonical = canonicalChecksumInput(repo, "abc123");
    const h1 = await sha256Hex(canonical);
    const h2 = await sha256Hex(canonical);

    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });
});
