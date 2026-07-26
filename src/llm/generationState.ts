import type { LLMProviderDefinition, LLMProviderId } from "./types";

export type ProviderRequestConfig = Readonly<{
  providerId: LLMProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  allowModelDownload: boolean;
}>;

export type PendingGeneration = Readonly<{
  requestId: string;
  sessionId: string;
  promptText: string;
  snippets: readonly string[];
  providerConfig: ProviderRequestConfig;
  executionPolicy: Readonly<{
    allowLocalProvider: boolean;
    allowRemoteProvider: boolean;
    webllmConsent: boolean;
    ollamaBaseUrl: string;
    lmStudioBaseUrl: string;
  }>;
  userMessagePersisted: boolean;
}>;

export function createProviderRequestConfig(config: ProviderRequestConfig): ProviderRequestConfig {
  return Object.freeze({
    ...config,
    baseUrl: config.baseUrl.trim(),
    model: config.model.trim(),
    apiKey: config.apiKey.trim(),
  });
}

export function buildSelectedProviderRequestConfig(input: {
  providerId: LLMProviderId;
  providerBaseUrl: string;
  ollamaBaseUrl: string;
  model: string;
  apiKey: string;
  allowModelDownload: boolean;
}): ProviderRequestConfig {
  return createProviderRequestConfig({
    providerId: input.providerId,
    baseUrl:
      input.providerId === "ollama"
        ? input.ollamaBaseUrl.trim() || "http://localhost:11434"
        : input.providerBaseUrl,
    model: input.model,
    apiKey: input.apiKey,
    allowModelDownload: input.allowModelDownload,
  });
}

export function buildFallbackProviderRequestConfig(input: {
  providerId: LLMProviderId;
  providerDefinition: LLMProviderDefinition;
  providerBaseUrl: string;
  ollamaBaseUrl: string;
  apiKey: string;
}): ProviderRequestConfig {
  return createProviderRequestConfig({
    providerId: input.providerId,
    baseUrl:
      input.providerId === "ollama"
        ? input.ollamaBaseUrl.trim() || "http://localhost:11434"
        : input.providerId === "lmstudio"
          ? input.providerBaseUrl.trim() || input.providerDefinition.defaultBaseUrl
          : input.providerDefinition.defaultBaseUrl,
    model: input.providerDefinition.defaultModel,
    apiKey: input.apiKey,
    allowModelDownload: false,
  });
}

export function resolveLmStudioPolicyUrl(
  providerId: LLMProviderId,
  providerBaseUrl: string,
): string {
  return providerId === "lmstudio" ? providerBaseUrl.trim() : "";
}

export function createPendingGeneration(input: PendingGeneration): PendingGeneration {
  return Object.freeze({
    ...input,
    snippets: Object.freeze([...input.snippets]),
    providerConfig: createProviderRequestConfig(input.providerConfig),
    executionPolicy: Object.freeze({ ...input.executionPolicy }),
  });
}

export function createSelectedProviderGeneration(input: {
  requestId: string;
  sessionId: string;
  promptText: string;
  snippets: readonly string[];
  providerSelection: Parameters<typeof buildSelectedProviderRequestConfig>[0];
  executionPolicy: PendingGeneration["executionPolicy"];
}): PendingGeneration {
  return createPendingGeneration({
    requestId: input.requestId,
    sessionId: input.sessionId,
    promptText: input.promptText,
    snippets: input.snippets,
    providerConfig: buildSelectedProviderRequestConfig(input.providerSelection),
    executionPolicy: input.executionPolicy,
    userMessagePersisted: false,
  });
}

export function markPendingUserMessagePersisted(generation: PendingGeneration): PendingGeneration {
  return createPendingGeneration({ ...generation, userMessagePersisted: true });
}

export function getGenerationStartPlan(generation: PendingGeneration): {
  clearPrompt: boolean;
  persistUserMessage: boolean;
} {
  const firstExecution = !generation.userMessagePersisted;
  return { clearPrompt: firstExecution, persistUserMessage: firstExecution };
}

export function updatePendingProviderConfig(
  generation: PendingGeneration,
  providerConfig: ProviderRequestConfig,
): PendingGeneration {
  return createPendingGeneration({ ...generation, providerConfig });
}

export function updatePendingExecutionPolicy(
  generation: PendingGeneration,
  executionPolicy: PendingGeneration["executionPolicy"],
): PendingGeneration {
  return createPendingGeneration({ ...generation, executionPolicy });
}

export function consumePendingGeneration(pending: PendingGeneration | null): {
  generation: PendingGeneration | null;
  nextPending: null;
} {
  return { generation: pending, nextPending: null };
}

export function cancelPendingGeneration(): null {
  return null;
}

export function resumePendingWebLLMGeneration(
  pending: PendingGeneration | null,
  model: string,
): { generation: PendingGeneration | null; nextPending: null } {
  const consumed = consumePendingGeneration(pending);
  if (!consumed.generation) return consumed;
  return {
    generation: updatePendingExecutionPolicy(
      updatePendingProviderConfig(
        consumed.generation,
        createProviderRequestConfig({
          ...consumed.generation.providerConfig,
          providerId: "webllm",
          model,
          allowModelDownload: true,
        }),
      ),
      { ...consumed.generation.executionPolicy, webllmConsent: true },
    ),
    nextPending: null,
  };
}

export function shouldResetRuntimeAfterEmptyResume(activeSignal: AbortSignal | null): boolean {
  return activeSignal === null || activeSignal.aborted;
}

export function throwIfGenerationCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Generation cancelled", "AbortError");
}
