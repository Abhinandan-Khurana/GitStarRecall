export type EmbeddingBackendPreference = "webgpu" | "wasm";

export type WebGpuProbeResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
    };

type GpuAdapterLike = {
  requestDevice?: () => Promise<unknown>;
};

type GpuLike = {
  requestAdapter?: () => Promise<unknown>;
};

export function normalizeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

export async function probeWebGpuSupport(
  navigatorLike: unknown,
): Promise<WebGpuProbeResult> {
  const gpu = (navigatorLike as { gpu?: GpuLike } | undefined)?.gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") {
    return {
      ok: false,
      reason: "navigator.gpu unavailable",
    };
  }

  try {
    const adapterCandidate = await gpu.requestAdapter();
    const adapter =
      adapterCandidate && typeof adapterCandidate === "object"
        ? (adapterCandidate as GpuAdapterLike)
        : null;
    if (!adapter) {
      return {
        ok: false,
        reason: "no WebGPU adapter available",
      };
    }

    if (typeof adapter.requestDevice === "function") {
      await adapter.requestDevice();
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `webgpu probe error: ${normalizeUnknownError(error)}`,
    };
  }
}

export function resolvePreferredBackend(
  preferredBackend: EmbeddingBackendPreference,
  probeResult: WebGpuProbeResult,
): { backend: EmbeddingBackendPreference; fallbackReason: string | null } {
  if (preferredBackend === "wasm") {
    return {
      backend: "wasm",
      fallbackReason: null,
    };
  }

  if (probeResult.ok) {
    return {
      backend: "webgpu",
      fallbackReason: null,
    };
  }

  return {
    backend: "wasm",
    fallbackReason: probeResult.reason,
  };
}
