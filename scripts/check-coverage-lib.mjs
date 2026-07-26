import ts from "typescript";

export function isProductionSource(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  if (
    /\.(?:test|spec)\.[jt]sx?$/u.test(normalized) ||
    normalized.endsWith(".d.ts") ||
    normalized.startsWith("src/test/") ||
    normalized.includes("/__tests__/")
  ) {
    return false;
  }
  return /^(?:src\/.*\.tsx?|api\/.*\.js)$/u.test(normalized);
}

export function parseChangedLines(diff) {
  const changed = new Map();
  let currentFile;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const destination = line.slice(4);
      currentFile = destination === "/dev/null" ? undefined : destination.replace(/^b\//u, "");
      if (currentFile && isProductionSource(currentFile) && !changed.has(currentFile)) {
        changed.set(currentFile, new Set());
      }
      continue;
    }

    if (!currentFile || !changed.has(currentFile) || !line.startsWith("@@")) continue;
    const match = /\+(\d+)(?:,(\d+))?/u.exec(line);
    if (!match) continue;

    const firstLine = Number(match[1]);
    const lineCount = match[2] === undefined ? 1 : Number(match[2]);
    for (let offset = 0; offset < lineCount; offset += 1) {
      changed.get(currentFile).add(firstLine + offset);
    }
  }

  return changed;
}

export function getLineCoverage(fileCoverage) {
  const lineHits = new Map();

  for (const [statementId, rawHits] of Object.entries(fileCoverage.s)) {
    const statement = fileCoverage.statementMap[statementId];
    if (!statement) continue;

    const hits = Number(rawHits);
    for (let line = statement.start.line; line <= statement.end.line; line += 1) {
      const existingHits = lineHits.get(line);
      lineHits.set(line, existingHits === undefined ? hits : Math.min(existingHits, hits));
    }
  }

  return lineHits;
}

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function importHasRuntimeBinding(statement) {
  if (!statement.importClause) return true;
  if (statement.importClause.isTypeOnly) return false;
  if (statement.importClause.name) return true;

  const bindings = statement.importClause.namedBindings;
  if (!bindings || ts.isNamespaceImport(bindings)) return Boolean(bindings);
  return bindings.elements.some((element) => !element.isTypeOnly);
}

function exportHasRuntimeBinding(statement) {
  if (statement.isTypeOnly) return false;
  if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause)) return true;
  return statement.exportClause.elements.some((element) => !element.isTypeOnly);
}

function statementHasRuntimeEffect(statement) {
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEmptyStatement(statement)
  ) {
    return false;
  }
  if (ts.isImportDeclaration(statement)) return importHasRuntimeBinding(statement);
  if (ts.isExportDeclaration(statement)) return exportHasRuntimeBinding(statement);
  if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) return false;
  return true;
}

export function sourceHasRuntimeCode(sourceText, filePath) {
  const scriptKind = filePath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : filePath.endsWith(".js")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    scriptKind,
  );
  return sourceFile.statements.some(statementHasRuntimeEffect);
}

export function assessChangedFile({ filePath, changedLines, fileCoverage, sourceText }) {
  if (!fileCoverage) {
    const missingCoverageEvidence =
      changedLines.size > 0 && sourceHasRuntimeCode(sourceText, filePath);
    return {
      path: filePath,
      changedLines: changedLines.size,
      coverableLines: 0,
      coveredLines: 0,
      uncoveredLines: [],
      missingCoverageEvidence,
    };
  }

  const lineCoverage = getLineCoverage(fileCoverage);
  const coverableLines = [...changedLines].filter((line) => lineCoverage.has(line));
  const uncoveredLines = coverableLines.filter((line) => lineCoverage.get(line) === 0);
  return {
    path: filePath,
    changedLines: changedLines.size,
    coverableLines: coverableLines.length,
    coveredLines: coverableLines.length - uncoveredLines.length,
    uncoveredLines,
    missingCoverageEvidence: false,
  };
}
