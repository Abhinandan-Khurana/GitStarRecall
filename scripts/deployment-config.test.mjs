import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const deployment = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const transformersPackage = JSON.parse(
  fs.readFileSync(path.join(root, "node_modules/@huggingface/transformers/package.json"), "utf8"),
);

describe("production deployment configuration", () => {
  it("rewrites only supported client routes", () => {
    expect(deployment.rewrites).toEqual([
      { source: "/auth/callback", destination: "/index.html" },
      { source: "/auth/callback/", destination: "/index.html" },
      { source: "/app", destination: "/index.html" },
      { source: "/app/", destination: "/index.html" },
      { source: "/app/setup", destination: "/index.html" },
      { source: "/app/setup/", destination: "/index.html" },
      { source: "/app/recall", destination: "/index.html" },
      { source: "/app/recall/", destination: "/index.html" },
      { source: "/app/library", destination: "/index.html" },
      { source: "/app/library/", destination: "/index.html" },
      { source: "/app/sessions", destination: "/index.html" },
      { source: "/app/sessions/", destination: "/index.html" },
      { source: "/app/settings", destination: "/index.html" },
      { source: "/app/settings/", destination: "/index.html" },
    ]);
    expect(deployment.routes).toBeUndefined();
    expect(deployment.rewrites.some(({ source }) => source.includes("*"))).toBe(false);
    expect(
      deployment.rewrites.some(({ source }) => source === "/(.*)" || source === "/:path*"),
    ).toBe(false);
  });

  it("sets the required browser security headers", () => {
    const headers = Object.fromEntries(
      deployment.headers[0].headers.map(({ key, value }) => [key, value]),
    );

    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("worker-src 'self' blob:");
    expect(headers["Content-Security-Policy"]).toContain(
      "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
    );
    expect(headers["Content-Security-Policy"]).not.toContain("http://[::1]");
    expect(headers["Content-Security-Policy"]).not.toMatch(
      /connect-src[^;]*http:\/\/(?!localhost:\*|127\.0\.0\.1:\*)/,
    );
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  it("pins the production Transformers script source to the installed package version", () => {
    const headers = Object.fromEntries(
      deployment.headers[0].headers.map(({ key, value }) => [key, value]),
    );
    const expectedScriptSource = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${transformersPackage.version}/dist/`;

    expect(headers["Content-Security-Policy"]).toContain(
      `script-src 'self' 'unsafe-eval' ${expectedScriptSource}`,
    );
  });

  it("publishes indexable assets and excludes authenticated routes from the sitemap", () => {
    expect(fs.existsSync(path.join(root, "public/static/favicon.ico"))).toBe(true);
    expect(fs.existsSync(path.join(root, "public/static/gitstarrecall-logo.png"))).toBe(true);

    const sitemap = fs.readFileSync(path.join(root, "public/sitemap.xml"), "utf8");
    expect(sitemap).toContain("https://git-star-recall.vercel.app/");
    expect(sitemap).not.toContain("/app");
    expect(sitemap).not.toContain("/auth");
  });
});
