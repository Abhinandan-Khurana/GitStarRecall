import type { OAuthConfig } from "./githubOAuth";

export type AuthMethod = "oauth" | "pat";

export type OAuthCallbackInput = {
  code?: string;
  state?: string;
  error?: string;
};

export type AuthContextValue = {
  accessToken: string | null;
  authScopeIdentity: string | null;
  authMethod: AuthMethod | null;
  oauthConfig: OAuthConfig;
  isAuthenticated: boolean;
  beginOAuthLogin: () => Promise<void>;
  handleOAuthCallback: (input: OAuthCallbackInput) => Promise<void>;
  loginWithPat: (token: string) => Promise<void>;
  logout: () => void;
};
