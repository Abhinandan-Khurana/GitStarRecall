import { defineConfig } from "@playwright/test";

const CI = Boolean(process.env.CI);
const previewCommand =
  process.env.PLAYWRIGHT_SKIP_BUILD === "1"
    ? "pnpm preview --host 127.0.0.1 --port 4173"
    : "pnpm build && pnpm preview --host 127.0.0.1 --port 4173";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/playwright",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: [
    ["line"],
    ["html", { outputFolder: "test-results/playwright-report", open: "never" }],
    ["junit", { outputFile: "test-results/playwright-junit.xml" }],
  ],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    colorScheme: "light",
    locale: "en-US",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: previewCommand,
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
