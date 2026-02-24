import { describe, expect, it } from "vitest";
import {
  getWebLLMModelProfile,
  getWebLLMSelectableModels,
  isWebLLMModelIdSupported,
  WEBLLM_FALLBACK_MODEL_ID,
  WEBLLM_HERMES_MODEL_ID,
  WEBLLM_HERMES_SUBSTITUTE_MODEL_ID,
  WEBLLM_MODELS,
  WEBLLM_PRIMARY_MODEL_ID,
} from "./modelCatalog";

describe("WebLLM model catalog", () => {
  it("contains the expected model ids", () => {
    const ids = WEBLLM_MODELS.map((model) => model.id);
    expect(ids).toContain(WEBLLM_PRIMARY_MODEL_ID);
    expect(ids).toContain(WEBLLM_FALLBACK_MODEL_ID);
    expect(ids).toContain(WEBLLM_HERMES_MODEL_ID);
    expect(ids).toContain(WEBLLM_HERMES_SUBSTITUTE_MODEL_ID);
    expect(ids).toHaveLength(6);
  });

  it("supports id lookups and profile retrieval", () => {
    expect(isWebLLMModelIdSupported(WEBLLM_PRIMARY_MODEL_ID)).toBe(true);
    expect(isWebLLMModelIdSupported("missing-model")).toBe(false);
    expect(getWebLLMModelProfile(WEBLLM_FALLBACK_MODEL_ID)?.label).toContain("SmolLM2");
    expect(getWebLLMModelProfile("missing-model")).toBeNull();
  });

  it("returns selectable models in catalog order", () => {
    const selectable = getWebLLMSelectableModels();
    expect(selectable).toHaveLength(WEBLLM_MODELS.length);
    expect(selectable[0]?.id).toBe(WEBLLM_MODELS[0]?.id);
  });
});
