import type { RepoSyncState } from "../db/types";
import type { GitHubStarredRepo } from "../github/types";

export function equalTopics(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const left = [...a].sort();
  const right = [...b].sort();
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
}

export function repoMetadataChanged(local: RepoSyncState, remote: GitHubStarredRepo): boolean {
  return (
    local.fullName !== remote.full_name ||
    local.description !== remote.description ||
    local.language !== remote.language ||
    local.updatedAt !== remote.updated_at ||
    !equalTopics(local.topics, remote.topics ?? [])
  );
}

export type SyncPlan = {
  removedRepoIds: number[];
  candidateRepoIds: number[];
};

export function buildSyncPlan(localRepos: RepoSyncState[], remoteRepos: GitHubStarredRepo[]): SyncPlan {
  const localById = new Map(localRepos.map((repo) => [repo.id, repo]));
  const remoteIds = new Set(remoteRepos.map((repo) => repo.id));

  const removedRepoIds = localRepos
    .map((repo) => repo.id)
    .filter((id) => !remoteIds.has(id));

  const candidateRepoIds = remoteRepos
    .filter((repo) => {
      const local = localById.get(repo.id);
      if (!local) {
        return true;
      }

      if (!local.checksum) {
        return true;
      }

      return repoMetadataChanged(local, repo);
    })
    .map((repo) => repo.id);

  return { removedRepoIds, candidateRepoIds };
}
