export type LLMProviderKind = "remote" | "local";

export type LLMProviderId = "openai-compatible" | "ollama" | "lmstudio" | "webllm";

export type LLMProviderDefinition = {
  id: LLMProviderId;
  label: string;
  kind: LLMProviderKind;
  defaultBaseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
};

export type LLMStreamRequest = {
  prompt: string;
  contextSnippets: string[];
  signal: AbortSignal;
  onToken: (token: string) => void;
  onInitProgress?: (progress: number, text: string) => void;
};

export type LLMProviderConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  allowModelDownload?: boolean;
};

export type LLMStreamProvider = {
  definition: LLMProviderDefinition;
  stream: (config: LLMProviderConfig, request: LLMStreamRequest) => Promise<void>;
};
