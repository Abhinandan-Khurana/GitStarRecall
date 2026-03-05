import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveTransformersVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "node_modules/@huggingface/transformers/package.json");
    const payload = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: unknown };
    const version = typeof payload.version === "string" ? payload.version.trim() : "";
    return version || "3.8.1";
  } catch {
    return "3.8.1";
  }
}

// Content-Security-Policy: see docs/threat-modeling-stride.md and docs/security-review-stride.md.
// Production uses script-src 'unsafe-eval' for runtime needs (e.g. embedding worker); avoid adding inline scripts.
const TRANSFORMERS_VERSION = resolveTransformersVersion();
const JSDELIVR_TRANSFORMERS_SCRIPT_SRC = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/`;
const BASE_CSP_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' https: data:",
  "frame-src https://www.youtube.com https://player.vimeo.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
];

const DEV_CSP = [
  `script-src 'self' 'unsafe-eval' 'unsafe-inline' ${JSDELIVR_TRANSFORMERS_SCRIPT_SRC}`,
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:* https://api.github.com https://api.openai.com https://api.anthropic.com https://api.deepseek.com https://api.moonshot.cn https://api.moonshot.ai https://api.z.ai https://open.bigmodel.cn https://bigmodel.cn https://huggingface.co https://*.huggingface.co https://hf.co https://*.hf.co https://xethub.hf.co https://*.xethub.hf.co https://cdn-lfs.huggingface.co https://cdn.jsdelivr.net https://raw.githubusercontent.com https://*.githubusercontent.com",
  ...BASE_CSP_DIRECTIVES,
].join("; ");

const PROD_CSP = [
  `script-src 'self' 'unsafe-eval' ${JSDELIVR_TRANSFORMERS_SCRIPT_SRC}`,
  "connect-src 'self' https://api.github.com https://api.openai.com https://api.anthropic.com https://api.deepseek.com https://api.moonshot.cn https://api.moonshot.ai https://api.z.ai https://open.bigmodel.cn https://bigmodel.cn https://huggingface.co https://*.huggingface.co https://hf.co https://*.hf.co https://xethub.hf.co https://*.xethub.hf.co https://cdn-lfs.huggingface.co https://cdn.jsdelivr.net https://raw.githubusercontent.com https://*.githubusercontent.com http://localhost:11434 http://localhost:1234 http://localhost:3001",
  ...BASE_CSP_DIRECTIVES,
].join("; ");

export default defineConfig(({ command }) => {
  const contentSecurityPolicy = command === "serve" ? DEV_CSP : PROD_CSP;

  return {
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      port: 5173,
      headers: {
        "Content-Security-Policy": contentSecurityPolicy,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    },
    preview: {
      headers: {
        "Content-Security-Policy": contentSecurityPolicy,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    },
  };
});
