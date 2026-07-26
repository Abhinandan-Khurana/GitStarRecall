import { CreateMLCEngine } from "@mlc-ai/web-llm";
import type { InitProgressReport, MLCEngine } from "@mlc-ai/web-llm";
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

  test("closes the iterator via return when an iterator read rejects", async () => {
    const engine = mockEngine();
    const iterator = {
      next: vi.fn().mockRejectedValue(new Error("stream boom")),
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

    await expect(
      manager.stream(
        "test-model",
        [{ role: "user", content: "hello" }],
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ code: "WEBLLM_STREAM_FAILED" });
    expect(iterator.return).toHaveBeenCalledOnce();
    expect(engine.interruptGenerate).not.toHaveBeenCalled();
  });

  test("closes the iterator via return when the token sink throws", async () => {
    const engine = mockEngine();
    const iterator = {
      next: vi
        .fn()
        .mockResolvedValue({ done: false, value: { choices: [{ delta: { content: "tok" } }] } }),
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
    const onToken = vi.fn(() => {
      throw new Error("sink boom");
    });

    await expect(
      manager.stream(
        "test-model",
        [{ role: "user", content: "hello" }],
        new AbortController().signal,
        onToken,
      ),
    ).rejects.toMatchObject({ code: "WEBLLM_STREAM_FAILED" });
    expect(onToken).toHaveBeenCalledOnce();
    expect(iterator.return).toHaveBeenCalledOnce();
  });

  test("does not close the iterator via return after normal completion", async () => {
    const engine = mockEngine();
    const iterator = {
      next: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: { choices: [{ delta: { content: "tok" } }] } })
        .mockResolvedValueOnce({ done: true, value: undefined }),
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
    const onToken = vi.fn();

    await manager.stream(
      "test-model",
      [{ role: "user", content: "hello" }],
      new AbortController().signal,
      onToken,
    );

    expect(onToken).toHaveBeenCalledExactlyOnceWith("tok");
    expect(iterator.return).not.toHaveBeenCalled();
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

  test("forwards ongoing initialization progress to a joined waiter after the initiator aborts", async () => {
    const engine = mockEngine();
    const initialization = deferred<MLCEngine>();
    let emitProgress: ((report: InitProgressReport) => void) | undefined;
    vi.mocked(CreateMLCEngine).mockImplementation(async (_modelId, options) => {
      emitProgress = options?.initProgressCallback;
      return initialization.promise;
    });
    const manager = new WebLLMEngineManager();
    const initiator = new AbortController();
    const joiner = new AbortController();
    const initiatorProgress = vi.fn();
    const joinerProgress = vi.fn();

    const initiatorWaiter = manager.ensureReady("test-model", {
      allowDownload: true,
      signal: initiator.signal,
      onProgress: initiatorProgress,
    });
    const joinerWaiter = manager.ensureReady("test-model", {
      allowDownload: true,
      signal: joiner.signal,
      onProgress: joinerProgress,
    });

    // The caller that started the shared load abandons it before it finishes.
    initiator.abort();
    await expect(initiatorWaiter).rejects.toMatchObject({ name: "AbortError" });

    // The joined waiter must still receive ongoing initialization progress from
    // the shared load, which is not restarted.
    emitProgress?.({ progress: 0.5, text: "loading shards", timeElapsed: 0 });
    expect(joinerProgress).toHaveBeenCalledWith(0.5, "loading shards");
    expect(initiatorProgress).not.toHaveBeenCalled();

    initialization.resolve(engine);
    await expect(joinerWaiter).resolves.toBeUndefined();
    expect(CreateMLCEngine).toHaveBeenCalledOnce();
  });

  test("scopes shared-load progress to the loading model so a queued waiter for another model is not fed the first model's progress", async () => {
    const engine = mockEngine();
    const initialization = deferred<MLCEngine>();
    let emitInitProgress: ((report: InitProgressReport) => void) | undefined;
    vi.mocked(CreateMLCEngine).mockImplementation(async (_modelId, options) => {
      emitInitProgress = options?.initProgressCallback;
      return initialization.promise;
    });
    const reloadStarted = deferred<void>();
    vi.mocked(engine.reload).mockImplementation(async () => {
      const reloadProgress = vi.mocked(engine.setInitProgressCallback).mock.calls[0]?.[0];
      reloadProgress?.({ progress: 0.8, text: "loading model-b", timeElapsed: 0 });
      reloadStarted.resolve();
    });
    const manager = new WebLLMEngineManager();
    const aProgress = vi.fn();
    const bProgress = vi.fn();

    const aWaiter = manager.ensureReady("model-a", {
      allowDownload: true,
      signal: new AbortController().signal,
      onProgress: aProgress,
    });
    // A waiter for a different model joins while model-a's shared load is in flight.
    const bWaiter = manager.ensureReady("model-b", {
      allowDownload: true,
      signal: new AbortController().signal,
      onProgress: bProgress,
    });

    // model-a's progress must reach only the model-a waiter, never the queued
    // model-b waiter.
    emitInitProgress?.({ progress: 0.5, text: "loading model-a", timeElapsed: 0 });
    expect(aProgress).toHaveBeenCalledWith(0.5, "loading model-a");
    expect(bProgress).not.toHaveBeenCalled();

    // model-a finishes without being restarted; the model-b waiter then drives
    // the reload to model-b and must still receive its own progress.
    initialization.resolve(engine);
    await aWaiter;
    await reloadStarted.promise;
    await bWaiter;

    expect(bProgress).toHaveBeenCalledWith(0.8, "loading model-b");
    expect(aProgress).toHaveBeenCalledTimes(1);
    expect(engine.reload).toHaveBeenCalledWith("model-b");
    expect(CreateMLCEngine).toHaveBeenCalledOnce();
  });

  test("a throwing progress listener neither breaks initialization nor starves other listeners", async () => {
    const engine = mockEngine();
    const boom = vi.fn(() => {
      throw new Error("listener boom");
    });
    const healthy = vi.fn();
    vi.mocked(CreateMLCEngine).mockImplementation(async (_modelId, options) => {
      // Defer emission by a microtask so both waiters register before progress
      // fans out, then emit as WebLLM would during initialization.
      await Promise.resolve();
      options?.initProgressCallback?.({ progress: 0.5, text: "loading", timeElapsed: 0 });
      return engine;
    });
    const manager = new WebLLMEngineManager();

    const throwingWaiter = manager.ensureReady("test-model", {
      allowDownload: true,
      signal: new AbortController().signal,
      onProgress: boom,
    });
    const healthyWaiter = manager.ensureReady("test-model", {
      allowDownload: true,
      signal: new AbortController().signal,
      onProgress: healthy,
    });

    // A misbehaving listener must not fail the shared initialization for either
    // caller, and must not prevent the healthy listener from observing progress.
    await expect(Promise.all([throwingWaiter, healthyWaiter])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(boom).toHaveBeenCalledWith(0.5, "loading");
    expect(healthy).toHaveBeenCalledWith(0.5, "loading");
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
