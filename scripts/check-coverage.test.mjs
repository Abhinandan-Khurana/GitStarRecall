import { describe, expect, it } from "vitest";
import {
  assessChangedFile,
  getLineCoverage,
  isProductionSource,
  parseChangedLines,
  sourceHasRuntimeCode,
} from "./check-coverage-lib.mjs";

function coverageForStatement({ startLine, endLine, hits }) {
  return {
    s: { 0: hits },
    statementMap: {
      0: {
        start: { line: startLine, column: 0 },
        end: { line: endLine, column: 1 },
      },
    },
  };
}

describe("changed-line coverage", () => {
  it("keeps test support files outside the production-source gate", () => {
    expect(isProductionSource("src/test/setup.ts")).toBe(false);
    expect(isProductionSource("src/example/__tests__/fixture.ts")).toBe(false);
    expect(isProductionSource("src/runtime.ts")).toBe(true);
  });

  it("fails closed for an untracked runtime source file absent from coverage evidence", () => {
    const result = assessChangedFile({
      filePath: "src/new-runtime.ts",
      changedLines: new Set([1, 2, 3]),
      fileCoverage: undefined,
      sourceText: "export function answer() {\n  return 42;\n}\n",
    });

    expect(result).toMatchObject({
      changedLines: 3,
      coverableLines: 0,
      missingCoverageEvidence: true,
    });
  });

  it("keeps an unloaded type-only source file non-applicable", () => {
    const sourceText = [
      'import type { ReactNode } from "react";',
      "export interface Props { children: ReactNode }",
      'export type Status = "ready" | "error";',
      "declare const compileTimeOnly: unique symbol;",
    ].join("\n");

    expect(sourceHasRuntimeCode(sourceText, "src/types.ts")).toBe(false);
    expect(
      assessChangedFile({
        filePath: "src/types.ts",
        changedLines: new Set([1, 2, 3, 4]),
        fileCoverage: undefined,
        sourceText,
      }).missingCoverageEvidence,
    ).toBe(false);
  });

  it("marks an uncovered continuation line as uncovered", () => {
    const fileCoverage = coverageForStatement({ startLine: 4, endLine: 7, hits: 0 });

    expect(getLineCoverage(fileCoverage)).toEqual(
      new Map([
        [4, 0],
        [5, 0],
        [6, 0],
        [7, 0],
      ]),
    );
    expect(
      assessChangedFile({
        filePath: "src/request.ts",
        changedLines: new Set([6]),
        fileCoverage,
        sourceText: "",
      }),
    ).toMatchObject({ coverableLines: 1, coveredLines: 0, uncoveredLines: [6] });
  });

  it("accepts a covered continuation line", () => {
    const result = assessChangedFile({
      filePath: "src/request.ts",
      changedLines: new Set([6]),
      fileCoverage: coverageForStatement({ startLine: 4, endLine: 7, hits: 1 }),
      sourceText: "",
    });

    expect(result).toMatchObject({
      coverableLines: 1,
      coveredLines: 1,
      uncoveredLines: [],
      missingCoverageEvidence: false,
    });
  });

  it("uses the least-covered statement when executable ranges overlap", () => {
    const lineHits = getLineCoverage({
      s: { 0: 3, 1: 0 },
      statementMap: {
        0: { start: { line: 2 }, end: { line: 5 } },
        1: { start: { line: 4 }, end: { line: 4 } },
      },
    });

    expect(lineHits.get(4)).toBe(0);
  });

  it("parses newly added production lines from zero-context diffs", () => {
    const changed = parseChangedLines(
      [
        "diff --git a/src/new.ts b/src/new.ts",
        "--- /dev/null",
        "+++ b/src/new.ts",
        "@@ -0,0 +1,3 @@",
        "+export function answer() {",
        "+  return 42;",
        "+}",
      ].join("\n"),
    );

    expect(changed.get("src/new.ts")).toEqual(new Set([1, 2, 3]));
  });
});
