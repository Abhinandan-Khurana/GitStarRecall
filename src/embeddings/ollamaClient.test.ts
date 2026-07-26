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

  test.each([
    "http://localhost.example.com:11434",
    "http://127.0.0.1.example.com",
    "http://user@localhost:11434",
    "https://192.168.1.10:11434",
    "ftp://localhost:11434",
  ])("rejects unsafe endpoint %s before discovery or embedding fetch", (baseUrl) => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      () =>
        new OllamaEmbeddingClient({
          baseUrl,
          model: "nomic-embed-text",
          timeoutMs: 10_000,
        }),
    ).toThrow(/endpoint/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("accepts any 127.0.0.0/8 address and preserves a safe proxy path", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [{ name: "nomic-embed-text" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OllamaEmbeddingClient({
      baseUrl: "https://127.255.42.7:11434/proxy/",
      model: "nomic-embed-text",
      timeoutMs: 10_000,
    });

    await expect(client.healthCheck()).resolves.toEqual(["nomic-embed-text"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://127.255.42.7:11434/proxy/api/tags",
      expect.objectContaining({ method: "GET" }),
    );
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

  test("rejects /api/embed responses whose vector count does not match the input batch", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ embeddings: [[1.1, 1.2]] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new OllamaEmbeddingClient({
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      timeoutMs: 10_000,
    });

    await expect(client.embedBatch(["alpha", "beta"])).rejects.toThrow(
      "Ollama /api/embed mismatch: expected 2, got 1",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:11434/api/embed",
      "http://localhost:11434/api/embed",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      model: "nomic-embed-text",
      input: ["alpha", "beta"],
    });
  });

  test.each([
    { embeddings: [], expectedCount: 0 },
    {
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      expectedCount: 2,
    },
  ])(
    "rejects a legacy single-prompt response containing $expectedCount vectors",
    async ({ embeddings, expectedCount }) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("not found", { status: 404 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ embeddings }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      vi.stubGlobal("fetch", fetchMock);
      const client = new OllamaEmbeddingClient({
        baseUrl: "http://localhost:11434",
        model: "nomic-embed-text",
        timeoutMs: 10_000,
      });

      await expect(client.embedBatch(["alpha"])).rejects.toThrow(
        `Ollama /api/embeddings returned ${expectedCount} vectors for single prompt`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        "http://localhost:11434/api/embed",
        "http://localhost:11434/api/embeddings",
      ]);
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
        model: "nomic-embed-text",
        prompt: "alpha",
      });
    },
  );

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
