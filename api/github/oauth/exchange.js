async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid request body",
    });
  }

  const { code, codeVerifier, redirectUri, clientId } = body;

  const expectedClientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const expectedRedirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

  if (!code || !codeVerifier || !redirectUri || !clientId) {
    return res.status(400).json({ error: "Missing OAuth fields" });
  }

  if (!expectedClientId || !expectedRedirectUri || !clientSecret) {
    return res.status(500).json({ error: "Server OAuth env not configured" });
  }

  if (clientId !== expectedClientId || redirectUri !== expectedRedirectUri) {
    return res.status(400).json({ error: "OAuth client/redirect mismatch" });
  }

  const ghResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: expectedClientId,
      client_secret: clientSecret,
      code,
      redirect_uri: expectedRedirectUri,
      code_verifier: codeVerifier,
    }),
  });

  const payload = await ghResponse.json();

  if (!ghResponse.ok || !payload.access_token) {
    return res.status(400).json({
      error: payload.error || "OAuth exchange failed",
      error_description: payload.error_description || null,
    });
  }

  return res.status(200).json({
    access_token: payload.access_token,
    scope: payload.scope ?? null,
    token_type: payload.token_type ?? "bearer",
  });
}
