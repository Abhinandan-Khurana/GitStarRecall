import { describe, expect, it } from "vitest";
import { clampResultScoreForDisplay, getResultScoreBand } from "./repoResultScore";

describe("repoResultScore", () => {
  it("clamps negative and non-finite values for display", () => {
    expect(clampResultScoreForDisplay(-0.28)).toBe(0);
    expect(clampResultScoreForDisplay(Number.NaN)).toBe(0);
    expect(clampResultScoreForDisplay(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampResultScoreForDisplay(0.42)).toBe(0.42);
  });

  it("derives score bands from display score", () => {
    expect(getResultScoreBand(0.7)).toBe("High");
    expect(getResultScoreBand(0.4)).toBe("Medium");
    expect(getResultScoreBand(0.2)).toBe("Low");
  });
});
