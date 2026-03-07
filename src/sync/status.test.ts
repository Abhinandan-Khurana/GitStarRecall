import { describe, expect, it } from "vitest";
import {
  getChunkingPhaseLabel,
  getChunkingProgressLabel,
  getReadmePhaseLabel,
  getReadmeProgressLabel,
} from "./status";

describe("sync status copy", () => {
  it("uses neutral first-sync labels", () => {
    expect(getReadmePhaseLabel(true, 12)).toBe("Fetching READMEs for starred repositories (12)");
    expect(getChunkingPhaseLabel(true)).toBe("Chunking repositories");
    expect(getChunkingProgressLabel(true)).toBe("Chunking repositories…");
  });

  it("uses incremental labels for later syncs", () => {
    expect(getReadmePhaseLabel(false, 6)).toBe("Fetching READMEs for new or updated repositories (6)");
    expect(getReadmeProgressLabel(false, 2, 6)).toBe("Fetching updated READMEs… 2/6");
    expect(getChunkingPhaseLabel(false)).toBe("Chunking updated repositories");
  });

  it("never uses changed repositories wording", () => {
    expect(getReadmePhaseLabel(true, 3)).not.toContain("changed repositories");
    expect(getReadmePhaseLabel(false, 3)).not.toContain("changed repositories");
    expect(getChunkingPhaseLabel(true)).not.toContain("changed repositories");
    expect(getChunkingPhaseLabel(false)).not.toContain("changed repositories");
  });
});
