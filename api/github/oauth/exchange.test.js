import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import handler from "./exchange.js";

const EXPECTED_CLIENT_ID = "expected-client-id";
const EXPECTED_REDIRECT_URI = "https://gitstarrecall.example/auth/callback";
const VALID_VERIFIER = "v".repeat(43);

function validBody(overrides = {}) {
  return {
    code: "temporary-code",
    codeVerifier: VALID_VERIFIER,
    redirectUri: EXPECTED_REDIRECT_URI,
    clientId: EXPECTED_CLIENT_ID,
    ...overrides,
  };
}

function createRequest({
  method = "POST",
  contentType = "application/json",
  body = validBody(),
  chunks,
} = {}) {
  const request = {
    method,
    headers: contentType === null ? {} : { "content-type": contentType },
  };

  if (chunks) {
    request[Symbol.asyncIterator] = async function* streamBody() {
      for (const chunk of chunks) {
        yield chunk;
      }
    };
  } else {
    request.body = body;
  }

  return request;
}

function createResponse() {
  const headers = new Map();
  return {
    statusCode: null,
    payload: null,
    headers,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

async function invoke(request = createRequest()) {
  const response = createResponse();
  await handler(request, response);
  return response;
}

function providerResponse(payload, ok = true) {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  };
}

describe("GitHub OAuth exchange API", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_OAUTH_CLIENT_ID", EXPECTED_CLIENT_ID);
    vi.stubEnv("GITHUB_OAUTH_REDIRECT_URI", EXPECTED_REDIRECT_URI);
    vi.stubEnv("GITHUB_OAUTH_CLIENT_SECRET", "server-only-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        providerResponse({
          access_token: "issued-access-token",
          scope: "read:user",
          token_type: "bearer",
        }),
      ),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("accepts POST only and advertises the allowed method", async () => {
    const response = await invoke(createRequest({ method: "GET" }));

    expect(response.statusCode).toBe(405);
    expect(response.payload).toEqual({ error: "Method not allowed" });
    expect(response.headers.get("allow")).toBe("POST");
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([null, "text/plain", "application/x-www-form-urlencoded", "application/jsonp"])(
    "rejects unsupported content type %s",
    async (contentType) => {
      const response = await invoke(createRequest({ contentType }));

      expect(response.statusCode).toBe(415);
      expect(response.payload).toEqual({ error: "Content type must be application/json" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test("accepts an application/json content type with charset", async () => {
    const response = await invoke(
      createRequest({ contentType: "application/json; charset=utf-8" }),
    );

    expect(response.statusCode).toBe(200);
  });

  test("rejects malformed streamed JSON", async () => {
    const response = await invoke(createRequest({ chunks: [Buffer.from('{"code":')] }));

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ error: "Invalid request body" });
  });

  test("rejects a streamed request as soon as it exceeds 8 KiB", async () => {
    const response = await invoke(
      createRequest({ chunks: [Buffer.alloc(8_192), Buffer.from("x")] }),
    );

    expect(response.statusCode).toBe(413);
    expect(response.payload).toEqual({ error: "Request body too large" });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("accepts an exact 8 KiB streamed request", async () => {
    const rawBody = JSON.stringify(validBody());
    const padding = " ".repeat(8_192 - Buffer.byteLength(rawBody, "utf8"));
    const exactBoundaryBody = Buffer.from(`${rawBody}${padding}`);

    expect(exactBoundaryBody.byteLength).toBe(8_192);

    const response = await invoke(
      createRequest({
        chunks: [exactBoundaryBody.subarray(0, 4_096), exactBoundaryBody.subarray(4_096)],
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("rejects an oversized pre-parsed body", async () => {
    const response = await invoke(createRequest({ body: validBody({ code: "x".repeat(8_192) }) }));

    expect(response.statusCode).toBe(413);
    expect(response.payload).toEqual({ error: "Request body too large" });
  });

  test.each([
    [
      "missing field",
      { code: "temporary-code", codeVerifier: VALID_VERIFIER, redirectUri: EXPECTED_REDIRECT_URI },
    ],
    ["extra field", validBody({ unexpected: true })],
    ["wrong field type", validBody({ code: 42 })],
    ["short verifier", validBody({ codeVerifier: "short" })],
    ["invalid verifier characters", validBody({ codeVerifier: "!".repeat(43) })],
    ["array body", []],
    ["null body", null],
  ])("rejects an invalid exact request shape: %s", async (_label, body) => {
    const response = await invoke(createRequest({ body }));

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ error: "Invalid OAuth request" });
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    ["client ID", validBody({ clientId: "other-client" })],
    ["redirect URI", validBody({ redirectUri: "https://attacker.example/auth/callback" })],
  ])("rejects a mismatched %s without revealing which value failed", async (_label, body) => {
    const response = await invoke(createRequest({ body }));

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ error: "Invalid OAuth request" });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("returns a bounded unavailable response for invalid server configuration", async () => {
    vi.stubEnv("GITHUB_OAUTH_REDIRECT_URI", "javascript:alert(1)");

    const response = await invoke();

    expect(response.statusCode).toBe(500);
    expect(response.payload).toEqual({ error: "OAuth exchange is unavailable" });
  });

  test("returns a bounded unavailable response when the client secret is missing", async () => {
    vi.stubEnv("GITHUB_OAUTH_CLIENT_SECRET", "");

    const response = await invoke();

    expect(response.statusCode).toBe(500);
    expect(response.payload).toEqual({ error: "OAuth exchange is unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("aborts the GitHub exchange after ten seconds and returns 504", async () => {
    vi.useFakeTimers();
    fetch.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );

    const pending = invoke();
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;

    expect(response.statusCode).toBe(504);
    expect(response.payload).toEqual({ error: "OAuth provider timed out" });
  });

  test("keeps the timeout active while reading the provider response body", async () => {
    vi.useFakeTimers();
    fetch.mockImplementation((_url, options) =>
      Promise.resolve({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      }),
    );

    const pending = invoke();
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;

    expect(response.statusCode).toBe(504);
    expect(response.payload).toEqual({ error: "OAuth provider timed out" });
  });

  test("maps a provider network failure to a bounded 502 response", async () => {
    fetch.mockRejectedValue(new Error("sensitive transport detail"));

    const response = await invoke();

    expect(response.statusCode).toBe(502);
    expect(response.payload).toEqual({ error: "OAuth provider unavailable" });
  });

  test("does not echo an upstream OAuth rejection", async () => {
    fetch.mockResolvedValue(
      providerResponse(
        {
          error: "bad_verification_code",
          error_description: "sensitive provider description",
        },
        false,
      ),
    );

    const response = await invoke();

    expect(response.statusCode).toBe(502);
    expect(response.payload).toEqual({ error: "OAuth exchange failed" });
    expect(JSON.stringify(response.payload)).not.toContain("sensitive provider description");
  });

  test("maps malformed provider JSON to a bounded 502 response", async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockRejectedValue(new SyntaxError("bad JSON")),
    });

    const response = await invoke();

    expect(response.statusCode).toBe(502);
    expect(response.payload).toEqual({ error: "OAuth provider returned an invalid response" });
  });

  test("preserves the successful response shape and sends the configured values upstream", async () => {
    const response = await invoke();

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({
      access_token: "issued-access-token",
      scope: "read:user",
      token_type: "bearer",
    });
    expect(fetch).toHaveBeenCalledOnce();

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options.body)).toEqual({
      client_id: EXPECTED_CLIENT_ID,
      client_secret: "server-only-secret",
      code: "temporary-code",
      redirect_uri: EXPECTED_REDIRECT_URI,
      code_verifier: VALID_VERIFIER,
    });
  });

  test.each([
    [createRequest({ method: "GET" }), 405],
    [createRequest({ contentType: "text/plain" }), 415],
    [createRequest({ body: {} }), 400],
    [createRequest(), 200],
  ])("adds private non-cache headers to every response class", async (request, expectedStatus) => {
    const response = await invoke(request);

    expect(response.statusCode).toBe(expectedStatus);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
