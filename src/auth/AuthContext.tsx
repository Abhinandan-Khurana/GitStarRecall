import { useCallback, useMemo, useState, type PropsWithChildren } from "react";
import { buildGitHubAuthorizeUrl, exchangeOAuthCode, getOAuthConfig } from "./githubOAuth";
import {
  buildAuthStorageScope,
  buildChatBackupScope,
  buildChatScopeKey,
  buildGitHubUserScopeIdentity,
  buildLegacyTokenChatScopeKey,
  buildLegacyTokenStorageScope,
} from "./authScope";
import { AuthContext } from "./auth-context";
import type { AuthContextValue, AuthMethod, OAuthCallbackInput } from "./auth-types";
import { createGitHubApiClient } from "@/github/client";
import { migrateLocalDatabaseScope, setLocalDatabaseScope } from "@/db/client";
import { migrateChatBackupScope } from "@/db/chatBackup";
import { migrateLegacySettingsScope } from "@/lib/settings";
import { normalizeGitHubToken } from "@/lib/normalizeGitHubToken";
import { captureLocalError, clearLocalLogs } from "@/observability/localLog";

export function AuthProvider({ children }: PropsWithChildren) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authScopeIdentity, setAuthScopeIdentity] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null);

  const oauthConfig = useMemo(() => getOAuthConfig(), []);

  const beginOAuthLogin = useCallback(async () => {
    const authorizeUrl = await buildGitHubAuthorizeUrl();
    window.location.assign(authorizeUrl);
  }, []);

  const establishSession = useCallback(async (token: string, method: AuthMethod) => {
    const normalizedToken = normalizeGitHubToken(token);
    if (!normalizedToken) {
      throw new Error("GitHub token is required");
    }

    const viewer = await createGitHubApiClient({
      accessToken: normalizedToken,
    }).fetchAuthenticatedUser();
    const nextAuthScopeIdentity = buildGitHubUserScopeIdentity(viewer);
    const nextDatabaseScope = buildAuthStorageScope(nextAuthScopeIdentity);
    const legacyChatScope = buildChatBackupScope(buildLegacyTokenChatScopeKey(normalizedToken));
    const nextChatScope = buildChatBackupScope(buildChatScopeKey(nextAuthScopeIdentity));

    await migrateLocalDatabaseScope({
      fromScopeKey: buildLegacyTokenStorageScope(normalizedToken),
      toScopeKey: nextDatabaseScope,
      fromChatScopeKey: legacyChatScope?.key,
      toChatScopeKey: nextChatScope?.key,
    });
    if (legacyChatScope && nextChatScope) {
      try {
        await migrateChatBackupScope(legacyChatScope, nextChatScope);
      } catch (error) {
        // Chat backup is auxiliary to the primary database scope. Its migration
        // retains the source on failure, so login can continue and retry later.
        captureLocalError(nextAuthScopeIdentity, "chat_backup_scope_migration_failed", error);
      }
    }
    await migrateLegacySettingsScope(normalizedToken, nextAuthScopeIdentity);

    setLocalDatabaseScope(nextDatabaseScope, nextChatScope);
    setAccessToken(normalizedToken);
    setAuthScopeIdentity(nextAuthScopeIdentity);
    setAuthMethod(method);
  }, []);

  const handleOAuthCallback = useCallback(
    async (input: OAuthCallbackInput) => {
      if (input.error) {
        throw new Error(`GitHub returned an OAuth error: ${input.error}`);
      }

      if (!input.code || !input.state) {
        throw new Error("Missing OAuth code/state in callback URL");
      }

      const token = await exchangeOAuthCode({
        code: input.code,
        state: input.state,
      });

      await establishSession(token, "oauth");
    },
    [establishSession],
  );

  const loginWithPat = useCallback(
    async (token: string) => {
      await establishSession(token, "pat");
    },
    [establishSession],
  );

  const logout = useCallback(() => {
    if (authScopeIdentity) {
      clearLocalLogs(authScopeIdentity);
    }
    setLocalDatabaseScope(buildAuthStorageScope(null), null);
    setAccessToken(null);
    setAuthScopeIdentity(null);
    setAuthMethod(null);
  }, [authScopeIdentity]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      authScopeIdentity,
      authMethod,
      oauthConfig,
      isAuthenticated: Boolean(accessToken),
      beginOAuthLogin,
      handleOAuthCallback,
      loginWithPat,
      logout,
    }),
    [
      accessToken,
      authScopeIdentity,
      authMethod,
      oauthConfig,
      beginOAuthLogin,
      handleOAuthCallback,
      loginWithPat,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
