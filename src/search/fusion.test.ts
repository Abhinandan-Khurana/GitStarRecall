import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./fusion";

describe("reciprocalRankFusion", () => {
  it("combines rankings and sorts by fused score", () => {
    const fused = reciprocalRankFusion([
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [{ id: "b" }, { id: "a" }, { id: "d" }],
    ]);

    expect(fused[0]?.id).toBe("a");
    expect(fused[1]?.id).toBe("b");
    expect(fused.some((item) => item.id === "d")).toBe(true);
  });
});
