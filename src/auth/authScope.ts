import type { GitHubAuthenticatedUser } from "../github/types";

export function hashAuthScopeToken(raw: string): string {
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash << 5) - hash + raw.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function buildGitHubUserScopeIdentity(user: Pick<GitHubAuthenticatedUser, "id" | "login">): string {
  const numericId = Number(user.id);
  if (Number.isFinite(numericId) && numericId > 0) {
    return `github:${numericId}`;
  }

  const normalizedLogin = String(user.login ?? "").trim().toLowerCase();
  if (normalizedLogin) {
    return `github-login:${normalizedLogin}`;
  }

  throw new Error("GitHub user identity is required");
}

export function buildLegacyTokenStorageScope(token: string | null): string {
  if (!token) {
    return "anon";
  }
  return `token:${hashAuthScopeToken(token)}`;
}

export function buildLegacyTokenChatScopeKey(token: string | null): string | null {
  if (!token) {
    return null;
  }
  return `chat:${hashAuthScopeToken(token)}`;
}

export function buildAuthStorageScope(scopeIdentity: string | null): string {
  if (!scopeIdentity) {
    return "anon";
  }
  return `auth:${scopeIdentity}`;
}

export function buildChatScopeKey(scopeIdentity: string | null): string | null {
  if (!scopeIdentity) {
    return null;
  }
  return `chat:${scopeIdentity}`;
}

export function buildEmbeddingPreferenceScopeKey(scopeIdentity: string | null): string {
  return buildAuthStorageScope(scopeIdentity);
}
