import { describe, expect, it } from "vitest";
import { inferBackendFromModel, isBrowserModelIdentifier } from "./modelRouting";

describe("modelRouting", () => {
  it("detects browser model identifiers by known prefixes only", () => {
    expect(isBrowserModelIdentifier("onnx-community/embeddinggemma-300m-ONNX")).toBe(true);
    expect(isBrowserModelIdentifier("Xenova/all-MiniLM-L6-v2")).toBe(true);
    expect(isBrowserModelIdentifier("myorg/custom-embed:latest")).toBe(false);
    expect(isBrowserModelIdentifier("myorg/onnx-community-embed:latest")).toBe(false);
  });

  it("routes namespaced ollama models to ollama backend", () => {
    expect(inferBackendFromModel("myorg/custom-embed:latest")).toBe("ollama");
    expect(inferBackendFromModel("mxbai-embed-large:latest")).toBe("ollama");
    expect(inferBackendFromModel("onnx-community/embeddinggemma-300m-ONNX")).toBe("browser");
  });
});

