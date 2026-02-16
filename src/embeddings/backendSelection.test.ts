import { describe, expect, test } from "vitest";
import { probeWebGpuSupport, resolvePreferredBackend } from "./backendSelection";

describe("backend selection", () => {
  test("prefers wasm when explicitly requested", () => {
    const resolved = resolvePreferredBackend("wasm", { ok: true });
    expect(resolved.backend).toBe("wasm");
    expect(resolved.fallbackReason).toBeNull();
  });

  test("selects webgpu when probe succeeds", () => {
    const resolved = resolvePreferredBackend("webgpu", { ok: true });
    expect(resolved.backend).toBe("webgpu");
    expect(resolved.fallbackReason).toBeNull();
  });

  test("falls back to wasm when webgpu probe fails", () => {
    const resolved = resolvePreferredBackend("webgpu", {
      ok: false,
      reason: "navigator.gpu unavailable",
    });
    expect(resolved.backend).toBe("wasm");
    expect(resolved.fallbackReason).toContain("navigator.gpu unavailable");
  });

  test("probe reports unavailable when gpu API is missing", async () => {
    const probe = await probeWebGpuSupport({});
    expect(probe.ok).toBe(false);
    if (!probe.ok) {
      expect(probe.reason).toContain("navigator.gpu unavailable");
    }
  });

  test("probe reports adapter failure", async () => {
    const probe = await probeWebGpuSupport({
      gpu: {
        requestAdapter: async () => null,
      },
    });
    expect(probe.ok).toBe(false);
    if (!probe.ok) {
      expect(probe.reason).toContain("no WebGPU adapter available");
    }
  });
});
