export type NativeEmbeddingDevice = "cuda" | "mps" | "cpu";

export type NativeRuntimeInfo = {
  device: NativeEmbeddingDevice;
  model: string;
  version: string;
};

export type NativeEmbeddingResponse = {
  embeddings: number[][];
  device: NativeEmbeddingDevice;
  model: string;
};

const LOCAL_ENDPOINT_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

function isLocalEndpoint(baseUrl: string): boolean {
  return LOCAL_ENDPOINT_PATTERN.test(baseUrl);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
}

function asDevice(value: unknown): NativeEmbeddingDevice | null {
  if (value === "cuda" || value === "mps" || value === "cpu") {
    return value;
  }
  return null;
}

function ensureHttpOk(response: Response, endpoint: string): void {
  if (!response.ok) {
    throw new Error(`native endpoint ${endpoint} failed: ${response.status} ${response.statusText}`);
  }
}

function parseNativeRuntimeInfo(value: unknown): NativeRuntimeInfo {
  const obj = asRecord(value);
  const device = asDevice(obj?.device);
  const model = typeof obj?.model === "string" ? obj.model : "";
  const version = typeof obj?.version === "string" ? obj.version : "";
  if (!obj || !device || !model || !version) {
    throw new Error("invalid native runtime response");
  }
  return { device, model, version };
}

function parseNativeEmbeddingResponse(value: unknown): NativeEmbeddingResponse {
  const obj = asRecord(value);
  const device = asDevice(obj?.device);
  const model = typeof obj?.model === "string" ? obj.model : "";
  const embeddingsRaw = obj?.embeddings;
  if (!obj || !device || !model || !Array.isArray(embeddingsRaw)) {
    throw new Error("invalid native embedding response");
  }

  const embeddings = embeddingsRaw.map((row) => {
    if (!Array.isArray(row)) {
      throw new Error("invalid native embedding vector row");
    }
    const numeric = row.map((value) => Number(value));
    if (numeric.some((value) => !Number.isFinite(value))) {
      throw new Error("native embedding vector contains non-numeric values");
    }
    return numeric;
  });

  return {
    embeddings,
    device,
    model,
  };
}

export class NativeEmbeddingClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly model: string;

  constructor(args: { baseUrl: string; timeoutMs: number; model: string }) {
    const normalizedBaseUrl = args.baseUrl.replace(/\/+$/, "");
    if (!isLocalEndpoint(normalizedBaseUrl)) {
      throw new Error("Local-native embedding endpoint must be localhost");
    }
    this.baseUrl = normalizedBaseUrl;
    this.timeoutMs = Math.max(1_000, Math.trunc(args.timeoutMs));
    this.model = args.model;
  }

  private async fetchJson(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      ensureHttpOk(response, path);
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }

  async healthCheck(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: controller.signal,
      });
      ensureHttpOk(response, "/health");
    } finally {
      clearTimeout(timeout);
    }
  }

  async getRuntimeInfo(): Promise<NativeRuntimeInfo> {
    const payload = await this.fetchJson("/v1/runtime", { method: "GET" });
    return parseNativeRuntimeInfo(payload);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }
    const payload = await this.fetchJson("/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        texts,
      }),
    });
    const response = parseNativeEmbeddingResponse(payload);
    if (response.embeddings.length !== texts.length) {
      throw new Error(
        `native embedding count mismatch: expected ${texts.length}, got ${response.embeddings.length}`,
      );
    }
    return response.embeddings.map((vector) => Float32Array.from(vector));
  }
}
