import { describe, expect, it } from "vitest";
import type { RepoRecord } from "@/db/types";
import { filterLibraryRepos, getLibraryFilterOptions, parseMinStarsFilter, type LibraryFilters } from "./libraryFilters";

const baseFilters: LibraryFilters = {
  query: "",
  language: "all",
  topic: "all",
  recency: "all",
  minStars: "",
  readmeStatus: "all",
  sortBy: "recently-synced",
};

function repo(overrides: Partial<RepoRecord>): RepoRecord {
  return {
    id: 1,
    fullName: "owner/repo",
    name: "repo",
    description: null,
    topics: [],
    language: null,
    htmlUrl: "https://github.com/owner/repo",
    stars: 0,
    forks: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    readmeUrl: null,
    readmeText: null,
    checksum: null,
    lastSyncedAt: 1,
    ...overrides,
  };
}

describe("library filters", () => {
  it("derives sorted language and GitHub topic options from repo metadata", () => {
    const options = getLibraryFilterOptions([
      repo({ language: "TypeScript", topics: ["ai", "vite"] }),
      repo({ language: "Go", topics: ["cli", "ai"] }),
      repo({ language: "typescript", topics: ["Vite"] }),
    ]);

    expect(options.languages).toEqual(["Go", "TypeScript"]);
    expect(options.topics).toEqual(["ai", "cli", "vite"]);
  });

  it("filters by query, metadata dropdowns, recency, minimum stars, and README status", () => {
    const repos = [
      repo({
        id: 1,
        fullName: "acme/vector-db",
        description: "Fast semantic search",
        language: "TypeScript",
        topics: ["ai", "database"],
        stars: 120,
        updatedAt: "2026-05-01T00:00:00.000Z",
        readmeText: "# Ready",
      }),
      repo({
        id: 2,
        fullName: "acme/old-ai",
        language: "TypeScript",
        topics: ["ai"],
        stars: 500,
        updatedAt: "2025-01-01T00:00:00.000Z",
        readmeText: "# Old",
      }),
      repo({
        id: 3,
        fullName: "acme/no-readme",
        language: "Go",
        topics: ["database"],
        stars: 200,
        updatedAt: "2026-05-01T00:00:00.000Z",
        readmeText: null,
      }),
    ];

    const filtered = filterLibraryRepos(repos, {
      ...baseFilters,
      query: "semantic",
      language: "TypeScript",
      topic: "ai",
      recency: "90",
      minStars: "100",
      readmeStatus: "indexed",
    }, new Date("2026-05-20T00:00:00.000Z").getTime());

    expect(filtered.map((item) => item.id)).toEqual([1]);
  });

  it("matches language and topic filters case-insensitively", () => {
    const repos = [
      repo({ id: 1, language: "TypeScript", topics: ["AI"], lastSyncedAt: 2 }),
      repo({ id: 2, language: "Go", topics: ["cli"], lastSyncedAt: 1 }),
    ];

    expect(filterLibraryRepos(repos, { ...baseFilters, language: "typescript", topic: "ai" }).map((item) => item.id)).toEqual([1]);
  });

  it("filters repos with missing README text", () => {
    const repos = [
      repo({ id: 1, readmeText: "# Ready", lastSyncedAt: 2 }),
      repo({ id: 2, readmeText: "   ", lastSyncedAt: 1 }),
    ];

    expect(filterLibraryRepos(repos, { ...baseFilters, readmeStatus: "missing" }).map((item) => item.id)).toEqual([2]);
  });

  it("ignores minimum stars unless it is a positive integer string", () => {
    const repos = [repo({ id: 1, stars: 5, lastSyncedAt: 1 }), repo({ id: 2, stars: 15, lastSyncedAt: 2 })];

    expect(parseMinStarsFilter("10abc")).toBeNull();
    expect(parseMinStarsFilter("0")).toBeNull();
    expect(parseMinStarsFilter(" 10")).toBeNull();
    expect(parseMinStarsFilter("10")).toBe(10);
    expect(filterLibraryRepos(repos, { ...baseFilters, minStars: "10abc" }).map((item) => item.id)).toEqual([2, 1]);
    expect(filterLibraryRepos(repos, { ...baseFilters, minStars: "10" }).map((item) => item.id)).toEqual([2]);
  });

  it("sorts without mutating the original repo order", () => {
    const repos = [
      repo({ id: 1, fullName: "b/repo", name: "repo", stars: 10, forks: 30, lastSyncedAt: 10 }),
      repo({ id: 2, fullName: "a/repo", name: "repo", stars: 40, forks: 20, lastSyncedAt: 20 }),
      repo({ id: 3, fullName: "c/repo", name: "repo", stars: 20, forks: 50, lastSyncedAt: 30 }),
    ];

    expect(filterLibraryRepos(repos, { ...baseFilters, sortBy: "stars" }).map((item) => item.id)).toEqual([2, 3, 1]);
    expect(repos.map((item) => item.id)).toEqual([1, 2, 3]);
  });
});
