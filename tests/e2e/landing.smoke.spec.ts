import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  LANDING_ACCESSIBILITY_BASELINE,
  type AccessibilityViolationSignature,
} from "./accessibility-baseline";

const LANDING_TITLE = /GitStarRecall - Local-First GitHub Stars Semantic Search/;
const LANDING_HEADING = "Find starred repos by memory, not by name.";

function recordBrowserErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`page: ${error.message}`);
  });

  return errors;
}

test("landing page renders its primary content without browser errors", async ({ page }) => {
  const browserErrors = recordBrowserErrors(page);

  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page).toHaveTitle(LANDING_TITLE);
  await expect(page.locator("#root")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: LANDING_HEADING })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with GitHub" }).first()).toBeVisible();
  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});

test("an unauthenticated direct app request returns to the landing page", async ({ page }) => {
  const browserErrors = recordBrowserErrors(page);

  await page.goto("/app", { waitUntil: "networkidle" });

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: LANDING_HEADING })).toBeVisible();
  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});

function normalizeTarget(target: readonly unknown[]): string {
  return target
    .map((part) => (Array.isArray(part) ? part.join(" >> ") : String(part)))
    .join(" >>> ")
    .replace(/\s+/gu, " ")
    .trim();
}

function compareAccessibilitySignatures(
  left: AccessibilityViolationSignature,
  right: AccessibilityViolationSignature,
): number {
  return `${left.ruleId}\0${left.impact}\0${left.target}`.localeCompare(
    `${right.ruleId}\0${right.impact}\0${right.target}`,
  );
}

test("landing page matches the reviewed serious and critical accessibility baseline", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("gitstarrecall.theme", "light");
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });

  const results = await new AxeBuilder({ page }).analyze();
  const actualSignatures = results.violations
    .filter(
      (violation): violation is typeof violation & { impact: "serious" | "critical" } =>
        violation.impact === "serious" || violation.impact === "critical",
    )
    .flatMap((violation) =>
      violation.nodes.map((node) => ({
        ruleId: violation.id,
        impact: violation.impact,
        target: normalizeTarget(node.target),
      })),
    )
    .sort(compareAccessibilitySignatures);
  const expectedSignatures: AccessibilityViolationSignature[] = [
    ...LANDING_ACCESSIBILITY_BASELINE,
  ].sort(compareAccessibilitySignatures);

  expect(actualSignatures).toEqual(expectedSignatures);
});
