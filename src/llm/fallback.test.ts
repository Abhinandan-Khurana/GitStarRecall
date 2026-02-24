import { describe, expect, it } from "vitest";
import { resolveProviderFallback } from "./fallback";

describe("provider fallback resolver", () => {
  it("prefers ollama first", () => {
    const fallback = resolveProviderFallback({
      canUseOllama: true,
      canUseLmStudio: true,
      canUseOpenAICompatible: true,
    });
    expect(fallback).toBe("ollama");
  });

  it("uses lmstudio when ollama is unavailable", () => {
    const fallback = resolveProviderFallback({
      canUseOllama: false,
      canUseLmStudio: true,
      canUseOpenAICompatible: true,
    });
    expect(fallback).toBe("lmstudio");
  });

  it("uses openai-compatible only when local providers are unavailable", () => {
    const fallback = resolveProviderFallback({
      canUseOllama: false,
      canUseLmStudio: false,
      canUseOpenAICompatible: true,
    });
    expect(fallback).toBe("openai-compatible");
  });

  it("returns null when no fallback provider is available", () => {
    const fallback = resolveProviderFallback({
      canUseOllama: false,
      canUseLmStudio: false,
      canUseOpenAICompatible: false,
    });
    expect(fallback).toBeNull();
  });
});
