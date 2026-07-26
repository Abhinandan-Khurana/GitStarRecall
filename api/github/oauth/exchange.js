const MAX_BODY_BYTES = 8 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;
const REQUIRED_FIELDS = ["clientId", "code", "codeVerifier", "redirectUri"];

class RequestBodyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseJson(raw) {
  if (!raw.trim()) {
    throw new RequestBodyError(400, "Invalid request body");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestBodyError(400, "Invalid request body");
  }
}

function assertBodySize(raw) {
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    throw new RequestBodyError(413, "Request body too large");
  }
}

async function readJsonBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
      assertBodySize(raw);
      return parseJson(raw);
    }

    let serialized;
    try {
      serialized = JSON.stringify(req.body);
    } catch {
      throw new RequestBodyError(400, "Invalid request body");
    }
    if (serialized === undefined) {
      throw new RequestBodyError(400, "Invalid request body");
    }
    assertBodySize(serialized);
    return req.body;
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new RequestBodyError(413, "Request body too large");
    }
    chunks.push(buffer);
  }

  return parseJson(Buffer.concat(chunks, totalBytes).toString("utf8"));
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function validateBody(body, expectedClientId, expectedRedirectUri) {
  if (!isPlainObject(body)) {
    return false;
  }

  const keys = Object.keys(body).sort();
  if (
    keys.length !== REQUIRED_FIELDS.length ||
    keys.some((key, index) => key !== REQUIRED_FIELDS[index])
  ) {
    return false;
  }

  const { code, codeVerifier, redirectUri, clientId } = body;
  if (
    typeof code !== "string" ||
    code.length < 1 ||
    code.length > 2_048 ||
    typeof codeVerifier !== "string" ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier) ||
    typeof redirectUri !== "string" ||
    redirectUri.length < 1 ||
    redirectUri.length > 2_048 ||
    typeof clientId !== "string" ||
    clientId.length < 1 ||
    clientId.length > 256
  ) {
    return false;
  }

  if (clientId !== expectedClientId || redirectUri !== expectedRedirectUri) {
    return false;
  }

  try {
    const url = new URL(redirectUri);
    return (
      (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

function applyPrivateResponseHeaders(res) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
}

function isJsonContentType(req) {
  const raw = req.headers?.["content-type"];
  const contentType = Array.isArray(raw) ? raw[0] : raw;
  return (
    typeof contentType === "string" && /^application\/json(?:\s*;|$)/i.test(contentType.trim())
  );
}

export default async function handler(req, res) {
  applyPrivateResponseHeaders(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isJsonContentType(req)) {
    return res.status(415).json({ error: "Content type must be application/json" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    const message = status === 413 ? "Request body too large" : "Invalid request body";
    return res.status(status).json({ error: message });
  }

  const expectedClientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const expectedRedirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

  if (!expectedClientId || !expectedRedirectUri || !clientSecret) {
    return res.status(500).json({ error: "OAuth exchange is unavailable" });
  }

  try {
    const configuredRedirect = new URL(expectedRedirectUri);
    if (configuredRedirect.protocol !== "https:" && configuredRedirect.protocol !== "http:") {
      throw new Error("Unsupported redirect protocol");
    }
  } catch {
    return res.status(500).json({ error: "OAuth exchange is unavailable" });
  }

  if (!validateBody(body, expectedClientId, expectedRedirectUri)) {
    return res.status(400).json({ error: "Invalid OAuth request" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let ghResponse;
  let payload;
  try {
    ghResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: expectedClientId,
        client_secret: clientSecret,
        code: body.code,
        redirect_uri: expectedRedirectUri,
        code_verifier: body.codeVerifier,
      }),
      signal: controller.signal,
    });

    try {
      payload = await ghResponse.json();
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        return res.status(504).json({ error: "OAuth provider timed out" });
      }
      return res.status(502).json({ error: "OAuth provider returned an invalid response" });
    }
  } catch (error) {
    const timedOut =
      controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? "OAuth provider timed out" : "OAuth provider unavailable",
    });
  } finally {
    clearTimeout(timeout);
  }

  if (
    !ghResponse.ok ||
    !isPlainObject(payload) ||
    typeof payload.access_token !== "string" ||
    !payload.access_token
  ) {
    return res.status(502).json({ error: "OAuth exchange failed" });
  }

  return res.status(200).json({
    access_token: payload.access_token,
    scope: typeof payload.scope === "string" ? payload.scope : null,
    token_type: typeof payload.token_type === "string" ? payload.token_type : "bearer",
  });
}
