import { buildSyncPlan, repoMetadataChanged } from "./plan";
import type { RepoSyncState } from "../db/types";
import type { GitHubStarredRepo } from "../github/types";

function localRepo(overrides: Partial<RepoSyncState> = {}): RepoSyncState {
  return {
    id: 1,
    fullName: "owner/repo-1",
    description: "d1",
    topics: ["a", "b"],
    language: "TypeScript",
    updatedAt: "2026-01-01T00:00:00Z",
    checksum: "hash-1",
    ...overrides,
  };
}

function remoteRepo(id: number, overrides: Partial<GitHubStarredRepo> = {}): GitHubStarredRepo {
  return {
    id,
    node_id: `node-${id}`,
    name: `repo-${id}`,
    full_name: `owner/repo-${id}`,
    private: false,
    html_url: `https://github.com/owner/repo-${id}`,
    description: `d${id}`,
    stargazers_count: id,
    forks_count: id,
    language: "TypeScript",
    topics: ["a", "b"],
    updated_at: "2026-01-01T00:00:00Z",
    owner: { login: "owner" },
    ...overrides,
  };
}

describe("sync planning", () => {
  test("detects add/update/remove states", () => {
    const local = [
      localRepo({ id: 1, checksum: "hash-1" }),
      localRepo({ id: 2, fullName: "owner/repo-2", checksum: "hash-2" }),
    ];

    const remote = [
      remoteRepo(2, { updated_at: "2026-02-01T00:00:00Z" }), // metadata changed
      remoteRepo(3), // new
    ];

    const plan = buildSyncPlan(local, remote);

    expect(plan.removedRepoIds).toEqual([1]);
    expect(plan.candidateRepoIds).toEqual([2, 3]);
  });

  test("repoMetadataChanged ignores topic ordering", () => {
    const local = localRepo({ topics: ["z", "a"] });
    const remote = remoteRepo(1, {
      full_name: "owner/repo-1",
      description: "d1",
      topics: ["a", "z"],
    });

    expect(repoMetadataChanged(local, remote)).toBe(false);
  });
});
