import type { RepoRecord } from "@/db/types";

export type LibraryRecencyFilter = "all" | "30" | "90" | "365";
export type LibraryReadmeStatus = "all" | "indexed" | "missing";
export type LibrarySortBy = "recently-synced" | "updated" | "stars" | "forks" | "name";

export type LibraryFilters = {
  query: string;
  language: string;
  topic: string;
  recency: LibraryRecencyFilter;
  minStars: string;
  readmeStatus: LibraryReadmeStatus;
  sortBy: LibrarySortBy;
};

function uniqueSorted(values: Array<string | null | undefined>, normalize = (value: string) => value): string[] {
  const byKey = new Map<string, string>();

  values.forEach((rawValue) => {
    const value = rawValue?.trim();
    if (!value) return;

    const normalized = normalize(value);
    const key = normalized.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, normalized);
    }
  });

  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function getLibraryFilterOptions(repos: RepoRecord[]) {
  return {
    languages: uniqueSorted(repos.map((repo) => repo.language)),
    topics: uniqueSorted(repos.flatMap((repo) => repo.topics), (topic) => topic.toLowerCase()),
  };
}

function matchesRepo(repo: RepoRecord, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const haystack = `${repo.fullName} ${repo.description ?? ""} ${repo.language ?? ""} ${repo.topics.join(" ")} ${repo.readmeText ?? ""}`.toLowerCase();
  return haystack.includes(normalizedQuery);
}

function isWithinDays(dateValue: string, days: number, now: number) {
  const timestamp = new Date(dateValue).getTime();
  return Number.isFinite(timestamp) && now - timestamp < 1000 * 60 * 60 * 24 * days;
}

export function parseMinStarsFilter(minStars: string) {
  return /^[1-9]\d*$/.test(minStars) ? Number(minStars) : null;
}

export function filterLibraryRepos(repos: RepoRecord[], filters: LibraryFilters, now = Date.now()) {
  const minStars = parseMinStarsFilter(filters.minStars);

  const filtered = repos.filter((repo) => {
    if (!matchesRepo(repo, filters.query)) return false;
    if (filters.language !== "all" && repo.language?.toLowerCase() !== filters.language.toLowerCase()) return false;
    if (filters.topic !== "all" && !repo.topics.some((topic) => topic.toLowerCase() === filters.topic.toLowerCase())) return false;
    if (filters.recency !== "all" && !isWithinDays(repo.updatedAt, Number(filters.recency), now)) return false;
    if (minStars !== null && repo.stars < minStars) return false;
    if (filters.readmeStatus === "indexed" && !repo.readmeText?.trim()) return false;
    if (filters.readmeStatus === "missing" && repo.readmeText?.trim()) return false;

    return true;
  });

  return filtered.sort((a, b) => {
    if (filters.sortBy === "updated") {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
    if (filters.sortBy === "stars") {
      return b.stars - a.stars;
    }
    if (filters.sortBy === "forks") {
      return b.forks - a.forks;
    }
    if (filters.sortBy === "name") {
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" });
    }

    return b.lastSyncedAt - a.lastSyncedAt;
  });
}
