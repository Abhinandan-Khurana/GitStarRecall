import type { LLMProviderId } from "../llm/types";

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

const STORAGE_KEY_PREFIX = "gitstarrecall.llm.settings.";
const GCM_IV_LENGTH = 12;

function hashScopeValue(raw: string): string {
  return Math.abs(
    raw.split("").reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0),
  ).toString();
}

function getStorageKey(scopeIdentity: string): string {
  return `${STORAGE_KEY_PREFIX}${hashScopeValue(scopeIdentity)}`;
}

function getLegacyTokenStorageKey(token: string): string {
  return `${STORAGE_KEY_PREFIX}${hashScopeValue(token)}`;
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
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(ciphertextBase64: string, key: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(ciphertextBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, GCM_IV_LENGTH);
  const data = combined.slice(GCM_IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
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
    typeof p.baseUrl === "string" &&
    typeof p.model === "string" &&
    (p.ollamaPreferredModel === undefined || typeof p.ollamaPreferredModel === "string") &&
    typeof p.allowRemoteProvider === "boolean" &&
    typeof p.allowLocalProvider === "boolean" &&
    (p.webllmConsent === undefined || typeof p.webllmConsent === "boolean") &&
    (p.webllmPreferredModel === undefined || typeof p.webllmPreferredModel === "string") &&
    (p.webllmLastRecommendedModel === undefined || typeof p.webllmLastRecommendedModel === "string") &&
    (p.apiKey === undefined || typeof p.apiKey === "string") &&
    (p.apiKeyEncrypted === undefined || typeof p.apiKeyEncrypted === "string")
  );
}

export function loadSettings(scopeIdentity: string | null): LLMProviderSettings | null {
  if (!scopeIdentity) return null;

  try {
    const key = getStorageKey(scopeIdentity);
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as unknown;
    if (!isValidStoredShape(parsed)) return null;

    const base: Omit<LLMProviderSettings, "apiKey"> = {
      providerId: parsed.providerId as LLMProviderId,
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
        typeof parsed.webllmLastRecommendedModel === "string" ? parsed.webllmLastRecommendedModel : "",
    };

    if (typeof parsed.apiKeyEncrypted === "string") {
      return null;
    }

    if (typeof parsed.apiKey === "string") {
      return { ...base, apiKey: parsed.apiKey };
    }

    return { ...base, apiKey: "" };
  } catch {
    return null;
  }
}

export async function loadSettingsAsync(scopeIdentity: string | null): Promise<LLMProviderSettings | null> {
  if (!scopeIdentity) return null;

  try {
    const key = getStorageKey(scopeIdentity);
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as unknown;
    if (!isValidStoredShape(parsed)) return null;

    const base: Omit<LLMProviderSettings, "apiKey"> = {
      providerId: parsed.providerId as LLMProviderId,
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
        typeof parsed.webllmLastRecommendedModel === "string" ? parsed.webllmLastRecommendedModel : "",
    };

    if (typeof parsed.apiKeyEncrypted === "string") {
      const envSecret = getEncryptionKeyEnv();
      if (!envSecret) return { ...base, apiKey: "" };
      try {
        const cryptoKey = await deriveKey(scopeIdentity, envSecret);
        const apiKey = await decrypt(parsed.apiKeyEncrypted as string, cryptoKey);
        return { ...base, apiKey };
      } catch {
        return { ...base, apiKey: "" };
      }
    }

    if (typeof parsed.apiKey === "string") {
      return { ...base, apiKey: parsed.apiKey };
    }

    return { ...base, apiKey: "" };
  } catch {
    return null;
  }
}

export function saveSettings(scopeIdentity: string | null, settings: LLMProviderSettings): void {
  if (!scopeIdentity) return;

  const envSecret = getEncryptionKeyEnv();
  const hasApiKey = Boolean(settings.apiKey && settings.apiKey.trim());

  const toStore: StoredSettings = {
    providerId: settings.providerId,
    baseUrl: settings.baseUrl,
    model: settings.model,
    ollamaPreferredModel: settings.ollamaPreferredModel,
    allowRemoteProvider: settings.allowRemoteProvider,
    allowLocalProvider: settings.allowLocalProvider,
    webllmConsent: settings.webllmConsent,
    webllmPreferredModel: settings.webllmPreferredModel,
    webllmLastRecommendedModel: settings.webllmLastRecommendedModel,
  };

  if (hasApiKey && envSecret && typeof crypto !== "undefined" && crypto.subtle) {
    deriveKey(scopeIdentity, envSecret)
      .then((cryptoKey) => encrypt(settings.apiKey.trim(), cryptoKey))
      .then((apiKeyEncrypted) => {
        try {
          const key = getStorageKey(scopeIdentity);
          localStorage.setItem(key, JSON.stringify({ ...toStore, apiKeyEncrypted }));
        } catch {
          console.warn("Failed to save LLM settings to localStorage");
        }
      })
      .catch(() => {
        try {
          const key = getStorageKey(scopeIdentity);
          localStorage.setItem(key, JSON.stringify({ ...toStore }));
        } catch {
          console.warn("Failed to save LLM settings to localStorage");
        }
      });
    return;
  }

  try {
    const key = getStorageKey(scopeIdentity);
    if (!hasApiKey) {
      localStorage.setItem(key, JSON.stringify({ ...toStore, apiKey: "" }));
    } else {
      localStorage.setItem(key, JSON.stringify(toStore));
    }
  } catch {
    console.warn("Failed to save LLM settings to localStorage");
  }
}

export function clearSettings(scopeIdentity: string | null): void {
  if (!scopeIdentity) return;

  try {
    const key = getStorageKey(scopeIdentity);
    localStorage.removeItem(key);
  } catch {
    // Ignore errors
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
    const nextKey = getStorageKey(scopeIdentity);
    const legacyValue = localStorage.getItem(legacyKey);
    if (!legacyValue) {
      return;
    }

    if (!localStorage.getItem(nextKey)) {
      let nextValue = legacyValue;
      const envSecret = getEncryptionKeyEnv();
      if (envSecret && typeof crypto !== "undefined" && crypto.subtle) {
        try {
          const parsed = JSON.parse(legacyValue) as unknown;
          if (isValidStoredShape(parsed) && typeof parsed.apiKeyEncrypted === "string") {
            const legacyCryptoKey = await deriveKey(legacyToken, envSecret);
            const apiKey = await decrypt(parsed.apiKeyEncrypted, legacyCryptoKey);
            const nextCryptoKey = await deriveKey(scopeIdentity, envSecret);
            const apiKeyEncrypted = await encrypt(apiKey, nextCryptoKey);
            nextValue = JSON.stringify({
              ...parsed,
              apiKeyEncrypted,
            });
          }
        } catch {
          nextValue = legacyValue;
        }
      }

      localStorage.setItem(nextKey, nextValue);
    }
    localStorage.removeItem(legacyKey);
  } catch {
    console.warn("Failed to migrate legacy LLM settings scope");
  }
}
