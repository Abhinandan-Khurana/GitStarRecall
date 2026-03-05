import { describe, expect, it } from "vitest";
import { countRareLikeTokens, lexicalOverlapScore } from "./lexical";

describe("lexicalOverlapScore", () => {
  it("deduplicates repeated query tokens before computing overlap ratio", () => {
    const score = lexicalOverlapScore("react react graphql", "react hooks");
    expect(score).toBe(0.5);
  });
});

describe("countRareLikeTokens", () => {
  it("deduplicates repeated rare-like query tokens", () => {
    const count = countRareLikeTokens("foo/bar foo/bar foo/bar");
    expect(count).toBe(1);
  });
});

