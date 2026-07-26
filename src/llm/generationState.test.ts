import { describe, expect, it } from "vitest";
import type { LLMProviderDefinition } from "./types";
import {
  buildFallbackProviderRequestConfig,
  buildSelectedProviderRequestConfig,
  cancelPendingGeneration,
  consumePendingGeneration,
  createPendingGeneration,
  createSelectedProviderGeneration,
  getGenerationStartPlan,
  markPendingUserMessagePersisted,
  resolveLmStudioPolicyUrl,
  resumePendingWebLLMGeneration,
  shouldResetRuntimeAfterEmptyResume,
  throwIfGenerationCancelled,
  updatePendingExecutionPolicy,
  updatePendingProviderConfig,
} from "./generationState";

const lmStudioDefinition: LLMProviderDefinition = {
  id: "lmstudio",
  label: "LM Studio",
  kind: "local",
  defaultBaseUrl: "http://localhost:1234",
  defaultModel: "local-model",
  requiresApiKey: false,
};

const ollamaDefinition: LLMProviderDefinition = {
  id: "ollama",
  label: "Ollama",
  kind: "local",
  defaultBaseUrl: "http://localhost:11434",
  defaultModel: "llama3.2",
  requiresApiKey: false,
};

const executionPolicy = {
  allowLocalProvider: true,
  allowRemoteProvider: false,
  webllmConsent: false,
  ollamaBaseUrl: "http://localhost:11434",
  lmStudioBaseUrl: "http://localhost:1234",
};

describe("generation request state", () => {
  it("uses the configured LM Studio URL for a selected request", () => {
    expect(
      buildSelectedProviderRequestConfig({
        providerId: "lmstudio",
        providerBaseUrl: " http://127.0.0.1:2345/v1 ",
        ollamaBaseUrl: "http://localhost:11434",
        model: " configured-model ",
        apiKey: " local-key ",
        allowModelDownload: false,
      }),
    ).toEqual({
      providerId: "lmstudio",
      baseUrl: "http://127.0.0.1:2345/v1",
      model: "configured-model",
      apiKey: "local-key",
      allowModelDownload: false,
    });
  });

  it("uses the safe Ollama default when its configured URL is blank", () => {
    expect(
      buildSelectedProviderRequestConfig({
        providerId: "ollama",
        providerBaseUrl: "http://stale-selected.invalid",
        ollamaBaseUrl: "",
        model: "llama3.2",
        apiKey: "",
        allowModelDownload: false,
      }).baseUrl,
    ).toBe("http://localhost:11434");

    expect(
      buildFallbackProviderRequestConfig({
        providerId: "ollama",
        providerDefinition: ollamaDefinition,
        providerBaseUrl: "http://stale-selected.invalid",
        ollamaBaseUrl: "",
        apiKey: "",
      }).baseUrl,
    ).toBe("http://localhost:11434");
  });

  it("falls back to safe defaults when configured URLs are whitespace-only", () => {
    expect(
      buildSelectedProviderRequestConfig({
        providerId: "ollama",
        providerBaseUrl: "http://stale-selected.invalid",
        ollamaBaseUrl: "   ",
        model: "llama3.2",
        apiKey: "",
        allowModelDownload: false,
      }).baseUrl,
    ).toBe("http://localhost:11434");

    expect(
      buildFallbackProviderRequestConfig({
        providerId: "ollama",
        providerDefinition: ollamaDefinition,
        providerBaseUrl: "http://stale-selected.invalid",
        ollamaBaseUrl: "  \t ",
        apiKey: "",
      }).baseUrl,
    ).toBe("http://localhost:11434");

    expect(
      buildFallbackProviderRequestConfig({
        providerId: "lmstudio",
        providerDefinition: lmStudioDefinition,
        providerBaseUrl: "   ",
        ollamaBaseUrl: "http://localhost:11434",
        apiKey: "",
      }).baseUrl,
    ).toBe("http://localhost:1234");
  });

  it("derives the LM Studio policy URL only from an actual LM Studio selection", () => {
    expect(resolveLmStudioPolicyUrl("lmstudio", " http://127.0.0.1:2345/v1 ")).toBe(
      "http://127.0.0.1:2345/v1",
    );
    expect(resolveLmStudioPolicyUrl("webllm", "http://webllm-injected.invalid")).toBe("");
    expect(resolveLmStudioPolicyUrl("openai-compatible", "https://api.openai.com/v1")).toBe("");
    expect(resolveLmStudioPolicyUrl("ollama", "http://127.0.0.1:11434")).toBe("");
    expect(resolveLmStudioPolicyUrl("lmstudio", "   ")).toBe("");
  });

  it("builds fallback transport from the fallback definition instead of stale selected state", () => {
    expect(
      buildFallbackProviderRequestConfig({
        providerId: "lmstudio",
        providerDefinition: lmStudioDefinition,
        providerBaseUrl: "http://127.0.0.1:2345",
        ollamaBaseUrl: "http://localhost:11434",
        apiKey: "",
      }),
    ).toEqual({
      providerId: "lmstudio",
      baseUrl: "http://127.0.0.1:2345",
      model: "local-model",
      apiKey: "",
      allowModelDownload: false,
    });

    expect(
      buildFallbackProviderRequestConfig({
        providerId: "openai-compatible",
        providerDefinition: {
          id: "openai-compatible",
          label: "OpenAI compatible",
          kind: "remote",
          defaultBaseUrl: "https://api.openai.com",
          defaultModel: "gpt-4o-mini",
          requiresApiKey: true,
        },
        providerBaseUrl: "http://stale-selected-provider.invalid",
        ollamaBaseUrl: "http://stale-selected-provider.invalid",
        apiKey: "sk-fallback",
      }),
    ).toEqual({
      providerId: "openai-compatible",
      baseUrl: "https://api.openai.com",
      model: "gpt-4o-mini",
      apiKey: "sk-fallback",
      allowModelDownload: false,
    });
  });

  it("consumes a download resume exactly once and retains persisted-user state", () => {
    const pending = markPendingUserMessagePersisted(
      createPendingGeneration({
        requestId: "request-1",
        sessionId: "session-1",
        promptText: "question",
        snippets: ["owner/repo\ncontext"],
        providerConfig: buildSelectedProviderRequestConfig({
          providerId: "webllm",
          providerBaseUrl: "",
          ollamaBaseUrl: "",
          model: "model-a",
          apiKey: "",
          allowModelDownload: false,
        }),
        executionPolicy,
        userMessagePersisted: false,
      }),
    );
    const resumed = updatePendingProviderConfig(pending, {
      ...pending.providerConfig,
      model: "model-b",
      allowModelDownload: true,
    });
    const first = consumePendingGeneration(resumed);
    const second = consumePendingGeneration(first.nextPending);

    expect(first.generation).toMatchObject({
      requestId: "request-1",
      sessionId: "session-1",
      promptText: "question",
      userMessagePersisted: true,
      providerConfig: { model: "model-b", allowModelDownload: true },
      executionPolicy,
    });
    expect(second.generation).toBeNull();
    expect(getGenerationStartPlan(pending)).toEqual({
      clearPrompt: false,
      persistUserMessage: false,
    });
  });

  it("resumes a pending WebLLM request with consent and the selected model", () => {
    const pending = createPendingGeneration({
      requestId: "request-resume",
      sessionId: "session-resume",
      promptText: "question",
      snippets: ["context"],
      providerConfig: buildSelectedProviderRequestConfig({
        providerId: "webllm",
        providerBaseUrl: "",
        ollamaBaseUrl: "",
        model: "old-model",
        apiKey: "",
        allowModelDownload: false,
      }),
      executionPolicy,
      userMessagePersisted: true,
    });

    const resumed = resumePendingWebLLMGeneration(pending, "selected-model");
    expect(resumed.nextPending).toBeNull();
    expect(resumed.generation).toMatchObject({
      requestId: "request-resume",
      userMessagePersisted: true,
      providerConfig: {
        providerId: "webllm",
        model: "selected-model",
        allowModelDownload: true,
      },
      executionPolicy: { webllmConsent: true },
    });
    expect(resumePendingWebLLMGeneration(null, "unused-model").generation).toBeNull();
  });

  it("clears the prompt and persists the user only on the first execution", () => {
    const generation = createPendingGeneration({
      requestId: "request-2",
      sessionId: "session-2",
      promptText: "question",
      snippets: ["context"],
      providerConfig: buildSelectedProviderRequestConfig({
        providerId: "webllm",
        providerBaseUrl: "",
        ollamaBaseUrl: "",
        model: "model-a",
        apiKey: "",
        allowModelDownload: false,
      }),
      executionPolicy,
      userMessagePersisted: false,
    });

    expect(getGenerationStartPlan(generation)).toEqual({
      clearPrompt: true,
      persistUserMessage: true,
    });
    expect(getGenerationStartPlan(markPendingUserMessagePersisted(generation))).toEqual({
      clearPrompt: false,
      persistUserMessage: false,
    });
    const consented = updatePendingExecutionPolicy(generation, {
      ...generation.executionPolicy,
      webllmConsent: true,
    });
    expect(consented.executionPolicy.webllmConsent).toBe(true);
    expect(generation.executionPolicy.webllmConsent).toBe(false);
  });

  it("snapshots a selected provider and execution policy into one pending request", () => {
    const selected = createSelectedProviderGeneration({
      requestId: "request-selected",
      sessionId: "session-selected",
      promptText: "question",
      snippets: ["context"],
      providerSelection: {
        providerId: "lmstudio",
        providerBaseUrl: " http://127.0.0.1:2345 ",
        ollamaBaseUrl: "http://localhost:11434",
        model: " local-model ",
        apiKey: " local-key ",
        allowModelDownload: false,
      },
      executionPolicy,
    });

    expect(selected).toMatchObject({
      requestId: "request-selected",
      sessionId: "session-selected",
      promptText: "question",
      snippets: ["context"],
      providerConfig: {
        providerId: "lmstudio",
        baseUrl: "http://127.0.0.1:2345",
        model: "local-model",
        apiKey: "local-key",
      },
      executionPolicy,
      userMessagePersisted: false,
    });
  });

  it("keeps the active runtime after an empty resume but idles when no live generation exists", () => {
    // Rapid double-confirm: the first click consumed the pending request and
    // started a live generation, so the second (empty) resume must not idle it.
    const active = new AbortController();
    expect(shouldResetRuntimeAfterEmptyResume(active.signal)).toBe(false);

    // No controller has ever been created (nothing to protect) -> idle.
    expect(shouldResetRuntimeAfterEmptyResume(null)).toBe(true);

    // A cancelled/aborted generation is no longer live -> idle.
    const cancelled = new AbortController();
    cancelled.abort();
    expect(shouldResetRuntimeAfterEmptyResume(cancelled.signal)).toBe(true);
  });

  it("discards a cancelled pending generation", () => {
    expect(consumePendingGeneration(cancelPendingGeneration()).generation).toBeNull();

    const controller = new AbortController();
    expect(() => throwIfGenerationCancelled(controller.signal)).not.toThrow();
    controller.abort();
    expect(() => throwIfGenerationCancelled(controller.signal)).toThrowError(
      expect.objectContaining({ name: "AbortError" }),
    );

    const nonErrorReasonController = new AbortController();
    nonErrorReasonController.abort("cancelled by caller");
    expect(() => throwIfGenerationCancelled(nonErrorReasonController.signal)).toThrowError(
      expect.objectContaining({ name: "AbortError" }),
    );
  });
});
