import { afterEach, describe, expect, test, vi } from "vitest";
import { NativeEmbeddingClient } from "./nativeClient";

describe("NativeEmbeddingClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("rejects non-localhost base urls", () => {
    expect(
      () =>
        new NativeEmbeddingClient({
          baseUrl: "https://example.com",
          timeoutMs: 1_000,
          model: "test-model",
        }),
    ).toThrow("localhost");
  });

  test("loads runtime info and batch embeddings", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ device: "cpu", model: "mini", version: "1.0.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          embeddings: [
            [0.1, 0.2, 0.3],
            [1.1, 1.2, 1.3],
          ],
          device: "cpu",
          model: "mini",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new NativeEmbeddingClient({
      baseUrl: "http://localhost:8765",
      timeoutMs: 10_000,
      model: "mini",
    });

    await client.healthCheck();
    const runtime = await client.getRuntimeInfo();
    expect(runtime.device).toBe("cpu");
    expect(runtime.model).toBe("mini");

    const vectors = await client.embedBatch(["alpha", "beta"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.[0]).toBeCloseTo(0.1, 4);
    expect(vectors[0]?.[1]).toBeCloseTo(0.2, 4);
    expect(vectors[0]?.[2]).toBeCloseTo(0.3, 4);
    expect(vectors[1]?.[0]).toBeCloseTo(1.1, 4);
    expect(vectors[1]?.[1]).toBeCloseTo(1.2, 4);
    expect(vectors[1]?.[2]).toBeCloseTo(1.3, 4);
  });

  test("throws when embedding count mismatches request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          embeddings: [[0.1, 0.2, 0.3]],
          device: "cpu",
          model: "mini",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new NativeEmbeddingClient({
      baseUrl: "http://127.0.0.1:8765",
      timeoutMs: 10_000,
      model: "mini",
    });

    await expect(client.embedBatch(["a", "b"])).rejects.toThrow("count mismatch");
  });
});
