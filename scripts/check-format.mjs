import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = runGit(["rev-parse", "--show-toplevel"], { text: true }).trim();
const prettierExtensions = new Set([
  ".cjs",
  ".css",
  ".gql",
  ".graphql",
  ".html",
  ".js",
  ".json",
  ".json5",
  ".jsonc",
  ".jsx",
  ".less",
  ".md",
  ".mdx",
  ".mjs",
  ".scss",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const generatedFiles = new Set(["pnpm-lock.yaml"]);

function runGit(args, { allowFailure = false, text = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: text ? "utf8" : "buffer",
  });

  if (result.status !== 0 && !allowFailure) {
    const detail = Buffer.from(result.stderr ?? "")
      .toString("utf8")
      .trim();
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }

  return result.status === 0 ? result.stdout : text ? "" : Buffer.alloc(0);
}

function refExists(ref) {
  return (
    spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd: root,
      stdio: "ignore",
    }).status === 0
  );
}

function parseNullDelimited(buffer) {
  return Buffer.from(buffer).toString("utf8").split("\0").filter(Boolean);
}

function resolveBaseRef() {
  const explicit = process.env.FORMAT_BASE_REF?.trim();
  const githubBase = process.env.GITHUB_BASE_REF?.trim();
  const candidates = [
    explicit,
    githubBase ? `refs/remotes/origin/${githubBase}` : undefined,
    githubBase ? `origin/${githubBase}` : undefined,
    githubBase,
    "origin/main",
  ].filter(Boolean);

  return candidates.find(refExists);
}

const changedFiles = new Set();
const baseRef = resolveBaseRef();

if (baseRef) {
  for (const file of parseNullDelimited(
    runGit(["diff", "--name-only", "--diff-filter=ACMR", "-z", `${baseRef}...HEAD`]),
  )) {
    changedFiles.add(file);
  }
} else {
  console.log("No base ref found; checking working-tree changes only.");
}

for (const args of [
  ["diff", "--name-only", "--diff-filter=ACMR", "-z"],
  ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
  ["ls-files", "--others", "--exclude-standard", "-z"],
]) {
  for (const file of parseNullDelimited(runGit(args))) {
    changedFiles.add(file);
  }
}

const filesToCheck = [...changedFiles]
  .filter((file) => !generatedFiles.has(file))
  .filter((file) => prettierExtensions.has(extname(file).toLowerCase()))
  .filter((file) => {
    const absolutePath = resolve(root, file);
    return existsSync(absolutePath) && statSync(absolutePath).isFile();
  })
  .sort();

if (filesToCheck.length === 0) {
  console.log("No changed Prettier-supported files to check.");
  process.exit(0);
}

console.log(`Checking formatting for ${filesToCheck.length} changed file(s).`);
const prettierCli = resolve(root, "node_modules/prettier/bin/prettier.cjs");
const result = spawnSync(process.execPath, [prettierCli, "--check", ...filesToCheck], {
  cwd: root,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
