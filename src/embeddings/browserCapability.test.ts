import { describe, expect, it } from "vitest";
import {
  recommendBrowserEmbeddingModelFromCapability,
  scoreBrowserDesktopStrength,
  type BrowserEmbeddingCapability,
  type BrowserEmbeddingRecommendation,
} from "./browserCapability";
import {
  BROWSER_EMBEDDING_FALLBACK_MODEL,
  DEFAULT_BROWSER_EMBEDDING_MODEL,
} from "./retrievalProfile";

function capability(overrides: Partial<BrowserEmbeddingCapability> = {}): BrowserEmbeddingCapability {
  return {
    isMobile: false,
    hasWebGPU: true,
    hardwareConcurrency: 8,
    deviceMemoryGB: 8,
    perfScore: 1500,
    ...overrides,
  };
}

describe("browser embedding capability recommendations", () => {
  it("uses MiniLM on mobile", () => {
    const recommendation = recommendBrowserEmbeddingModelFromCapability(capability({ isMobile: true }));
    expect(recommendation.modelId).toBe(BROWSER_EMBEDDING_FALLBACK_MODEL);
    expect(recommendation.reason).toBe("mobile");
    expect(recommendation.modelCandidates[0]).toBe(BROWSER_EMBEDDING_FALLBACK_MODEL);
  });

  it("uses MiniLM when webgpu is unavailable", () => {
    const recommendation = recommendBrowserEmbeddingModelFromCapability(capability({ hasWebGPU: false }));
    expect(recommendation.modelId).toBe(BROWSER_EMBEDDING_FALLBACK_MODEL);
    expect(recommendation.reason).toBe("no-webgpu");
  });

  it("uses embeddinggemma for strong desktops", () => {
    const recommendation = recommendBrowserEmbeddingModelFromCapability(
      capability({ hardwareConcurrency: 12, deviceMemoryGB: 16, perfScore: 2200 }),
    );
    expect(recommendation.modelId).toBe(DEFAULT_BROWSER_EMBEDDING_MODEL);
    expect(recommendation.reason).toBe("strong-desktop");
    expect(recommendation.modelCandidates[0]).toBe(DEFAULT_BROWSER_EMBEDDING_MODEL);
  });

  it("uses MiniLM for weaker desktops", () => {
    const recommendation = recommendBrowserEmbeddingModelFromCapability(
      capability({ hardwareConcurrency: 4, deviceMemoryGB: 4, perfScore: 700 }),
    );
    expect(recommendation.modelId).toBe(BROWSER_EMBEDDING_FALLBACK_MODEL);
    expect(recommendation.reason).toBe("weak-desktop");
  });

  it("applies anti-flap close to threshold", () => {
    const previousRecommendation: BrowserEmbeddingRecommendation = {
      modelId: DEFAULT_BROWSER_EMBEDDING_MODEL,
      reason: "strong-desktop",
      score: 5,
      threshold: 5,
      capability: capability({ hardwareConcurrency: 10, deviceMemoryGB: null, perfScore: 1200 }),
      modelCandidates: [DEFAULT_BROWSER_EMBEDDING_MODEL, BROWSER_EMBEDDING_FALLBACK_MODEL],
    };
    const next = recommendBrowserEmbeddingModelFromCapability(
      capability({ hardwareConcurrency: 10, deviceMemoryGB: null, perfScore: 800 }),
      { previousRecommendation },
    );
    expect(next.modelId).toBe(DEFAULT_BROWSER_EMBEDDING_MODEL);
    expect(next.reason).toBe("strong-desktop");
    expect(next.score).toBe(4);
  });

  it("treats unknown device memory as neutral (no bonus)", () => {
    const unknownMemory = scoreBrowserDesktopStrength(
      capability({ hardwareConcurrency: 6, deviceMemoryGB: null, perfScore: 800 }),
    );
    const lowMemory = scoreBrowserDesktopStrength(
      capability({ hardwareConcurrency: 6, deviceMemoryGB: 6, perfScore: 800 }),
    );
    expect(unknownMemory).toBeLessThan(lowMemory);
  });
});

describe("browser embedding desktop strength scoring", () => {
  it("scores strong desktops above weak desktops", () => {
    const weak = scoreBrowserDesktopStrength(
      capability({ hardwareConcurrency: 4, deviceMemoryGB: 4, perfScore: 600 }),
    );
    const strong = scoreBrowserDesktopStrength(
      capability({ hardwareConcurrency: 12, deviceMemoryGB: 16, perfScore: 2200 }),
    );
    expect(strong).toBeGreaterThan(weak);
  });
});
