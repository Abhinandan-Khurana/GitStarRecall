import type { LLMProviderId } from "./types";

export type ProviderFallbackAvailability = {
  canUseOllama: boolean;
  canUseLmStudio: boolean;
  canUseOpenAICompatible: boolean;
};

export function resolveProviderFallback(
  availability: ProviderFallbackAvailability,
): LLMProviderId | null {
  if (availability.canUseOllama) {
    return "ollama";
  }

  if (availability.canUseLmStudio) {
    return "lmstudio";
  }

  if (availability.canUseOpenAICompatible) {
    return "openai-compatible";
  }

  return null;
}
