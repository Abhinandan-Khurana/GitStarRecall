import { describe, expect, test, vi } from "vitest";
import { Embedder } from "./Embedder";

type WorkerResponse = {
  id: string;
  status: "complete" | "error";
  embeddings?: unknown[];
  errors?: Array<string | null>;
  error?: string;
  selectedBackend?: "webgpu" | "wasm";
  selectedModel?: string | null;
  fallbackReason?: string | null;
};

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => unknown) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  private readonly responder: (payload: unknown) => WorkerResponse;

  constructor(responder: (payload: unknown) => WorkerResponse) {
    this.responder = responder;
  }

  postMessage(payload: unknown): void {
    const response = this.responder(payload);
    queueMicrotask(() => {
      this.onmessage?.({ data: response } as MessageEvent);
    });
  }

  terminate(): void {
    // noop for tests
  }
}

class ManualWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => unknown) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  terminateCalls = 0;

  postMessage(payload: unknown): void {
    this.posted.push(payload);
  }

  respond(payload: unknown): void {
    this.onmessage?.({ data: payload } as MessageEvent);
  }

  crash(message: string): void {
    this.onerror?.({ message, error: new Error(message) } as ErrorEvent);
  }

  failMessage(): void {
    this.onmessageerror?.({ data: null } as MessageEvent);
  }

  terminate(): void {
    this.terminateCalls += 1;
  }
}

describe("Embedder batch API", () => {
  test("returns an empty batch without posting to the worker", async () => {
    const worker = new ManualWorker();
    const embedder = new Embedder({ workerFactory: () => worker });

    await expect(embedder.embedBatch([])).resolves.toEqual([]);
    expect(worker.posted).toHaveLength(0);
  });

  test("embedBatch preserves input ordering", async () => {
    const embedder = new Embedder(
      () =>
        new FakeWorker((payload) => {
          const request = payload as { id: string; texts: string[] };
          return {
            id: request.id,
            status: "complete",
            embeddings: request.texts.map((text, index) =>
              Float32Array.from([index + 1, text.length]),
            ),
            errors: request.texts.map(() => null),
          };
        }),
    );

    const result = await embedder.embedBatch(["alpha", "beta", "gamma"]);
    expect(result).toHaveLength(3);
    expect(Array.from(result[0]?.embedding ?? [])).toEqual([1, 5]);
    expect(Array.from(result[1]?.embedding ?? [])).toEqual([2, 4]);
    expect(Array.from(result[2]?.embedding ?? [])).toEqual([3, 5]);
  });

  test("embedBatch returns per-item errors without rejecting the whole batch", async () => {
    const embedder = new Embedder(
      () =>
        new FakeWorker((payload) => {
          const request = payload as { id: string; texts: string[] };
          return {
            id: request.id,
            status: "complete",
            embeddings: [Float32Array.from([1, 1]), null, Float32Array.from([3, 1])],
            errors: [null, "bad input text", null],
          };
        }),
    );

    const result = await embedder.embedBatch(["ok-1", "bad", "ok-2"]);
    expect(result).toHaveLength(3);
    expect(result[0]?.error).toBeNull();
    expect(result[1]?.embedding).toBeNull();
    expect(result[1]?.error).toBe("bad input text");
    expect(result[2]?.error).toBeNull();
  });

  test("normalizes plain array vectors and preserves invalid per-item results", async () => {
    const embedder = new Embedder(
      () =>
        new FakeWorker((payload) => {
          const request = payload as { id: string };
          return {
            id: request.id,
            status: "complete",
            embeddings: [[1, 2], {}],
            errors: [null, "invalid vector"],
          };
        }),
    );

    const results = await embedder.embedBatch(["array", "invalid"]);

    expect(results[0]?.embedding).toEqual(Float32Array.from([1, 2]));
    expect(results[1]).toEqual({ embedding: null, error: "invalid vector" });
  });

  test("embed throws when single-item batch reports an error", async () => {
    const embedder = new Embedder(
      () =>
        new FakeWorker((payload) => {
          const request = payload as { id: string; texts: string[] };
          return {
            id: request.id,
            status: "complete",
            embeddings: [null],
            errors: [`failed: ${request.texts[0]}`],
          };
        }),
    );

    await expect(embedder.embed("bad-item")).rejects.toThrow("failed: bad-item");
  });

  test("embed resolves the vector returned by a successful single-item batch", async () => {
    const embedder = new Embedder(
      () =>
        new FakeWorker((payload) => {
          const request = payload as { id: string };
          return {
            id: request.id,
            status: "complete",
            embeddings: [Float32Array.from([0.25, 0.75])],
            errors: [null],
          };
        }),
    );

    await expect(embedder.embed("valid")).resolves.toEqual(Float32Array.from([0.25, 0.75]));
  });

  test("passes preferred backend and captures runtime fallback diagnostics", async () => {
    let postedPreferredBackend: string | null = null;
    let postedModelCandidates: string[] | null = null;
    const embedder = new Embedder({
      preferredBackend: "webgpu",
      modelCandidates: ["onnx-community/embeddinggemma-300m-ONNX", "Xenova/all-MiniLM-L6-v2"],
      workerFactory: () =>
        new FakeWorker((payload) => {
          const request = payload as {
            id: string;
            texts: string[];
            preferredBackend?: string;
            modelCandidates?: string[];
          };
          postedPreferredBackend = request.preferredBackend ?? null;
          postedModelCandidates = request.modelCandidates ?? null;
          return {
            id: request.id,
            status: "complete",
            embeddings: [Float32Array.from([1, 2, 3])],
            errors: [null],
            selectedBackend: "wasm",
            selectedModel: "Xenova/all-MiniLM-L6-v2",
            fallbackReason: "navigator.gpu unavailable",
          };
        }),
    });

    const result = await embedder.embedBatch(["hello"]);
    expect(result[0]?.error).toBeNull();
    expect(postedPreferredBackend).toBe("webgpu");
    expect(postedModelCandidates).toEqual([
      "onnx-community/embeddinggemma-300m-ONNX",
      "Xenova/all-MiniLM-L6-v2",
    ]);
    expect(embedder.getRuntimeInfo()).toEqual({
      preferredBackend: "webgpu",
      selectedBackend: "wasm",
      selectedModel: "Xenova/all-MiniLM-L6-v2",
      fallbackReason: "navigator.gpu unavailable",
    });
  });

  test("rejects every pending job with a typed error when the worker crashes", async () => {
    const worker = new ManualWorker();
    const embedder = new Embedder({ workerFactory: () => worker });
    const first = embedder.embedBatch(["first"]);
    const second = embedder.embedBatch(["second"]);
    const firstRejection = expect(first).rejects.toMatchObject({
      name: "EmbeddingWorkerError",
      code: "worker_error",
      message: "worker crashed",
    });
    const secondRejection = expect(second).rejects.toMatchObject({
      name: "EmbeddingWorkerError",
      code: "worker_error",
    });

    worker.crash("worker crashed");

    await Promise.all([firstRejection, secondRejection]);
    expect(worker.terminateCalls).toBe(1);
  });

  test("rejects pending work when a worker message cannot be decoded", async () => {
    const worker = new ManualWorker();
    const embedder = new Embedder({ workerFactory: () => worker });
    const pending = embedder.embedBatch(["message"]);
    const rejection = expect(pending).rejects.toMatchObject({
      name: "EmbeddingWorkerError",
      code: "message_error",
    });

    worker.failMessage();

    await rejection;
    expect(worker.terminateCalls).toBe(1);
  });

  test("rejects a worker error response and records its runtime diagnostics", async () => {
    const worker = new ManualWorker();
    const embedder = new Embedder({ workerFactory: () => worker, preferredBackend: "webgpu" });
    const pending = embedder.embedBatch(["error"]);
    const request = worker.posted[0] as { id: string };
    const rejection = expect(pending).rejects.toMatchObject({
      name: "EmbeddingWorkerError",
      code: "worker_response_error",
      message: "model initialization failed",
    });

    worker.respond({
      id: request.id,
      status: "error",
      error: "model initialization failed",
      selectedBackend: "wasm",
      selectedModel: " fallback-model ",
      fallbackReason: "webgpu unavailable",
    });

    await rejection;
    expect(embedder.getRuntimeInfo()).toEqual({
      preferredBackend: "webgpu",
      selectedBackend: "wasm",
      selectedModel: "fallback-model",
      fallbackReason: "webgpu unavailable",
    });
  });

  test("uses a bounded default message for an empty worker error response", async () => {
    const worker = new ManualWorker();
    const embedder = new Embedder({ workerFactory: () => worker });
    const pending = embedder.embedBatch(["error"]);
    const request = worker.posted[0] as { id: string };
    const rejection = expect(pending).rejects.toMatchObject({
      name: "EmbeddingWorkerError",
      code: "worker_response_error",
      message: "Embedding worker failed",
    });

    worker.respond({ id: request.id, status: "error" });

    await rejection;
  });

  test("rejects malformed response envelopes instead of leaving jobs pending", async () => {
    const malformedResponses: Array<(id: string) => unknown> = [
      () => null,
      () => ({ status: "complete", embeddings: [], errors: [] }),
      (id) => ({ id, status: "partial", embeddings: [], errors: [] }),
      (id) => ({ id, status: "complete" }),
    ];

    for (const buildResponse of malformedResponses) {
      const worker = new ManualWorker();
      const embedder = new Embedder({ workerFactory: () => worker });
      const pending = embedder.embedBatch(["malformed"]);
      const request = worker.posted[0] as { id: string };
      const rejection = expect(pending).rejects.toMatchObject({
        name: "EmbeddingWorkerError",
        code: "malformed_response",
      });

      worker.respond(buildResponse(request.id));

      await rejection;
      expect(worker.terminateCalls).toBe(1);
    }
  });

  test("times out a stalled request and ignores its late response", async () => {
    vi.useFakeTimers();
    try {
      const worker = new ManualWorker();
      const embedder = new Embedder({ workerFactory: () => worker, requestTimeoutMs: 1_000 });
      const pending = embedder.embedBatch(["slow"]);
      const request = worker.posted[0] as { id: string };
      const rejection = expect(pending).rejects.toMatchObject({
        name: "EmbeddingWorkerError",
        code: "request_timeout",
      });

      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
      worker.respond({
        id: request.id,
        status: "complete",
        embeddings: [Float32Array.from([1])],
        errors: [null],
      });

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("rejects synchronous postMessage failures and clears the request timer", async () => {
    vi.useFakeTimers();
    try {
      const worker = new ManualWorker();
      const postFailure = new Error("structured clone failed");
      worker.postMessage = () => {
        throw postFailure;
      };
      const embedder = new Embedder({ workerFactory: () => worker, requestTimeoutMs: 1_000 });

      await expect(embedder.embedBatch(["uncloneable"])).rejects.toMatchObject({
        name: "EmbeddingWorkerError",
        code: "post_message_failed",
        cause: postFailure,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("termination rejects all jobs, is idempotent, and prevents future posts", async () => {
    const worker = new ManualWorker();
    const embedder = new Embedder({ workerFactory: () => worker });
    const first = embedder.embedBatch(["first"]);
    const second = embedder.embedBatch(["second"]);
    const firstRejection = expect(first).rejects.toMatchObject({
      name: "EmbeddingWorkerError",
      code: "terminated",
    });
    const secondRejection = expect(second).rejects.toMatchObject({
      name: "EmbeddingWorkerError",
      code: "terminated",
    });

    embedder.terminate();
    embedder.terminate();

    await Promise.all([firstRejection, secondRejection]);
    await expect(embedder.embedBatch(["after termination"])).rejects.toMatchObject({
      name: "EmbeddingWorkerError",
      code: "terminated",
    });
    expect(worker.posted).toHaveLength(2);
    expect(worker.terminateCalls).toBe(1);
  });

  test("clears the request timeout after a successful response", async () => {
    vi.useFakeTimers();
    try {
      const worker = new ManualWorker();
      const embedder = new Embedder({ workerFactory: () => worker, requestTimeoutMs: 1_000 });
      const pending = embedder.embedBatch(["complete"]);
      const request = worker.posted[0] as { id: string };

      worker.respond({
        id: request.id,
        status: "complete",
        embeddings: [Float32Array.from([1])],
        errors: [null],
      });

      await expect(pending).resolves.toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
