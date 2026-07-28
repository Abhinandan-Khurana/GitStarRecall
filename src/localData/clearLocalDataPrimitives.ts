import { buildEmbeddingPreferenceScopeKey } from "../auth/authScope";

const SCOPED_PREFERENCE_KEY_PREFIXES = [
  "gitstarrecall.embedding.ollama.consent",
  "gitstarrecall.embedding.ollama.pref",
  "gitstarrecall.retrieval.tuning",
  "gitstarrecall.sudo",
] as const;

/**
 * Exact Cache Storage buckets used by the browser embedding and WebLLM
 * dependencies configured by this app. Keep this allowlist narrow: deleting an
 * arbitrary cache merely because its name contains "model" could erase another
 * application or service worker's data on the same origin.
 */
export const APP_MODEL_CACHE_NAMES = [
  "transformers-cache",
  "webllm/model",
  "webllm/config",
  "webllm/wasm",
] as const;

type PreferenceStorage = Pick<Storage, "getItem" | "removeItem">;
type InspectableCacheStorage = Pick<CacheStorage, "delete" | "keys">;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwDeletionFailures(label: string, failures: unknown[]): void {
  if (failures.length === 0) return;
  throw new AggregateError(
    failures,
    `${label}: ${failures.map((failure) => errorMessage(failure)).join("; ")}`,
  );
}

function requireScopeIdentity(scopeIdentity: string): string {
  const normalized = scopeIdentity.trim();
  if (!normalized) {
    throw new Error("An authenticated scope identity is required to clear preferences");
  }
  return normalized;
}

function resolveLocalStorage(): PreferenceStorage {
  if (typeof localStorage === "undefined") {
    throw new Error("localStorage is unavailable; scoped preferences could not be cleared");
  }
  return localStorage;
}

/** Returns the complete, exact preference-key set owned by one identity. */
export function getScopedPreferenceKeys(scopeIdentity: string): string[] {
  const normalizedIdentity = requireScopeIdentity(scopeIdentity);
  const storageScope = buildEmbeddingPreferenceScopeKey(normalizedIdentity);
  return SCOPED_PREFERENCE_KEY_PREFIXES.map((prefix) => `${prefix}.${storageScope}`);
}

/**
 * Strictly removes only identity-scoped app preferences and verifies that each
 * key is gone. Global UI choices such as theme and onboarding are intentionally
 * outside this key set.
 */
export function clearScopedPreferences(scopeIdentity: string, storage?: PreferenceStorage): void {
  const keys = getScopedPreferenceKeys(scopeIdentity);
  const resolvedStorage = storage ?? resolveLocalStorage();
  const failures: unknown[] = [];

  for (const key of keys) {
    try {
      resolvedStorage.removeItem(key);
    } catch (error) {
      failures.push(error);
    }
  }

  const retainedKeys: string[] = [];
  for (const key of keys) {
    try {
      if (resolvedStorage.getItem(key) !== null) retainedKeys.push(key);
    } catch (error) {
      failures.push(error);
    }
  }
  if (retainedKeys.length > 0) {
    failures.push(
      new Error(`Scoped preference deletion could not be verified: ${retainedKeys.join(", ")}`),
    );
  }
  throwDeletionFailures("Scoped preference deletion failed", failures);
}

function resolveCacheStorage(): InspectableCacheStorage | null {
  const candidate = (globalThis as { caches?: unknown }).caches;
  if (
    (typeof candidate !== "object" && typeof candidate !== "function") ||
    candidate === null ||
    typeof (candidate as Partial<InspectableCacheStorage>).keys !== "function" ||
    typeof (candidate as Partial<InspectableCacheStorage>).delete !== "function"
  ) {
    return null;
  }
  return candidate as InspectableCacheStorage;
}

/**
 * Clears only the app's known model/runtime Cache Storage buckets. Browsers
 * without Cache Storage have nothing to clear here and are treated as a no-op.
 * The caller remains responsible for aborting downloads and unloading any
 * already-instantiated in-memory provider/worker engines before invoking this.
 */
export async function clearModelCaches(
  cacheStorage: InspectableCacheStorage | null = resolveCacheStorage(),
): Promise<void> {
  if (cacheStorage === null) {
    return;
  }

  const ownedNames = new Set<string>(APP_MODEL_CACHE_NAMES);
  const existingNames = await cacheStorage.keys();
  const targets = existingNames.filter((name) => ownedNames.has(name));
  const failures: unknown[] = [];

  for (const name of targets) {
    try {
      await cacheStorage.delete(name);
    } catch (error) {
      failures.push(error);
    }
  }

  let retainedOwnedNames: string[] = [];
  try {
    retainedOwnedNames = (await cacheStorage.keys()).filter((name) => ownedNames.has(name));
  } catch (error) {
    failures.push(error);
  }
  if (retainedOwnedNames.length > 0) {
    failures.push(
      new Error(`Model cache deletion could not be verified: ${retainedOwnedNames.join(", ")}`),
    );
  }
  throwDeletionFailures("Model cache deletion failed", failures);
}
