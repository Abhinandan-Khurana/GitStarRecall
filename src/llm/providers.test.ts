import { getProviderById } from "./providers";
import type { LLMProviderId, LLMStreamRequest } from "./types";
import { getWebLLMEngineManager } from "./webllm/engine";

vi.mock("./webllm/engine", () => {
  class WebLLMProviderError extends Error {
    readonly code = "WEBLLM_UNSUPPORTED";
  }
  return {
    getWebLLMEngineManager: vi.fn(),
    WebLLMProviderError,
  };
});

const encoder = new TextEncoder();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function responseFromChunks(chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function trackedResponse(chunks: Uint8Array[]): { response: Response; wasCanceled: () => boolean } {
  let canceled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
      cancel() {
        canceled = true;
      },
    }),
    { status: 200 },
  );
  return { response, wasCanceled: () => canceled };
}

function everyTwoChunkSplit(value: string): Uint8Array[][] {
  const bytes = encoder.encode(value);
  const splits = Array.from({ length: bytes.length + 1 }, (_, index) =>
    [bytes.slice(0, index), bytes.slice(index)].filter((chunk) => chunk.byteLength > 0),
  );
  splits.push(Array.from(bytes, (byte) => Uint8Array.of(byte)));
  return splits;
}

function streamRequest(onToken: (token: string) => void): LLMStreamRequest {
  return {
    prompt: "Find a repository",
    contextSnippets: ["Context"],
    signal: new AbortController().signal,
    onToken,
  };
}

async function streamWith(providerId: LLMProviderId, baseUrl: string, body: string) {
  const tokens: string[] = [];
  vi.mocked(fetch).mockResolvedValueOnce(responseFromChunks([encoder.encode(body)]));
  await getProviderById(providerId).stream(
    { baseUrl, model: "test-model" },
    streamRequest((token) => tokens.push(token)),
  );
  return tokens;
}

describe("provider transports", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.mocked(getWebLLMEngineManager).mockReset();
  });

  test("LM Studio SSE emits a valid terminal record across every byte split", async () => {
    const terminalRecord = `data: ${JSON.stringify({ choices: [{ delta: { content: "hé🌟" } }] })}`;

    for (const chunks of everyTwoChunkSplit(terminalRecord)) {
      const tokens: string[] = [];
      vi.mocked(fetch).mockResolvedValueOnce(responseFromChunks(chunks));
      await getProviderById("lmstudio").stream(
        { baseUrl: "http://127.42.7.9:1234/proxy/", model: "test-model" },
        streamRequest((token) => tokens.push(token)),
      );
      expect(tokens).toEqual(["hé🌟"]);
    }

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      "http://127.42.7.9:1234/proxy/v1/chat/completions",
    );
  });

  test("LM Studio SSE ignores metadata and empty data before the done sentinel", async () => {
    await expect(
      streamWith("lmstudio", "http://localhost:1234", "event: ping\n\ndata:\n\ndata: [DONE]\n"),
    ).resolves.toEqual([]);
  });

  test("Ollama JSONL emits a valid terminal record across every byte split", async () => {
    const terminalRecord = JSON.stringify({ message: { content: "hé🌟" }, done: true });

    for (const chunks of everyTwoChunkSplit(terminalRecord)) {
      const tokens: string[] = [];
      vi.mocked(fetch).mockResolvedValueOnce(responseFromChunks(chunks));
      await getProviderById("ollama").stream(
        { baseUrl: "https://[::1]:11434/proxy/", model: "test-model" },
        streamRequest((token) => tokens.push(token)),
      );
      expect(tokens).toEqual(["hé🌟"]);
    }

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("https://[::1]:11434/proxy/api/chat");
  });

  test("Ollama stops reading at a newline-terminated done record", async () => {
    await expect(
      streamWith(
        "ollama",
        "http://localhost:11434",
        `${JSON.stringify({ done: true })}\n${JSON.stringify({ response: "must-not-emit" })}\n`,
      ),
    ).resolves.toEqual([]);
  });

  test("LM Studio SSE cancels the reader when the done sentinel precedes stream end", async () => {
    const tracked = trackedResponse([
      encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n`),
      encoder.encode("data: [DONE]\n"),
      encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "leaked" } }] })}\n`),
    ]);
    vi.mocked(fetch).mockResolvedValueOnce(tracked.response);
    const tokens: string[] = [];

    await getProviderById("lmstudio").stream(
      { baseUrl: "http://localhost:1234", model: "test-model" },
      streamRequest((token) => tokens.push(token)),
    );

    expect(tokens).toEqual(["hi"]);
    expect(tracked.wasCanceled()).toBe(true);
  });

  test("Ollama JSONL cancels the reader when the done record precedes stream end", async () => {
    const tracked = trackedResponse([
      encoder.encode(`${JSON.stringify({ message: { content: "hi" }, done: true })}\n`),
      encoder.encode(`${JSON.stringify({ response: "leaked" })}\n`),
    ]);
    vi.mocked(fetch).mockResolvedValueOnce(tracked.response);
    const tokens: string[] = [];

    await getProviderById("ollama").stream(
      { baseUrl: "http://localhost:11434", model: "test-model" },
      streamRequest((token) => tokens.push(token)),
    );

    expect(tokens).toEqual(["hi"]);
    expect(tracked.wasCanceled()).toBe(true);
  });

  test("SSE reaching end of stream without a terminal record does not cancel the reader", async () => {
    const tracked = trackedResponse([
      encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n`),
    ]);
    vi.mocked(fetch).mockResolvedValueOnce(tracked.response);
    const tokens: string[] = [];

    await getProviderById("lmstudio").stream(
      { baseUrl: "http://localhost:1234", model: "test-model" },
      streamRequest((token) => tokens.push(token)),
    );

    expect(tokens).toEqual(["hi"]);
    expect(tracked.wasCanceled()).toBe(false);
  });

  test.each([
    ["lmstudio" as const, "http://localhost:1234", "data: {bad", "Malformed terminal SSE record"],
    ["ollama" as const, "http://localhost:11434", "{bad", "Malformed terminal JSONL record"],
  ])(
    "%s reports malformed last meaningful data at EOF with or without trailing newlines",
    async (providerId, baseUrl, malformedRecord, expectedError) => {
      for (const suffix of ["", "\n", "\n\n"] as const) {
        await expect(
          streamWith(providerId, baseUrl, `${malformedRecord}${suffix}`),
        ).rejects.toThrow(expectedError);
      }
    },
  );

  test.each([
    [
      "lmstudio" as const,
      "http://localhost:1234",
      `data: {bad\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: "recovered" } }] })}`,
    ],
    [
      "ollama" as const,
      "http://localhost:11434",
      `{bad\n\n${JSON.stringify({ response: "recovered", done: true })}`,
    ],
  ])(
    "%s preserves compatibility for malformed nonterminal lines",
    async (providerId, baseUrl, body) => {
      await expect(streamWith(providerId, baseUrl, body)).resolves.toEqual(["recovered"]);
    },
  );

  test.each([
    ["ollama" as const, "http://localhost.example.com:11434"],
    ["ollama" as const, "http://user@localhost:11434"],
    ["ollama" as const, "http://2130706433:11434"],
    ["lmstudio" as const, "https://127.0.0.1.example.com"],
    ["lmstudio" as const, "ftp://localhost:1234"],
    ["lmstudio" as const, "http://127.1:1234"],
  ])("%s rejects unsafe endpoint %s before fetch", async (providerId, baseUrl) => {
    await expect(
      getProviderById(providerId).stream(
        { baseUrl, model: "test-model" },
        streamRequest(() => undefined),
      ),
    ).rejects.toThrow(/endpoint/u);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("WebLLM cancellation during initialization settles without starting a stream", async () => {
    vi.stubEnv("VITE_WEBLLM_ENABLED", "true");
    const initialization = deferred<void>();
    const ensureReady = vi.fn(
      (_modelId: string, options: { signal: AbortSignal }) =>
        new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(new DOMException("aborted", "AbortError"));
          options.signal.addEventListener("abort", onAbort, { once: true });
          void initialization.promise.then(resolve, reject);
        }),
    );
    const stream = vi.fn();
    vi.mocked(getWebLLMEngineManager).mockReturnValue({ ensureReady, stream } as never);
    const controller = new AbortController();

    const pending = getProviderById("webllm").stream(
      { baseUrl: "", model: "test-model", allowModelDownload: true },
      { ...streamRequest(() => undefined), signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(ensureReady).toHaveBeenCalledWith(
      "test-model",
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(stream).not.toHaveBeenCalled();
    initialization.resolve();
  });
});
