import { describe, expect, test } from "vitest";
import { Embedder } from "./Embedder";

type WorkerResponse = {
  id: string;
  status: "complete" | "error";
  embeddings?: Array<Float32Array | null>;
  errors?: Array<string | null>;
  error?: string;
  selectedBackend?: "webgpu" | "wasm";
  fallbackReason?: string | null;
};

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
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

describe("Embedder batch API", () => {
  test("embedBatch preserves input ordering", async () => {
    const embedder = new Embedder(
      () =>
        new FakeWorker((payload) => {
          const request = payload as { id: string; texts: string[] };
          return {
            id: request.id,
            status: "complete",
            embeddings: request.texts.map((text, index) => Float32Array.from([index + 1, text.length])),
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

  test("passes preferred backend and captures runtime fallback diagnostics", async () => {
    let postedPreferredBackend: string | null = null;
    const embedder = new Embedder({
      preferredBackend: "webgpu",
      workerFactory: () =>
        new FakeWorker((payload) => {
          const request = payload as { id: string; texts: string[]; preferredBackend?: string };
          postedPreferredBackend = request.preferredBackend ?? null;
          return {
            id: request.id,
            status: "complete",
            embeddings: [Float32Array.from([1, 2, 3])],
            errors: [null],
            selectedBackend: "wasm",
            fallbackReason: "navigator.gpu unavailable",
          };
        }),
    });

    const result = await embedder.embedBatch(["hello"]);
    expect(result[0]?.error).toBeNull();
    expect(postedPreferredBackend).toBe("webgpu");
    expect(embedder.getRuntimeInfo()).toEqual({
      preferredBackend: "webgpu",
      selectedBackend: "wasm",
      fallbackReason: "navigator.gpu unavailable",
    });
  });
});
