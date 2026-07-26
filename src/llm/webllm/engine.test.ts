import { CreateMLCEngine } from "@mlc-ai/web-llm";
import type { MLCEngine } from "@mlc-ai/web-llm";
import { WebLLMEngineManager } from "./engine";

vi.mock("@mlc-ai/web-llm", () => ({
  CreateMLCEngine: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mockEngine(): MLCEngine {
  return {
    chat: { completions: { create: vi.fn() } },
    interruptGenerate: vi.fn(),
    reload: vi.fn(),
    setInitProgressCallback: vi.fn(),
    unload: vi.fn(),
  } as unknown as MLCEngine;
}

describe("WebLLMEngineManager", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { gpu: {} });
    vi.mocked(CreateMLCEngine).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("an initialization waiter rejects promptly when aborted", async () => {
    const initialization = deferred<MLCEngine>();
    vi.mocked(CreateMLCEngine).mockReturnValue(initialization.promise);
    const manager = new WebLLMEngineManager();
    const controller = new AbortController();

    const pending = manager.ensureReady("test-model", {
      allowDownload: true,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(CreateMLCEngine).toHaveBeenCalledOnce();

    initialization.resolve(mockEngine());
    await initialization.promise;
  });

  test("an aborted waiter does not clear initialization shared by another caller", async () => {
    const initialization = deferred<MLCEngine>();
    vi.mocked(CreateMLCEngine).mockReturnValue(initialization.promise);
    const manager = new WebLLMEngineManager();
    const cancelled = new AbortController();
    const active = new AbortController();

    const cancelledWaiter = manager.ensureReady("test-model", {
      allowDownload: true,
      signal: cancelled.signal,
    });
    const activeWaiter = manager.ensureReady("test-model", {
      allowDownload: true,
      signal: active.signal,
    });
    cancelled.abort();

    await expect(cancelledWaiter).rejects.toMatchObject({ name: "AbortError" });
    initialization.resolve(mockEngine());
    await expect(activeWaiter).resolves.toBeUndefined();
    expect(CreateMLCEngine).toHaveBeenCalledOnce();
  });

  test("a pre-aborted stream never invokes chat completion creation", async () => {
    const engine = mockEngine();
    vi.mocked(CreateMLCEngine).mockResolvedValue(engine);
    const manager = new WebLLMEngineManager();
    await manager.ensureReady("test-model", {
      allowDownload: true,
      signal: new AbortController().signal,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      manager.stream(
        "test-model",
        [{ role: "user", content: "hello" }],
        controller.signal,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.chat.completions.create).not.toHaveBeenCalled();
  });

  test("aborts promptly while stream creation is pending", async () => {
    const engine = mockEngine();
    const creation = deferred<AsyncIterable<never>>();
    vi.mocked(engine.chat.completions.create).mockReturnValue(creation.promise as never);
    vi.mocked(CreateMLCEngine).mockResolvedValue(engine);
    const manager = new WebLLMEngineManager();
    await manager.ensureReady("test-model", {
      allowDownload: true,
      signal: new AbortController().signal,
    });
    const controller = new AbortController();
    const onToken = vi.fn();

    const pending = manager.stream(
      "test-model",
      [{ role: "user", content: "hello" }],
      controller.signal,
      onToken,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.interruptGenerate).toHaveBeenCalledOnce();
    expect(onToken).not.toHaveBeenCalled();
    creation.resolve({
      async *[Symbol.asyncIterator]() {
        yield undefined as never;
      },
    });
    await creation.promise;
  });

  test("aborts promptly while an iterator read is stalled and emits no later token", async () => {
    const engine = mockEngine();
    const read = deferred<IteratorResult<{ choices: Array<{ delta: { content: string } }> }>>();
    const iterator = {
      next: vi.fn(() => read.promise),
      return: vi.fn(async () => ({ done: true, value: undefined })),
    };
    vi.mocked(engine.chat.completions.create).mockResolvedValue({
      [Symbol.asyncIterator]: () => iterator,
    } as never);
    vi.mocked(CreateMLCEngine).mockResolvedValue(engine);
    const manager = new WebLLMEngineManager();
    await manager.ensureReady("test-model", {
      allowDownload: true,
      signal: new AbortController().signal,
    });
    const controller = new AbortController();
    const onToken = vi.fn();
    const pending = manager.stream(
      "test-model",
      [{ role: "user", content: "hello" }],
      controller.signal,
      onToken,
    );
    await vi.waitFor(() => expect(iterator.next).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.interruptGenerate).toHaveBeenCalledOnce();
    expect(iterator.return).toHaveBeenCalledOnce();
    read.resolve({
      done: false,
      value: { choices: [{ delta: { content: "too late" } }] },
    });
    await read.promise;
    expect(onToken).not.toHaveBeenCalled();
  });

  test("removes the abort listener after a successful stream", async () => {
    const engine = mockEngine();
    vi.mocked(engine.chat.completions.create).mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "done" } }] };
      },
    } as never);
    vi.mocked(CreateMLCEngine).mockResolvedValue(engine);
    const manager = new WebLLMEngineManager();
    const controller = new AbortController();
    const onToken = vi.fn();
    await manager.ensureReady("test-model", {
      allowDownload: true,
      signal: controller.signal,
    });

    await manager.stream(
      "test-model",
      [{ role: "user", content: "hello" }],
      controller.signal,
      onToken,
    );
    controller.abort();

    expect(onToken).toHaveBeenCalledOnce();
    expect(onToken).toHaveBeenCalledWith("done");
    expect(engine.interruptGenerate).not.toHaveBeenCalled();
  });

  test("interrupt rejection cannot replace AbortError or become unhandled", async () => {
    const engine = mockEngine();
    const read = deferred<IteratorResult<never>>();
    const iterator = { next: vi.fn(() => read.promise) };
    vi.mocked(engine.chat.completions.create).mockResolvedValue({
      [Symbol.asyncIterator]: () => iterator,
    } as never);
    vi.mocked(engine.interruptGenerate).mockRejectedValue(new Error("interrupt failed"));
    vi.mocked(CreateMLCEngine).mockResolvedValue(engine);
    const manager = new WebLLMEngineManager();
    await manager.ensureReady("test-model", {
      allowDownload: true,
      signal: new AbortController().signal,
    });
    const controller = new AbortController();
    const pending = manager.stream(
      "test-model",
      [{ role: "user", content: "hello" }],
      controller.signal,
      vi.fn(),
    );
    await vi.waitFor(() => expect(iterator.next).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.interruptGenerate).toHaveBeenCalledOnce();
    await Promise.resolve();
    read.resolve({ done: true, value: undefined as never });
  });

  test("reports unsupported WebGPU before attempting initialization", async () => {
    vi.stubGlobal("navigator", {});
    const manager = new WebLLMEngineManager();

    await expect(
      manager.ensureReady("test-model", {
        allowDownload: true,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "WEBLLM_UNSUPPORTED" });
    expect(CreateMLCEngine).not.toHaveBeenCalled();
  });

  test("forwards bounded initialization and reload progress", async () => {
    const engine = mockEngine();
    const onProgress = vi.fn();
    vi.mocked(CreateMLCEngine).mockImplementation(async (_modelId, options) => {
      options?.initProgressCallback?.({ progress: 2, text: "initializing", timeElapsed: 0 });
      return engine;
    });
    vi.mocked(engine.reload).mockImplementation(async () => {
      const progressCallback = vi.mocked(engine.setInitProgressCallback).mock.calls[0]?.[0];
      progressCallback?.({ progress: Number.NaN, text: "", timeElapsed: 0 });
    });
    const manager = new WebLLMEngineManager();
    const signal = new AbortController().signal;

    await manager.ensureReady("model-a", { allowDownload: true, signal, onProgress });
    await manager.ensureReady("model-b", { allowDownload: true, signal, onProgress });

    expect(onProgress).toHaveBeenNthCalledWith(1, 1, "initializing");
    expect(onProgress).toHaveBeenNthCalledWith(2, 0, "Preparing model");
    expect(engine.reload).toHaveBeenCalledWith("model-b");
  });

  test("clears a rejected initialization so a later attempt can recover", async () => {
    vi.mocked(CreateMLCEngine)
      .mockRejectedValueOnce(new Error("download failed"))
      .mockResolvedValueOnce(mockEngine());
    const manager = new WebLLMEngineManager();
    const options = { allowDownload: true, signal: new AbortController().signal };

    await expect(manager.ensureReady("test-model", options)).rejects.toMatchObject({
      code: "WEBLLM_INIT_FAILED",
    });
    await expect(manager.ensureReady("test-model", options)).resolves.toBeUndefined();
    expect(CreateMLCEngine).toHaveBeenCalledTimes(2);
  });

  test("rejects streaming before the selected model is initialized", async () => {
    const manager = new WebLLMEngineManager();

    await expect(
      manager.stream(
        "test-model",
        [{ role: "user", content: "hello" }],
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ code: "WEBLLM_INIT_FAILED" });
  });
});
