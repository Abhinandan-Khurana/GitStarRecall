import {
  useCallback,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {
  buildGitHubAuthorizeUrl,
  exchangeOAuthCode,
  getOAuthConfig,
} from "./githubOAuth";
import { AuthContext } from "./auth-context";
import type { AuthContextValue, AuthMethod, OAuthCallbackInput } from "./auth-types";

function normalizeTokenInput(raw: string): string {
  let token = raw.trim();
  token = token.replace(/^bearer\s+/i, "");
  token = token.replace(/^token\s+/i, "");
  token = token.replace(/^['"]+|['"]+$/g, "").trim();
  return token;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null);

  const oauthConfig = useMemo(() => getOAuthConfig(), []);

  const beginOAuthLogin = useCallback(async () => {
    const authorizeUrl = await buildGitHubAuthorizeUrl();
    window.location.assign(authorizeUrl);
  }, []);

  const handleOAuthCallback = useCallback(async (input: OAuthCallbackInput) => {
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

    setAccessToken(normalizeTokenInput(token));
    setAuthMethod("oauth");
  }, []);

  const loginWithPat = useCallback((token: string) => {
    const trimmed = normalizeTokenInput(token);

    if (!trimmed) {
      throw new Error("GitHub token is required");
    }

    setAccessToken(trimmed);
    setAuthMethod("pat");
  }, []);

  const logout = useCallback(() => {
    setAccessToken(null);
    setAuthMethod(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
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
