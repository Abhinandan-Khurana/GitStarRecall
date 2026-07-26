const AUTH_STATE_KEY = "gitstarrecall.oauth.state";
const AUTH_VERIFIER_KEY = "gitstarrecall.oauth.verifier";
const AUTH_ISSUED_AT_KEY = "gitstarrecall.oauth.issued-at";
const AUTH_SESSION_TTL_MS = 10 * 60 * 1000;
const OAUTH_EXCHANGE_TIMEOUT_MS = 10_000;
const inFlightExchanges = new Map<string, Promise<string>>();

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

export class OAuthExchangeError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = "OAuthExchangeError";
    this.retryable = retryable;
  }
}

export function isRetryableOAuthError(error: unknown): error is OAuthExchangeError {
  return error instanceof OAuthExchangeError && error.retryable;
}

export function getOAuthConfig(): OAuthConfig {
  const redirectUri =
    import.meta.env.VITE_GITHUB_REDIRECT_URI ?? `${window.location.origin}/auth/callback`;

  return {
    clientId: import.meta.env.VITE_GITHUB_CLIENT_ID ?? "",
    redirectUri,
    scopes: ["read:user"],
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
  sessionStorage.setItem(AUTH_ISSUED_AT_KEY, String(Date.now()));

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

export function clearOAuthSession(): void {
  sessionStorage.removeItem(AUTH_STATE_KEY);
  sessionStorage.removeItem(AUTH_VERIFIER_KEY);
  sessionStorage.removeItem(AUTH_ISSUED_AT_KEY);
}

function readOAuthSession(expectedState: string): string {
  const storedState = sessionStorage.getItem(AUTH_STATE_KEY);
  const verifier = sessionStorage.getItem(AUTH_VERIFIER_KEY);
  const issuedAtRaw = sessionStorage.getItem(AUTH_ISSUED_AT_KEY);

  if (!storedState || !verifier || !issuedAtRaw) {
    clearOAuthSession();
    throw new Error("OAuth session was not found. Start login again.");
  }

  if (storedState !== expectedState) {
    clearOAuthSession();
    throw new Error("OAuth state mismatch. Start login again.");
  }

  const issuedAt = Number(issuedAtRaw);
  const age = Date.now() - issuedAt;
  if (!Number.isFinite(issuedAt) || age < 0 || age > AUTH_SESSION_TTL_MS) {
    clearOAuthSession();
    throw new Error("OAuth session expired. Start login again.");
  }

  return verifier;
}

async function performOAuthCodeExchange(args: { code: string; state: string }): Promise<string> {
  const exchangeUrl = import.meta.env.VITE_GITHUB_OAUTH_EXCHANGE_URL ?? "";

  if (!exchangeUrl) {
    throw new Error("Missing VITE_GITHUB_OAUTH_EXCHANGE_URL");
  }

  const verifier = readOAuthSession(args.state);
  const config = getOAuthConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OAUTH_EXCHANGE_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(exchangeUrl, {
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
        signal: controller.signal,
      });
    } catch (error) {
      const message = controller.signal.aborted
        ? "OAuth token exchange timed out"
        : "OAuth token exchange is temporarily unavailable";
      throw new OAuthExchangeError(message, true, { cause: error });
    }

    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        throw new OAuthExchangeError(
          `OAuth token exchange is temporarily unavailable (${response.status})`,
          true,
        );
      }
      clearOAuthSession();
      throw new Error(`OAuth token exchange failed (${response.status})`);
    }

    let payload: { access_token?: string };
    try {
      payload = (await response.json()) as { access_token?: string };
    } catch (error) {
      const message = controller.signal.aborted
        ? "OAuth token exchange timed out"
        : "OAuth token exchange returned an invalid response";
      throw new OAuthExchangeError(message, true, { cause: error });
    }

    if (!payload.access_token) {
      clearOAuthSession();
      throw new Error("OAuth exchange did not return access_token");
    }

    clearOAuthSession();
    return payload.access_token;
  } finally {
    clearTimeout(timeout);
  }
}

export function exchangeOAuthCode(args: { code: string; state: string }): Promise<string> {
  const requestKey = `${args.code}\u0000${args.state}`;
  const existing = inFlightExchanges.get(requestKey);
  if (existing) {
    return existing;
  }

  const exchange = performOAuthCodeExchange(args).finally(() => {
    inFlightExchanges.delete(requestKey);
  });
  inFlightExchanges.set(requestKey, exchange);
  return exchange;
}
