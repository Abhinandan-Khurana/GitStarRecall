import type { LLMProviderDefinition, LLMProviderId } from "../llm/types";

export type LLMProviderSettings = {
  providerId: LLMProviderId;
  baseUrl: string;
  model: string;
  ollamaPreferredModel: string;
  apiKey: string;
  allowRemoteProvider: boolean;
  allowLocalProvider: boolean;
  webllmConsent: boolean;
  webllmPreferredModel: string;
  webllmLastRecommendedModel: string;
};

export type ProviderSettingsHydrationState = "loading" | "ready" | "error";
export type ProviderSettingsSaveState = "idle" | "saving" | "saved" | "error";

export type ProviderSettingsStore = {
  hydrate(scopeIdentity: string | null): Promise<LLMProviderSettings | null>;
  save(scopeIdentity: string | null, settings: LLMProviderSettings): Promise<void>;
};

export function resolveHydratedProviderSettings(
  saved: LLMProviderSettings | null,
  defaults: LLMProviderSettings,
): LLMProviderSettings {
  return { ...(saved ?? defaults) };
}

export function createDefaultProviderSettings(
  webLLMEnabled: boolean,
  webLLMPrimaryModel: string,
): LLMProviderSettings {
  return {
    providerId: webLLMEnabled ? "webllm" : "openai-compatible",
    baseUrl: webLLMEnabled ? "" : "https://api.openai.com",
    model: webLLMEnabled ? webLLMPrimaryModel : "gpt-4o-mini",
    ollamaPreferredModel: "llama3.1:8b",
    apiKey: "",
    allowRemoteProvider: false,
    allowLocalProvider: false,
    webllmConsent: false,
    webllmPreferredModel: "",
    webllmLastRecommendedModel: "",
  };
}

export type HydratedProviderSettingsView = {
  providerId: LLMProviderId;
  baseUrl: string;
  model: string;
  ollamaPreferredModel: string;
  apiKey: string;
  allowRemoteProvider: boolean;
  allowLocalProvider: boolean;
  webllmConsent: boolean;
  webllmSelectedModel: string;
  webllmModelManuallySet: boolean;
  webllmLastRecommendedModel: string;
};

export function deriveHydratedProviderSettingsView(input: {
  saved: LLMProviderSettings | null;
  webLLMEnabled: boolean;
  webLLMPrimaryModel: string;
  providerDefinitions: LLMProviderDefinition[];
}): HydratedProviderSettingsView {
  const hydrated = resolveHydratedProviderSettings(
    input.saved,
    createDefaultProviderSettings(input.webLLMEnabled, input.webLLMPrimaryModel),
  );
  const requestedProviderId =
    !input.webLLMEnabled && hydrated.providerId === "webllm"
      ? "openai-compatible"
      : hydrated.providerId;
  const provider =
    input.providerDefinitions.find((definition) => definition.id === requestedProviderId) ??
    input.providerDefinitions[0];
  const providerId = provider.id;
  const webllmSelectedModel =
    provider.id === "webllm"
      ? hydrated.webllmPreferredModel || hydrated.model || input.webLLMPrimaryModel
      : hydrated.webllmPreferredModel ||
        hydrated.webllmLastRecommendedModel ||
        input.webLLMPrimaryModel;

  return {
    providerId,
    baseUrl: hydrated.baseUrl || provider.defaultBaseUrl,
    model: hydrated.model || provider.defaultModel,
    ollamaPreferredModel: hydrated.ollamaPreferredModel || "llama3.1:8b",
    apiKey: hydrated.apiKey,
    allowRemoteProvider: hydrated.allowRemoteProvider,
    allowLocalProvider: hydrated.allowLocalProvider,
    webllmConsent: hydrated.webllmConsent,
    webllmSelectedModel,
    webllmModelManuallySet: Boolean(hydrated.webllmPreferredModel),
    webllmLastRecommendedModel: hydrated.webllmLastRecommendedModel ?? "",
  };
}

export function getProviderSettingsStatusMessage(
  hydrationState: ProviderSettingsHydrationState,
  saveState: ProviderSettingsSaveState,
  error: string | null,
): string {
  if (hydrationState === "loading") return "Loading saved provider settings...";
  if (saveState === "saving") return "Saving provider settings...";
  if (saveState === "saved") return "Provider settings saved.";
  if (saveState === "error") {
    return `Provider settings not saved: ${error ?? "Unknown error"}`;
  }
  return "Provider settings save automatically.";
}

const STORAGE_KEY_PREFIX = "gitstarrecall.llm.settings.";
const STABLE_SCOPE_KEY_PREFIX = `${STORAGE_KEY_PREFIX}scope.`;
const GCM_IV_LENGTH = 12;
const saveQueueByScope = new Map<string, Promise<void>>();
const hydratedScopes = new Set<string>();
const hydrationRevisionByScope = new Map<string, number>();
const persistenceRevisionByScope = new Map<string, number>();
const VALID_PROVIDER_IDS = new Set<LLMProviderId>([
  "openai-compatible",
  "ollama",
  "lmstudio",
  "webllm",
]);

function hashScopeValue(raw: string): string {
  return Math.abs(
    raw.split("").reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0),
  ).toString();
}

function encodeScopeIdentity(scopeIdentity: string): string {
  return encodeURIComponent(scopeIdentity);
}

function getStorageKey(scopeIdentity: string): string {
  return `${STABLE_SCOPE_KEY_PREFIX}${encodeScopeIdentity(scopeIdentity)}`;
}

function getHistoricalScopeStorageKey(scopeIdentity: string): string {
  return `${STORAGE_KEY_PREFIX}${hashScopeValue(scopeIdentity)}`;
}

function getLegacyTokenStorageKey(token: string): string {
  return `${STORAGE_KEY_PREFIX}${hashScopeValue(token)}`;
}

function getStoredSettingsRecord(scopeIdentity: string): { key: string; value: string } | null {
  const primaryKey = getStorageKey(scopeIdentity);
  const primaryValue = localStorage.getItem(primaryKey);
  if (primaryValue) {
    return {
      key: primaryKey,
      value: primaryValue,
    };
  }

  const historicalKey = getHistoricalScopeStorageKey(scopeIdentity);
  const historicalValue = localStorage.getItem(historicalKey);
  if (historicalValue) {
    return {
      key: historicalKey,
      value: historicalValue,
    };
  }

  return null;
}

function clearHistoricalScopeStorageKey(scopeIdentity: string): void {
  const historicalKey = getHistoricalScopeStorageKey(scopeIdentity);
  if (historicalKey !== getStorageKey(scopeIdentity)) {
    localStorage.removeItem(historicalKey);
  }
}

function persistScopedSettingsValue(scopeIdentity: string, value: string): void {
  const key = getStorageKey(scopeIdentity);
  localStorage.setItem(key, value);
  clearHistoricalScopeStorageKey(scopeIdentity);
}

function getEncryptionKeyEnv(): string {
  const v = import.meta.env.VITE_LLM_SETTINGS_ENCRYPTION_KEY;
  return typeof v === "string" ? v : "";
}

async function deriveKey(sessionToken: string, envSecret: string): Promise<CryptoKey> {
  const combined = new TextEncoder().encode(sessionToken + envSecret);
  const hash = await crypto.subtle.digest("SHA-256", combined);
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(ciphertextBase64: string, key: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(ciphertextBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, GCM_IV_LENGTH);
  const data = combined.slice(GCM_IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

type StoredSettings = Omit<LLMProviderSettings, "apiKey"> & {
  apiKey?: string;
  apiKeyEncrypted?: string;
};

function isValidStoredShape(parsed: unknown): parsed is StoredSettings {
  if (parsed == null || typeof parsed !== "object") return false;
  const p = parsed as Record<string, unknown>;
  return (
    typeof p.providerId === "string" &&
    VALID_PROVIDER_IDS.has(p.providerId as LLMProviderId) &&
    typeof p.baseUrl === "string" &&
    typeof p.model === "string" &&
    (p.ollamaPreferredModel === undefined || typeof p.ollamaPreferredModel === "string") &&
    typeof p.allowRemoteProvider === "boolean" &&
    typeof p.allowLocalProvider === "boolean" &&
    (p.webllmConsent === undefined || typeof p.webllmConsent === "boolean") &&
    (p.webllmPreferredModel === undefined || typeof p.webllmPreferredModel === "string") &&
    (p.webllmLastRecommendedModel === undefined ||
      typeof p.webllmLastRecommendedModel === "string") &&
    (p.apiKey === undefined || typeof p.apiKey === "string") &&
    (p.apiKeyEncrypted === undefined || typeof p.apiKeyEncrypted === "string")
  );
}

export async function loadSettingsAsync(
  scopeIdentity: string | null,
): Promise<LLMProviderSettings | null> {
  if (!scopeIdentity) return null;

  const stored = getStoredSettingsRecord(scopeIdentity);
  if (!stored) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.value) as unknown;
  } catch {
    throw new Error("Saved provider settings are not valid JSON");
  }
  if (!isValidStoredShape(parsed)) {
    throw new Error("Saved provider settings have an invalid shape");
  }

  const base: Omit<LLMProviderSettings, "apiKey"> = {
    providerId: parsed.providerId,
    baseUrl: parsed.baseUrl,
    model: parsed.model,
    ollamaPreferredModel:
      typeof parsed.ollamaPreferredModel === "string" ? parsed.ollamaPreferredModel : "",
    allowRemoteProvider: parsed.allowRemoteProvider,
    allowLocalProvider: parsed.allowLocalProvider,
    webllmConsent: parsed.webllmConsent === true,
    webllmPreferredModel:
      typeof parsed.webllmPreferredModel === "string" ? parsed.webllmPreferredModel : "",
    webllmLastRecommendedModel:
      typeof parsed.webllmLastRecommendedModel === "string"
        ? parsed.webllmLastRecommendedModel
        : "",
  };

  if (typeof parsed.apiKeyEncrypted === "string") {
    const envSecret = getEncryptionKeyEnv();
    if (!envSecret || typeof crypto === "undefined" || !crypto.subtle) {
      throw new Error(
        "Encrypted provider settings require VITE_LLM_SETTINGS_ENCRYPTION_KEY and Web Crypto support",
      );
    }
    try {
      const cryptoKey = await deriveKey(scopeIdentity, envSecret);
      const apiKey = await decrypt(parsed.apiKeyEncrypted, cryptoKey);
      return { ...base, apiKey };
    } catch {
      throw new Error("Encrypted provider settings could not be decrypted");
    }
  }

  if (typeof parsed.apiKey === "string") {
    return { ...base, apiKey: parsed.apiKey };
  }

  return { ...base, apiKey: "" };
}

async function persistSettingsSnapshot(
  scopeIdentity: string,
  settings: LLMProviderSettings,
  persistenceRevision: number,
): Promise<void> {
  const snapshot = { ...settings, apiKey: settings.apiKey.trim() };

  const envSecret = getEncryptionKeyEnv();
  const hasApiKey = snapshot.apiKey.length > 0;

  const toStore: StoredSettings = {
    providerId: snapshot.providerId,
    baseUrl: snapshot.baseUrl,
    model: snapshot.model,
    ollamaPreferredModel: snapshot.ollamaPreferredModel,
    allowRemoteProvider: snapshot.allowRemoteProvider,
    allowLocalProvider: snapshot.allowLocalProvider,
    webllmConsent: snapshot.webllmConsent,
    webllmPreferredModel: snapshot.webllmPreferredModel,
    webllmLastRecommendedModel: snapshot.webllmLastRecommendedModel,
  };

  if (!hasApiKey) {
    if ((persistenceRevisionByScope.get(scopeIdentity) ?? 0) !== persistenceRevision) return;
    persistScopedSettingsValue(scopeIdentity, JSON.stringify({ ...toStore, apiKey: "" }));
    return;
  }

  if (!envSecret || typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error(
      "Provider API keys require VITE_LLM_SETTINGS_ENCRYPTION_KEY and Web Crypto support",
    );
  }

  const cryptoKey = await deriveKey(scopeIdentity, envSecret);
  const apiKeyEncrypted = await encrypt(snapshot.apiKey, cryptoKey);
  if ((persistenceRevisionByScope.get(scopeIdentity) ?? 0) !== persistenceRevision) return;
  persistScopedSettingsValue(scopeIdentity, JSON.stringify({ ...toStore, apiKeyEncrypted }));
}

function enqueueSettingsSave(
  scopeIdentity: string | null,
  settings: LLMProviderSettings,
): Promise<void> {
  if (!scopeIdentity) return Promise.resolve();

  const snapshot = { ...settings };
  const persistenceRevision = persistenceRevisionByScope.get(scopeIdentity) ?? 0;
  const previous = saveQueueByScope.get(scopeIdentity) ?? Promise.resolve();
  const operation = previous.then(() =>
    persistSettingsSnapshot(scopeIdentity, snapshot, persistenceRevision),
  );
  const queueTail = operation.catch(() => undefined);
  saveQueueByScope.set(scopeIdentity, queueTail);
  void queueTail.then(() => {
    if (saveQueueByScope.get(scopeIdentity) === queueTail) {
      saveQueueByScope.delete(scopeIdentity);
    }
  });
  return operation;
}

export const providerSettingsStore: ProviderSettingsStore = {
  hydrate(scopeIdentity) {
    if (!scopeIdentity) return Promise.resolve(null);

    hydratedScopes.delete(scopeIdentity);
    const revision = (hydrationRevisionByScope.get(scopeIdentity) ?? 0) + 1;
    hydrationRevisionByScope.set(scopeIdentity, revision);
    return loadSettingsAsync(scopeIdentity).then((settings) => {
      if (hydrationRevisionByScope.get(scopeIdentity) !== revision) return null;
      hydratedScopes.add(scopeIdentity);
      return settings;
    });
  },
  save(scopeIdentity, settings) {
    if (scopeIdentity && !hydratedScopes.has(scopeIdentity)) {
      return Promise.reject(new Error("Provider settings are still loading"));
    }
    return enqueueSettingsSave(scopeIdentity, settings);
  },
};

export function resetProviderSettingsStoreForTests(): void {
  saveQueueByScope.clear();
  hydratedScopes.clear();
  hydrationRevisionByScope.clear();
  persistenceRevisionByScope.clear();
}

function invalidateProviderSettingsScope(scopeIdentity: string): void {
  persistenceRevisionByScope.set(
    scopeIdentity,
    (persistenceRevisionByScope.get(scopeIdentity) ?? 0) + 1,
  );
  hydrationRevisionByScope.set(
    scopeIdentity,
    (hydrationRevisionByScope.get(scopeIdentity) ?? 0) + 1,
  );
  hydratedScopes.delete(scopeIdentity);
}

export function clearSettings(scopeIdentity: string | null): void {
  if (!scopeIdentity) return;

  invalidateProviderSettingsScope(scopeIdentity);

  try {
    const key = getStorageKey(scopeIdentity);
    localStorage.removeItem(key);
    clearHistoricalScopeStorageKey(scopeIdentity);
  } catch {
    // Ignore errors
  }
}

export async function clearSettingsStrict(scopeIdentity: string): Promise<void> {
  if (scopeIdentity.trim().length === 0) {
    throw new Error("Provider settings scope is required");
  }

  invalidateProviderSettingsScope(scopeIdentity);

  // A save that already started may still be encrypting. Its captured persistence
  // revision prevents it from writing, but wait for the queue before removing an
  // older value that may already have reached storage.
  await (saveQueueByScope.get(scopeIdentity) ?? Promise.resolve());
  // Hydration may have started after the first invalidation while the save queue
  // was draining. Revoke that stale eligibility at the deletion boundary.
  invalidateProviderSettingsScope(scopeIdentity);

  const keys = Array.from(
    new Set([getStorageKey(scopeIdentity), getHistoricalScopeStorageKey(scopeIdentity)]),
  );
  let storageFailure: unknown;

  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      storageFailure ??= error;
    }
  }

  for (const key of keys) {
    try {
      if (localStorage.getItem(key) !== null) {
        storageFailure ??= new Error(`Provider settings key was not removed: ${key}`);
      }
    } catch (error) {
      storageFailure ??= error;
    }
  }

  if (storageFailure) {
    throw storageFailure;
  }
}

export async function migrateLegacySettingsScope(
  legacyToken: string | null,
  scopeIdentity: string | null,
): Promise<void> {
  if (!legacyToken || !scopeIdentity || typeof localStorage === "undefined") {
    return;
  }

  try {
    const legacyKey = getLegacyTokenStorageKey(legacyToken);
    const legacyValue = localStorage.getItem(legacyKey);
    const existingScopedRecord = getStoredSettingsRecord(scopeIdentity);

    if (existingScopedRecord) {
      if (existingScopedRecord.key !== getStorageKey(scopeIdentity)) {
        persistScopedSettingsValue(scopeIdentity, existingScopedRecord.value);
      }
      if (legacyValue) {
        localStorage.removeItem(legacyKey);
      }
      return;
    }

    if (!legacyValue) {
      return;
    }

    let nextValue = legacyValue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(legacyValue) as unknown;
    } catch {
      localStorage.removeItem(legacyKey);
      return;
    }
    if (isValidStoredShape(parsed) && typeof parsed.apiKeyEncrypted === "string") {
      const envSecret = getEncryptionKeyEnv();
      if (!envSecret || typeof crypto === "undefined" || !crypto.subtle) {
        throw new Error(
          "Legacy encrypted API key cannot be migrated without VITE_LLM_SETTINGS_ENCRYPTION_KEY and Web Crypto support",
        );
      }
      const legacyCryptoKey = await deriveKey(legacyToken, envSecret);
      const apiKey = await decrypt(parsed.apiKeyEncrypted, legacyCryptoKey);
      const nextCryptoKey = await deriveKey(scopeIdentity, envSecret);
      const apiKeyEncrypted = await encrypt(apiKey, nextCryptoKey);
      nextValue = JSON.stringify({
        ...parsed,
        apiKeyEncrypted,
      });
    }

    persistScopedSettingsValue(scopeIdentity, nextValue);
    localStorage.removeItem(legacyKey);
  } catch (error) {
    throw new Error(
      `Failed to migrate legacy LLM settings scope: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
