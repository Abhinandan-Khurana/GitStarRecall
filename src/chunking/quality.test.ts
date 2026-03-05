import { describe, expect, it } from "vitest";
import { chunkQualityScore } from "./quality";

describe("chunkQualityScore", () => {
  it("scores normal prose higher than noisy code-heavy chunk", () => {
    const prose = "# Usage\nInstall package and run tests locally with examples and walkthrough.";
    const noisy = "```ts\nconst x=1\n```\n```bash\nnpm i\n```\nhttps://x.dev | a | b |";
    expect(chunkQualityScore(prose)).toBeGreaterThan(chunkQualityScore(noisy));
  });
});
