import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BASELINE_COMMIT = "d5c071a4f11436c7a19eb2a1b8474e21e51ffb7b";
const BUDGETS = {
  largestJavaScriptRawBytes: {
    baselineBytes: 6_796_298,
    maximumBytes: 6_932_224,
  },
  totalJavaScriptRawBytes: {
    baselineBytes: 7_677_607,
    maximumBytes: 7_831_160,
  },
  totalJavaScriptGzipBytes: {
    baselineBytes: 2_615_423,
    maximumBytes: 2_667_732,
  },
  ortWasmRawBytes: {
    baselineBytes: 21_596_019,
    maximumBytes: 22_027_940,
  },
  ortWasmGzipBytes: {
    baselineBytes: 5_046_898,
    maximumBytes: 5_147_836,
  },
  totalWasmRawBytes: {
    baselineBytes: 22_255_753,
    maximumBytes: 22_700_869,
  },
  totalWasmGzipBytes: {
    baselineBytes: 5_369_848,
    maximumBytes: 5_477_245,
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

  if (javaScript.length === 0) {
    throw new Error(`No JavaScript chunks were found under ${distDirectory}.`);
  }

  const ortWasm = wasm.filter((file) => file.runtime === "onnxruntime");
  if (ortWasm.length === 0) {
    throw new Error(`No ONNX Runtime WASM asset was found under ${distDirectory}.`);
  }

  const metrics = {
    largestJavaScriptRawBytes: javaScript[0].rawBytes,
    totalJavaScriptRawBytes: sum(javaScript, "rawBytes"),
    totalJavaScriptGzipBytes: sum(javaScript, "gzipBytes"),
    ortWasmRawBytes: sum(ortWasm, "rawBytes"),
    ortWasmGzipBytes: sum(ortWasm, "gzipBytes"),
    totalWasmRawBytes: sum(wasm, "rawBytes"),
    totalWasmGzipBytes: sum(wasm, "gzipBytes"),
  };
  const checks = Object.fromEntries(
    Object.entries(BUDGETS).map(([name, budget]) => [
      name,
      {
        ...budget,
        actualBytes: metrics[name],
        passed: metrics[name] <= budget.maximumBytes,
      },
    ]),
  );
  const failedChecks = Object.entries(checks).filter(([, check]) => !check.passed);
  const report = {
    schemaVersion: 2,
    baselineCommit: BASELINE_COMMIT,
    compression: "gzip level 9",
    budgetPolicy: "2% ceiling over the recorded baseline, rounded up to whole bytes",
    budgets: checks,
    result: {
      passed: failedChecks.length === 0,
      metrics,
      javaScript,
      wasm,
    },
  };

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (failedChecks.length > 0) {
    const failures = failedChecks
      .map(
        ([name, check]) =>
          `${name}: ${check.actualBytes.toLocaleString("en-US")} > ${check.maximumBytes.toLocaleString("en-US")}`,
      )
      .join("; ");
    throw new Error(`Bundle budget exceeded: ${failures}. Report: ${reportPath}`);
  }

  console.log(
    `Bundle budgets passed: ${javaScript.length} JavaScript chunks (${metrics.totalJavaScriptRawBytes.toLocaleString("en-US")} raw / ${metrics.totalJavaScriptGzipBytes.toLocaleString("en-US")} gzip bytes) and ${wasm.length} WASM assets (${metrics.totalWasmRawBytes.toLocaleString("en-US")} raw / ${metrics.totalWasmGzipBytes.toLocaleString("en-US")} gzip bytes).`,
  );
  console.log(`Bundle report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
