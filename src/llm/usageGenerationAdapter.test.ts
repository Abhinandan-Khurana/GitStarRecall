import { describe, expect, it, vi } from "vitest";
import type { ChatMessageRecord } from "../db/types";
import { createPendingGeneration, createProviderRequestConfig } from "./generationState";
import {
  createUsageGenerationDependencies,
  executeUsageGeneration,
  type UsageGenerationBindings,
} from "./usageGenerationAdapter";

const providerDefinition = {
  id: "lmstudio" as const,
  label: "LM Studio",
  kind: "local" as const,
  defaultBaseUrl: "http://localhost:1234",
  defaultModel: "local-model",
  requiresApiKey: false,
};

function createStateSetter<T>(initial: T) {
  let current = initial;
  const setter = vi.fn((value: T | ((previous: T) => T)) => {
    current = typeof value === "function" ? (value as (previous: T) => T)(current) : value;
  });
  return { setter, value: () => current };
}

function createBindings() {
  const answer = createStateSetter("");
  const prompt = createStateSetter("question");
  const sessionMessages = createStateSetter<Record<string, ChatMessageRecord[]>>({});
  const runtimeState = createStateSetter<
    "idle" | "probing" | "ready" | "needs-consent" | "downloading" | "failed"
  >("ready");
  const error = createStateSetter<string | null>("old error");
  const providerStream = vi.fn(async (_config, request) => {
    request.onInitProgress?.(0.5, "loading");
    request.onToken("token");
  });
  const bindings: UsageGenerationBindings = {
    controllerRef: { current: null },
    pendingGenerationRef: { current: null },
    fallbackWebLLMModelId: "fallback-web-model",
    providerDefinitions: [providerDefinition],
    getDatabase: vi.fn().mockResolvedValue({
      getNextChatMessageSequence: vi.fn().mockReturnValue(1),
      addChatMessage: vi.fn().mockResolvedValue(undefined),
    }),
    getProvider: vi.fn(() => ({ definition: providerDefinition, stream: providerStream })),
    createId: vi.fn(() => "message-id"),
    now: vi.fn(() => 1234),
    setGenerating: vi.fn(),
    setAnswer: answer.setter,
    setPrompt: prompt.setter,
    setSessionMessages: sessionMessages.setter,
    sortMessages: vi.fn((messages) => messages),
    setRuntimeState: runtimeState.setter,
    setDownloadProgress: vi.fn(),
    setProgressText: vi.fn(),
    setDownloadDialogOpen: vi.fn(),
    setAllowModelDownload: vi.fn(),
    setProviderId: vi.fn(),
    setProviderModel: vi.fn(),
    setProviderBaseUrl: vi.fn(),
    setSelectedWebLLMModel: vi.fn(),
    setError: error.setter,
    reportError: vi.fn(),
  };
  return { answer, bindings, error, prompt, providerStream, runtimeState, sessionMessages };
}

function generation() {
  return createPendingGeneration({
    requestId: "request-id",
    sessionId: "session-id",
    promptText: "question",
    snippets: ["context"],
    providerConfig: createProviderRequestConfig({
      providerId: "lmstudio",
      baseUrl: "http://127.0.0.1:1234",
      model: "local-model",
      apiKey: "",
      allowModelDownload: false,
    }),
    executionPolicy: {
      allowLocalProvider: true,
      allowRemoteProvider: false,
      webllmConsent: false,
      ollamaBaseUrl: "http://localhost:11434",
      lmStudioBaseUrl: "http://127.0.0.1:1234",
    },
    userMessagePersisted: false,
  });
}

describe("usage generation adapter", () => {
  it("maps generation lifecycle events to page state without live provider reads", async () => {
    const { answer, bindings, error, prompt, providerStream, runtimeState, sessionMessages } =
      createBindings();
    const dependencies = createUsageGenerationDependencies(bindings);
    const message: ChatMessageRecord = {
      id: "message-id",
      sessionId: "session-id",
      role: "user",
      content: "question",
      sequence: 1,
      createdAt: 1234,
    };

    dependencies.onResetAnswer();
    dependencies.onClearPrompt();
    dependencies.onToken("first");
    dependencies.onMessage(message);
    dependencies.onRuntimeState("needs-consent");
    dependencies.onDownloadRequired(generation());
    dependencies.onWebLLMModelFallback("fallback-web-model");
    dependencies.onProviderFallback(
      createProviderRequestConfig({
        providerId: "lmstudio",
        baseUrl: "http://127.0.0.1:1234",
        model: "local-model",
        apiKey: "",
        allowModelDownload: false,
      }),
      "LM Studio",
    );
    dependencies.onError(new Error("failed"), "lmstudio");
    await dependencies.stream({
      config: generation().providerConfig,
      promptText: "question",
      snippets: ["context"],
      controller: dependencies.controller,
      onToken: vi.fn(),
    });
    dependencies.onFinished();

    expect(answer.value()).toBe("first");
    expect(prompt.value()).toBe("");
    expect(sessionMessages.value()["session-id"]).toEqual([message]);
    expect(runtimeState.value()).toBe("downloading");
    expect(error.value()).toBe("WebLLM failed, switched to LM Studio.");
    expect(bindings.pendingGenerationRef.current?.requestId).toBe("request-id");
    expect(bindings.setDownloadDialogOpen).toHaveBeenCalledWith(true);
    expect(bindings.setProviderModel).toHaveBeenCalledWith("fallback-web-model");
    expect(bindings.setSelectedWebLLMModel).toHaveBeenCalledWith("fallback-web-model");
    expect(bindings.reportError).toHaveBeenCalledOnce();
    expect(bindings.setDownloadProgress).toHaveBeenCalledWith(0.5);
    expect(bindings.setProgressText).toHaveBeenCalledWith("loading");
    expect(providerStream).toHaveBeenCalledOnce();
    expect(bindings.controllerRef.current).toBeNull();
    expect(bindings.setAllowModelDownload).toHaveBeenCalledWith(false);
  });

  it("executes a complete generation through the adapter", async () => {
    const { bindings, sessionMessages } = createBindings();

    await expect(executeUsageGeneration(generation(), bindings)).resolves.toBe("completed");

    expect(sessionMessages.value()["session-id"]?.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(bindings.setGenerating).toHaveBeenNthCalledWith(1, true);
    expect(bindings.setGenerating).toHaveBeenLastCalledWith(false);
  });
});
