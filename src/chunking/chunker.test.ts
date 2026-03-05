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

  test("chunk budget preserves high-signal markdown sections on large readmes", () => {
    const noisySection = [
      "```ts",
      "const value = 1;",
      "```",
      "| col | val |",
      "| --- | --- |",
      "| a | b |",
      "",
    ].join("\n");
    const highSignalSection = [
      "## High Signal Section",
      "This section includes legacyneedle important context for semantic retrieval.",
      "",
    ].join("\n");

    const noisyPrefix = new Array(250).fill(noisySection).join("\n");
    const noisySuffix = new Array(80).fill(noisySection).join("\n");
    const largeReadme = `${noisyPrefix}\n${highSignalSection}\n${noisySuffix}`;

    const repo = makeRepo({
      id: 77,
      readmeText: largeReadme,
    });

    const chunks = chunkRepo(repo);
    expect(chunks.length).toBeLessThanOrEqual(120);
    expect(chunks.some((chunk) => chunk.text.includes("legacyneedle"))).toBe(true);
  });
});
