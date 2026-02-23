export type OllamaEmbeddingEndpoint = "embed" | "embeddings";

export type OllamaEmbeddingRuntimeInfo = {
  baseUrl: string;
  model: string;
  endpoint: OllamaEmbeddingEndpoint;
  availableModels: string[];
};

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

const LOCAL_ENDPOINT_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

function isLocalEndpoint(baseUrl: string): boolean {
  return LOCAL_ENDPOINT_PATTERN.test(baseUrl);
}

function asObject(value: JsonValue | null | undefined): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function asArray(value: JsonValue | null | undefined): JsonValue[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value;
}

function asString(value: JsonValue | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value;
}

function parseModelNames(payload: JsonValue): string[] {
  const root = asObject(payload);
  const models = asArray(root?.models);
  if (!models) {
    return [];
  }
  const names: string[] = [];
  for (const modelEntry of models) {
    const modelObject = asObject(modelEntry);
    const name = asString(modelObject?.name);
    if (name) {
      names.push(name);
    }
  }
  return names;
}

function parseNumericVector(value: JsonValue): number[] {
  const row = asArray(value);
  if (!row) {
    throw new Error("invalid embedding vector format");
  }
  const numeric = row.map((item) => Number(item));
  if (numeric.some((item) => !Number.isFinite(item))) {
    throw new Error("embedding vector contains non-numeric values");
  }
  return numeric;
}

function parseEmbedResponse(payload: JsonValue): number[][] {
  const root = asObject(payload);
  const embeddings = asArray(root?.embeddings);
  if (embeddings) {
    return embeddings.map((entry) => parseNumericVector(entry));
  }
  const embedding = root?.embedding;
  if (embedding) {
    return [parseNumericVector(embedding)];
  }
  throw new Error("missing embeddings array in Ollama response");
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as JsonValue;
    const root = asObject(payload);
    const message = asString(root?.error) ?? asString(root?.message);
    if (message && message.trim()) {
      return message;
    }
  } catch {
    // ignore parse errors
  }
  return `${response.status} ${response.statusText}`;
}

export class OllamaEmbeddingClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private endpoint: OllamaEmbeddingEndpoint | null = null;
  private availableModels: string[] = [];

  constructor(args: { baseUrl: string; model: string; timeoutMs: number }) {
    const normalizedBaseUrl = args.baseUrl.trim().replace(/\/+$/, "");
    if (!isLocalEndpoint(normalizedBaseUrl)) {
      throw new Error("Ollama endpoint must use localhost / 127.0.0.1 / [::1]");
    }
    const normalizedModel = args.model.trim();
    if (!normalizedModel) {
      throw new Error("Ollama embedding model is required");
    }
    this.baseUrl = normalizedBaseUrl;
    this.model = normalizedModel;
    this.timeoutMs = Math.max(1_000, Math.trunc(args.timeoutMs));
  }

  private async fetchWithTimeout(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Ollama request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async ensureEmbedEndpoint(): Promise<OllamaEmbeddingEndpoint> {
    if (this.endpoint) {
      return this.endpoint;
    }

    const response = await this.fetchWithTimeout("/api/embed", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: ["probe"],
      }),
    });

    if (response.status === 404 || response.status === 405) {
      this.endpoint = "embeddings";
      return this.endpoint;
    }

    if (!response.ok) {
      const reason = await extractErrorMessage(response);
      this.endpoint = "embed";
      throw new Error(`Ollama /api/embed probe failed: ${reason}`);
    }

    this.endpoint = "embed";
    return this.endpoint;
  }

  async healthCheck(): Promise<string[]> {
    const response = await this.fetchWithTimeout("/api/tags", { method: "GET" });
    if (!response.ok) {
      const reason = await extractErrorMessage(response);
      throw new Error(`Ollama health check failed: ${reason}`);
    }
    const payload = (await response.json()) as JsonValue;
    this.availableModels = parseModelNames(payload);
    return this.availableModels;
  }

  async probeRuntime(): Promise<OllamaEmbeddingRuntimeInfo> {
    const availableModels = await this.healthCheck();
    const endpoint = await this.ensureEmbedEndpoint();
    return {
      baseUrl: this.baseUrl,
      model: this.model,
      endpoint,
      availableModels,
    };
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }

    const endpoint = await this.ensureEmbedEndpoint();
    if (endpoint === "embed") {
      const response = await this.fetchWithTimeout("/api/embed", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      });
      if (!response.ok) {
        const reason = await extractErrorMessage(response);
        throw new Error(`Ollama /api/embed failed: ${reason}`);
      }
      const payload = (await response.json()) as JsonValue;
      const vectors = parseEmbedResponse(payload);
      if (vectors.length !== texts.length) {
        throw new Error(`Ollama /api/embed mismatch: expected ${texts.length}, got ${vectors.length}`);
      }
      return vectors.map((vector) => Float32Array.from(vector));
    }

    const vectors: Float32Array[] = [];
    for (const text of texts) {
      const response = await this.fetchWithTimeout("/api/embeddings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
      });
      if (!response.ok) {
        const reason = await extractErrorMessage(response);
        throw new Error(`Ollama /api/embeddings failed: ${reason}`);
      }
      const payload = (await response.json()) as JsonValue;
      const vectorRows = parseEmbedResponse(payload);
      if (vectorRows.length !== 1) {
        throw new Error(`Ollama /api/embeddings returned ${vectorRows.length} vectors for single prompt`);
      }
      vectors.push(Float32Array.from(vectorRows[0]));
    }
    return vectors;
  }
}
