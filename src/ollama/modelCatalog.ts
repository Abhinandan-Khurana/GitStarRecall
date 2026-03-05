const LOCAL_ENDPOINT_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type OllamaModelEntry = {
  name: string;
  families: string[];
};

export type OllamaModelCatalog = {
  all: string[];
  embedding: string[];
  llm: string[];
  recommendedEmbedding: string;
  recommendedLlm: string | null;
};

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

function isLocalEndpoint(baseUrl: string): boolean {
  return LOCAL_ENDPOINT_PATTERN.test(baseUrl);
}

function normalizeModelName(name: string): string {
  return name.trim();
}

function parseFamilies(details: JsonObject | null): string[] {
  if (!details) {
    return [];
  }
  const family = asString(details.family);
  const families = asArray(details.families)
    ?.map((value) => asString(value))
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim()) ?? [];

  if (family && family.trim()) {
    return Array.from(new Set([family.trim(), ...families]));
  }
  return Array.from(new Set(families));
}

function parseModelEntries(payload: JsonValue): OllamaModelEntry[] {
  const root = asObject(payload);
  const models = asArray(root?.models);
  if (!models) {
    return [];
  }

  const entries: OllamaModelEntry[] = [];
  for (const modelValue of models) {
    const modelObject = asObject(modelValue);
    if (!modelObject) {
      continue;
    }

    const byName = asString(modelObject.name);
    const byModel = asString(modelObject.model);
    const normalized = normalizeModelName(byName ?? byModel ?? "");
    if (!normalized) {
      continue;
    }

    entries.push({
      name: normalized,
      families: parseFamilies(asObject(modelObject.details)),
    });
  }
  return entries;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

const EMBEDDING_NAME_HINT =
  /(embed|embedding|nomic-embed|mxbai-embed|snowflake-arctic-embed|bge|e5|minilm|gte|jina-embeddings)/i;
const EMBEDDING_FAMILIES = new Set(["bert", "clip", "sentence-transformers"]);

function isEmbeddingModel(entry: OllamaModelEntry): boolean {
  if (EMBEDDING_NAME_HINT.test(entry.name)) {
    return true;
  }
  return entry.families.some((family) => EMBEDDING_FAMILIES.has(family.toLowerCase()));
}

function pickRecommendedEmbedding(models: string[]): string {
  if (models.includes(DEFAULT_EMBEDDING_MODEL)) {
    return DEFAULT_EMBEDDING_MODEL;
  }
  return models[0] ?? DEFAULT_EMBEDDING_MODEL;
}

export function buildOllamaModelCatalogFromPayload(
  payload: JsonValue,
  preferredLlmModel: string | null,
): OllamaModelCatalog {
  const entries = parseModelEntries(payload);
  const all = uniqueSorted(entries.map((entry) => entry.name));
  const embedding = uniqueSorted(entries.filter((entry) => isEmbeddingModel(entry)).map((entry) => entry.name));
  const llm = uniqueSorted(entries.filter((entry) => !isEmbeddingModel(entry)).map((entry) => entry.name));
  const normalizedPreferredLlm = preferredLlmModel ? preferredLlmModel.trim() : "";

  return {
    all,
    embedding,
    llm,
    recommendedEmbedding: pickRecommendedEmbedding(embedding),
    recommendedLlm: normalizedPreferredLlm && llm.includes(normalizedPreferredLlm) ? normalizedPreferredLlm : llm[0] ?? null,
  };
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

async function fetchWithTimeout(
  baseUrl: string,
  path: string,
  timeoutMs: number,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Ollama request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOllamaModelCatalog(args: {
  baseUrl: string;
  timeoutMs: number;
  preferredLlmModel: string | null;
}): Promise<OllamaModelCatalog> {
  const normalizedBaseUrl = args.baseUrl.trim().replace(/\/+$/, "");
  if (!isLocalEndpoint(normalizedBaseUrl)) {
    throw new Error("Ollama endpoint must use localhost / 127.0.0.1 / [::1]");
  }

  const response = await fetchWithTimeout(normalizedBaseUrl, "/api/tags", Math.max(1_000, Math.trunc(args.timeoutMs)), {
    method: "GET",
  });
  if (!response.ok) {
    const reason = await extractErrorMessage(response);
    throw new Error(`Ollama model list request failed: ${reason}`);
  }

  const payload = (await response.json()) as JsonValue;
  return buildOllamaModelCatalogFromPayload(payload, args.preferredLlmModel);
}
