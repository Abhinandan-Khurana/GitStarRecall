import { describe, expect, it } from "vitest";
import { deriveSyncProgressState } from "./syncProgress";

describe("deriveSyncProgressState", () => {
  it("keeps README progress visible during README phase even with embedding metrics present", () => {
    const state = deriveSyncProgressState(
      {
        primaryStage: "readmes",
        readmeActive: true,
        chunkingActive: false,
        embeddingActive: false,
        embeddingWindowed: false,
        readmesTarget: 10,
        readmesCompleted: 4,
        chunkingTarget: 10,
        chunkingCompleted: 4,
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
    expect(state.embeddingRemaining).toBe(8);
  });

  it("marks embedding as initializing when phase is embedding but target is unknown", () => {
    const state = deriveSyncProgressState(
      {
        primaryStage: "embedding-init",
        readmeActive: false,
        chunkingActive: false,
        embeddingActive: true,
        embeddingWindowed: false,
        readmesTarget: 10,
        readmesCompleted: 10,
        chunkingTarget: 10,
        chunkingCompleted: 10,
        embeddingsCreated: 0,
        embeddingTarget: 0,
      },
      null,
    );

    expect(state.hasEmbeddingProgress).toBe(false);
    expect(state.embeddingInitializing).toBe(true);
  });

  it("reports chunking progress and remaining work before embeddings begin", () => {
    const state = deriveSyncProgressState(
      {
        primaryStage: "chunking",
        readmeActive: true,
        chunkingActive: true,
        embeddingActive: false,
        embeddingWindowed: false,
        readmesTarget: 12,
        readmesCompleted: 7,
        chunkingTarget: 12,
        chunkingCompleted: 7,
        embeddingsCreated: 0,
        embeddingTarget: 0,
      },
      null,
    );

    expect(state.hasChunkingProgress).toBe(true);
    expect(state.chunkingProgress).toBeCloseTo(58.3333333333);
    expect(state.chunkingRemaining).toBe(5);
  });

  it("keeps chunking visible as secondary work while embeddings are active", () => {
    const state = deriveSyncProgressState(
      {
        primaryStage: "embedding",
        readmeActive: false,
        chunkingActive: true,
        embeddingActive: true,
        embeddingWindowed: true,
        readmesTarget: 10,
        readmesCompleted: 7,
        chunkingTarget: 10,
        chunkingCompleted: 7,
        embeddingsCreated: 0,
        embeddingTarget: 0,
      },
      {
        embeddingsProcessed: 2,
        queueDepth: 8,
      },
    );

    expect(state.hasChunkingProgress).toBe(true);
    expect(state.hasEmbeddingProgress).toBe(true);
    expect(state.chunkingRemaining).toBe(3);
    expect(state.embeddingRemaining).toBe(8);
  });
});
