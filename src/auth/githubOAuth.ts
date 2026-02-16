const AUTH_STATE_KEY = "gitstarrecall.oauth.state";
const AUTH_VERIFIER_KEY = "gitstarrecall.oauth.verifier";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(bytes = 32): string {
  const random = new Uint8Array(bytes);
  crypto.getRandomValues(random);
  return base64UrlEncode(random);
}

async function sha256(input: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(digest);
}

export type OAuthConfig = {
  clientId: string;
  redirectUri: string;
  scopes: string[];
};

export function getOAuthConfig(): OAuthConfig {
  const redirectUri =
    import.meta.env.VITE_GITHUB_REDIRECT_URI ?? `${window.location.origin}/auth/callback`;

  return {
    clientId: import.meta.env.VITE_GITHUB_CLIENT_ID ?? "",
    redirectUri,
    scopes: ["read:user", "repo"],
  };
}

export async function buildGitHubAuthorizeUrl(): Promise<string> {
  const config = getOAuthConfig();

  if (!config.clientId) {
    throw new Error("Missing VITE_GITHUB_CLIENT_ID");
  }

  const verifier = randomString(48);
  const state = randomString(32);
  const challenge = base64UrlEncode(await sha256(verifier));

  sessionStorage.setItem(AUTH_STATE_KEY, state);
  sessionStorage.setItem(AUTH_VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    allow_signup: "false",
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export function consumeOAuthSession(expectedState: string): string {
  const storedState = sessionStorage.getItem(AUTH_STATE_KEY);
  const verifier = sessionStorage.getItem(AUTH_VERIFIER_KEY);

  sessionStorage.removeItem(AUTH_STATE_KEY);
  sessionStorage.removeItem(AUTH_VERIFIER_KEY);

  if (!storedState || !verifier) {
    throw new Error("OAuth session was not found. Start login again.");
  }

  if (storedState !== expectedState) {
    throw new Error("OAuth state mismatch. Start login again.");
  }

  return verifier;
}

export async function exchangeOAuthCode(args: {
  code: string;
  state: string;
}): Promise<string> {
  const verifier = consumeOAuthSession(args.state);
  const exchangeUrl = import.meta.env.VITE_GITHUB_OAUTH_EXCHANGE_URL ?? "";

  if (!exchangeUrl) {
    throw new Error("Missing VITE_GITHUB_OAUTH_EXCHANGE_URL");
  }

  const config = getOAuthConfig();
  const response = await fetch(exchangeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code: args.code,
      codeVerifier: verifier,
      redirectUri: config.redirectUri,
      clientId: config.clientId,
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed (${response.status})`);
  }

  const payload = (await response.json()) as { access_token?: string };

  if (!payload.access_token) {
    throw new Error("OAuth exchange did not return access_token");
  }

  return payload.access_token;
}
