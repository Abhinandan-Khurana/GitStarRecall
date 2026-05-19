import { getReadmeDisplayExcerpt, summarizeReadmeDisplayHealth } from "./displayExcerpt";

describe("README display excerpts", () => {
  test("returns missing when README is null", () => {
    expect(getReadmeDisplayExcerpt(null)).toEqual({
      kind: "missing",
      text: null,
    });
  });

  test("extracts visible text from HTML-heavy README prefixes", () => {
    const readme = `
      <p align="center">
        <img src="banner.png" alt="ZeroClaw" />
      </p>

      <h1 align="center">ZeroClaw — Personal AI Assistant</h1>

      <p align="center">
        <strong>You own the agent. You own the data.</strong>
      </p>
    `;

    const result = getReadmeDisplayExcerpt(readme);

    expect(result.kind).toBe("ready");
    expect(result.text).toContain("ZeroClaw");
    expect(result.text).toContain("Personal AI Assistant");
    expect(result.text).toContain("You own the agent");
    expect(result.text).not.toContain("<p");
    expect(result.text).not.toContain("<img");
  });

  test("skips badge and image noise while keeping meaningful markdown text", () => {
    const readme = `
      ![CI](https://img.shields.io/badge/ci-pass-green)
      ![npm](https://img.shields.io/badge/npm-v1-blue)

      # Project Name

      A useful project description for local-first search.
    `;

    const result = getReadmeDisplayExcerpt(readme);

    expect(result.kind).toBe("ready");
    expect(result.text).toContain("Project Name");
    expect(result.text).toContain("useful project description");
    expect(result.text).not.toContain("shields.io");
  });

  test("returns empty-display when README exists but has no displayable text", () => {
    const readme = `
      <p align="center">
        <img src="logo.png" />
      </p>

      ![badge](https://img.shields.io/badge/test-ok-green)
    `;

    const result = getReadmeDisplayExcerpt(readme);

    expect(result.kind).toBe("empty-display");
    expect(result.text).toBeNull();
  });

  test("truncates at a word boundary", () => {
    const readme = `# Title\n\n${"word ".repeat(1000)}`;

    const result = getReadmeDisplayExcerpt(readme, 120);

    expect(result.kind).toBe("ready");
    expect(result.text?.length).toBeLessThanOrEqual(121);
    expect(result.text).toMatch(/…$/);
  });

  test("summarizes display health for diagnostics", () => {
    const summary = summarizeReadmeDisplayHealth([
      { readmeText: "# Visible" },
      { readmeText: null },
      { readmeText: '<img src="logo.png" />' },
    ]);

    expect(summary).toEqual({
      ready: 1,
      missing: 1,
      "empty-display": 1,
    });
  });
});
