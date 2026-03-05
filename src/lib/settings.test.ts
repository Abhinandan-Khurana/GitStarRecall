import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSettings, loadSettings, saveSettings, type LLMProviderSettings } from "./settings";

class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

function hashStorageKey(token: string): string {
  const hash = token.split("").reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0);
  return `gitstarrecall.llm.settings.${Math.abs(hash)}`;
}

describe("llm provider settings", () => {
  const token = "test-token";
  let originalLocalStorage: Storage | undefined;

  beforeEach(() => {
    originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: new MemoryStorage(),
      configurable: true,
    });
  });

  afterEach(() => {
    if (originalLocalStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
      return;
    }
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it("saves and loads webllm fields", () => {
    const settings: LLMProviderSettings = {
      providerId: "webllm",
      baseUrl: "",
      model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      ollamaPreferredModel: "llama3.1:8b",
      apiKey: "",
      allowRemoteProvider: false,
      allowLocalProvider: true,
      webllmConsent: true,
      webllmPreferredModel: "SmolLM2-360M-Instruct-q4f16_1-MLC",
      webllmLastRecommendedModel: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    };

    saveSettings(token, settings);
    const loaded = loadSettings(token);

    expect(loaded).not.toBeNull();
    expect(loaded?.providerId).toBe("webllm");
    expect(loaded?.webllmConsent).toBe(true);
    expect(loaded?.webllmPreferredModel).toBe("SmolLM2-360M-Instruct-q4f16_1-MLC");
    expect(loaded?.webllmLastRecommendedModel).toBe("SmolLM2-360M-Instruct-q4f16_1-MLC");
    expect(loaded?.ollamaPreferredModel).toBe("llama3.1:8b");
  });

  it("supports legacy records without webllm fields", () => {
    const key = hashStorageKey(token);
    localStorage.setItem(
      key,
      JSON.stringify({
        providerId: "openai-compatible",
        baseUrl: "https://api.openai.com",
        model: "gpt-4o-mini",
        apiKey: "",
        allowRemoteProvider: true,
        allowLocalProvider: false,
      }),
    );

    const loaded = loadSettings(token);
    expect(loaded).not.toBeNull();
    expect(loaded?.providerId).toBe("openai-compatible");
    expect(loaded?.webllmConsent).toBe(false);
    expect(loaded?.webllmPreferredModel).toBe("");
    expect(loaded?.webllmLastRecommendedModel).toBe("");
    expect(loaded?.ollamaPreferredModel).toBe("");
  });

  it("clears settings for the scoped token", () => {
    const settings: LLMProviderSettings = {
      providerId: "ollama",
      baseUrl: "http://localhost:11434",
      model: "llama3.1:8b",
      ollamaPreferredModel: "llama3.1:8b",
      apiKey: "",
      allowRemoteProvider: false,
      allowLocalProvider: true,
      webllmConsent: false,
      webllmPreferredModel: "",
      webllmLastRecommendedModel: "",
    };

    saveSettings(token, settings);
    expect(loadSettings(token)).not.toBeNull();
    clearSettings(token);
    expect(loadSettings(token)).toBeNull();
  });
});
