import { describe, expect, it } from "vitest";
import {
  buildAuthStorageScope,
  buildChatBackupScope,
  buildChatScopeKey,
  buildEmbeddingPreferenceScopeKey,
  buildGitHubUserScopeIdentity,
  buildLegacyTokenStorageScope,
  hashAuthScopeToken,
} from "./authScope";

describe("authScope", () => {
  it("returns stable hashes for the same token", () => {
    expect(hashAuthScopeToken("abc")).toBe(hashAuthScopeToken("abc"));
    expect(hashAuthScopeToken("abc")).not.toBe(hashAuthScopeToken("def"));
  });

  it("builds stable scopes from the GitHub user identity", () => {
    const scopeIdentity = buildGitHubUserScopeIdentity({ id: 42, login: "octocat" });
    expect(scopeIdentity).toBe("github:42");
    expect(buildAuthStorageScope(scopeIdentity)).toBe("auth:github:42");
    expect(buildChatScopeKey(scopeIdentity)).toBe("chat:github:42");
    expect(buildChatBackupScope(buildChatScopeKey(scopeIdentity))).toEqual({
      key: "chat:github:42",
      legacySessionPrefix: "chat:github:42:",
    });
  });

  it("keeps legacy token-derived scopes distinct from the new user-derived scope", () => {
    expect(buildLegacyTokenStorageScope("ghp_example")).toMatch(/^token:/);
    expect(buildLegacyTokenStorageScope("ghp_example")).not.toBe(
      buildAuthStorageScope("github:42"),
    );
  });

  it("falls back to anon scope when token is missing", () => {
    expect(buildAuthStorageScope(null)).toBe("anon");
    expect(buildChatScopeKey(null)).toBeNull();
    expect(buildChatBackupScope(null)).toBeNull();
    expect(buildEmbeddingPreferenceScopeKey(null)).toBe("anon");
  });
});
