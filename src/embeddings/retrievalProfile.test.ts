import { describe, expect, it } from "vitest";
import { formatForEmbedding, getRetrievalProfile } from "./retrievalProfile";

describe("retrievalProfile", () => {
  it("maps qwen3 model to query/passage profile", () => {
    expect(getRetrievalProfile("qwen3-embedding:4b")).toEqual({
      queryPrefix: "query: ",
      documentPrefix: "passage: ",
    });
  });

  it("maps mxbai to search profile", () => {
    expect(getRetrievalProfile("mxbai-embed-large")).toEqual({
      queryPrefix: "search_query: ",
      documentPrefix: "search_document: ",
    });
  });

  it("keeps embeddinggemma unprefixed per model-card contract", () => {
    expect(getRetrievalProfile("embeddinggemma")).toEqual({
      queryPrefix: "",
      documentPrefix: "",
    });
  });

  it("formats text only when prefix exists", () => {
    expect(formatForEmbedding("hello", "query:")).toBe("query: hello");
    expect(formatForEmbedding("hello", "")).toBe("hello");
  });
});
