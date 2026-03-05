import { chunkRepo, normalizeText, splitReadmeIntoSections } from "./chunker";
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

  test("splitReadmeIntoSections ignores markdown headings inside fenced code blocks", () => {
    const readme = [
      "# Intro",
      "Some content.",
      "```bash",
      "# not-a-real-heading",
      "echo ok",
      "```",
      "## Real Section",
      "More content",
    ].join("\n");

    const sections = splitReadmeIntoSections(readme);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain("# not-a-real-heading");
    expect(sections[1]).toContain("## Real Section");
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

  test("chunk budget scores badge-heavy windows after normalization", () => {
    const badges = new Array(6)
      .fill("![ci](https://img.shields.io/badge/ci-pass-brightgreen)")
      .join(" ");
    const intro = ["## Intro", "badgesemantictoken keeps this section relevant.", badges, ""].join("\n");
    const bodySection = [
      "## Architecture",
      "This section explains retrieval ranking and semantic chunk relevance for query matching.",
      "",
    ].join("\n");
    const largeReadme = `${intro}\n${new Array(1800).fill(bodySection).join("\n")}`;

    const repo = makeRepo({
      id: 109,
      readmeText: largeReadme,
    });

    const chunks = chunkRepo(repo);
    expect(chunks.length).toBeLessThanOrEqual(120);
    expect(chunks.some((chunk) => chunk.text.includes("badgesemantictoken"))).toBe(true);
  });

  test("chunk budget does not force-include low-quality first windows", () => {
    const lowSignal = [
      "| badge | value |",
      "| --- | --- |",
      "| ci | pass |",
      "```txt",
      "xxxx",
      "```",
      "lowwindowtoken",
      "",
    ].join("\n");
    const highSignal = [
      "## Core Architecture",
      "This section explains retrieval quality and semantic ranking decisions in detail.",
      "highsignalwindowtoken",
      "",
    ].join("\n");

    const lowPrefix = new Array(80).fill(lowSignal).join("\n");
    const highBody = new Array(700).fill(highSignal).join("\n");
    const repo = makeRepo({
      id: 88,
      readmeText: `${lowPrefix}\n${highBody}`,
    });

    const chunks = chunkRepo(repo);
    expect(chunks.length).toBeLessThanOrEqual(120);
    expect(chunks.some((chunk) => chunk.text.includes("highsignalwindowtoken"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("lowwindowtoken"))).toBe(false);
  });

  test("chunk budget fallback keeps quality floor for very low-signal remainder", () => {
    const lowSignal = [
      "| | | | | | | | | | | | | | | | | |",
      "https://example.com/a https://example.com/b https://example.com/c https://example.com/d",
      "| | | | | | | | | | | | | | | | | |",
      "https://example.com/e https://example.com/f https://example.com/g https://example.com/h",
      "lowsignalwindowtoken",
      "",
    ].join("\n");
    const highSignal = [
      "## Core Design",
      "Meaningful architecture explanation with retrieval semantics and ranking intuition.",
      "highsignalfallbacktoken",
      "",
    ].join("\n");

    const lowPrefix = new Array(900).fill(lowSignal).join("\n");
    const highBody = new Array(40).fill(highSignal).join("\n");
    const repo = makeRepo({
      id: 124,
      readmeText: `${highBody}\n${lowPrefix}`,
    });

    const chunks = chunkRepo(repo);
    expect(chunks.some((chunk) => chunk.text.includes("highsignalfallbacktoken"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("lowsignalwindowtoken"))).toBe(false);
  });
});
