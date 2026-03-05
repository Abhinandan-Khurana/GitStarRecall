import {
  BROWSER_EMBEDDING_FALLBACK_MODEL,
  DEFAULT_BROWSER_EMBEDDING_MODEL,
} from "./retrievalProfile";

export type BrowserEmbeddingCapability = {
  isMobile: boolean;
  hasWebGPU: boolean;
  hardwareConcurrency: number;
  deviceMemoryGB: number | null;
  perfScore: number | null;
};

export type BrowserEmbeddingRecommendationReason =
  | "mobile"
  | "no-webgpu"
  | "strong-desktop"
  | "weak-desktop"
  | "probe-failed";

export type BrowserEmbeddingRecommendation = {
  modelId: string;
  reason: BrowserEmbeddingRecommendationReason;
  score: number | null;
  threshold: number | null;
  capability: BrowserEmbeddingCapability | null;
  modelCandidates: string[];
};

type NavigatorWithHints = Navigator & {
  gpu?: object;
  deviceMemory?: number;
  userAgentData?: {
    mobile?: boolean;
  };
};

type RecommendationContext = {
  previousRecommendation?: BrowserEmbeddingRecommendation | null;
};

const DESKTOP_STRONG_THRESHOLD = 5;

function detectMobileDevice(nav: NavigatorWithHints): boolean {
  const uaMobile = /android|iphone|ipad|ipod|mobile/i.test(nav.userAgent);
  return Boolean(nav.userAgentData?.mobile) || uaMobile;
}

function detectHardwareConcurrency(nav: Navigator): number {
  const raw = Number(nav.hardwareConcurrency);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 2;
  }
  return Math.max(1, Math.trunc(raw));
}

function detectDeviceMemoryGB(nav: NavigatorWithHints): number | null {
  const raw = Number(nav.deviceMemory);
  if (!Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  return raw;
}

async function runPerfProbe(timeoutMs: number): Promise<number | null> {
  const safeTimeoutMs = Math.max(100, Math.trunc(timeoutMs));
  const start = performance.now();
  const softDeadline = start + safeTimeoutMs;

  try {
    let rounds = 0;
    let accumulator = 0;
    while (performance.now() < softDeadline && rounds < 10) {
      const loopStart = performance.now();
      for (let i = 0; i < 80_000; i += 1) {
        accumulator += (i * 13) % 17;
      }
      const elapsed = performance.now() - loopStart;
      if (!Number.isFinite(elapsed) || elapsed <= 0) {
        break;
      }
      rounds += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    if (rounds === 0) {
      return null;
    }
    const totalElapsed = performance.now() - start;
    if (!Number.isFinite(totalElapsed) || totalElapsed <= 0) {
      return null;
    }
    const normalized = (rounds * 100_000) / totalElapsed;
    if (!Number.isFinite(normalized) || accumulator < 0) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function desktopScoreFromCapability(capability: BrowserEmbeddingCapability): number {
  let score = 0;
  if (capability.hardwareConcurrency >= 10) {
    score += 3;
  } else if (capability.hardwareConcurrency >= 8) {
    score += 2;
  } else if (capability.hardwareConcurrency >= 6) {
    score += 1;
  }

  if (capability.deviceMemoryGB == null) {
    score += 0;
  } else if (capability.deviceMemoryGB >= 16) {
    score += 3;
  } else if (capability.deviceMemoryGB >= 8) {
    score += 2;
  } else if (capability.deviceMemoryGB >= 6) {
    score += 1;
  }

  if (capability.perfScore == null) {
    score += 0;
  } else if (capability.perfScore >= 1600) {
    score += 3;
  } else if (capability.perfScore >= 1100) {
    score += 2;
  } else if (capability.perfScore >= 800) {
    score += 1;
  }
  return score;
}

function withCandidates(
  base: Omit<BrowserEmbeddingRecommendation, "modelCandidates">,
): BrowserEmbeddingRecommendation {
  if (base.modelId === BROWSER_EMBEDDING_FALLBACK_MODEL) {
    return {
      ...base,
      modelCandidates: [BROWSER_EMBEDDING_FALLBACK_MODEL, DEFAULT_BROWSER_EMBEDDING_MODEL],
    };
  }
  return {
    ...base,
    modelCandidates: [DEFAULT_BROWSER_EMBEDDING_MODEL, BROWSER_EMBEDDING_FALLBACK_MODEL],
  };
}

function applyDesktopAntiFlap(args: {
  baseRecommendation: BrowserEmbeddingRecommendation;
  previousRecommendation?: BrowserEmbeddingRecommendation | null;
}): BrowserEmbeddingRecommendation {
  const { baseRecommendation, previousRecommendation } = args;
  if (
    previousRecommendation?.reason === "strong-desktop" &&
    baseRecommendation.reason === "weak-desktop" &&
    baseRecommendation.score === (baseRecommendation.threshold ?? DESKTOP_STRONG_THRESHOLD) - 1
  ) {
    return withCandidates({
      modelId: DEFAULT_BROWSER_EMBEDDING_MODEL,
      reason: "strong-desktop",
      score: baseRecommendation.score,
      threshold: baseRecommendation.threshold,
      capability: baseRecommendation.capability,
    });
  }
  return baseRecommendation;
}

export function recommendBrowserEmbeddingModelFromCapability(
  capability: BrowserEmbeddingCapability,
  context?: RecommendationContext,
): BrowserEmbeddingRecommendation {
  try {
    if (capability.isMobile) {
      return withCandidates({
        modelId: BROWSER_EMBEDDING_FALLBACK_MODEL,
        reason: "mobile",
        score: null,
        threshold: null,
        capability,
      });
    }

    if (!capability.hasWebGPU) {
      return withCandidates({
        modelId: BROWSER_EMBEDDING_FALLBACK_MODEL,
        reason: "no-webgpu",
        score: null,
        threshold: null,
        capability,
      });
    }

    const score = desktopScoreFromCapability(capability);
    const strongDesktop = score >= DESKTOP_STRONG_THRESHOLD;
    const recommendation = withCandidates(
      strongDesktop
        ? {
            modelId: DEFAULT_BROWSER_EMBEDDING_MODEL,
            reason: "strong-desktop",
            score,
            threshold: DESKTOP_STRONG_THRESHOLD,
            capability,
          }
        : {
            modelId: BROWSER_EMBEDDING_FALLBACK_MODEL,
            reason: "weak-desktop",
            score,
            threshold: DESKTOP_STRONG_THRESHOLD,
            capability,
          },
    );
    return applyDesktopAntiFlap({
      baseRecommendation: recommendation,
      previousRecommendation: context?.previousRecommendation,
    });
  } catch {
    return withCandidates({
      modelId: BROWSER_EMBEDDING_FALLBACK_MODEL,
      reason: "probe-failed",
      score: null,
      threshold: null,
      capability,
    });
  }
}

export async function detectBrowserEmbeddingCapability(): Promise<BrowserEmbeddingCapability> {
  const nav = navigator as NavigatorWithHints;
  const isMobile = detectMobileDevice(nav);
  const hasWebGPU = typeof nav.gpu !== "undefined";
  const hardwareConcurrency = detectHardwareConcurrency(nav);
  const deviceMemoryGB = detectDeviceMemoryGB(nav);

  if (isMobile) {
    return {
      isMobile,
      hasWebGPU,
      hardwareConcurrency,
      deviceMemoryGB,
      perfScore: null,
    };
  }

  if (!hasWebGPU) {
    return {
      isMobile,
      hasWebGPU,
      hardwareConcurrency,
      deviceMemoryGB,
      perfScore: null,
    };
  }

  const perfScore = await runPerfProbe(1_000);
  return {
    isMobile,
    hasWebGPU,
    hardwareConcurrency,
    deviceMemoryGB,
    perfScore,
  };
}

export async function recommendBrowserEmbeddingModel(context?: RecommendationContext): Promise<BrowserEmbeddingRecommendation> {
  try {
    const capability = await detectBrowserEmbeddingCapability();
    return recommendBrowserEmbeddingModelFromCapability(capability, context);
  } catch {
    return withCandidates({
      modelId: BROWSER_EMBEDDING_FALLBACK_MODEL,
      reason: "probe-failed",
      score: null,
      threshold: null,
      capability: null,
    });
  }
}

export function scoreBrowserDesktopStrength(capability: BrowserEmbeddingCapability): number {
  return desktopScoreFromCapability(capability);
}
