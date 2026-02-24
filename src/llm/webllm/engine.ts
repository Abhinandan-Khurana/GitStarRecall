import type {
  ChatCompletionChunk,
  InitProgressReport,
  MLCEngineInterface,
} from "@mlc-ai/web-llm";
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
  onProgress?: (progress: number, text: string) => void;
};

class WebLLMEngineManager {
  private engine: MLCEngineInterface | null = null;

  private activeModelId: string | null = null;

  private loadingPromise: Promise<void> | null = null;

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
    if (!this.supportsWebGPU()) {
      throw new WebLLMProviderError("WEBLLM_UNSUPPORTED", "WebGPU is not available in this browser.");
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

    if (this.loadingPromise) {
      await this.loadingPromise;
      if (this.engine && this.activeModelId === modelId) {
        return;
      }
    }

    this.loadingPromise = (async () => {
      try {
        if (!this.engine) {
          this.engine = await CreateMLCEngine(modelId, {
            initProgressCallback: (report) => {
              const next = this.toProgress(report);
              options.onProgress?.(next.progress, next.text);
            },
            logLevel: "INFO",
          });
          this.activeModelId = modelId;
          return;
        }

        this.engine.setInitProgressCallback((report) => {
          const next = this.toProgress(report);
          options.onProgress?.(next.progress, next.text);
        });
        await this.engine.reload(modelId);
        this.activeModelId = modelId;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WebLLMProviderError("WEBLLM_INIT_FAILED", `WebLLM init failed: ${message}`);
      }
    })();

    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  async stream(
    modelId: string,
    messages: WebLLMMessage[],
    signal: AbortSignal,
    onToken: (token: string) => void,
  ): Promise<void> {
    if (!this.engine || this.activeModelId !== modelId) {
      throw new WebLLMProviderError(
        "WEBLLM_INIT_FAILED",
        "WebLLM engine is not initialized for the selected model.",
      );
    }

    try {
      const chunkStream = await this.engine.chat.completions.create({
        model: modelId,
        messages,
        stream: true,
        temperature: 0.2,
        max_tokens: 700,
      });

      for await (const chunk of chunkStream as AsyncIterable<ChatCompletionChunk>) {
        if (signal.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        const token = chunk.choices?.[0]?.delta?.content ?? "";
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
