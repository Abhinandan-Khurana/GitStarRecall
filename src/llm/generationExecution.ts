import type { ChatMessageRecord } from "../db/types";
import { resolveProviderFallback } from "./fallback";
import {
  buildFallbackProviderRequestConfig,
  createProviderRequestConfig,
  getGenerationStartPlan,
  markPendingUserMessagePersisted,
  throwIfGenerationCancelled,
  updatePendingProviderConfig,
  type PendingGeneration,
  type ProviderRequestConfig,
} from "./generationState";
import { buildLocalEndpointUrl } from "./localEndpoint";
import type { LLMProviderDefinition, LLMStreamProvider } from "./types";

type WebLLMExecutionError = Error & {
  code:
    | "WEBLLM_UNSUPPORTED"
    | "WEBLLM_DOWNLOAD_REQUIRED"
    | "WEBLLM_INIT_FAILED"
    | "WEBLLM_STREAM_FAILED";
};

export type GenerationDatabase = {
  getNextChatMessageSequence(sessionId: string): number;
  addChatMessage(message: ChatMessageRecord): Promise<void>;
};

type StreamArguments = {
  config: ProviderRequestConfig;
  promptText: string;
  snippets: string[];
  controller: AbortController;
  onToken: (token: string) => void;
};

export async function streamProviderRequest(
  args: StreamArguments,
  provider: LLMStreamProvider,
  onInitProgress: (progress: number, text: string) => void,
): Promise<void> {
  await provider.stream(
    {
      baseUrl: args.config.baseUrl,
      model: args.config.model,
      apiKey: args.config.apiKey,
      allowModelDownload: args.config.allowModelDownload,
    },
    {
      prompt: args.promptText,
      contextSnippets: args.snippets,
      signal: args.controller.signal,
      onToken: args.onToken,
      onInitProgress,
    },
  );
}

export type GenerationExecutionOutcome = "completed" | "suspended" | "failed" | "cancelled";

export type GenerationExecutionDependencies = {
  controller: AbortController;
  fallbackWebLLMModelId: string;
  getDatabase(): Promise<GenerationDatabase>;
  stream(args: StreamArguments): Promise<void>;
  providerDefinitions: readonly LLMProviderDefinition[];
  canReachLocalProvider(
    provider: "ollama" | "lmstudio",
    baseUrl: string,
    signal: AbortSignal,
  ): Promise<boolean>;
  createId(): string;
  now(): number;
  onGeneratingChange(active: boolean): void;
  onResetAnswer(): void;
  onClearPrompt(): void;
  onToken(token: string): void;
  onMessage(message: ChatMessageRecord): void;
  onRuntimeState(state: "ready" | "needs-consent" | "downloading" | "failed"): void;
  onDownloadRequired(generation: PendingGeneration): void;
  onWebLLMModelFallback(model: string): void;
  onProviderFallback(config: ProviderRequestConfig, label: string): void;
  onError(error: unknown, providerId: ProviderRequestConfig["providerId"]): void;
  onFinished(): void;
};

export async function checkLocalProviderReachability(
  provider: "ollama" | "lmstudio",
  configuredBaseUrl: string,
  callerSignal: AbortSignal,
  fetchImplementation: typeof fetch = fetch,
  timeoutMs = 2_000,
): Promise<boolean> {
  if (callerSignal.aborted) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortForCaller = () => controller.abort(callerSignal.reason);
  callerSignal.addEventListener("abort", abortForCaller, { once: true });
  let rejectForAbort: (() => void) | null = null;
  try {
    const url =
      provider === "ollama"
        ? buildLocalEndpointUrl(
            configuredBaseUrl || "http://localhost:11434",
            "/api/tags",
            "Ollama",
          )
        : buildLocalEndpointUrl(
            configuredBaseUrl || "http://localhost:1234",
            "/v1/models",
            "LM Studio",
          );
    const aborted = new Promise<never>((_, reject) => {
      rejectForAbort = () => reject(new DOMException("Local provider probe aborted", "AbortError"));
      controller.signal.addEventListener("abort", rejectForAbort, { once: true });
    });
    const response = await Promise.race([
      fetchImplementation(url, { method: "GET", signal: controller.signal }),
      aborted,
    ]);
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    callerSignal.removeEventListener("abort", abortForCaller);
    if (rejectForAbort) controller.signal.removeEventListener("abort", rejectForAbort);
  }
}

async function resolveFallbackConfig(
  generation: PendingGeneration,
  dependencies: GenerationExecutionDependencies,
): Promise<{ config: ProviderRequestConfig; label: string } | null> {
  const { executionPolicy } = generation;
  throwIfGenerationCancelled(dependencies.controller.signal);
  let canUseOllama = false;
  let canUseLmStudio = false;
  if (executionPolicy.allowLocalProvider) {
    canUseOllama = await dependencies.canReachLocalProvider(
      "ollama",
      executionPolicy.ollamaBaseUrl,
      dependencies.controller.signal,
    );
    throwIfGenerationCancelled(dependencies.controller.signal);
    if (!canUseOllama) {
      canUseLmStudio = await dependencies.canReachLocalProvider(
        "lmstudio",
        executionPolicy.lmStudioBaseUrl,
        dependencies.controller.signal,
      );
      throwIfGenerationCancelled(dependencies.controller.signal);
    }
  }
  const providerId = resolveProviderFallback({
    canUseOllama,
    canUseLmStudio,
    canUseOpenAICompatible:
      executionPolicy.allowRemoteProvider && generation.providerConfig.apiKey.length > 0,
  });
  const definition =
    dependencies.providerDefinitions.find((provider) => provider.id === providerId) ?? null;
  if (!providerId || !definition) return null;
  return {
    config: buildFallbackProviderRequestConfig({
      providerId,
      providerDefinition: definition,
      providerBaseUrl: executionPolicy.lmStudioBaseUrl,
      ollamaBaseUrl: executionPolicy.ollamaBaseUrl,
      apiKey: generation.providerConfig.apiKey,
    }),
    label: definition.label,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isWebLLMExecutionError(error: unknown): error is WebLLMExecutionError {
  return (
    error instanceof Error &&
    error.name === "WebLLMProviderError" &&
    typeof (error as Partial<WebLLMExecutionError>).code === "string"
  );
}

export async function executeGeneration(
  generation: PendingGeneration,
  dependencies: GenerationExecutionDependencies,
): Promise<GenerationExecutionOutcome> {
  let activeGeneration = generation;
  let streamedAnswer = "";
  let errorProviderId: ProviderRequestConfig["providerId"] = generation.providerConfig.providerId;
  const { controller } = dependencies;

  try {
    dependencies.onResetAnswer();
    dependencies.onGeneratingChange(true);
    const database = await dependencies.getDatabase();
    throwIfGenerationCancelled(controller.signal);

    const startPlan = getGenerationStartPlan(activeGeneration);
    if (startPlan.clearPrompt) dependencies.onClearPrompt();
    if (startPlan.persistUserMessage) {
      const userMessage: ChatMessageRecord = {
        id: dependencies.createId(),
        sessionId: activeGeneration.sessionId,
        role: "user",
        content: activeGeneration.promptText,
        sequence: database.getNextChatMessageSequence(activeGeneration.sessionId),
        createdAt: dependencies.now(),
      };
      throwIfGenerationCancelled(controller.signal);
      await database.addChatMessage(userMessage);
      dependencies.onMessage(userMessage);
      activeGeneration = markPendingUserMessagePersisted(activeGeneration);
    }

    const onToken = (token: string) => {
      streamedAnswer += token;
      dependencies.onToken(token);
    };
    let effectiveConfig = activeGeneration.providerConfig;

    try {
      await dependencies.stream({
        config: effectiveConfig,
        promptText: activeGeneration.promptText,
        snippets: [...activeGeneration.snippets],
        controller,
        onToken,
      });
      if (effectiveConfig.providerId === "webllm") dependencies.onRuntimeState("ready");
    } catch (streamError) {
      throwIfGenerationCancelled(controller.signal);
      if (effectiveConfig.providerId !== "webllm" || !isWebLLMExecutionError(streamError)) {
        throw streamError;
      }

      if (streamError.code === "WEBLLM_DOWNLOAD_REQUIRED") {
        const pending = updatePendingProviderConfig(activeGeneration, effectiveConfig);
        dependencies.onRuntimeState("needs-consent");
        dependencies.onDownloadRequired(pending);
        return "suspended";
      }

      let recoveredWithWebLLM = false;
      if (effectiveConfig.model !== dependencies.fallbackWebLLMModelId) {
        effectiveConfig = createProviderRequestConfig({
          ...effectiveConfig,
          model: dependencies.fallbackWebLLMModelId,
          allowModelDownload: true,
        });
        dependencies.onWebLLMModelFallback(effectiveConfig.model);
        try {
          dependencies.onRuntimeState("downloading");
          await dependencies.stream({
            config: effectiveConfig,
            promptText: activeGeneration.promptText,
            snippets: [...activeGeneration.snippets],
            controller,
            onToken,
          });
          dependencies.onRuntimeState("ready");
          recoveredWithWebLLM = true;
        } catch {
          dependencies.onRuntimeState("failed");
        }
      } else {
        dependencies.onRuntimeState("failed");
      }

      if (!recoveredWithWebLLM) {
        throwIfGenerationCancelled(controller.signal);
        if (streamedAnswer.trim().length === 0) {
          const fallback = await resolveFallbackConfig(activeGeneration, dependencies);
          throwIfGenerationCancelled(controller.signal);
          if (!fallback) throw streamError;
          dependencies.onProviderFallback(fallback.config, fallback.label);
          errorProviderId = fallback.config.providerId;
          await dependencies.stream({
            config: fallback.config,
            promptText: activeGeneration.promptText,
            snippets: [...activeGeneration.snippets],
            controller,
            onToken,
          });
        } else {
          throw streamError;
        }
      }
    }

    throwIfGenerationCancelled(controller.signal);
    if (streamedAnswer.trim()) {
      const assistantMessage: ChatMessageRecord = {
        id: dependencies.createId(),
        sessionId: activeGeneration.sessionId,
        role: "assistant",
        content: streamedAnswer,
        sequence: database.getNextChatMessageSequence(activeGeneration.sessionId),
        createdAt: dependencies.now(),
      };
      throwIfGenerationCancelled(controller.signal);
      await database.addChatMessage(assistantMessage);
      dependencies.onMessage(assistantMessage);
    }
    return "completed";
  } catch (error) {
    dependencies.onError(error, errorProviderId);
    return isAbortError(error) ? "cancelled" : "failed";
  } finally {
    dependencies.onGeneratingChange(false);
    dependencies.onFinished();
  }
}
