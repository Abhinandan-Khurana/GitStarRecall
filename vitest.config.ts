import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(projectRoot, "src") },
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
    include: ["src/**/*.test.{ts,tsx}", "api/**/*.test.js", "scripts/**/*.test.mjs"],
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    restoreMocks: true,
    clearMocks: true,
    reporters: ["default", "junit"],
    outputFile: {
      junit: "./test-results/junit.xml",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "api/**/*.js"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "api/**/*.test.js",
        "src/**/*.d.ts",
        "src/test/**",
        "src/**/__tests__/**",
      ],
      reportsDirectory: "./coverage",
      reporter: ["text", "json", "json-summary", "html", "lcov"],
    },
  },
});
