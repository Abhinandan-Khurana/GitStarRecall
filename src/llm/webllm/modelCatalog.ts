export type WebLLMModelTier = "ultra-low" | "balanced" | "quality";

export type WebLLMModelProfile = {
  id: string;
  label: string;
  tier: WebLLMModelTier;
  approxDownloadMB: number;
  notes?: string;
  experimental?: boolean;
};

export const WEBLLM_MODELS: WebLLMModelProfile[] = [
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 1B Instruct",
    tier: "balanced",
    approxDownloadMB: 700,
    notes: "Primary default for strong desktops",
  },
  {
    id: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    label: "SmolLM2 360M Instruct",
    tier: "ultra-low",
    approxDownloadMB: 250,
    notes: "Mobile and weak-device fallback",
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: "Qwen2.5 1.5B Instruct",
    tier: "quality",
    approxDownloadMB: 1100,
    notes: "Strong for technical summaries",
  },
  {
    id: "Gemma-2-2B-Instruct-q4f16_1-MLC",
    label: "Gemma 2 2B Instruct",
    tier: "quality",
    approxDownloadMB: 1400,
    notes: "Polished README summarization",
  },
  {
    id: "Hermes-3-Llama-3-3B-Instruct-q4f16_1-MLC",
    label: "Hermes 3 Llama 3 3B",
    tier: "quality",
    approxDownloadMB: 1900,
    notes: "Can be unavailable in some WebLLM releases",
    experimental: true,
  },
  {
    id: "Llama-3.1-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.1 3B Instruct",
    tier: "quality",
    approxDownloadMB: 1900,
    notes: "Fallback substitute when Hermes is unavailable",
  },
];

export const WEBLLM_PRIMARY_MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
export const WEBLLM_FALLBACK_MODEL_ID = "SmolLM2-360M-Instruct-q4f16_1-MLC";
export const WEBLLM_HERMES_MODEL_ID = "Hermes-3-Llama-3-3B-Instruct-q4f16_1-MLC";
export const WEBLLM_HERMES_SUBSTITUTE_MODEL_ID = "Llama-3.1-3B-Instruct-q4f16_1-MLC";

export function isWebLLMModelIdSupported(modelId: string): boolean {
  return WEBLLM_MODELS.some((model) => model.id === modelId);
}

export function getWebLLMModelProfile(modelId: string): WebLLMModelProfile | null {
  return WEBLLM_MODELS.find((model) => model.id === modelId) ?? null;
}

export function getWebLLMSelectableModels(): WebLLMModelProfile[] {
  return WEBLLM_MODELS;
}
