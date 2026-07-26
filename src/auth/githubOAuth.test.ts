import { buildGitHubAuthorizeUrl, exchangeOAuthCode, getOAuthConfig } from "./githubOAuth";

function createSessionStorageMock(): Storage {
  const backing = new Map<string, string>();
  return {
    get length() {
      return backing.size;
    },
    clear() {
      backing.clear();
    },
    getItem(key: string) {
      return backing.has(key) ? backing.get(key)! : null;
    },
    key(index: number) {
      return [...backing.keys()][index] ?? null;
    },
    removeItem(key: string) {
      backing.delete(key);
    },
    setItem(key: string, value: string) {
      backing.set(key, value);
    },
  };
}

function oauthResponse(
  status = 200,
  payload: unknown = { access_token: "issued-token" },
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

async function createOAuthSession(): Promise<{ state: string; verifier: string }> {
  const authorizeUrl = new URL(await buildGitHubAuthorizeUrl());
  const state = authorizeUrl.searchParams.get("state");
  const verifier = sessionStorage.getItem("gitstarrecall.oauth.verifier");

  if (!state || !verifier) {
    throw new Error("OAuth test session was not created");
  }

  return { state, verifier };
}

describe("github oauth scope policy", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GITHUB_CLIENT_ID", "client-id-123");
    vi.stubEnv("VITE_GITHUB_REDIRECT_URI", "http://localhost:5173/auth/callback");
    vi.stubEnv("VITE_GITHUB_OAUTH_EXCHANGE_URL", "/api/github/oauth/exchange");
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    vi.stubGlobal("sessionStorage", createSessionStorageMock());
    vi.stubGlobal("btoa", (input: string) => Buffer.from(input, "binary").toString("base64"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(oauthResponse()));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("uses read:user as the only configured scope", () => {
    expect(getOAuthConfig().scopes).toEqual(["read:user"]);
  });

  test("buildGitHubAuthorizeUrl serializes only read:user in scope query", async () => {
    const url = await buildGitHubAuthorizeUrl();
    const parsed = new URL(url);

    expect(parsed.searchParams.get("scope")).toBe("read:user");
    expect(parsed.searchParams.get("scope")).not.toContain("repo");
  });

  test("deduplicates an in-flight exchange for the same callback payload", async () => {
    const { state } = await createOAuthSession();
    let resolveFetch!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = exchangeOAuthCode({ code: "callback-code", state });
    const second = exchangeOAuthCode({ code: "callback-code", state });

    expect(fetch).toHaveBeenCalledOnce();
    resolveFetch(oauthResponse());
    await expect(Promise.all([first, second])).resolves.toEqual(["issued-token", "issued-token"]);
  });

  test("retains PKCE state across a transient network failure and retries directly", async () => {
    const { state, verifier } = await createOAuthSession();
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(oauthResponse());

    const firstAttempt = exchangeOAuthCode({ code: "callback-code", state });
    await expect(firstAttempt).rejects.toMatchObject({ retryable: true });
    expect(sessionStorage.getItem("gitstarrecall.oauth.state")).toBe(state);

    await expect(exchangeOAuthCode({ code: "callback-code", state })).resolves.toBe("issued-token");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body))),
    ).toEqual([
      expect.objectContaining({ codeVerifier: verifier }),
      expect.objectContaining({ codeVerifier: verifier }),
    ]);
    expect(sessionStorage.getItem("gitstarrecall.oauth.state")).toBeNull();
  });

  test("times out a stalled exchange and permits a fresh retry", async () => {
    vi.useFakeTimers();
    const { state, verifier } = await createOAuthSession();
    let firstSignal: AbortSignal | undefined;

    vi.mocked(fetch)
      .mockImplementationOnce((_input, options) => {
        firstSignal = options?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          firstSignal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      })
      .mockResolvedValueOnce(oauthResponse());

    const stalledAttempt = exchangeOAuthCode({ code: "callback-code", state });
    const duplicateAttempt = exchangeOAuthCode({ code: "callback-code", state });

    expect(stalledAttempt).toBe(duplicateAttempt);
    expect(fetch).toHaveBeenCalledOnce();
    expect(firstSignal).toBeDefined();
    const timeoutRejection = expect(stalledAttempt).rejects.toMatchObject({
      retryable: true,
      message: "OAuth token exchange timed out",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await timeoutRejection;
    expect(firstSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(sessionStorage.getItem("gitstarrecall.oauth.verifier")).toBe(verifier);

    await expect(exchangeOAuthCode({ code: "callback-code", state })).resolves.toBe("issued-token");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("times out a stalled response body and permits a fresh retry", async () => {
    vi.useFakeTimers();
    const { state, verifier } = await createOAuthSession();
    let firstSignal: AbortSignal | undefined;

    vi.mocked(fetch)
      .mockImplementationOnce((_input, options) => {
        firstSignal = options?.signal ?? undefined;
        return Promise.resolve({
          ...oauthResponse(),
          json: () =>
            new Promise((_resolve, reject) => {
              firstSignal?.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
              });
            }),
        } as Response);
      })
      .mockResolvedValueOnce(oauthResponse());

    const stalledAttempt = exchangeOAuthCode({ code: "callback-code", state });
    const timeoutRejection = expect(stalledAttempt).rejects.toMatchObject({
      retryable: true,
      message: "OAuth token exchange timed out",
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(firstSignal).toBeDefined();
    await vi.advanceTimersByTimeAsync(10_000);
    await timeoutRejection;
    expect(firstSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(sessionStorage.getItem("gitstarrecall.oauth.verifier")).toBe(verifier);

    await expect(exchangeOAuthCode({ code: "callback-code", state })).resolves.toBe("issued-token");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([429, 503])("retains PKCE state after retryable HTTP %s", async (status) => {
    const { state, verifier } = await createOAuthSession();
    vi.mocked(fetch)
      .mockResolvedValueOnce(oauthResponse(status))
      .mockResolvedValueOnce(oauthResponse());

    const attempt = exchangeOAuthCode({ code: "callback-code", state });
    await expect(attempt).rejects.toMatchObject({ retryable: true });
    expect(sessionStorage.getItem("gitstarrecall.oauth.state")).toBe(state);
    expect(sessionStorage.getItem("gitstarrecall.oauth.verifier")).toBe(verifier);
    await expect(exchangeOAuthCode({ code: "callback-code", state })).resolves.toBe("issued-token");
  });

  test("retains PKCE state when a success response contains invalid JSON", async () => {
    const { state, verifier } = await createOAuthSession();
    vi.mocked(fetch).mockResolvedValueOnce({
      ...oauthResponse(),
      json: vi.fn().mockRejectedValue(new SyntaxError("invalid JSON")),
    });

    await expect(exchangeOAuthCode({ code: "callback-code", state })).rejects.toMatchObject({
      retryable: true,
      message: "OAuth token exchange returned an invalid response",
    });
    expect(sessionStorage.getItem("gitstarrecall.oauth.state")).toBe(state);
    expect(sessionStorage.getItem("gitstarrecall.oauth.verifier")).toBe(verifier);
  });

  test("clears PKCE state when a success response omits the access token", async () => {
    const { state } = await createOAuthSession();
    vi.mocked(fetch).mockResolvedValueOnce(oauthResponse(200, {}));

    await expect(exchangeOAuthCode({ code: "callback-code", state })).rejects.toThrow(
      "OAuth exchange did not return access_token",
    );
    expect(sessionStorage.getItem("gitstarrecall.oauth.state")).toBeNull();
  });

  test("clears PKCE state after terminal rejection and rejects replay", async () => {
    const { state } = await createOAuthSession();
    vi.mocked(fetch).mockResolvedValueOnce(oauthResponse(400));

    await expect(exchangeOAuthCode({ code: "callback-code", state })).rejects.toThrow(
      "OAuth token exchange failed (400)",
    );
    expect(sessionStorage.getItem("gitstarrecall.oauth.state")).toBeNull();
    await expect(exchangeOAuthCode({ code: "callback-code", state })).rejects.toThrow(
      "OAuth session was not found",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("clears PKCE state on mismatch", async () => {
    const { state } = await createOAuthSession();

    await expect(
      exchangeOAuthCode({ code: "callback-code", state: `${state}-wrong` }),
    ).rejects.toThrow("OAuth state mismatch");
    expect(sessionStorage.getItem("gitstarrecall.oauth.state")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("expires abandoned PKCE state after ten minutes", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { state } = await createOAuthSession();
    vi.mocked(Date.now).mockReturnValue(now + 10 * 60 * 1000 + 1);

    await expect(exchangeOAuthCode({ code: "callback-code", state })).rejects.toThrow(
      "OAuth session expired",
    );
    expect(sessionStorage.getItem("gitstarrecall.oauth.state")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("clears PKCE state after success so the callback cannot be replayed", async () => {
    const { state } = await createOAuthSession();

    await expect(exchangeOAuthCode({ code: "callback-code", state })).resolves.toBe("issued-token");
    await expect(exchangeOAuthCode({ code: "callback-code", state })).rejects.toThrow(
      "OAuth session was not found",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });
});
