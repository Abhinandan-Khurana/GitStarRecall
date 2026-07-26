import type { ChatMessageRecord } from "../db/types";
import {
  checkLocalProviderReachability,
  executeGeneration,
  streamProviderRequest,
  type GenerationDatabase,
  type GenerationExecutionDependencies,
  type GenerationExecutionOutcome,
} from "./generationExecution";
import type { PendingGeneration } from "./generationState";
import type { LLMProviderDefinition, LLMProviderId, LLMStreamProvider } from "./types";

type StateSetter<T> = (value: T | ((previous: T) => T)) => void;
type RuntimeState = "idle" | "probing" | "ready" | "needs-consent" | "downloading" | "failed";
type SessionMessages = Record<string, ChatMessageRecord[]>;

export type UsageGenerationBindings = {
  controllerRef: { current: AbortController | null };
  pendingGenerationRef: { current: PendingGeneration | null };
  fallbackWebLLMModelId: string;
  providerDefinitions: readonly LLMProviderDefinition[];
  getDatabase(): Promise<GenerationDatabase>;
  getProvider(providerId: LLMProviderId): LLMStreamProvider;
  createId(): string;
  now(): number;
  setGenerating: StateSetter<boolean>;
  setAnswer: StateSetter<string>;
  setPrompt: StateSetter<string>;
  setSessionMessages: StateSetter<SessionMessages>;
  sortMessages(messages: ChatMessageRecord[]): ChatMessageRecord[];
  setRuntimeState: StateSetter<RuntimeState>;
  setDownloadProgress: StateSetter<number>;
  setProgressText: StateSetter<string | null>;
  setDownloadDialogOpen: StateSetter<boolean>;
  setAllowModelDownload: StateSetter<boolean>;
  setProviderId: StateSetter<LLMProviderId>;
  setProviderModel: StateSetter<string>;
  setProviderBaseUrl: StateSetter<string>;
  setSelectedWebLLMModel: StateSetter<string>;
  setError: StateSetter<string | null>;
  reportError(error: unknown, providerId: LLMProviderId): void;
};

export function createUsageGenerationDependencies(
  bindings: UsageGenerationBindings,
): GenerationExecutionDependencies {
  bindings.controllerRef.current?.abort();
  const controller = new AbortController();
  bindings.controllerRef.current = controller;

  return {
    controller,
    fallbackWebLLMModelId: bindings.fallbackWebLLMModelId,
    getDatabase: bindings.getDatabase,
    providerDefinitions: bindings.providerDefinitions,
    canReachLocalProvider: checkLocalProviderReachability,
    createId: bindings.createId,
    now: bindings.now,
    stream: (args) =>
      streamProviderRequest(
        args,
        bindings.getProvider(args.config.providerId),
        (progress, text) => {
          bindings.setDownloadProgress(progress);
          bindings.setProgressText(text);
          bindings.setRuntimeState("downloading");
        },
      ),
    onGeneratingChange: bindings.setGenerating,
    onResetAnswer: () => {
      bindings.setError(null);
      bindings.setAnswer("");
    },
    onClearPrompt: () => bindings.setPrompt(""),
    onToken: (token) => bindings.setAnswer((previous) => previous + token),
    onMessage: (message) =>
      bindings.setSessionMessages((previous) => ({
        ...previous,
        [message.sessionId]: bindings.sortMessages([
          ...(previous[message.sessionId] ?? []),
          message,
        ]),
      })),
    onRuntimeState: bindings.setRuntimeState,
    onDownloadRequired: (pending) => {
      bindings.pendingGenerationRef.current = pending;
      bindings.setDownloadDialogOpen(true);
      bindings.setError(null);
    },
    onWebLLMModelFallback: (model) => {
      bindings.setProviderModel(model);
      bindings.setSelectedWebLLMModel(model);
    },
    onProviderFallback: (config, label) => {
      bindings.setProviderId(config.providerId);
      bindings.setProviderModel(config.model);
      bindings.setProviderBaseUrl(config.baseUrl);
      bindings.setError(`WebLLM failed, switched to ${label}.`);
    },
    onError: bindings.reportError,
    onFinished: () => {
      if (bindings.controllerRef.current === controller) {
        bindings.controllerRef.current = null;
      }
      bindings.setAllowModelDownload(false);
    },
  };
}

export function executeUsageGeneration(
  generation: PendingGeneration,
  bindings: UsageGenerationBindings,
): Promise<GenerationExecutionOutcome> {
  return executeGeneration(generation, createUsageGenerationDependencies(bindings));
}
