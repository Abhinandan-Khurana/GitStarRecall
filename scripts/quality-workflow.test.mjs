import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const workflowUrl = new URL("../.github/workflows/quality.yml", import.meta.url);

describe("quality workflow contracts", () => {
  it("accepts a deterministic base ref for manual recovery runs", async () => {
    const workflow = await readFile(workflowUrl, "utf8");

    expect(workflow).toMatch(
      /workflow_dispatch:\s+inputs:\s+base_ref:\s+description: Base ref for changed-file and coverage checks\s+required: false\s+default: origin\/main\s+type: string/u,
    );
  });

  it("uses the manual base before preserving pull request and push fallbacks", async () => {
    const workflow = await readFile(workflowUrl, "utf8");
    const baseRefExpression =
      "${{ inputs.base_ref || github.event.pull_request.base.sha || github.event.before || 'HEAD^' }}";

    expect(workflow).toContain(`FORMAT_BASE_REF: ${baseRefExpression}`);
    expect(workflow).toContain(`COVERAGE_BASE_REF: ${baseRefExpression}`);
    expect(workflow.split(baseRefExpression)).toHaveLength(3);
  });
});
