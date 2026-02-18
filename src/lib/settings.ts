import type { LLMProviderId } from "../llm/types";

export type LLMProviderSettings = {
  providerId: LLMProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  allowRemoteProvider: boolean;
  allowLocalProvider: boolean;
};

const STORAGE_KEY_PREFIX = "gitstarrecall.llm.settings.";
const GCM_IV_LENGTH = 12;

function getStorageKey(token: string): string {
  // Use a hash of the token to avoid storing sensitive data in plain text
  const hash = token.split("").reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0);
  return `${STORAGE_KEY_PREFIX}${Math.abs(hash)}`;
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
    typeof p.allowRemoteProvider === "boolean" &&
    typeof p.allowLocalProvider === "boolean" &&
    (p.apiKey === undefined || typeof p.apiKey === "string") &&
    (p.apiKeyEncrypted === undefined || typeof p.apiKeyEncrypted === "string")
  );
}

export function loadSettings(token: string | null): LLMProviderSettings | null {
  if (!token) return null;

  try {
    const key = getStorageKey(token);
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as unknown;
    if (!isValidStoredShape(parsed)) return null;

    const base: Omit<LLMProviderSettings, "apiKey"> = {
      providerId: parsed.providerId as LLMProviderId,
      baseUrl: parsed.baseUrl,
      model: parsed.model,
      allowRemoteProvider: parsed.allowRemoteProvider,
      allowLocalProvider: parsed.allowLocalProvider,
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

export async function loadSettingsAsync(token: string | null): Promise<LLMProviderSettings | null> {
  if (!token) return null;

  try {
    const key = getStorageKey(token);
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as unknown;
    if (!isValidStoredShape(parsed)) return null;

    const base: Omit<LLMProviderSettings, "apiKey"> = {
      providerId: parsed.providerId as LLMProviderId,
      baseUrl: parsed.baseUrl,
      model: parsed.model,
      allowRemoteProvider: parsed.allowRemoteProvider,
      allowLocalProvider: parsed.allowLocalProvider,
    };

    if (typeof parsed.apiKeyEncrypted === "string") {
      const envSecret = getEncryptionKeyEnv();
      if (!envSecret) return { ...base, apiKey: "" };
      try {
        const cryptoKey = await deriveKey(token, envSecret);
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

export function saveSettings(token: string | null, settings: LLMProviderSettings): void {
  if (!token) return;

  const envSecret = getEncryptionKeyEnv();
  const hasApiKey = Boolean(settings.apiKey && settings.apiKey.trim());

  const toStore: StoredSettings = {
    providerId: settings.providerId,
    baseUrl: settings.baseUrl,
    model: settings.model,
    allowRemoteProvider: settings.allowRemoteProvider,
    allowLocalProvider: settings.allowLocalProvider,
  };

  if (hasApiKey && envSecret && typeof crypto !== "undefined" && crypto.subtle) {
    deriveKey(token, envSecret)
      .then((cryptoKey) => encrypt(settings.apiKey.trim(), cryptoKey))
      .then((apiKeyEncrypted) => {
        try {
          const key = getStorageKey(token);
          localStorage.setItem(key, JSON.stringify({ ...toStore, apiKeyEncrypted }));
        } catch {
          console.warn("Failed to save LLM settings to localStorage");
        }
      })
      .catch(() => {
        try {
          const key = getStorageKey(token);
          localStorage.setItem(key, JSON.stringify({ ...toStore }));
        } catch {
          console.warn("Failed to save LLM settings to localStorage");
        }
      });
    return;
  }

  try {
    const key = getStorageKey(token);
    if (!hasApiKey) {
      localStorage.setItem(key, JSON.stringify({ ...toStore, apiKey: "" }));
    } else {
      localStorage.setItem(key, JSON.stringify(toStore));
    }
  } catch {
    console.warn("Failed to save LLM settings to localStorage");
  }
}

export function clearSettings(token: string | null): void {
  if (!token) return;

  try {
    const key = getStorageKey(token);
    localStorage.removeItem(key);
  } catch {
    // Ignore errors
  }
}
