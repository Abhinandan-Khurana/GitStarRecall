import { describe, expect, it } from "vitest";
import { BASELINE_COMMIT, BUDGETS, buildReport, evaluateBudgets } from "./check-bundle-size.mjs";

const REVIEWED_CEILINGS = {
  largestJavaScriptRawBytes: 6_966_206,
  totalJavaScriptRawBytes: 7_869_548,
  totalJavaScriptGzipBytes: 2_667_732,
  ortWasmRawBytes: 22_027_940,
  ortWasmGzipBytes: 5_147_836,
  totalWasmRawBytes: 22_700_869,
  totalWasmGzipBytes: 5_477_245,
};

const metricsAtCeilings = () =>
  Object.fromEntries(Object.entries(BUDGETS).map(([name, value]) => [name, value.maximumBytes]));

describe("bundle budget policy", () => {
  it("derives the reviewed ceilings from the fixed baseline and class tolerance", () => {
    expect(BASELINE_COMMIT).toBe("d5c071a4f11436c7a19eb2a1b8474e21e51ffb7b");
    expect(
      Object.fromEntries(Object.entries(BUDGETS).map(([k, v]) => [k, v.maximumBytes])),
    ).toEqual(REVIEWED_CEILINGS);

    for (const budget of Object.values(BUDGETS)) {
      expect(budget.maximumBytes).toBe(
        Math.ceil(budget.baselineBytes * (1 + budget.tolerancePercent / 100)),
      );
    }
  });

  it("allows 2.5% only for raw JavaScript and 2% for gzip JavaScript and WASM", () => {
    expect(
      Object.fromEntries(Object.entries(BUDGETS).map(([k, v]) => [k, v.tolerancePercent])),
    ).toEqual({
      largestJavaScriptRawBytes: 2.5,
      totalJavaScriptRawBytes: 2.5,
      totalJavaScriptGzipBytes: 2,
      ortWasmRawBytes: 2,
      ortWasmGzipBytes: 2,
      totalWasmRawBytes: 2,
      totalWasmGzipBytes: 2,
    });
  });

  it("passes at each ceiling and fails one byte above it", () => {
    expect(Object.values(evaluateBudgets(metricsAtCeilings())).every((check) => check.passed)).toBe(
      true,
    );

    for (const name of Object.keys(BUDGETS)) {
      const metrics = metricsAtCeilings();
      metrics[name] += 1;
      const checks = evaluateBudgets(metrics);
      expect(checks[name].passed, name).toBe(false);
      expect(checks[name].headroomBytes, name).toBe(-1);
    }
  });

  it("reports the per-class policy and measurements truthfully", () => {
    const report = buildReport({
      javaScript: [
        { path: "dist/a.js", rawBytes: 6_700_000, gzipBytes: 2_000_000 },
        { path: "dist/b.js", rawBytes: 900_000, gzipBytes: 600_000 },
      ],
      wasm: [
        {
          path: "dist/ort-wasm.wasm",
          rawBytes: 21_596_019,
          gzipBytes: 5_046_898,
          runtime: "onnxruntime",
        },
        {
          path: "dist/sql-wasm.wasm",
          rawBytes: 659_734,
          gzipBytes: 322_950,
          runtime: "sql.js",
        },
      ],
    });

    expect(report.baselineCommit).toBe(BASELINE_COMMIT);
    expect(report.budgetPolicy).toEqual({
      rule: expect.stringMatching(/fixed baseline.*metric class tolerance.*rounded up/iu),
      metricClasses: {
        rawJavaScript: { tolerancePercent: 2.5, appliesTo: "uncompressed JavaScript" },
        gzipJavaScript: { tolerancePercent: 2, appliesTo: "gzipped JavaScript" },
        wasm: { tolerancePercent: 2, appliesTo: "raw and gzipped WASM" },
      },
    });
    expect(report.result.metrics).toEqual({
      largestJavaScriptRawBytes: 6_700_000,
      totalJavaScriptRawBytes: 7_600_000,
      totalJavaScriptGzipBytes: 2_600_000,
      ortWasmRawBytes: 21_596_019,
      ortWasmGzipBytes: 5_046_898,
      totalWasmRawBytes: 22_255_753,
      totalWasmGzipBytes: 5_369_848,
    });
  });

  it("enforces required bundle composition for direct callers", () => {
    expect(() => buildReport({ javaScript: [], wasm: [] })).toThrow(
      "No JavaScript chunks were found",
    );
    expect(() =>
      buildReport({
        javaScript: [{ path: "dist/app.js", rawBytes: 1, gzipBytes: 1 }],
        wasm: [
          {
            path: "dist/sql-wasm.wasm",
            rawBytes: 1,
            gzipBytes: 1,
            runtime: "sql.js",
          },
        ],
      }),
    ).toThrow("No ONNX Runtime WASM asset was found");
  });

  it("measures the largest JavaScript chunk independent of input order", () => {
    const report = buildReport({
      javaScript: [
        { path: "dist/small.js", rawBytes: 100, gzipBytes: 50 },
        { path: "dist/large.js", rawBytes: 200, gzipBytes: 80 },
      ],
      wasm: [
        {
          path: "dist/ort-wasm.wasm",
          rawBytes: 1,
          gzipBytes: 1,
          runtime: "onnxruntime",
        },
      ],
    });

    expect(report.result.metrics.largestJavaScriptRawBytes).toBe(200);
  });
});
