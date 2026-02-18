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

function getStorageKey(token: string): string {
  // Use a hash of the token to avoid storing sensitive data in plain text
  const hash = token.split("").reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0);
  return `${STORAGE_KEY_PREFIX}${Math.abs(hash)}`;
}

export function loadSettings(token: string | null): LLMProviderSettings | null {
  if (!token) return null;
  
  try {
    const key = getStorageKey(token);
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    
    const parsed = JSON.parse(stored);
    // Validate the structure
    if (
      typeof parsed.providerId === "string" &&
      typeof parsed.baseUrl === "string" &&
      typeof parsed.model === "string" &&
      typeof parsed.apiKey === "string" &&
      typeof parsed.allowRemoteProvider === "boolean" &&
      typeof parsed.allowLocalProvider === "boolean"
    ) {
      return parsed as LLMProviderSettings;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSettings(token: string | null, settings: LLMProviderSettings): void {
  if (!token) return;
  
  try {
    const key = getStorageKey(token);
    localStorage.setItem(key, JSON.stringify(settings));
  } catch {
    // Storage might be full or disabled
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
