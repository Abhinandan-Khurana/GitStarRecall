import { describe, expect, it, vi } from "vitest";
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

  it("warns once for unknown model families while defaulting to mean pooling", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveEmbeddingPooling("myorg/custom-embedding-v1")).toBe("mean");
    expect(resolveEmbeddingPooling("myorg/custom-embedding-v1")).toBe("mean");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
