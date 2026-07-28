import {
  APP_MODEL_CACHE_NAMES,
  clearModelCaches,
  clearScopedPreferences,
  getScopedPreferenceKeys,
} from "./clearLocalDataPrimitives";

class MemoryStorage implements Pick<Storage, "getItem" | "removeItem"> {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class MemoryCacheStorage implements Pick<CacheStorage, "delete" | "keys"> {
  readonly names: Set<string>;

  constructor(names: readonly string[]) {
    this.names = new Set(names);
  }

  async delete(cacheName: string): Promise<boolean> {
    return this.names.delete(cacheName);
  }

  async keys(): Promise<string[]> {
    return [...this.names];
  }
}

describe("clearScopedPreferences", () => {
  test("removes and verifies the complete scoped preference set", () => {
    const storage = new MemoryStorage();
    const keys = getScopedPreferenceKeys("github:101");
    for (const key of keys) storage.values.set(key, `value:${key}`);

    clearScopedPreferences("github:101", storage);

    expect(keys).toHaveLength(4);
    expect(keys.every((key) => storage.getItem(key) === null)).toBe(true);
  });

  test("preserves another account and unrelated global preferences byte-for-byte", () => {
    const storage = new MemoryStorage();
    const accountAKeys = getScopedPreferenceKeys("github:101");
    const accountBEntries = getScopedPreferenceKeys("github:202").map(
      (key, index) => [key, `account-b-${index}-\u0000-data`] as const,
    );
    const unrelatedEntries = [
      ["gitstarrecall.theme", "dark"],
      ["gsr-workspace-guide-dismissed", "1"],
      ["unrelated-origin-preference", "preserve exactly"],
    ] as const;

    for (const key of accountAKeys) storage.values.set(key, "account-a");
    for (const [key, value] of [...accountBEntries, ...unrelatedEntries]) {
      storage.values.set(key, value);
    }
    const preservedBefore = new Map(
      [...accountBEntries, ...unrelatedEntries].map(([key]) => [key, storage.getItem(key)]),
    );

    clearScopedPreferences("github:101", storage);

    expect(new Map([...preservedBefore.keys()].map((key) => [key, storage.getItem(key)]))).toEqual(
      preservedBefore,
    );
  });

  test("rejects empty identities before touching storage", () => {
    const removeItem = vi.fn();

    expect(() => clearScopedPreferences("  ", { getItem: vi.fn(), removeItem })).toThrow(
      /scope identity is required/i,
    );
    expect(removeItem).not.toHaveBeenCalled();
  });

  test("propagates storage failures", () => {
    expect(() =>
      clearScopedPreferences("github:101", {
        getItem: () => null,
        removeItem: () => {
          throw new Error("storage denied");
        },
      }),
    ).toThrow("storage denied");
  });

  test("attempts every scoped preference after an earlier removal throws", () => {
    const keys = getScopedPreferenceKeys("github:101");
    const attempted: string[] = [];
    const retained = new Set(keys);

    expect(() =>
      clearScopedPreferences("github:101", {
        getItem: (key) => (retained.has(key) ? "present" : null),
        removeItem: (key) => {
          attempted.push(key);
          if (key === keys[0]) throw new Error("first removal denied");
          retained.delete(key);
        },
      }),
    ).toThrow(/first removal denied/i);
    expect(attempted).toEqual(keys);
    expect([...retained]).toEqual([keys[0]]);
  });

  test("rejects a storage implementation that lies about deletion", () => {
    expect(() =>
      clearScopedPreferences("github:101", {
        getItem: () => "still present",
        removeItem: () => {},
      }),
    ).toThrow(/could not be verified/i);
  });

  test("fails closed when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);

    expect(() => clearScopedPreferences("github:101")).toThrow(/localStorage is unavailable/i);

    vi.unstubAllGlobals();
  });
});

describe("clearModelCaches", () => {
  test("deletes every known app model cache", async () => {
    const cacheStorage = new MemoryCacheStorage(APP_MODEL_CACHE_NAMES);

    await clearModelCaches(cacheStorage);

    expect(await cacheStorage.keys()).toEqual([]);
  });

  test("preserves unrelated caches, including misleading model-like names", async () => {
    const unrelated = ["app-shell-v3", "another-model-cache", "webllm/model-backup"];
    const cacheStorage = new MemoryCacheStorage([...APP_MODEL_CACHE_NAMES, ...unrelated]);

    await clearModelCaches(cacheStorage);

    expect(await cacheStorage.keys()).toEqual(unrelated);
  });

  test("propagates Cache Storage inspection and deletion failures", async () => {
    await expect(
      clearModelCaches({
        keys: async () => {
          throw new Error("inspection denied");
        },
        delete: vi.fn(),
      }),
    ).rejects.toThrow("inspection denied");

    await expect(
      clearModelCaches({
        keys: async () => ["transformers-cache"],
        delete: async () => {
          throw new Error("deletion denied");
        },
      }),
    ).rejects.toThrow("deletion denied");
  });

  test("attempts every owned cache after an earlier deletion rejects", async () => {
    const names = new Set<string>(APP_MODEL_CACHE_NAMES);
    const attempted: string[] = [];

    await expect(
      clearModelCaches({
        keys: async () => [...names],
        delete: async (name) => {
          attempted.push(name);
          if (name === APP_MODEL_CACHE_NAMES[0]) throw new Error("first deletion denied");
          return names.delete(name);
        },
      }),
    ).rejects.toThrow(/first deletion denied/i);
    expect(attempted).toEqual([...APP_MODEL_CACHE_NAMES]);
    expect([...names]).toEqual([APP_MODEL_CACHE_NAMES[0]]);
  });

  test("rejects a Cache Storage implementation that retains an owned cache", async () => {
    await expect(
      clearModelCaches({
        keys: async () => ["webllm/model"],
        delete: async () => false,
      }),
    ).rejects.toThrow(/could not be verified/i);
  });

  test("is a safe no-op when Cache Storage is unavailable", async () => {
    await expect(clearModelCaches(null)).resolves.toBeUndefined();
  });

  test("is a safe no-op when the global Cache Storage capability is absent or malformed", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(clearModelCaches()).resolves.toBeUndefined();

    vi.stubGlobal("caches", { keys: undefined, delete: undefined });
    await expect(clearModelCaches()).resolves.toBeUndefined();

    vi.unstubAllGlobals();
  });
});
