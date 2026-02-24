import { describe, expect, it } from "vitest";
import {
  recommendWebLLMModelFromCapability,
  scoreDesktopStrength,
  resolveHermesModelSelection,
  type WebLLMCapability,
  type WebLLMRecommendation,
} from "./capability";
import {
  WEBLLM_FALLBACK_MODEL_ID,
  WEBLLM_HERMES_MODEL_ID,
  WEBLLM_HERMES_SUBSTITUTE_MODEL_ID,
  WEBLLM_PRIMARY_MODEL_ID,
} from "./modelCatalog";

function capability(overrides: Partial<WebLLMCapability> = {}): WebLLMCapability {
  return {
    isMobile: false,
    hasWebGPU: true,
    hardwareConcurrency: 8,
    deviceMemoryGB: 8,
    perfScore: 2000,
    ...overrides,
  };
}

describe("WebLLM capability recommendations", () => {
  it("uses fallback model on mobile with webgpu", () => {
    const recommendation = recommendWebLLMModelFromCapability(capability({ isMobile: true }));
    expect(recommendation.modelId).toBe(WEBLLM_FALLBACK_MODEL_ID);
    expect(recommendation.reason).toBe("mobile");
  });

  it("uses fallback model on mobile without webgpu", () => {
    const recommendation = recommendWebLLMModelFromCapability(
      capability({ isMobile: true, hasWebGPU: false }),
    );
    expect(recommendation.modelId).toBe(WEBLLM_FALLBACK_MODEL_ID);
    expect(recommendation.reason).toBe("mobile");
  });

  it("uses low-end fallback model when webgpu is unavailable", () => {
    const recommendation = recommendWebLLMModelFromCapability(capability({ hasWebGPU: false }));
    expect(recommendation.modelId).toBe(WEBLLM_FALLBACK_MODEL_ID);
    expect(recommendation.reason).toBe("no-webgpu");
  });

  it("recommends primary model for mac-like profile with unknown memory", () => {
    const recommendation = recommendWebLLMModelFromCapability(
      capability({ deviceMemoryGB: null, hardwareConcurrency: 10, perfScore: 1500 }),
    );
    expect(recommendation.modelId).toBe(WEBLLM_PRIMARY_MODEL_ID);
    expect(recommendation.reason).toBe("strong-desktop");
  });

  it("recommends fallback model for unknown memory with low cpu/perf", () => {
    const recommendation = recommendWebLLMModelFromCapability(
      capability({ deviceMemoryGB: null, hardwareConcurrency: 4, perfScore: 600 }),
    );
    expect(recommendation.modelId).toBe(WEBLLM_FALLBACK_MODEL_ID);
    expect(recommendation.reason).toBe("weak-desktop");
  });

  it("uses primary model for strong desktops", () => {
    const recommendation = recommendWebLLMModelFromCapability(
      capability({ deviceMemoryGB: 16, hardwareConcurrency: 12, perfScore: 2600 }),
    );
    expect(recommendation.modelId).toBe(WEBLLM_PRIMARY_MODEL_ID);
    expect(recommendation.reason).toBe("strong-desktop");
  });

  it("uses fallback model for weaker desktops", () => {
    const recommendation = recommendWebLLMModelFromCapability(
      capability({ deviceMemoryGB: 4, hardwareConcurrency: 4, perfScore: 900 }),
    );
    expect(recommendation.modelId).toBe(WEBLLM_FALLBACK_MODEL_ID);
    expect(recommendation.reason).toBe("weak-desktop");
  });

  it("treats null perf score as neutral for strong desktop recommendation", () => {
    const recommendation = recommendWebLLMModelFromCapability(
      capability({ deviceMemoryGB: 16, hardwareConcurrency: 10, perfScore: null }),
    );
    expect(recommendation.modelId).toBe(WEBLLM_PRIMARY_MODEL_ID);
    expect(recommendation.reason).toBe("strong-desktop");
  });

  it("applies anti-flap when previous recommendation was strong near threshold", () => {
    const previousRecommendation: WebLLMRecommendation = {
      modelId: WEBLLM_PRIMARY_MODEL_ID,
      reason: "strong-desktop",
      score: 5,
      threshold: 5,
      capability: capability({ deviceMemoryGB: null, hardwareConcurrency: 8, perfScore: 1200 }),
    };
    const next = recommendWebLLMModelFromCapability(
      capability({ deviceMemoryGB: null, hardwareConcurrency: 8, perfScore: 800 }),
      { previousRecommendation },
    );
    expect(next.score).toBe(4);
    expect(next.threshold).toBe(5);
    expect(next.reason).toBe("strong-desktop");
    expect(next.modelId).toBe(WEBLLM_PRIMARY_MODEL_ID);
  });
});

describe("WebLLM desktop strength scoring", () => {
  it("scores higher for stronger desktop capabilities", () => {
    const weakScore = scoreDesktopStrength(
      capability({ deviceMemoryGB: 4, hardwareConcurrency: 4, perfScore: 600 }),
    );
    const strongScore = scoreDesktopStrength(
      capability({ deviceMemoryGB: 16, hardwareConcurrency: 12, perfScore: 2200 }),
    );
    expect(weakScore).toBeLessThan(strongScore);
  });

  it("handles unknown memory as neutral instead of hard fail", () => {
    const score = scoreDesktopStrength(
      capability({ deviceMemoryGB: null, hardwareConcurrency: 8, perfScore: 1200 }),
    );
    expect(score).toBeGreaterThanOrEqual(4);
  });
});

describe("Hermes model resolution", () => {
  it("maps Hermes selection to supported substitute", () => {
    expect(resolveHermesModelSelection(WEBLLM_HERMES_MODEL_ID)).toBe(WEBLLM_HERMES_SUBSTITUTE_MODEL_ID);
  });

  it("returns other model ids unchanged", () => {
    expect(resolveHermesModelSelection(WEBLLM_PRIMARY_MODEL_ID)).toBe(WEBLLM_PRIMARY_MODEL_ID);
  });
});
