import {
  WEBLLM_FALLBACK_MODEL_ID,
  WEBLLM_PRIMARY_MODEL_ID,
  WEBLLM_HERMES_MODEL_ID,
  WEBLLM_HERMES_SUBSTITUTE_MODEL_ID,
} from "./modelCatalog";

export type WebLLMCapability = {
  isMobile: boolean;
  hasWebGPU: boolean;
  hardwareConcurrency: number;
  deviceMemoryGB: number | null;
  perfScore: number | null;
};

export type WebLLMRecommendationReason =
  | "mobile"
  | "no-webgpu"
  | "strong-desktop"
  | "weak-desktop"
  | "probe-failed";

export type WebLLMRecommendation = {
  modelId: string;
  reason: WebLLMRecommendationReason;
  score: number | null;
  threshold: number | null;
  capability: WebLLMCapability | null;
};

const DESKTOP_STRONG_THRESHOLD = 5;

type NavigatorWithHints = Navigator & {
  gpu?: object;
  deviceMemory?: number;
  userAgentData?: {
    mobile?: boolean;
  };
};

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

async function runPerfProbe(args?: { timeoutMs?: number }): Promise<number | null> {
  const timeoutMs = Math.max(100, Math.trunc(args?.timeoutMs ?? 1200));
  const start = performance.now();
  const softDeadline = start + timeoutMs;

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

export async function detectWebLLMCapability(): Promise<WebLLMCapability> {
  const nav = navigator as NavigatorWithHints;
  const isMobile = detectMobileDevice(nav);
  const hasWebGPU = typeof nav.gpu !== "undefined";
  const hardwareConcurrency = detectHardwareConcurrency(nav);
  const deviceMemoryGB = detectDeviceMemoryGB(nav);
  const perfScore = await runPerfProbe({ timeoutMs: 1200 });

  return {
    isMobile,
    hasWebGPU,
    hardwareConcurrency,
    deviceMemoryGB,
    perfScore,
  };
}

export async function recommendWebLLMModel(context?: RecommendationContext): Promise<WebLLMRecommendation> {
  try {
    const capability = await detectWebLLMCapability();
    return recommendWebLLMModelFromCapability(capability, context);
  } catch {
    return {
      modelId: WEBLLM_FALLBACK_MODEL_ID,
      reason: "probe-failed",
      score: null,
      threshold: null,
      capability: null,
    };
  }
}

type RecommendationContext = {
  previousRecommendation?: WebLLMRecommendation | null;
};

function desktopScoreFromCapability(capability: WebLLMCapability): number {
  let score = 0;

  if (capability.hardwareConcurrency >= 10) {
    score += 3;
  } else if (capability.hardwareConcurrency >= 8) {
    score += 2;
  } else if (capability.hardwareConcurrency >= 6) {
    score += 1;
  }

  if (capability.deviceMemoryGB == null) {
    score += 1;
  } else if (capability.deviceMemoryGB >= 16) {
    score += 3;
  } else if (capability.deviceMemoryGB >= 8) {
    score += 2;
  } else if (capability.deviceMemoryGB >= 6) {
    score += 1;
  }

  if (capability.perfScore == null) {
    score += 1;
  } else if (capability.perfScore >= 1600) {
    score += 3;
  } else if (capability.perfScore >= 1100) {
    score += 2;
  } else if (capability.perfScore >= 800) {
    score += 1;
  }

  return score;
}

function applyDesktopAntiFlap(args: {
  baseRecommendation: WebLLMRecommendation;
  previousRecommendation?: WebLLMRecommendation | null;
}): WebLLMRecommendation {
  const previous = args.previousRecommendation;
  const current = args.baseRecommendation;

  if (
    previous?.reason === "strong-desktop" &&
    current.reason === "weak-desktop" &&
    current.score === (current.threshold ?? DESKTOP_STRONG_THRESHOLD) - 1
  ) {
    return {
      modelId: WEBLLM_PRIMARY_MODEL_ID,
      reason: "strong-desktop",
      score: current.score,
      threshold: current.threshold,
      capability: current.capability,
    };
  }

  return current;
}

export function scoreDesktopStrength(capability: WebLLMCapability): number {
  return desktopScoreFromCapability(capability);
}

export function recommendWebLLMModelFromCapability(
  capability: WebLLMCapability,
  context?: RecommendationContext,
): WebLLMRecommendation {
  try {
    if (capability.isMobile) {
      return {
        modelId: WEBLLM_FALLBACK_MODEL_ID,
        reason: "mobile",
        score: null,
        threshold: null,
        capability,
      };
    }

    if (!capability.hasWebGPU) {
      return {
        modelId: WEBLLM_FALLBACK_MODEL_ID,
        reason: "no-webgpu",
        score: null,
        threshold: null,
        capability,
      };
    }

    const score = desktopScoreFromCapability(capability);
    const strongDesktop = score >= DESKTOP_STRONG_THRESHOLD;

    const recommendation: WebLLMRecommendation = strongDesktop
      ? {
        modelId: WEBLLM_PRIMARY_MODEL_ID,
        reason: "strong-desktop",
        score,
        threshold: DESKTOP_STRONG_THRESHOLD,
        capability,
      }
      : {
        modelId: WEBLLM_FALLBACK_MODEL_ID,
        reason: "weak-desktop",
        score,
        threshold: DESKTOP_STRONG_THRESHOLD,
        capability,
      };

    return applyDesktopAntiFlap({
      baseRecommendation: recommendation,
      previousRecommendation: context?.previousRecommendation,
    });
  } catch {
    return {
      modelId: WEBLLM_FALLBACK_MODEL_ID,
      reason: "probe-failed",
      score: null,
      threshold: null,
      capability,
    };
  }
}

export function resolveHermesModelSelection(modelId: string): string {
  if (modelId !== WEBLLM_HERMES_MODEL_ID) {
    return modelId;
  }

  return WEBLLM_HERMES_SUBSTITUTE_MODEL_ID;
}
