import type {
  LLMProviderConfig,
  LLMProviderDefinition,
  LLMProviderId,
  LLMStreamProvider,
  LLMStreamRequest,
} from "./types";

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

async function parseSseStream(response: Response, onToken: (token: string) => void): Promise<void> {
  if (!response.body) {
    throw new Error("Streaming response body is not available");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }

      const raw = trimmed.slice(5).trim();
      if (raw === "[DONE]") {
        return;
      }

      if (!raw) {
        continue;
      }

      try {
        const payload = JSON.parse(raw) as {
          choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
        };
        const token = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content;

        if (token) {
          onToken(token);
        }
      } catch {
        // Skip malformed SSE lines without killing the stream.
      }
    }
  }
}

async function parseJsonLineStream(response: Response, onToken: (token: string) => void): Promise<void> {
  if (!response.body) {
    throw new Error("Streaming response body is not available");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
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

        if (payload.done) {
          return;
        }
      } catch {
        // ignore bad line
      }
    }
  }
}

function buildMessages(prompt: string, snippets: string[]) {
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
      const response = await fetch(`${trimSlash(config.baseUrl)}/api/chat`, {
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
      const response = await fetch(`${trimSlash(config.baseUrl)}/v1/chat/completions`, {
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

      await parseSseStream(response, request.onToken);
    },
  },
};

export function getProviderDefinitions(): LLMProviderDefinition[] {
  return definitions;
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

  return message;
}
