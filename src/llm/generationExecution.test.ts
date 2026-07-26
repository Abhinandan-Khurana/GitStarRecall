import { describe, expect, it, vi } from "vitest";
import type { ChatMessageRecord } from "../db/types";
import {
  checkLocalProviderReachability,
  executeGeneration,
  streamProviderRequest,
  type GenerationExecutionDependencies,
} from "./generationExecution";
import {
  createPendingGeneration,
  createProviderRequestConfig,
  markPendingUserMessagePersisted,
  type PendingGeneration,
  type ProviderRequestConfig,
} from "./generationState";
import type { LLMProviderDefinition } from "./types";

const providerDefinitions: LLMProviderDefinition[] = [
  {
    id: "ollama",
    label: "Ollama",
    kind: "local",
    defaultBaseUrl: "http://localhost:11434",
    defaultModel: "llama3.2",
    requiresApiKey: false,
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    kind: "local",
    defaultBaseUrl: "http://localhost:1234",
    defaultModel: "fallback-local-model",
    requiresApiKey: false,
  },
  {
    id: "openai-compatible",
    label: "OpenAI compatible",
    kind: "remote",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    requiresApiKey: true,
  },
];

function webLLMError(
  code: "WEBLLM_DOWNLOAD_REQUIRED" | "WEBLLM_INIT_FAILED" | "WEBLLM_STREAM_FAILED",
): Error & { code: typeof code } {
  return Object.assign(new Error(code), { name: "WebLLMProviderError", code });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function generation(overrides: Partial<PendingGeneration> = {}): PendingGeneration {
  return createPendingGeneration({
    requestId: "request-1",
    sessionId: "session-1",
    promptText: "Which repository?",
    snippets: ["owner/repo\ncontext"],
    providerConfig: createProviderRequestConfig({
      providerId: "webllm",
      baseUrl: "",
      model: "web-model",
      apiKey: "sk-snapshot",
      allowModelDownload: false,
    }),
    executionPolicy: {
      allowLocalProvider: true,
      allowRemoteProvider: true,
      webllmConsent: true,
      ollamaBaseUrl: "http://127.0.0.2:11434",
      lmStudioBaseUrl: "http://127.0.0.3:1234",
    },
    userMessagePersisted: false,
    ...overrides,
  });
}

function harness(overrides: Partial<GenerationExecutionDependencies> = {}) {
  const messages: ChatMessageRecord[] = [];
  let nextId = 0;
  const database = {
    getNextChatMessageSequence: vi.fn(() => messages.length + 1),
    addChatMessage: vi.fn(async (message: ChatMessageRecord) => {
      messages.push(message);
    }),
  };
  const dependencies: GenerationExecutionDependencies = {
    controller: new AbortController(),
    fallbackWebLLMModelId: "fallback-web-model",
    getDatabase: vi.fn().mockResolvedValue(database),
    stream: vi.fn(async ({ onToken }) => onToken("answer")),
    providerDefinitions,
    canReachLocalProvider: vi.fn().mockResolvedValue(false),
    createId: () => `message-${++nextId}`,
    now: () => 1000 + nextId,
    onGeneratingChange: vi.fn(),
    onResetAnswer: vi.fn(),
    onClearPrompt: vi.fn(),
    onToken: vi.fn(),
    onMessage: vi.fn(),
    onRuntimeState: vi.fn(),
    onDownloadRequired: vi.fn(),
    onWebLLMModelFallback: vi.fn(),
    onProviderFallback: vi.fn(),
    onError: vi.fn(),
    onFinished: vi.fn(),
    ...overrides,
  };
  return { database, dependencies, messages };
}

describe("generation execution", () => {
  it("persists exactly one user and assistant on first execution", async () => {
    const { dependencies, messages } = harness();

    await expect(executeGeneration(generation(), dependencies)).resolves.toBe("completed");

    expect(messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "Which repository?" },
      { role: "assistant", content: "answer" },
    ]);
    expect(dependencies.onClearPrompt).toHaveBeenCalledOnce();
    expect(dependencies.onMessage).toHaveBeenCalledTimes(2);
    expect(dependencies.onGeneratingChange).toHaveBeenNthCalledWith(1, true);
    expect(dependencies.onGeneratingChange).toHaveBeenLastCalledWith(false);
    expect(dependencies.onFinished).toHaveBeenCalledOnce();
  });

  it("resumes a persisted-user generation without clearing or duplicating the user", async () => {
    const { dependencies, messages } = harness();
    const resumed = markPendingUserMessagePersisted(generation());

    await expect(executeGeneration(resumed, dependencies)).resolves.toBe("completed");

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "assistant", content: "answer" });
    expect(dependencies.onClearPrompt).not.toHaveBeenCalled();
    expect(dependencies.onMessage).toHaveBeenCalledOnce();
  });

  it("suspends DOWNLOAD_REQUIRED with a persisted-user immutable snapshot", async () => {
    const { dependencies, messages } = harness({
      stream: vi.fn().mockRejectedValue(webLLMError("WEBLLM_DOWNLOAD_REQUIRED")),
    });

    await expect(executeGeneration(generation(), dependencies)).resolves.toBe("suspended");

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(dependencies.onDownloadRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "request-1",
        userMessagePersisted: true,
        executionPolicy: expect.objectContaining({
          lmStudioBaseUrl: "http://127.0.0.3:1234",
        }),
      }),
    );
    expect(dependencies.onMessage).toHaveBeenCalledOnce();
    expect(dependencies.onRuntimeState).toHaveBeenCalledWith("needs-consent");
  });

  it("executes an explicit fallback config and ignores changed live policy", async () => {
    const fallbackConfig: ProviderRequestConfig = createProviderRequestConfig({
      providerId: "lmstudio",
      baseUrl: "http://127.0.0.3:1234",
      model: "fallback-local-model",
      apiKey: "sk-snapshot",
      allowModelDownload: false,
    });
    let liveLmStudioBaseUrl = "http://changed-live-state.invalid";
    const preReassignmentLiveUrl = liveLmStudioBaseUrl;
    const probedBaseUrls: string[] = [];
    const stream = vi
      .fn<GenerationExecutionDependencies["stream"]>()
      .mockRejectedValueOnce(webLLMError("WEBLLM_INIT_FAILED"))
      .mockRejectedValueOnce(webLLMError("WEBLLM_STREAM_FAILED"))
      .mockImplementationOnce(async ({ config, onToken }) => {
        expect(config).toEqual(fallbackConfig);
        onToken("fallback answer");
      });
    const canReachLocalProvider = vi.fn(
      async (provider: "ollama" | "lmstudio", baseUrl: string) => {
        if (provider === "ollama") return false;
        probedBaseUrls.push(baseUrl);
        expect(baseUrl).toBe("http://127.0.0.3:1234");
        // The snapshot must be used regardless of live mutations both before
        // (preReassignmentLiveUrl) and after (liveLmStudioBaseUrl) generation().
        expect(baseUrl).not.toBe(preReassignmentLiveUrl);
        expect(baseUrl).not.toBe(liveLmStudioBaseUrl);
        return true;
      },
    );
    const { dependencies, messages } = harness({ stream, canReachLocalProvider });
    const pending = generation();
    liveLmStudioBaseUrl = "http://another-live-change.invalid";

    await expect(executeGeneration(pending, dependencies)).resolves.toBe("completed");

    expect(stream).toHaveBeenCalledTimes(3);
    expect(probedBaseUrls).toEqual(["http://127.0.0.3:1234"]);
    expect(preReassignmentLiveUrl).toBe("http://changed-live-state.invalid");
    expect(liveLmStudioBaseUrl).toBe("http://another-live-change.invalid");
    expect(dependencies.onProviderFallback).toHaveBeenCalledWith(fallbackConfig, "LM Studio");
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(messages.at(-1)?.content).toBe("fallback answer");
  });

  it("uses reachable Ollama without starting a lower-priority LM Studio probe", async () => {
    const stream = vi
      .fn<GenerationExecutionDependencies["stream"]>()
      .mockRejectedValueOnce(webLLMError("WEBLLM_INIT_FAILED"))
      .mockRejectedValueOnce(webLLMError("WEBLLM_STREAM_FAILED"))
      .mockImplementationOnce(async ({ config, onToken }) => {
        expect(config.providerId).toBe("ollama");
        expect(config.baseUrl).toBe("http://127.0.0.2:11434");
        onToken("ollama answer");
      });
    const canReachLocalProvider = vi.fn().mockResolvedValue(true);
    const { dependencies, messages } = harness({ stream, canReachLocalProvider });

    await expect(executeGeneration(generation(), dependencies)).resolves.toBe("completed");

    expect(canReachLocalProvider).toHaveBeenCalledOnce();
    expect(canReachLocalProvider).toHaveBeenCalledWith(
      "ollama",
      "http://127.0.0.2:11434",
      dependencies.controller.signal,
    );
    expect(dependencies.onProviderFallback).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "ollama" }),
      "Ollama",
    );
    expect(messages.at(-1)).toMatchObject({ role: "assistant", content: "ollama answer" });
  });

  it("does not persist a partial assistant after a failed WebLLM retry", async () => {
    const stream = vi
      .fn<GenerationExecutionDependencies["stream"]>()
      .mockRejectedValueOnce(webLLMError("WEBLLM_INIT_FAILED"))
      .mockImplementationOnce(async ({ onToken }) => {
        onToken("partial");
        throw webLLMError("WEBLLM_STREAM_FAILED");
      });
    const { dependencies, messages } = harness({ stream });

    await expect(executeGeneration(generation(), dependencies)).resolves.toBe("failed");

    expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(0);
    expect(dependencies.canReachLocalProvider).not.toHaveBeenCalled();
    expect(dependencies.onError).toHaveBeenCalledOnce();
  });

  it("clears a partial WebLLM attempt before retrying its fallback model", async () => {
    const stream = vi
      .fn<GenerationExecutionDependencies["stream"]>()
      .mockImplementationOnce(async ({ onToken }) => {
        onToken("stale partial ");
        throw webLLMError("WEBLLM_INIT_FAILED");
      })
      .mockImplementationOnce(async ({ onToken }) => onToken("clean answer"));
    const { dependencies, messages } = harness({ stream });

    await expect(executeGeneration(generation(), dependencies)).resolves.toBe("completed");

    expect(messages.at(-1)).toMatchObject({ role: "assistant", content: "clean answer" });
    expect(dependencies.onResetAnswer).toHaveBeenCalledTimes(2);
  });

  it("clears whitespace tokens before a provider fallback so they cannot prefix the answer", async () => {
    const stream = vi
      .fn<GenerationExecutionDependencies["stream"]>()
      .mockImplementationOnce(async ({ onToken }) => {
        onToken("  \n ");
        throw webLLMError("WEBLLM_STREAM_FAILED");
      })
      .mockImplementationOnce(async ({ onToken }) => onToken("fallback answer"));
    const { dependencies, messages } = harness({ stream });

    await expect(
      executeGeneration(
        generation({
          providerConfig: createProviderRequestConfig({
            providerId: "webllm",
            baseUrl: "",
            model: "fallback-web-model",
            apiKey: "sk-snapshot",
            allowModelDownload: true,
          }),
        }),
        dependencies,
      ),
    ).resolves.toBe("completed");

    expect(stream).toHaveBeenCalledTimes(2);
    expect(dependencies.onProviderFallback).toHaveBeenCalledOnce();
    expect(messages.at(-1)).toMatchObject({ role: "assistant", content: "fallback answer" });
    expect(dependencies.onResetAnswer).toHaveBeenCalledTimes(2);
  });

  it("cancels during database acquisition before prompt clear or user write", async () => {
    const databaseGate = deferred<ReturnType<typeof harness>["database"]>();
    const { database, dependencies, messages } = harness({
      getDatabase: vi.fn().mockReturnValue(databaseGate.promise),
    });
    const execution = executeGeneration(generation(), dependencies);
    dependencies.controller.abort();
    databaseGate.resolve(database);

    await expect(execution).resolves.toBe("cancelled");
    expect(messages).toHaveLength(0);
    expect(dependencies.onClearPrompt).not.toHaveBeenCalled();
    expect(dependencies.stream).not.toHaveBeenCalled();
  });

  it("cancels while resolving fallback before fallback execution", async () => {
    const stream = vi
      .fn<GenerationExecutionDependencies["stream"]>()
      .mockRejectedValueOnce(webLLMError("WEBLLM_INIT_FAILED"))
      .mockRejectedValueOnce(webLLMError("WEBLLM_STREAM_FAILED"));
    const fetchImplementation = vi.fn<typeof fetch>().mockReturnValue(new Promise(() => {}));
    const canReachLocalProvider = vi.fn(
      (provider: "ollama" | "lmstudio", baseUrl: string, signal: AbortSignal) =>
        checkLocalProviderReachability(provider, baseUrl, signal, fetchImplementation, 10_000),
    );
    const { dependencies, messages } = harness({
      stream,
      canReachLocalProvider,
    });
    const execution = executeGeneration(generation(), dependencies);
    await vi.waitFor(() => expect(dependencies.canReachLocalProvider).toHaveBeenCalledOnce());
    dependencies.controller.abort();

    await expect(execution).resolves.toBe("cancelled");
    expect(dependencies.canReachLocalProvider).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(stream).toHaveBeenCalledTimes(2);
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(0);
    expect(dependencies.onProviderFallback).not.toHaveBeenCalled();
  });

  it("cancels after streaming before assistant persistence", async () => {
    const streamGate = deferred<void>();
    const stream = vi
      .fn<GenerationExecutionDependencies["stream"]>()
      .mockImplementation(async ({ onToken }) => {
        onToken("answer that must not persist");
        await streamGate.promise;
      });
    const { dependencies, messages } = harness({ stream });
    const execution = executeGeneration(generation(), dependencies);
    await vi.waitFor(() => expect(dependencies.onToken).toHaveBeenCalledOnce());
    dependencies.controller.abort();
    streamGate.resolve();

    await expect(execution).resolves.toBe("cancelled");
    expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(0);
  });

  it("reports an ordinary provider stream failure without attempting WebLLM recovery", async () => {
    const streamError = new Error("provider failed");
    const { dependencies, messages } = harness({
      stream: vi.fn().mockRejectedValue(streamError),
    });

    await expect(
      executeGeneration(
        generation({
          providerConfig: createProviderRequestConfig({
            providerId: "lmstudio",
            baseUrl: "http://127.0.0.3:1234",
            model: "local-model",
            apiKey: "",
            allowModelDownload: false,
          }),
        }),
        dependencies,
      ),
    ).resolves.toBe("failed");

    expect(dependencies.stream).toHaveBeenCalledOnce();
    expect(dependencies.canReachLocalProvider).not.toHaveBeenCalled();
    expect(dependencies.onError).toHaveBeenCalledWith(streamError, "lmstudio");
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(0);
  });

  it("attributes a failing remote fallback to the remote provider", async () => {
    const fallbackError = new Error("remote fallback failed");
    const stream = vi
      .fn<GenerationExecutionDependencies["stream"]>()
      .mockRejectedValueOnce(webLLMError("WEBLLM_INIT_FAILED"))
      .mockRejectedValueOnce(webLLMError("WEBLLM_STREAM_FAILED"))
      .mockRejectedValueOnce(fallbackError);
    const { dependencies, messages } = harness({ stream });

    await expect(executeGeneration(generation(), dependencies)).resolves.toBe("failed");

    expect(stream).toHaveBeenCalledTimes(3);
    expect(dependencies.onProviderFallback).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "openai-compatible" }),
      "OpenAI compatible",
    );
    expect(dependencies.onError).toHaveBeenCalledOnce();
    expect(dependencies.onError).toHaveBeenCalledWith(fallbackError, "openai-compatible");
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(0);
  });

  it("attributes a failing local fallback to the local provider", async () => {
    const fallbackError = new Error("local fallback failed");
    const stream = vi
      .fn<GenerationExecutionDependencies["stream"]>()
      .mockRejectedValueOnce(webLLMError("WEBLLM_INIT_FAILED"))
      .mockRejectedValueOnce(webLLMError("WEBLLM_STREAM_FAILED"))
      .mockRejectedValueOnce(fallbackError);
    const canReachLocalProvider = vi.fn(async (provider: "ollama" | "lmstudio") => {
      return provider === "lmstudio";
    });
    const { dependencies, messages } = harness({ stream, canReachLocalProvider });

    await expect(executeGeneration(generation(), dependencies)).resolves.toBe("failed");

    expect(stream).toHaveBeenCalledTimes(3);
    expect(dependencies.onProviderFallback).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "lmstudio" }),
      "LM Studio",
    );
    expect(dependencies.onError).toHaveBeenCalledOnce();
    expect(dependencies.onError).toHaveBeenCalledWith(fallbackError, "lmstudio");
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(0);
  });

  it("marks WebLLM ready after its fallback model succeeds", async () => {
    const stream = vi
      .fn<GenerationExecutionDependencies["stream"]>()
      .mockRejectedValueOnce(webLLMError("WEBLLM_INIT_FAILED"))
      .mockImplementationOnce(async ({ onToken }) => onToken("fallback model answer"));
    const { dependencies, messages } = harness({ stream });

    await expect(executeGeneration(generation(), dependencies)).resolves.toBe("completed");

    expect(dependencies.onRuntimeState).toHaveBeenCalledWith("downloading");
    expect(dependencies.onRuntimeState).toHaveBeenLastCalledWith("ready");
    expect(dependencies.onWebLLMModelFallback).toHaveBeenCalledWith("fallback-web-model");
    expect(messages.at(-1)).toMatchObject({ role: "assistant", content: "fallback model answer" });
  });

  it("does not retry the same WebLLM fallback model", async () => {
    const streamError = webLLMError("WEBLLM_STREAM_FAILED");
    const stream = vi
      .fn<GenerationExecutionDependencies["stream"]>()
      .mockRejectedValue(streamError);
    const { dependencies } = harness({ stream });

    await expect(
      executeGeneration(
        generation({
          providerConfig: createProviderRequestConfig({
            providerId: "webllm",
            baseUrl: "",
            model: "fallback-web-model",
            apiKey: "",
            allowModelDownload: true,
          }),
          executionPolicy: {
            ...generation().executionPolicy,
            allowLocalProvider: false,
            allowRemoteProvider: false,
          },
        }),
        dependencies,
      ),
    ).resolves.toBe("failed");

    expect(stream).toHaveBeenCalledOnce();
    expect(dependencies.onRuntimeState).toHaveBeenCalledWith("failed");
    expect(dependencies.onWebLLMModelFallback).not.toHaveBeenCalled();
  });
});

describe("local provider reachability", () => {
  it.each([
    ["ollama", "", "http://localhost:11434/api/tags"],
    ["lmstudio", "http://127.0.0.3:1234", "http://127.0.0.3:1234/v1/models"],
  ] as const)("checks the %s discovery endpoint", async (provider, baseUrl, expectedUrl) => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      checkLocalProviderReachability(
        provider,
        baseUrl,
        new AbortController().signal,
        fetchImplementation,
        100,
      ),
    ).resolves.toBe(true);
    expect(fetchImplementation).toHaveBeenCalledWith(
      expectedUrl,
      expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
    );
  });

  it("fails closed for invalid endpoints and network failures", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));

    await expect(
      checkLocalProviderReachability(
        "ollama",
        "http://localhost.example.com",
        new AbortController().signal,
        fetchImplementation,
      ),
    ).resolves.toBe(false);
    await expect(
      checkLocalProviderReachability(
        "ollama",
        "http://127.0.0.1:11434",
        new AbortController().signal,
        fetchImplementation,
      ),
    ).resolves.toBe(false);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("does not fetch when reachability is already aborted", async () => {
    const caller = new AbortController();
    caller.abort();
    const fetchImplementation = vi.fn<typeof fetch>();

    await expect(
      checkLocalProviderReachability(
        "ollama",
        "http://localhost:11434",
        caller.signal,
        fetchImplementation,
      ),
    ).resolves.toBe(false);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("returns false on timeout and removes its timer and caller listener", async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      const removeListener = vi.spyOn(caller.signal, "removeEventListener");
      const fetchImplementation = vi.fn<typeof fetch>().mockReturnValue(new Promise(() => {}));
      const pending = checkLocalProviderReachability(
        "ollama",
        "http://localhost:11434",
        caller.signal,
        fetchImplementation,
        25,
      );

      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).resolves.toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("provider request transport", () => {
  it("passes the immutable request config and abort signal to the selected provider", async () => {
    const controller = new AbortController();
    const onToken = vi.fn();
    const onInitProgress = vi.fn();
    const stream = vi.fn().mockResolvedValue(undefined);
    const config = createProviderRequestConfig({
      providerId: "lmstudio",
      baseUrl: "http://127.0.0.3:1234",
      model: "configured-model",
      apiKey: "snapshot-key",
      allowModelDownload: false,
    });

    await streamProviderRequest(
      { config, promptText: "question", snippets: ["context"], controller, onToken },
      {
        definition: providerDefinitions[1]!,
        stream,
      },
      onInitProgress,
    );

    expect(stream).toHaveBeenCalledWith(
      {
        baseUrl: "http://127.0.0.3:1234",
        model: "configured-model",
        apiKey: "snapshot-key",
        allowModelDownload: false,
      },
      {
        prompt: "question",
        contextSnippets: ["context"],
        signal: controller.signal,
        onToken,
        onInitProgress,
      },
    );
  });
});
