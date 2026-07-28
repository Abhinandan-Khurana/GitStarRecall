import type {
  LLMProviderConfig,
  LLMProviderDefinition,
  LLMProviderId,
  LLMStreamProvider,
  LLMStreamRequest,
} from "./types";
import { getWebLLMEngineManager, WebLLMProviderError } from "./webllm/engine";
import { buildLocalEndpointUrl } from "./localEndpoint";

const TOP_K_LIMIT = 8;

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildContextBlock(snippets: string[]): string {
  return snippets
    .slice(0, TOP_K_LIMIT)
    .map((snippet, index) => `Context ${index + 1}:\n${snippet}`)
    .join("\n\n");
}

function normalizeProviderError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

type StreamRecordOutcome = "ignored" | "valid" | "malformed" | "done";

function consumeSseLine(line: string, onToken: (token: string) => void): StreamRecordOutcome {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return "ignored";
  }

  const raw = trimmed.slice(5).trim();
  if (raw === "[DONE]") {
    return "done";
  }
  if (!raw) {
    return "ignored";
  }

  try {
    const payload = JSON.parse(raw) as {
      choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
    };
    const token = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content;
    if (token) {
      onToken(token);
    }
    return "valid";
  } catch {
    return "malformed";
  }
}

async function parseSseStream(response: Response, onToken: (token: string) => void): Promise<void> {
  if (!response.body) {
    throw new Error("Streaming response body is not available");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingMalformedRecord = false;

  const consume = (line: string): boolean => {
    const outcome = consumeSseLine(line, onToken);
    if (outcome === "malformed") {
      pendingMalformedRecord = true;
    } else if (outcome === "valid" || outcome === "done") {
      pendingMalformedRecord = false;
    }
    return outcome === "done";
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (consume(line)) {
        // Release the underlying transport instead of leaving the connection
        // draining after the terminal record has already been observed.
        await reader.cancel().catch(() => undefined);
        return;
      }
    }
  }

  if (buffer.trim()) {
    consume(buffer);
  }
  if (pendingMalformedRecord) {
    throw new Error("Malformed terminal SSE record");
  }
}

function consumeJsonLine(line: string, onToken: (token: string) => void): StreamRecordOutcome {
  const trimmed = line.trim();
  if (!trimmed) {
    return "ignored";
  }

  try {
    const payload = JSON.parse(trimmed) as {
      message?: { content?: string };
      response?: string;
      done?: boolean;
    };
    const token = payload.message?.content ?? payload.response;
    if (token) {
      onToken(token);
    }
    return payload.done === true ? "done" : "valid";
  } catch {
    return "malformed";
  }
}

async function parseJsonLineStream(
  response: Response,
  onToken: (token: string) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("Streaming response body is not available");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingMalformedRecord = false;

  const consume = (line: string): boolean => {
    const outcome = consumeJsonLine(line, onToken);
    if (outcome === "malformed") {
      pendingMalformedRecord = true;
    } else if (outcome === "valid" || outcome === "done") {
      pendingMalformedRecord = false;
    }
    return outcome === "done";
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (consume(line)) {
        // Release the underlying transport instead of leaving the connection
        // draining after the terminal record has already been observed.
        await reader.cancel().catch(() => undefined);
        return;
      }
    }
  }

  if (buffer.trim()) {
    consume(buffer);
  }
  if (pendingMalformedRecord) {
    throw new Error("Malformed terminal JSONL record");
  }
}

type ProviderMessage = {
  role: "system" | "user";
  content: string;
};

function buildMessages(prompt: string, snippets: string[]): ProviderMessage[] {
  return [
    {
      role: "system",
      content:
        "You are a recommendation assistant for GitHub starred repositories. Use only provided context and be concise.",
    },
    {
      role: "user",
      content: `${prompt}\n\n${buildContextBlock(snippets)}`,
    },
  ];
}

export function isWebLLMEnabled(): boolean {
  const raw = import.meta.env.VITE_WEBLLM_ENABLED;
  return raw === "1" || raw === "true";
}

const definitions: LLMProviderDefinition[] = [
  {
    id: "openai-compatible",
    label: "Remote (OpenAI-compatible)",
    kind: "remote",
    defaultBaseUrl: "https://api.openai.com",
    defaultModel: "gpt-4o-mini",
    requiresApiKey: true,
  },
  {
    id: "ollama",
    label: "Local (Ollama)",
    kind: "local",
    defaultBaseUrl: "http://localhost:11434",
    defaultModel: "llama3.1:8b",
    requiresApiKey: false,
  },
  {
    id: "lmstudio",
    label: "Local (LM Studio)",
    kind: "local",
    defaultBaseUrl: "http://localhost:1234",
    defaultModel: "local-model",
    requiresApiKey: false,
  },
  {
    id: "webllm",
    label: "Local (Browser WebLLM)",
    kind: "local",
    defaultBaseUrl: "",
    defaultModel: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    requiresApiKey: false,
  },
];

const providersById: Record<LLMProviderId, LLMStreamProvider> = {
  "openai-compatible": {
    definition: definitions[0],
    async stream(config: LLMProviderConfig, request: LLMStreamRequest): Promise<void> {
      const response = await fetch(`${trimSlash(config.baseUrl)}/v1/chat/completions`, {
        method: "POST",
        signal: request.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey ?? ""}`,
        },
        body: JSON.stringify({
          model: config.model,
          stream: true,
          messages: buildMessages(request.prompt, request.contextSnippets),
        }),
      });

      if (!response.ok) {
        throw new Error(`Provider request failed (${response.status})`);
      }

      await parseSseStream(response, request.onToken);
    },
  },
  ollama: {
    definition: definitions[1],
    async stream(config: LLMProviderConfig, request: LLMStreamRequest): Promise<void> {
      const response = await fetch(buildLocalEndpointUrl(config.baseUrl, "/api/chat", "Ollama"), {
        method: "POST",
        signal: request.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          stream: true,
          messages: buildMessages(request.prompt, request.contextSnippets),
        }),
      });

      if (!response.ok) {
        throw new Error(`Provider request failed (${response.status})`);
      }

      await parseJsonLineStream(response, request.onToken);
    },
  },
  lmstudio: {
    definition: definitions[2],
    async stream(config: LLMProviderConfig, request: LLMStreamRequest): Promise<void> {
      const response = await fetch(
        buildLocalEndpointUrl(config.baseUrl, "/v1/chat/completions", "LM Studio"),
        {
          method: "POST",
          signal: request.signal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            stream: true,
            messages: buildMessages(request.prompt, request.contextSnippets),
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Provider request failed (${response.status})`);
      }

      await parseSseStream(response, request.onToken);
    },
  },
  webllm: {
    definition: definitions[3],
    async stream(config: LLMProviderConfig, request: LLMStreamRequest): Promise<void> {
      if (!isWebLLMEnabled()) {
        throw new WebLLMProviderError("WEBLLM_UNSUPPORTED", "WebLLM is disabled by feature flag.");
      }

      const manager = getWebLLMEngineManager();
      await manager.ensureReady(config.model, {
        allowDownload: config.allowModelDownload === true,
        signal: request.signal,
        onProgress: (progress, text) => {
          request.onInitProgress?.(progress, text);
        },
      });
      await manager.stream(
        config.model,
        buildMessages(request.prompt, request.contextSnippets),
        request.signal,
        request.onToken,
      );
    },
  },
};

export function getProviderDefinitions(): LLMProviderDefinition[] {
  if (!isWebLLMEnabled()) {
    return definitions.filter((definition) => definition.id !== "webllm");
  }
  return definitions;
}

export async function unloadWebLLM(): Promise<void> {
  await getWebLLMEngineManager().unload();
}

export function getProviderById(providerId: LLMProviderId): LLMStreamProvider {
  return providersById[providerId];
}

export function formatProviderError(error: unknown, providerKind: "local" | "remote"): string {
  const normalized = normalizeProviderError(error);

  if (normalized.name === "AbortError") {
    return "Generation cancelled.";
  }

  const message = normalized.message || "Provider call failed";

  if (providerKind === "local" && /Failed to fetch|NetworkError/i.test(message)) {
    return "Local provider unreachable. Ensure Ollama/LM Studio is running and CORS/network access allows localhost calls.";
  }

  if (normalized instanceof WebLLMProviderError) {
    if (normalized.code === "WEBLLM_DOWNLOAD_REQUIRED") {
      return "WebLLM model download requires explicit consent.";
    }
    if (normalized.code === "WEBLLM_UNSUPPORTED") {
      return "WebLLM is unavailable in this browser/device.";
    }
    return normalized.message;
  }

  return message;
}
