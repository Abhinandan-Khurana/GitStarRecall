import { describe, expect, it } from "vitest";
import { deriveSyncProgressState } from "./syncProgress";

describe("deriveSyncProgressState", () => {
  it("keeps README progress visible during README phase even with embedding metrics present", () => {
    const state = deriveSyncProgressState(
      {
        phase: "Fetching READMEs for changed/new repos (10)",
        readmesTarget: 10,
        readmesCompleted: 4,
        embeddingsCreated: 0,
        embeddingTarget: 0,
      },
      {
        embeddingsProcessed: 2,
        queueDepth: 8,
      },
    );

    expect(state.hasReadmeProgress).toBe(true);
    expect(state.readmeProgress).toBe(40);
    expect(state.hasEmbeddingProgress).toBe(true);
  });

  it("marks embedding as initializing when phase is embedding but target is unknown", () => {
    const state = deriveSyncProgressState(
      {
        phase: "Initializing embedding model",
        readmesTarget: 10,
        readmesCompleted: 10,
        embeddingsCreated: 0,
        embeddingTarget: 0,
      },
      null,
    );

    expect(state.hasEmbeddingProgress).toBe(false);
    expect(state.embeddingInitializing).toBe(true);
  });
});
