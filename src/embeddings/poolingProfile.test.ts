import { describe, expect, it } from "vitest";
import { resolveEmbeddingPooling } from "./poolingProfile";

describe("resolveEmbeddingPooling", () => {
  it("uses mean pooling for embeddinggemma", () => {
    expect(resolveEmbeddingPooling("onnx-community/embeddinggemma-300m-ONNX")).toBe("mean");
    expect(resolveEmbeddingPooling("embeddinggemma")).toBe("mean");
  });

  it("defaults to mean pooling for other models", () => {
    expect(resolveEmbeddingPooling("Xenova/all-MiniLM-L6-v2")).toBe("mean");
    expect(resolveEmbeddingPooling("")).toBe("mean");
    expect(resolveEmbeddingPooling(null)).toBe("mean");
  });
});
