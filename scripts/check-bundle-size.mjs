import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const BASELINE_COMMIT = "d5c071a4f11436c7a19eb2a1b8474e21e51ffb7b";

const budget = (baselineBytes, toleranceBasisPoints, metricClass) => ({
  metricClass,
  baselineBytes,
  tolerancePercent: toleranceBasisPoints / 100,
  maximumBytes: Math.ceil((baselineBytes * (10_000 + toleranceBasisPoints)) / 10_000),
});

// Baselines are measurements from BASELINE_COMMIT. Raw JavaScript has a 2.6% ceiling;
// transferred JavaScript and every WASM measurement retain the stricter 2% ceiling.
export const BUDGETS = {
  largestJavaScriptRawBytes: budget(6_796_298, 260, "rawJavaScript"),
  totalJavaScriptRawBytes: budget(7_677_607, 260, "rawJavaScript"),
  totalJavaScriptGzipBytes: budget(2_615_423, 200, "gzipJavaScript"),
  ortWasmRawBytes: budget(21_596_019, 200, "wasm"),
  ortWasmGzipBytes: budget(5_046_898, 200, "wasm"),
  totalWasmRawBytes: budget(22_255_753, 200, "wasm"),
  totalWasmGzipBytes: budget(5_369_848, 200, "wasm"),
};

const BUDGET_POLICY = {
  rule: "Each ceiling is the fixed baseline plus its metric class tolerance, rounded up to whole bytes.",
  metricClasses: {
    rawJavaScript: { tolerancePercent: 2.6, appliesTo: "uncompressed JavaScript" },
    gzipJavaScript: { tolerancePercent: 2, appliesTo: "gzipped JavaScript" },
    wasm: { tolerancePercent: 2, appliesTo: "raw and gzipped WASM" },
  },
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = path.join(projectRoot, "dist");
const reportPath = path.join(projectRoot, "test-results", "bundle-report.json");

function sum(files, metric) {
  return files.reduce((total, file) => total + file[metric], 0);
}

async function collectBundleFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectBundleFiles(absolutePath)));
    } else if (entry.isFile() && /\.(?:(?:c|m)?js|wasm)$/u.test(entry.name)) {
      const fileStats = await stat(absolutePath);
      const contents = await readFile(absolutePath);
      files.push({
        path: path.relative(projectRoot, absolutePath).split(path.sep).join("/"),
        rawBytes: fileStats.size,
        gzipBytes: gzipSync(contents, { level: 9 }).length,
        sha256: createHash("sha256").update(contents).digest("hex"),
      });
    }
  }

  return files;
}

export function evaluateBudgets(metrics) {
  return Object.fromEntries(
    Object.entries(BUDGETS).map(([name, budget]) => {
      const actualBytes = metrics[name];
      if (!Number.isSafeInteger(actualBytes) || actualBytes < 0) {
        throw new Error(`Missing measurement for budgeted metric ${name}`);
      }

      return [
        name,
        {
          ...budget,
          actualBytes,
          headroomBytes: budget.maximumBytes - actualBytes,
          passed: actualBytes <= budget.maximumBytes,
        },
      ];
    }),
  );
}

function describeFailures(failedChecks) {
  return failedChecks
    .map(
      ([name, check]) =>
        `${name}: ${check.actualBytes.toLocaleString("en-US")} > ${check.maximumBytes.toLocaleString("en-US")} (baseline ${check.baselineBytes.toLocaleString("en-US")} +${check.tolerancePercent}%)`,
    )
    .join("; ");
}

export function buildReport({ javaScript, wasm }) {
  if (javaScript.length === 0) {
    throw new Error(`No JavaScript chunks were found under ${distDirectory}.`);
  }

  const ortWasm = wasm.filter((file) => file.runtime === "onnxruntime");
  if (ortWasm.length === 0) {
    throw new Error(`No ONNX Runtime WASM asset was found under ${distDirectory}.`);
  }

  const metrics = {
    largestJavaScriptRawBytes: javaScript.reduce(
      (largest, file) => Math.max(largest, file.rawBytes),
      0,
    ),
    totalJavaScriptRawBytes: sum(javaScript, "rawBytes"),
    totalJavaScriptGzipBytes: sum(javaScript, "gzipBytes"),
    ortWasmRawBytes: sum(ortWasm, "rawBytes"),
    ortWasmGzipBytes: sum(ortWasm, "gzipBytes"),
    totalWasmRawBytes: sum(wasm, "rawBytes"),
    totalWasmGzipBytes: sum(wasm, "gzipBytes"),
  };
  const budgets = evaluateBudgets(metrics);

  return {
    schemaVersion: 3,
    baselineCommit: BASELINE_COMMIT,
    compression: "gzip level 9",
    budgetPolicy: BUDGET_POLICY,
    budgets,
    result: {
      passed: Object.values(budgets).every((check) => check.passed),
      metrics,
      javaScript,
      wasm,
    },
  };
}

async function main() {
  let distStats;
  try {
    distStats = await stat(distDirectory);
  } catch {
    throw new Error(`Bundle output is missing at ${distDirectory}. Run "pnpm build" first.`);
  }

  if (!distStats.isDirectory()) {
    throw new Error(`Expected ${distDirectory} to be a directory. Run "pnpm build" first.`);
  }

  const files = await collectBundleFiles(distDirectory);
  const javaScript = files
    .filter((file) => /\.(?:c|m)?js$/u.test(file.path))
    .sort((a, b) => b.rawBytes - a.rawBytes);
  const wasm = files
    .filter((file) => file.path.endsWith(".wasm"))
    .map((file) => ({
      ...file,
      runtime: file.path.includes("ort-wasm")
        ? "onnxruntime"
        : file.path.includes("sql-wasm")
          ? "sql.js"
          : "other",
    }))
    .sort((a, b) => b.rawBytes - a.rawBytes);

  const report = buildReport({ javaScript, wasm });
  const metrics = report.result.metrics;
  const failedChecks = Object.entries(report.budgets).filter(([, check]) => !check.passed);

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (failedChecks.length > 0) {
    throw new Error(
      `Bundle budget exceeded: ${describeFailures(failedChecks)}. Report: ${reportPath}`,
    );
  }

  console.log(
    `Bundle budgets passed: ${javaScript.length} JavaScript chunks (${metrics.totalJavaScriptRawBytes.toLocaleString("en-US")} raw / ${metrics.totalJavaScriptGzipBytes.toLocaleString("en-US")} gzip bytes) and ${wasm.length} WASM assets (${metrics.totalWasmRawBytes.toLocaleString("en-US")} raw / ${metrics.totalWasmGzipBytes.toLocaleString("en-US")} gzip bytes).`,
  );
  console.log(`Bundle report: ${reportPath}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
