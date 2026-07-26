import type { ChatCompletionChunk, InitProgressReport, MLCEngineInterface } from "@mlc-ai/web-llm";
import { CreateMLCEngine } from "@mlc-ai/web-llm";

export type WebLLMErrorCode =
  | "WEBLLM_UNSUPPORTED"
  | "WEBLLM_DOWNLOAD_REQUIRED"
  | "WEBLLM_INIT_FAILED"
  | "WEBLLM_STREAM_FAILED";

export class WebLLMProviderError extends Error {
  readonly code: WebLLMErrorCode;

  constructor(code: WebLLMErrorCode, message: string) {
    super(message);
    this.name = "WebLLMProviderError";
    this.code = code;
  }
}

export type WebLLMEnsureReadyOptions = {
  allowDownload: boolean;
  signal: AbortSignal;
  onProgress?: (progress: number, text: string) => void;
};

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError();
  }
}

async function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

export class WebLLMEngineManager {
  private engine: MLCEngineInterface | null = null;

  private activeModelId: string | null = null;

  private loadingPromise: Promise<void> | null = null;

  private readonly progressListeners = new Set<
    (modelId: string, progress: number, text: string) => void
  >();

  private emitProgress(modelId: string, progress: number, text: string): void {
    for (const listener of this.progressListeners) {
      try {
        listener(modelId, progress, text);
      } catch {
        // A misbehaving progress sink must neither abort the shared load nor
        // prevent the remaining listeners from observing progress.
      }
    }
  }

  private supportsWebGPU(): boolean {
    const nav = navigator as Navigator & { gpu?: object };
    return typeof nav.gpu !== "undefined";
  }

  private toProgress(report: InitProgressReport): { progress: number; text: string } {
    const progress = Number.isFinite(report.progress) ? report.progress : 0;
    const normalized = Math.max(0, Math.min(1, progress));
    const text = report.text || "Preparing model";
    return { progress: normalized, text };
  }

  async ensureReady(modelId: string, options: WebLLMEnsureReadyOptions): Promise<void> {
    throwIfAborted(options.signal);

    if (!this.supportsWebGPU()) {
      throw new WebLLMProviderError(
        "WEBLLM_UNSUPPORTED",
        "WebGPU is not available in this browser.",
      );
    }

    if (this.engine && this.activeModelId === modelId) {
      return;
    }

    if (!options.allowDownload) {
      throw new WebLLMProviderError(
        "WEBLLM_DOWNLOAD_REQUIRED",
        "Model download consent is required before WebLLM initialization.",
      );
    }

    // Every caller that waits on the shared load registers its own progress
    // sink. The engine forwards a single progress stream (see emitProgress) to
    // all live waiters, so a caller that joins an in-flight load still receives
    // ongoing progress even after the caller that started the load aborts. Each
    // sink is scoped to the model it is waiting for: a waiter queued for model B
    // ignores model A's progress while A loads, and starts receiving progress
    // once B's reload begins — the shared load is never restarted. The listener
    // is removed once this caller stops waiting, keeping cleanup deterministic
    // and preventing forwarding to an aborted caller.
    const listener = (loadedModelId: string, progress: number, text: string) => {
      if (loadedModelId === modelId && !options.signal.aborted) {
        options.onProgress?.(progress, text);
      }
    };
    this.progressListeners.add(listener);

    try {
      if (this.loadingPromise) {
        await waitWithAbort(this.loadingPromise, options.signal);
        throwIfAborted(options.signal);
        if (this.engine && this.activeModelId === modelId) {
          return;
        }
      }

      throwIfAborted(options.signal);
      const loadingPromise = (async () => {
        try {
          if (!this.engine) {
            this.engine = await CreateMLCEngine(modelId, {
              initProgressCallback: (report) => {
                const next = this.toProgress(report);
                this.emitProgress(modelId, next.progress, next.text);
              },
              logLevel: "INFO",
            });
            this.activeModelId = modelId;
            return;
          }

          this.engine.setInitProgressCallback((report) => {
            const next = this.toProgress(report);
            this.emitProgress(modelId, next.progress, next.text);
          });
          await this.engine.reload(modelId);
          this.activeModelId = modelId;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new WebLLMProviderError("WEBLLM_INIT_FAILED", `WebLLM init failed: ${message}`);
        }
      })();
      this.loadingPromise = loadingPromise;
      void loadingPromise.then(
        () => {
          if (this.loadingPromise === loadingPromise) {
            this.loadingPromise = null;
          }
        },
        () => {
          if (this.loadingPromise === loadingPromise) {
            this.loadingPromise = null;
          }
        },
      );

      await waitWithAbort(loadingPromise, options.signal);
    } finally {
      this.progressListeners.delete(listener);
    }
  }

  async stream(
    modelId: string,
    messages: WebLLMMessage[],
    signal: AbortSignal,
    onToken: (token: string) => void,
  ): Promise<void> {
    throwIfAborted(signal);

    if (!this.engine || this.activeModelId !== modelId) {
      throw new WebLLMProviderError(
        "WEBLLM_INIT_FAILED",
        "WebLLM engine is not initialized for the selected model.",
      );
    }

    const engine = this.engine;
    let interrupted = false;
    let iterator: AsyncIterator<ChatCompletionChunk> | null = null;
    const interrupt = () => {
      if (interrupted) {
        return;
      }
      interrupted = true;
      try {
        void Promise.resolve(engine.interruptGenerate()).catch(() => undefined);
      } catch {
        // Cancellation must still settle even if the runtime cannot interrupt cleanly.
      }
    };
    const onAbort = () => interrupt();
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      throwIfAborted(signal);
      const chunkStream = await waitWithAbort(
        engine.chat.completions.create({
          model: modelId,
          messages,
          stream: true,
          temperature: 0.2,
          max_tokens: 700,
        }),
        signal,
      );
      iterator = (chunkStream as AsyncIterable<ChatCompletionChunk>)[Symbol.asyncIterator]();

      while (true) {
        const result = await waitWithAbort(iterator.next(), signal);
        if (result.done) {
          break;
        }
        throwIfAborted(signal);
        const token = result.value.choices?.[0]?.delta?.content ?? "";
        if (token.length > 0) {
          onToken(token);
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new WebLLMProviderError("WEBLLM_STREAM_FAILED", `WebLLM stream failed: ${message}`);
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted && iterator?.return) {
        try {
          void Promise.resolve(iterator.return()).catch(() => undefined);
        } catch {
          // The abort result remains authoritative even if iterator cleanup fails.
        }
      }
    }
  }

  async unload(): Promise<void> {
    if (!this.engine) {
      return;
    }

    await this.engine.unload();
    this.engine = null;
    this.activeModelId = null;
  }
}

const sharedManager = new WebLLMEngineManager();

export function getWebLLMEngineManager(): WebLLMEngineManager {
  return sharedManager;
}
type WebLLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
