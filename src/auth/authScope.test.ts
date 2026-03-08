import { describe, expect, it } from "vitest";
import {
  buildAuthStorageScope,
  buildChatScopeKey,
  buildEmbeddingPreferenceScopeKey,
  hashAuthScopeToken,
} from "./authScope";

describe("authScope", () => {
  it("returns stable hashes for the same token", () => {
    expect(hashAuthScopeToken("abc")).toBe(hashAuthScopeToken("abc"));
    expect(hashAuthScopeToken("abc")).not.toBe(hashAuthScopeToken("def"));
  });

  it("builds isolated scopes for authenticated tokens", () => {
    const scope = buildAuthStorageScope("ghp_example");
    expect(scope).toMatch(/^token:/);
    expect(scope).not.toBe(buildAuthStorageScope("ghp_other"));
  });

  it("falls back to anon scope when token is missing", () => {
    expect(buildAuthStorageScope(null)).toBe("anon");
    expect(buildChatScopeKey(null)).toBeNull();
    expect(buildEmbeddingPreferenceScopeKey(null)).toBe("anon");
  });
});
