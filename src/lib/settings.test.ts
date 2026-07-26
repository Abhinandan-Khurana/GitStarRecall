import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSettings,
  createDefaultProviderSettings,
  deriveHydratedProviderSettingsView,
  getProviderSettingsStatusMessage,
  loadSettingsAsync,
  migrateLegacySettingsScope,
  providerSettingsStore,
  resolveHydratedProviderSettings,
  type LLMProviderSettings,
} from "./settings";
import type { LLMProviderDefinition } from "../llm/types";

class MemoryStorage implements Storage {
  private entries = new Map<string, string>();
  failNextSet = false;

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
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error("simulated storage failure");
    }
    this.entries.set(key, value);
  }
}

function hashStorageKey(raw: string): string {
  return `gitstarrecall.llm.settings.${Math.abs(
    raw.split("").reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0),
  )}`;
}

function scopeStorageKey(scopeIdentity: string): string {
  return `gitstarrecall.llm.settings.scope.${encodeURIComponent(scopeIdentity)}`;
}

function historicalScopeStorageKey(scopeIdentity: string): string {
  const hash = scopeIdentity
    .split("")
    .reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0);
  return `gitstarrecall.llm.settings.${Math.abs(hash)}`;
}

async function encryptApiKey(
  scopeIdentity: string,
  envSecret: string,
  apiKey: string,
): Promise<string> {
  const combined = new TextEncoder().encode(scopeIdentity + envSecret);
  const hash = await crypto.subtle.digest("SHA-256", combined);
  const cryptoKey = await crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 1);
  const encoded = new TextEncoder().encode(apiKey);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoded);
  const combinedBytes = new Uint8Array(iv.length + ciphertext.byteLength);
  combinedBytes.set(iv, 0);
  combinedBytes.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combinedBytes));
}

function makeSettings(overrides: Partial<LLMProviderSettings> = {}): LLMProviderSettings {
  return {
    providerId: "openai-compatible",
    baseUrl: "https://api.openai.com",
    model: "gpt-4o-mini",
    ollamaPreferredModel: "llama3.1:8b",
    apiKey: "",
    allowRemoteProvider: true,
    allowLocalProvider: false,
    webllmConsent: false,
    webllmPreferredModel: "",
    webllmLastRecommendedModel: "",
    ...overrides,
  };
}

const providerDefinitions: LLMProviderDefinition[] = [
  {
    id: "openai-compatible",
    label: "OpenAI compatible",
    kind: "remote",
    defaultBaseUrl: "https://api.openai.com",
    defaultModel: "gpt-4o-mini",
    requiresApiKey: true,
  },
  {
    id: "webllm",
    label: "WebLLM",
    kind: "local",
    defaultBaseUrl: "",
    defaultModel: "primary-web-model",
    requiresApiKey: false,
  },
];

describe("llm provider settings", () => {
  const scopeIdentity = "github:42";
  const legacyToken = "ghp_legacy_token";
  let originalLocalStorage: Storage | undefined;
  let storage: MemoryStorage;

  beforeEach(() => {
    vi.unstubAllEnvs();
    originalLocalStorage = globalThis.localStorage;
    storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
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

  it("saves and loads webllm fields", async () => {
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

    await providerSettingsStore.hydrate(scopeIdentity);
    await providerSettingsStore.save(scopeIdentity, settings);
    const loaded = await loadSettingsAsync(scopeIdentity);

    expect(loaded).not.toBeNull();
    expect(loaded?.providerId).toBe("webllm");
    expect(loaded?.webllmConsent).toBe(true);
    expect(loaded?.webllmPreferredModel).toBe("SmolLM2-360M-Instruct-q4f16_1-MLC");
    expect(loaded?.webllmLastRecommendedModel).toBe("SmolLM2-360M-Instruct-q4f16_1-MLC");
    expect(loaded?.ollamaPreferredModel).toBe("llama3.1:8b");
  });

  it("supports legacy records without webllm fields", async () => {
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

    const loaded = await loadSettingsAsync(scopeIdentity);
    expect(loaded).not.toBeNull();
    expect(loaded?.providerId).toBe("openai-compatible");
    expect(loaded?.webllmConsent).toBe(false);
    expect(loaded?.webllmPreferredModel).toBe("");
    expect(loaded?.webllmLastRecommendedModel).toBe("");
    expect(loaded?.ollamaPreferredModel).toBe("");
  });

  it("rejects malformed and invalid saved records explicitly", async () => {
    localStorage.setItem(scopeStorageKey(scopeIdentity), "{not-json");
    await expect(loadSettingsAsync(scopeIdentity)).rejects.toThrow(
      "Saved provider settings are not valid JSON",
    );

    localStorage.setItem(scopeStorageKey(scopeIdentity), JSON.stringify({ providerId: "webllm" }));
    await expect(loadSettingsAsync(scopeIdentity)).rejects.toThrow(
      "Saved provider settings have an invalid shape",
    );
  });

  it("requires encryption support to load or save API keys", async () => {
    vi.stubEnv("VITE_LLM_SETTINGS_ENCRYPTION_KEY", "");
    localStorage.setItem(
      scopeStorageKey(scopeIdentity),
      JSON.stringify({
        ...makeSettings({ apiKey: "" }),
        apiKey: undefined,
        apiKeyEncrypted: "ciphertext",
      }),
    );
    await expect(loadSettingsAsync(scopeIdentity)).rejects.toThrow(
      "Encrypted provider settings require VITE_LLM_SETTINGS_ENCRYPTION_KEY",
    );

    localStorage.clear();
    await providerSettingsStore.hydrate(scopeIdentity);
    await expect(
      providerSettingsStore.save(scopeIdentity, makeSettings({ apiKey: "sk-secret" })),
    ).rejects.toThrow("Provider API keys require VITE_LLM_SETTINGS_ENCRYPTION_KEY");
    expect(localStorage.getItem(scopeStorageKey(scopeIdentity))).toBeNull();
  });

  it("defaults a missing legacy API key to blank", async () => {
    const withoutApiKey = {
      providerId: "openai-compatible",
      baseUrl: "https://api.openai.com",
      model: "gpt-4o-mini",
      ollamaPreferredModel: "llama3.1:8b",
      allowRemoteProvider: true,
      allowLocalProvider: false,
      webllmConsent: false,
      webllmPreferredModel: "",
      webllmLastRecommendedModel: "",
    };
    localStorage.setItem(scopeStorageKey(scopeIdentity), JSON.stringify(withoutApiKey));

    expect((await loadSettingsAsync(scopeIdentity))?.apiKey).toBe("");
  });

  it("derives defaults, WebLLM fallback, model selection, and status copy", () => {
    expect(createDefaultProviderSettings(false, "primary-web-model")).toMatchObject({
      providerId: "openai-compatible",
      baseUrl: "https://api.openai.com",
      model: "gpt-4o-mini",
    });
    expect(createDefaultProviderSettings(true, "primary-web-model")).toMatchObject({
      providerId: "webllm",
      baseUrl: "",
      model: "primary-web-model",
    });

    const defaults = deriveHydratedProviderSettingsView({
      saved: null,
      webLLMEnabled: true,
      webLLMPrimaryModel: "primary-web-model",
      providerDefinitions,
    });
    expect(defaults).toMatchObject({
      providerId: "webllm",
      model: "primary-web-model",
      webllmSelectedModel: "primary-web-model",
      webllmModelManuallySet: false,
    });

    const disabled = deriveHydratedProviderSettingsView({
      saved: makeSettings({
        providerId: "webllm",
        baseUrl: "",
        model: "",
        ollamaPreferredModel: "",
        webllmLastRecommendedModel: "recommended-web-model",
      }),
      webLLMEnabled: false,
      webLLMPrimaryModel: "primary-web-model",
      providerDefinitions,
    });
    expect(disabled).toMatchObject({
      providerId: "openai-compatible",
      baseUrl: "https://api.openai.com",
      model: "gpt-4o-mini",
      ollamaPreferredModel: "llama3.1:8b",
      webllmSelectedModel: "recommended-web-model",
    });

    const unknownProvider = deriveHydratedProviderSettingsView({
      saved: makeSettings({ providerId: "unknown-provider" as LLMProviderSettings["providerId"] }),
      webLLMEnabled: true,
      webLLMPrimaryModel: "primary-web-model",
      providerDefinitions,
    });
    expect(unknownProvider).toMatchObject({
      providerId: "unknown-provider",
      baseUrl: "https://api.openai.com",
    });

    const remoteWithoutWebModel = deriveHydratedProviderSettingsView({
      saved: makeSettings({ webllmPreferredModel: "", webllmLastRecommendedModel: "" }),
      webLLMEnabled: true,
      webLLMPrimaryModel: "primary-web-model",
      providerDefinitions,
    });
    expect(remoteWithoutWebModel.webllmSelectedModel).toBe("primary-web-model");

    const manual = deriveHydratedProviderSettingsView({
      saved: makeSettings({
        providerId: "webllm",
        baseUrl: "",
        model: "",
        webllmPreferredModel: "manual-web-model",
      }),
      webLLMEnabled: true,
      webLLMPrimaryModel: "primary-web-model",
      providerDefinitions,
    });
    expect(manual).toMatchObject({
      webllmSelectedModel: "manual-web-model",
      webllmModelManuallySet: true,
    });

    expect(getProviderSettingsStatusMessage("loading", "idle", null)).toBe(
      "Loading saved provider settings...",
    );
    expect(getProviderSettingsStatusMessage("ready", "saving", null)).toBe(
      "Saving provider settings...",
    );
    expect(getProviderSettingsStatusMessage("ready", "saved", null)).toBe(
      "Provider settings saved.",
    );
    expect(getProviderSettingsStatusMessage("ready", "error", "disk full")).toBe(
      "Provider settings not saved: disk full",
    );
    expect(getProviderSettingsStatusMessage("error", "error", null)).toBe(
      "Provider settings not saved: Unknown error",
    );
    expect(getProviderSettingsStatusMessage("ready", "idle", null)).toBe(
      "Provider settings save automatically.",
    );
  });

  it("clears settings for the scoped token", async () => {
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

    await providerSettingsStore.hydrate(scopeIdentity);
    await providerSettingsStore.save(scopeIdentity, settings);
    expect(await loadSettingsAsync(scopeIdentity)).not.toBeNull();
    clearSettings(scopeIdentity);
    expect(await loadSettingsAsync(scopeIdentity)).toBeNull();
  });

  it("uses clean defaults when a newly hydrated account has no saved settings", async () => {
    vi.stubEnv("VITE_LLM_SETTINGS_ENCRYPTION_KEY", "test-secret");
    const freshScopeIdentity = "github:84";
    const accountA = makeSettings({ apiKey: "sk-account-a", allowRemoteProvider: true });
    const cleanDefaults = makeSettings({ apiKey: "", allowRemoteProvider: false });

    await providerSettingsStore.hydrate(scopeIdentity);
    await providerSettingsStore.save(scopeIdentity, accountA);
    const freshSaved = await providerSettingsStore.hydrate(freshScopeIdentity);
    const freshSettings = resolveHydratedProviderSettings(freshSaved, cleanDefaults);
    await providerSettingsStore.save(freshScopeIdentity, freshSettings);

    expect((await loadSettingsAsync(scopeIdentity))?.apiKey).toBe("sk-account-a");
    expect(await loadSettingsAsync(freshScopeIdentity)).toEqual(cleanDefaults);
  });

  it("does not let a pending encrypted save resurrect cleared settings", async () => {
    vi.stubEnv("VITE_LLM_SETTINGS_ENCRYPTION_KEY", "test-secret");
    await providerSettingsStore.hydrate(scopeIdentity);
    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let releaseEncryption: (() => void) | undefined;
    const encryptionGate = new Promise<void>((resolve) => {
      releaseEncryption = resolve;
    });
    vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (algorithm, key, data) => {
      await encryptionGate;
      return originalEncrypt(algorithm, key, data);
    });

    const pendingSave = providerSettingsStore.save(
      scopeIdentity,
      makeSettings({ apiKey: "sk-must-not-return" }),
    );
    await vi.waitFor(() => expect(crypto.subtle.encrypt).toHaveBeenCalledOnce());
    clearSettings(scopeIdentity);
    releaseEncryption?.();

    await expect(pendingSave).resolves.toBeUndefined();
    expect(await loadSettingsAsync(scopeIdentity)).toBeNull();
    await expect(
      providerSettingsStore.save(scopeIdentity, makeSettings({ apiKey: "sk-after-clear" })),
    ).rejects.toThrow("Provider settings are still loading");
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
    expect((await loadSettingsAsync(scopeIdentity))?.providerId).toBe("ollama");
  });

  it("discards malformed legacy records instead of blocking future logins", async () => {
    const legacyKey = hashStorageKey(legacyToken);
    localStorage.setItem(legacyKey, "{not-json");

    await expect(migrateLegacySettingsScope(legacyToken, scopeIdentity)).resolves.toBeUndefined();

    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect(localStorage.getItem(scopeStorageKey(scopeIdentity))).toBeNull();
  });

  it("hydrates encrypted records without substituting a blank API key", async () => {
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

    expect(await loadSettingsAsync(scopeIdentity)).toEqual({
      providerId: "openai-compatible",
      baseUrl: "https://api.openai.com",
      model: "gpt-4o-mini",
      ollamaPreferredModel: "",
      apiKey: "sk-live",
      allowRemoteProvider: true,
      allowLocalProvider: false,
      webllmConsent: false,
      webllmPreferredModel: "",
      webllmLastRecommendedModel: "",
    });
  });

  it("loads historical hashed stable-scope records and promotes them on save", async () => {
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

    expect((await loadSettingsAsync(scopeIdentity))?.providerId).toBe("ollama");

    await providerSettingsStore.hydrate(scopeIdentity);
    await providerSettingsStore.save(scopeIdentity, {
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

  it("serializes at least 100 delayed encrypted saves so the newest value is durable", async () => {
    vi.stubEnv("VITE_LLM_SETTINGS_ENCRYPTION_KEY", "test-secret");
    await providerSettingsStore.hydrate(scopeIdentity);
    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let invocation = 0;
    let activeEncryptions = 0;
    let peakActiveEncryptions = 0;
    vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (algorithm, key, data) => {
      const current = invocation;
      invocation += 1;
      activeEncryptions += 1;
      peakActiveEncryptions = Math.max(peakActiveEncryptions, activeEncryptions);
      await new Promise((resolve) => setTimeout(resolve, (current * 37) % 5));
      try {
        return await originalEncrypt(algorithm, key, data);
      } finally {
        activeEncryptions -= 1;
      }
    });

    const saves = Array.from({ length: 100 }, (_, index) =>
      providerSettingsStore.save(scopeIdentity, makeSettings({ apiKey: `sk-${index}` })),
    );
    await Promise.all(saves);

    expect(invocation).toBe(100);
    expect(peakActiveEncryptions).toBe(1);
    expect((await loadSettingsAsync(scopeIdentity))?.apiKey).toBe("sk-99");
  });

  it("reports a failed write without poisoning the next queued save", async () => {
    vi.stubEnv("VITE_LLM_SETTINGS_ENCRYPTION_KEY", "test-secret");
    await providerSettingsStore.hydrate(scopeIdentity);
    storage.failNextSet = true;

    const failedSave = providerSettingsStore.save(
      scopeIdentity,
      makeSettings({ apiKey: "sk-failed" }),
    );
    const recoveredSave = providerSettingsStore.save(
      scopeIdentity,
      makeSettings({ apiKey: "sk-recovered" }),
    );

    await expect(failedSave).rejects.toThrow("simulated storage failure");
    await expect(recoveredSave).resolves.toBeUndefined();
    expect((await loadSettingsAsync(scopeIdentity))?.apiKey).toBe("sk-recovered");
  });

  it("preserves an encrypted record when hydration cannot decrypt it", async () => {
    vi.stubEnv("VITE_LLM_SETTINGS_ENCRYPTION_KEY", "wrong-secret");
    const key = scopeStorageKey(scopeIdentity);
    const apiKeyEncrypted = await encryptApiKey(scopeIdentity, "correct-secret", "sk-live");
    const stored = JSON.stringify({
      ...makeSettings({ apiKey: "" }),
      apiKey: undefined,
      apiKeyEncrypted,
    });
    localStorage.setItem(key, stored);

    await expect(loadSettingsAsync(scopeIdentity)).rejects.toThrow(
      "Encrypted provider settings could not be decrypted",
    );
    expect(localStorage.getItem(key)).toBe(stored);
  });

  it("rejects a pre-hydration save instead of replacing an encrypted key with blank state", async () => {
    vi.stubEnv("VITE_LLM_SETTINGS_ENCRYPTION_KEY", "test-secret");
    const key = scopeStorageKey(scopeIdentity);
    const apiKeyEncrypted = await encryptApiKey(scopeIdentity, "test-secret", "sk-live");
    const stored = JSON.stringify({
      ...makeSettings({ apiKey: "" }),
      apiKey: undefined,
      apiKeyEncrypted,
    });
    localStorage.setItem(key, stored);

    const originalDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    let releaseDecryption: (() => void) | undefined;
    const decryptionGate = new Promise<void>((resolve) => {
      releaseDecryption = resolve;
    });
    vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (algorithm, cryptoKey, data) => {
      await decryptionGate;
      return originalDecrypt(algorithm, cryptoKey, data);
    });

    const hydration = providerSettingsStore.hydrate(scopeIdentity);
    await expect(
      providerSettingsStore.save(scopeIdentity, makeSettings({ apiKey: "" })),
    ).rejects.toThrow("Provider settings are still loading");
    expect(localStorage.getItem(key)).toBe(stored);

    releaseDecryption?.();
    expect((await hydration)?.apiKey).toBe("sk-live");
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

  it("fails loudly and preserves the legacy record when the env secret is missing for encrypted migration", async () => {
    vi.stubEnv("VITE_LLM_SETTINGS_ENCRYPTION_KEY", "");
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

    await expect(migrateLegacySettingsScope(legacyToken, scopeIdentity)).rejects.toThrow(
      /Legacy encrypted API key cannot be migrated without VITE_LLM_SETTINGS_ENCRYPTION_KEY/,
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
