import { describe, expect, test, vi } from "vitest";
import { buildOllamaModelCatalogFromPayload, fetchOllamaModelCatalog } from "./modelCatalog";

describe("buildOllamaModelCatalogFromPayload", () => {
  test("splits embedding and llm models", () => {
    const catalog = buildOllamaModelCatalogFromPayload(
      {
        models: [
          { name: "nomic-embed-text", details: { family: "bert" } },
          { name: "llama3.1:8b", details: { family: "llama" } },
          { name: "mxbai-embed-large" },
          { name: "qwen3-embedding:0.6b" },
        ],
      },
      "llama3.1:8b",
    );

    expect(catalog.embedding).toEqual(["qwen3-embedding:0.6b", "mxbai-embed-large", "nomic-embed-text"]);
    expect(catalog.llm).toEqual(["llama3.1:8b"]);
    expect(catalog.recommendedEmbedding).toBe("qwen3-embedding:0.6b");
    expect(catalog.recommendedLlm).toBe("llama3.1:8b");
  });

  test("uses first embedding model when nomic-embed-text is unavailable", () => {
    const catalog = buildOllamaModelCatalogFromPayload(
      {
        models: [{ name: "bge-m3" }],
      },
      null,
    );
    expect(catalog.recommendedEmbedding).toBe("bge-m3");
    expect(catalog.recommendedLlm).toBeNull();
  });

  test("matches recommended embedding models even when ollama names include tags", () => {
    const catalog = buildOllamaModelCatalogFromPayload(
      {
        models: [
          { name: "mxbai-embed-large:latest" },
          { name: "nomic-embed-text:latest" },
          { name: "llama3.1:8b", details: { family: "llama" } },
        ],
      },
      null,
    );
    expect(catalog.embedding[0]).toBe("mxbai-embed-large:latest");
    expect(catalog.recommendedEmbedding).toBe("mxbai-embed-large:latest");
  });

  test("deduplicates and sorts model names", () => {
    const catalog = buildOllamaModelCatalogFromPayload(
      {
        models: [
          { name: "llama3.1:8b" },
          { name: "llama3.1:8b" },
          { name: "nomic-embed-text" },
        ],
      },
      null,
    );
    expect(catalog.all).toEqual(["llama3.1:8b", "nomic-embed-text"]);
  });
});

describe("fetchOllamaModelCatalog", () => {
  test("fetches tags and builds catalog", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { name: "nomic-embed-text" },
            { name: "llama3.1:8b" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await fetchOllamaModelCatalog({
      baseUrl: "http://localhost:11434",
      timeoutMs: 10_000,
      preferredLlmModel: "llama3.1:8b",
    });

    expect(catalog.embedding).toContain("nomic-embed-text");
    expect(catalog.llm).toContain("llama3.1:8b");
  });

  test("rejects non-local endpoint", async () => {
    await expect(
      fetchOllamaModelCatalog({
        baseUrl: "https://example.com",
        timeoutMs: 10_000,
        preferredLlmModel: null,
      }),
    ).rejects.toThrow("localhost");
  });
});
