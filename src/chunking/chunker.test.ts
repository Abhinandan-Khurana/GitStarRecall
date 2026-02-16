import { chunkRepo, normalizeText } from "./chunker";
import type { RepoRecord } from "../db/types";

function makeRepo(overrides: Partial<RepoRecord> = {}): RepoRecord {
  return {
    id: 1,
    fullName: "owner/repo",
    name: "repo",
    description: "A test repo",
    topics: ["vector", "search"],
    language: "TypeScript",
    htmlUrl: "https://github.com/owner/repo",
    stars: 100,
    forks: 10,
    updatedAt: "2026-01-01T00:00:00Z",
    readmeUrl: "https://github.com/owner/repo/blob/main/README.md",
    readmeText: "# Title\n\nSome **markdown** with [link](https://example.com)",
    checksum: "checksum",
    lastSyncedAt: 1,
    ...overrides,
  };
}

describe("chunker", () => {
  test("normalizeText strips markdown/html noise", () => {
    const normalized = normalizeText(
      "<h1>Hello</h1>\n![img](x)\n[Docs](https://x)\n`code`\n\n- item",
    );

    expect(normalized).toContain("Hello");
    expect(normalized).toContain("Docs");
    expect(normalized).not.toContain("<h1>");
    expect(normalized).not.toContain("![img]");
  });

  test("chunkRepo returns deterministic chunk ids tied to repo id", () => {
    const repo = makeRepo({ id: 42 });
    const chunks = chunkRepo(repo);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].id).toBe("42:0");
    expect(chunks.every((chunk) => chunk.repoId === 42)).toBe(true);
  });
});
