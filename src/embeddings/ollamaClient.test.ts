import { afterEach, describe, expect, test, vi } from "vitest";
import { OllamaEmbeddingClient } from "./ollamaClient";

describe("OllamaEmbeddingClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("rejects non-localhost base URLs", () => {
    expect(
      () =>
        new OllamaEmbeddingClient({
          baseUrl: "https://example.com",
          model: "nomic-embed-text",
          timeoutMs: 10_000,
        }),
    ).toThrow("localhost");
  });

  test("probes runtime and embeds via /api/embed", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [{ name: "nomic-embed-text" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          embeddings: [
            [1.1, 1.2, 1.3],
            [2.1, 2.2, 2.3],
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OllamaEmbeddingClient({
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      timeoutMs: 10_000,
    });

    const runtime = await client.probeRuntime();
    expect(runtime.endpoint).toBe("embed");
    expect(runtime.availableModels).toContain("nomic-embed-text");

    const vectors = await client.embedBatch(["alpha", "beta"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.[0]).toBeCloseTo(1.1, 4);
    expect(vectors[1]?.[0]).toBeCloseTo(2.1, 4);

    const probeCall = fetchMock.mock.calls[1];
    const embedCall = fetchMock.mock.calls[2];
    const probeBody = String(probeCall?.[1]?.body ?? "");
    const embedBody = String(embedCall?.[1]?.body ?? "");
    expect(probeBody).not.toContain("token");
    expect(probeBody).not.toContain("authorization");
    expect(embedBody).not.toContain("token");
    expect(embedBody).not.toContain("authorization");
  });

  test("falls back to /api/embeddings when /api/embed is unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [{ name: "nomic-embed-text" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response("not found", {
        status: 404,
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding: [0.1, 0.2, 0.3] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding: [1.1, 1.2, 1.3] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OllamaEmbeddingClient({
      baseUrl: "http://127.0.0.1:11434",
      model: "nomic-embed-text",
      timeoutMs: 10_000,
    });

    const runtime = await client.probeRuntime();
    expect(runtime.endpoint).toBe("embeddings");

    const vectors = await client.embedBatch(["a", "b"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.[0]).toBeCloseTo(0.1, 4);
    expect(vectors[1]?.[0]).toBeCloseTo(1.1, 4);
  });

  test("returns deterministic timeout errors", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            return;
          }
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OllamaEmbeddingClient({
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      timeoutMs: 1_000,
    });

    const pending = expect(client.healthCheck()).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(1_500);
    await pending;
    vi.useRealTimers();
  });
});
