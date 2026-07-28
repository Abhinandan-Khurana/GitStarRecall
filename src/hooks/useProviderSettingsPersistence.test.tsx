// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LLMProviderDefinition } from "../llm/types";
import type { LLMProviderSettings, ProviderSettingsStore } from "../lib/settings";
import { useProviderSettingsPersistence } from "./useProviderSettingsPersistence";

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
    id: "ollama",
    label: "Ollama",
    kind: "local",
    defaultBaseUrl: "http://localhost:11434",
    defaultModel: "llama3.1:8b",
    requiresApiKey: false,
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

function settings(overrides: Partial<LLMProviderSettings> = {}): LLMProviderSettings {
  return {
    providerId: "openai-compatible",
    baseUrl: "https://example.test/v1",
    model: "saved-model",
    ollamaPreferredModel: "saved-ollama",
    apiKey: "sk-saved",
    allowRemoteProvider: true,
    allowLocalProvider: false,
    webllmConsent: false,
    webllmPreferredModel: "",
    webllmLastRecommendedModel: "recommended-web-model",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderPersistence(
  store: ProviderSettingsStore,
  onPersistenceError = vi.fn(),
  scopeIdentity: string | null = "github:1",
) {
  return renderHook(
    ({ scope }) =>
      useProviderSettingsPersistence({
        scopeIdentity: scope,
        webLLMEnabled: true,
        webLLMPrimaryModel: "primary-web-model",
        providerDefinitions,
        store,
        onPersistenceError,
      }),
    { initialProps: { scope: scopeIdentity } },
  );
}

describe("useProviderSettingsPersistence", () => {
  it("hydrates saved settings before enabling serialized persistence", async () => {
    const store: ProviderSettingsStore = {
      hydrate: vi.fn().mockResolvedValue(settings()),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderPersistence(store);

    expect(result.current.hydrationState).toBe("loading");
    await waitFor(() => expect(result.current.hydrationState).toBe("ready"));
    expect(result.current).toMatchObject({
      providerId: "openai-compatible",
      providerBaseUrl: "https://example.test/v1",
      providerModel: "saved-model",
      providerApiKey: "sk-saved",
      ollamaPreferredChatModel: "saved-ollama",
      allowRemoteProvider: true,
      webllmSelectedModel: "recommended-web-model",
    });
    await waitFor(() => expect(result.current.saveState).toBe("saved"));
    expect(store.save).toHaveBeenCalledWith(
      "github:1",
      expect.objectContaining({
        ...settings(),
        webllmPreferredModel: "",
      }),
    );

    act(() => {
      result.current.setWebllmSelectedModel("manual-web-model");
      result.current.setWebllmModelManuallySet(true);
    });
    await waitFor(() =>
      expect(store.save).toHaveBeenLastCalledWith(
        "github:1",
        expect.objectContaining({ webllmPreferredModel: "manual-web-model" }),
      ),
    );
  });

  it("does not rehydrate when equivalent provider definitions receive a new array identity", async () => {
    const store: ProviderSettingsStore = {
      hydrate: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const onPersistenceError = vi.fn();
    const hook = renderHook(
      ({ definitions }) =>
        useProviderSettingsPersistence({
          scopeIdentity: "github:1",
          webLLMEnabled: true,
          webLLMPrimaryModel: "primary-web-model",
          providerDefinitions: definitions,
          store,
          onPersistenceError,
        }),
      { initialProps: { definitions: providerDefinitions } },
    );
    await waitFor(() => expect(hook.result.current.saveState).toBe("saved"));

    hook.rerender({ definitions: providerDefinitions.map((definition) => ({ ...definition })) });
    await waitFor(() => expect(hook.result.current.saveState).toBe("saved"));

    expect(store.hydrate).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledOnce();
    expect(onPersistenceError).not.toHaveBeenCalled();
  });

  it("does not rehydrate or resave when an inline error handler changes identity", async () => {
    const latestSaveError = new Error("latest save failed");
    const store: ProviderSettingsStore = {
      hydrate: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(latestSaveError),
    };
    const observedErrors: unknown[] = [];
    const hook = renderHook(
      ({ renderMarker }) =>
        useProviderSettingsPersistence({
          scopeIdentity: "github:1",
          webLLMEnabled: true,
          webLLMPrimaryModel: "primary-web-model",
          providerDefinitions,
          store,
          onPersistenceError: (event, error) => {
            observedErrors.push({ renderMarker, event, error });
          },
        }),
      { initialProps: { renderMarker: 1 } },
    );
    await waitFor(() => expect(hook.result.current.saveState).toBe("saved"));

    hook.rerender({ renderMarker: 2 });
    await waitFor(() => expect(hook.result.current.saveState).toBe("saved"));

    expect(store.hydrate).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledOnce();

    act(() => hook.result.current.setProviderModel("changed-model"));
    await waitFor(() => expect(hook.result.current.saveState).toBe("error"));
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(observedErrors).toEqual([
      {
        renderMarker: 2,
        event: "provider_settings_save_failed",
        error: latestSaveError,
      },
    ]);
  });

  it("rehydrates and saves when provider defaults change semantically", async () => {
    const store: ProviderSettingsStore = {
      hydrate: vi.fn().mockResolvedValue(
        settings({
          providerId: "ollama",
          baseUrl: "",
          model: "",
          ollamaPreferredModel: "",
          apiKey: "",
        }),
      ),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const onPersistenceError = vi.fn();
    const hook = renderHook(
      ({ definitions }) =>
        useProviderSettingsPersistence({
          scopeIdentity: "github:1",
          webLLMEnabled: true,
          webLLMPrimaryModel: "primary-web-model",
          providerDefinitions: definitions,
          store,
          onPersistenceError,
        }),
      { initialProps: { definitions: providerDefinitions } },
    );
    await waitFor(() =>
      expect(hook.result.current).toMatchObject({
        providerId: "ollama",
        providerBaseUrl: "http://localhost:11434",
        providerModel: "llama3.1:8b",
        saveState: "saved",
      }),
    );

    const changedDefinitions = providerDefinitions.map((definition) =>
      definition.id === "ollama"
        ? {
            ...definition,
            defaultBaseUrl: "http://127.0.0.1:22434",
            defaultModel: "qwen3:8b",
          }
        : definition,
    );
    hook.rerender({ definitions: changedDefinitions });

    await waitFor(() =>
      expect(hook.result.current).toMatchObject({
        providerId: "ollama",
        providerBaseUrl: "http://127.0.0.1:22434",
        providerModel: "qwen3:8b",
        saveState: "saved",
      }),
    );
    expect(store.save).toHaveBeenLastCalledWith(
      "github:1",
      expect.objectContaining({
        providerId: "ollama",
        baseUrl: "http://127.0.0.1:22434",
        model: "qwen3:8b",
      }),
    );
  });

  it("uses clean defaults for an empty scope and never saves without an identity", async () => {
    const store: ProviderSettingsStore = {
      hydrate: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const emptyScope = renderPersistence(store, vi.fn(), null);
    expect(emptyScope.result.current).toMatchObject({
      providerId: "webllm",
      providerModel: "primary-web-model",
      hydrationState: "ready",
      saveState: "idle",
      statusMessage: "Provider settings save automatically.",
    });
    expect(store.hydrate).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    emptyScope.unmount();

    vi.mocked(store.hydrate).mockResolvedValueOnce(settings());
    const hydrated = renderPersistence(store);
    await waitFor(() => expect(hydrated.result.current.hydrationState).toBe("ready"));
    expect(hydrated.result.current).toMatchObject({
      providerId: "openai-compatible",
      providerModel: "saved-model",
      providerApiKey: "sk-saved",
    });
    await waitFor(() => expect(hydrated.result.current.saveState).toBe("saved"));
    const saveCountBeforeLogout = vi.mocked(store.save).mock.calls.length;

    hydrated.rerender({ scope: null });
    await waitFor(() =>
      expect(hydrated.result.current).toMatchObject({
        providerId: "webllm",
        providerModel: "primary-web-model",
        providerApiKey: "",
        hydrationState: "ready",
        saveState: "idle",
      }),
    );
    expect(store.save).toHaveBeenCalledTimes(saveCountBeforeLogout);
  });

  it("surfaces hydration and latest-save failures without throwing", async () => {
    const onPersistenceError = vi.fn();
    const hydrationError = new Error("decrypt failed");
    const failedHydration: ProviderSettingsStore = {
      hydrate: vi.fn().mockRejectedValue(hydrationError),
      save: vi.fn(),
    };
    const hydration = renderPersistence(failedHydration, onPersistenceError);
    await waitFor(() => expect(hydration.result.current.hydrationState).toBe("error"));
    expect(hydration.result.current).toMatchObject({
      saveState: "error",
      persistenceError: "decrypt failed",
      statusMessage: "Provider settings not saved: decrypt failed",
    });
    expect(onPersistenceError).toHaveBeenCalledWith(
      "provider_settings_hydration_failed",
      hydrationError,
    );
    hydration.unmount();

    const saveError = "storage unavailable";
    const failedSave: ProviderSettingsStore = {
      hydrate: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockRejectedValue(saveError),
    };
    const saving = renderPersistence(failedSave, onPersistenceError);
    await waitFor(() => expect(saving.result.current.saveState).toBe("error"));
    expect(saving.result.current.persistenceError).toBe(saveError);
    expect(onPersistenceError).toHaveBeenCalledWith("provider_settings_save_failed", saveError);
  });

  it("keeps the newest save status when older writes settle later", async () => {
    const saves: Array<ReturnType<typeof deferred<void>>> = [];
    const store: ProviderSettingsStore = {
      hydrate: vi.fn().mockResolvedValue(settings({ apiKey: "" })),
      save: vi.fn().mockImplementation(() => {
        const operation = deferred<void>();
        saves.push(operation);
        return operation.promise;
      }),
    };
    const { result } = renderPersistence(store);
    await waitFor(() => expect(saves).toHaveLength(1));
    act(() => saves[0].resolve());
    await waitFor(() => expect(result.current.saveState).toBe("saved"));

    act(() => result.current.setProviderModel("model-two"));
    await waitFor(() => expect(saves).toHaveLength(2));
    act(() => result.current.setProviderModel("model-three"));
    await waitFor(() => expect(saves).toHaveLength(3));

    act(() => saves[2].resolve());
    await waitFor(() => expect(result.current.saveState).toBe("saved"));
    act(() => saves[1].reject(new Error("stale failure")));
    await waitFor(() => expect(result.current.saveState).toBe("saved"));
    expect(result.current.persistenceError).toBeNull();
    expect(store.save).toHaveBeenLastCalledWith(
      "github:1",
      expect.objectContaining({ model: "model-three" }),
    );
  });

  it("ignores stale hydration after a scope change and after cleanup", async () => {
    const accountA = deferred<LLMProviderSettings | null>();
    const accountB = deferred<LLMProviderSettings | null>();
    const store: ProviderSettingsStore = {
      hydrate: vi
        .fn()
        .mockImplementation((scope) =>
          scope === "github:a" ? accountA.promise : accountB.promise,
        ),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const hook = renderPersistence(store, vi.fn(), "github:a");
    act(() => accountA.resolve(settings({ model: "account-a", apiKey: "sk-account-a" })));
    await waitFor(() => expect(hook.result.current.providerModel).toBe("account-a"));
    await waitFor(() => expect(store.save).toHaveBeenCalledTimes(1));
    hook.rerender({ scope: "github:b" });
    await waitFor(() =>
      expect(hook.result.current).toMatchObject({
        providerModel: "primary-web-model",
        providerApiKey: "",
        hydrationState: "loading",
      }),
    );
    expect(store.save).toHaveBeenCalledTimes(1);
    act(() => accountB.resolve(settings({ model: "account-b" })));
    await waitFor(() => expect(hook.result.current.providerModel).toBe("account-b"));
    await waitFor(() => expect(store.save).toHaveBeenCalledTimes(2));
    expect(store.save).toHaveBeenLastCalledWith(
      "github:b",
      expect.objectContaining({ model: "account-b" }),
    );

    const pending = deferred<LLMProviderSettings | null>();
    const cleanupStore: ProviderSettingsStore = {
      hydrate: vi.fn().mockReturnValue(pending.promise),
      save: vi.fn(),
    };
    const cleanup = renderPersistence(cleanupStore);
    cleanup.unmount();
    act(() => pending.resolve(settings()));
    await Promise.resolve();
    expect(cleanupStore.save).not.toHaveBeenCalled();
  });
});
