import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSettings,
  loadSettings,
  loadSettingsAsync,
  migrateLegacySettingsScope,
  saveSettings,
  type LLMProviderSettings,
} from "./settings";

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

function hashStorageKey(raw: string): string {
  return `gitstarrecall.llm.settings.${Math.abs(
    raw.split("").reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0),
  )}`;
}

function scopeStorageKey(scopeIdentity: string): string {
  return `gitstarrecall.llm.settings.scope.${encodeURIComponent(scopeIdentity)}`;
}

function historicalScopeStorageKey(scopeIdentity: string): string {
  const hash = scopeIdentity.split("").reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0);
  return `gitstarrecall.llm.settings.${Math.abs(hash)}`;
}

async function encryptApiKey(scopeIdentity: string, envSecret: string, apiKey: string): Promise<string> {
  const combined = new TextEncoder().encode(scopeIdentity + envSecret);
  const hash = await crypto.subtle.digest("SHA-256", combined);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    hash,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 1);
  const encoded = new TextEncoder().encode(apiKey);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoded);
  const combinedBytes = new Uint8Array(iv.length + ciphertext.byteLength);
  combinedBytes.set(iv, 0);
  combinedBytes.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combinedBytes));
}

describe("llm provider settings", () => {
  const scopeIdentity = "github:42";
  const legacyToken = "ghp_legacy_token";
  let originalLocalStorage: Storage | undefined;

  beforeEach(() => {
    vi.unstubAllEnvs();
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

    saveSettings(scopeIdentity, settings);
    const loaded = loadSettings(scopeIdentity);

    expect(loaded).not.toBeNull();
    expect(loaded?.providerId).toBe("webllm");
    expect(loaded?.webllmConsent).toBe(true);
    expect(loaded?.webllmPreferredModel).toBe("SmolLM2-360M-Instruct-q4f16_1-MLC");
    expect(loaded?.webllmLastRecommendedModel).toBe("SmolLM2-360M-Instruct-q4f16_1-MLC");
    expect(loaded?.ollamaPreferredModel).toBe("llama3.1:8b");
  });

  it("supports legacy records without webllm fields", () => {
    const key = scopeStorageKey(scopeIdentity);
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

    const loaded = loadSettings(scopeIdentity);
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

    saveSettings(scopeIdentity, settings);
    expect(loadSettings(scopeIdentity)).not.toBeNull();
    clearSettings(scopeIdentity);
    expect(loadSettings(scopeIdentity)).toBeNull();
  });

  it("migrates legacy token-scoped records into the user scope", async () => {
    const legacyKey = hashStorageKey(legacyToken);
    localStorage.setItem(
      legacyKey,
      JSON.stringify({
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
      }),
    );

    await migrateLegacySettingsScope(legacyToken, scopeIdentity);

    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect(loadSettings(scopeIdentity)?.providerId).toBe("ollama");
  });

  it("treats encrypted records as configured in sync loads", async () => {
    vi.stubEnv("VITE_LLM_SETTINGS_ENCRYPTION_KEY", "test-secret");
    const key = scopeStorageKey(scopeIdentity);
    const apiKeyEncrypted = await encryptApiKey(scopeIdentity, "test-secret", "sk-live");
    localStorage.setItem(
      key,
      JSON.stringify({
        providerId: "openai-compatible",
        baseUrl: "https://api.openai.com",
        model: "gpt-4o-mini",
        apiKeyEncrypted,
        allowRemoteProvider: true,
        allowLocalProvider: false,
        webllmConsent: false,
        webllmPreferredModel: "",
        webllmLastRecommendedModel: "",
      }),
    );

    expect(loadSettings(scopeIdentity)).toEqual({
      providerId: "openai-compatible",
      baseUrl: "https://api.openai.com",
      model: "gpt-4o-mini",
      ollamaPreferredModel: "",
      apiKey: "",
      allowRemoteProvider: true,
      allowLocalProvider: false,
      webllmConsent: false,
      webllmPreferredModel: "",
      webllmLastRecommendedModel: "",
    });
  });

  it("loads historical hashed stable-scope records and promotes them on save", () => {
    const historicalKey = historicalScopeStorageKey(scopeIdentity);
    localStorage.setItem(
      historicalKey,
      JSON.stringify({
        providerId: "ollama",
        baseUrl: "http://localhost:11434",
        model: "llama3.1:8b",
        apiKey: "",
        allowRemoteProvider: false,
        allowLocalProvider: true,
      }),
    );

    expect(loadSettings(scopeIdentity)?.providerId).toBe("ollama");

    saveSettings(scopeIdentity, {
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
    });

    expect(localStorage.getItem(historicalKey)).toBeNull();
    expect(localStorage.getItem(scopeStorageKey(scopeIdentity))).not.toBeNull();
  });

  it("fails loudly and preserves the legacy record when encrypted migration cannot decrypt", async () => {
    vi.stubEnv("VITE_LLM_SETTINGS_ENCRYPTION_KEY", "test-secret");
    const legacyKey = hashStorageKey(legacyToken);
    localStorage.setItem(
      legacyKey,
      JSON.stringify({
        providerId: "openai-compatible",
        baseUrl: "https://api.openai.com",
        model: "gpt-4o-mini",
        apiKeyEncrypted: "not-valid-ciphertext",
        allowRemoteProvider: true,
        allowLocalProvider: false,
        webllmConsent: false,
        webllmPreferredModel: "",
        webllmLastRecommendedModel: "",
      }),
    );

    await expect(migrateLegacySettingsScope(legacyToken, scopeIdentity)).rejects.toThrow(
      /Failed to migrate legacy LLM settings scope/,
    );

    expect(localStorage.getItem(legacyKey)).not.toBeNull();
    expect(localStorage.getItem(scopeStorageKey(scopeIdentity))).toBeNull();
  });

  it("re-encrypts migrated legacy API keys for the stable scope", async () => {
    vi.stubEnv("VITE_LLM_SETTINGS_ENCRYPTION_KEY", "test-secret");
    const legacyKey = hashStorageKey(legacyToken);
    const apiKeyEncrypted = await encryptApiKey(legacyToken, "test-secret", "sk-legacy");
    localStorage.setItem(
      legacyKey,
      JSON.stringify({
        providerId: "openai-compatible",
        baseUrl: "https://api.openai.com",
        model: "gpt-4o-mini",
        apiKeyEncrypted,
        allowRemoteProvider: true,
        allowLocalProvider: false,
        webllmConsent: false,
        webllmPreferredModel: "",
        webllmLastRecommendedModel: "",
      }),
    );

    await migrateLegacySettingsScope(legacyToken, scopeIdentity);

    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect(await loadSettingsAsync(scopeIdentity)).toEqual({
      providerId: "openai-compatible",
      baseUrl: "https://api.openai.com",
      model: "gpt-4o-mini",
      ollamaPreferredModel: "",
      apiKey: "sk-legacy",
      allowRemoteProvider: true,
      allowLocalProvider: false,
      webllmConsent: false,
      webllmPreferredModel: "",
      webllmLastRecommendedModel: "",
    });
  });
});
