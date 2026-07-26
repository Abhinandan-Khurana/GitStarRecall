import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessChangedFile, isProductionSource, parseChangedLines } from "./check-coverage-lib.mjs";

const BASELINE_COMMIT = "d5c071a4f11436c7a19eb2a1b8474e21e51ffb7b";
const BASELINE = {
  lines: { covered: 3_912, total: 14_501 },
  statements: { covered: 3_912, total: 14_501 },
  functions: { covered: 289, total: 412 },
  branches: { covered: 931, total: 1_414 },
};
const MINIMUM_CHANGED_LINE_PERCENTAGE = 90;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coveragePath = path.join(projectRoot, "coverage", "coverage-final.json");
const summaryPath = path.join(projectRoot, "coverage", "coverage-summary.json");
const reportPath = path.join(projectRoot, "test-results", "coverage-gate.json");

function runGit(args) {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function resolveBaseRef() {
  const explicitBase = process.env.COVERAGE_BASE_REF?.trim();
  if (explicitBase) {
    runGit(["rev-parse", "--verify", `${explicitBase}^{commit}`]);
    return explicitBase;
  }

  const candidates = [];
  const githubBase = process.env.GITHUB_BASE_REF?.trim();
  if (githubBase) candidates.push(`origin/${githubBase}`, githubBase);
  candidates.push("origin/main", "main", "HEAD^");

  for (const candidate of candidates) {
    try {
      runGit(["rev-parse", "--verify", `${candidate}^{commit}`]);
      return candidate;
    } catch {
      // Try the next deterministic local fallback.
    }
  }

  throw new Error(
    "Unable to resolve the coverage diff base. Set COVERAGE_BASE_REF to the PR base commit.",
  );
}

async function addUntrackedSourceLines(changed) {
  const untracked = runGit(["ls-files", "--others", "--exclude-standard", "--", "src", "api"])
    .split("\n")
    .filter((filePath) => filePath && isProductionSource(filePath));

  for (const filePath of untracked) {
    const contents = await readFile(path.join(projectRoot, filePath), "utf8");
    const lineCount =
      contents.length === 0
        ? 0
        : contents.split(/\r?\n/u).length - (contents.endsWith("\n") ? 1 : 0);
    changed.set(filePath, new Set(Array.from({ length: lineCount }, (_, index) => index + 1)));
  }
}

function percentage(covered, total) {
  return total === 0 ? null : (covered / total) * 100;
}

function didRegress(actual, baseline) {
  return actual.covered * baseline.total < baseline.covered * actual.total;
}

async function main() {
  const [coverage, summary] = await Promise.all([
    readFile(coveragePath, "utf8").then(JSON.parse),
    readFile(summaryPath, "utf8").then(JSON.parse),
  ]).catch((error) => {
    throw new Error(
      `Coverage evidence is missing or invalid. Run "pnpm test:coverage" first. ${error.message}`,
    );
  });

  const baseRef = resolveBaseRef();
  const diff = runGit([
    "diff",
    "--unified=0",
    "--no-color",
    "--no-ext-diff",
    baseRef,
    "--",
    "src",
    "api",
  ]);
  const changedLines = parseChangedLines(diff);
  await addUntrackedSourceLines(changedLines);
  const coverageByRelativePath = new Map(
    Object.entries(coverage).map(([absolutePath, fileCoverage]) => [
      path.relative(projectRoot, absolutePath).split(path.sep).join("/"),
      fileCoverage,
    ]),
  );

  const files = [];
  let changedCoverableLines = 0;
  let coveredChangedLines = 0;
  for (const [filePath, changedFileLines] of [...changedLines].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const fileCoverage = coverageByRelativePath.get(filePath);
    const sourceText = fileCoverage
      ? ""
      : await readFile(path.join(projectRoot, filePath), "utf8").catch((error) => {
          throw new Error(`Unable to inspect changed source ${filePath}. ${error.message}`);
        });
    const result = assessChangedFile({
      filePath,
      changedLines: changedFileLines,
      fileCoverage,
      sourceText,
    });
    changedCoverableLines += result.coverableLines;
    coveredChangedLines += result.coveredLines;
    files.push(result);
  }

  const changedLinePercentage = percentage(coveredChangedLines, changedCoverableLines);
  const global = Object.fromEntries(
    Object.entries(BASELINE).map(([metric, baseline]) => {
      const actual = summary.total[metric];
      if (!actual) throw new Error(`Coverage summary is missing the ${metric} metric.`);
      return [
        metric,
        {
          baseline,
          actual: { covered: actual.covered, total: actual.total },
          baselinePercentage: percentage(baseline.covered, baseline.total),
          actualPercentage: percentage(actual.covered, actual.total),
          passed: !didRegress(actual, baseline),
        },
      ];
    }),
  );
  const missingCoverageFiles = files
    .filter((file) => file.missingCoverageEvidence)
    .map((file) => file.path);
  const changedLinesPassed =
    missingCoverageFiles.length === 0 &&
    (changedLinePercentage === null || changedLinePercentage >= MINIMUM_CHANGED_LINE_PERCENTAGE);
  const report = {
    schemaVersion: 2,
    baselineCommit: BASELINE_COMMIT,
    baseRef,
    sourceScope: ["src/**/*.{ts,tsx}", "api/**/*.js"],
    global,
    changedLines: {
      minimumPercentage: MINIMUM_CHANGED_LINE_PERCENTAGE,
      status:
        missingCoverageFiles.length > 0
          ? "missing-evidence"
          : changedLinePercentage === null
            ? "not-applicable"
            : "measured",
      covered: coveredChangedLines,
      coverable: changedCoverableLines,
      percentage: changedLinePercentage,
      missingCoverageFiles,
      passed: changedLinesPassed,
      files,
    },
    passed: Object.values(global).every((metric) => metric.passed) && changedLinesPassed,
  };

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const [metric, result] of Object.entries(global)) {
    console.log(
      `Global ${metric}: ${result.actual.covered}/${result.actual.total} (${result.actualPercentage.toFixed(2)}%); baseline ${result.baseline.covered}/${result.baseline.total} (${result.baselinePercentage.toFixed(2)}%) — ${result.passed ? "passed" : "FAILED"}`,
    );
  }
  console.log(
    missingCoverageFiles.length > 0
      ? `Changed-line coverage: FAILED because coverage evidence is missing for ${missingCoverageFiles.join(", ")}.`
      : changedLinePercentage === null
        ? `Changed-line coverage: not applicable (no changed executable production lines relative to ${baseRef}).`
        : `Changed-line coverage: ${coveredChangedLines}/${changedCoverableLines} (${changedLinePercentage.toFixed(2)}%); minimum ${MINIMUM_CHANGED_LINE_PERCENTAGE}% — ${changedLinesPassed ? "passed" : "FAILED"}.`,
  );
  console.log(`Coverage gate report: ${reportPath}`);

  if (!report.passed) {
    const uncovered = files
      .filter((file) => file.uncoveredLines.length > 0)
      .map((file) => `${file.path}:${file.uncoveredLines.join(",")}`)
      .join("; ");
    throw new Error(
      `Coverage quality gate failed.${missingCoverageFiles.length > 0 ? ` Missing coverage evidence: ${missingCoverageFiles.join(", ")}.` : ""}${uncovered ? ` Uncovered changed lines: ${uncovered}.` : ""} Report: ${reportPath}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
