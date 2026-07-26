import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const workflowUrl = new URL("../.github/workflows/quality.yml", import.meta.url);

describe("quality workflow contracts", () => {
  it("checks formatting against the pull request or push base commit", async () => {
    const workflow = await readFile(workflowUrl, "utf8");

    expect(workflow).toMatch(
      /- name: Check formatting\s+env:\s+FORMAT_BASE_REF: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \|\| 'HEAD\^' \}\}\s+run: pnpm format:check/u,
    );
  });
});
