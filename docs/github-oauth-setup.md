# GitHub OAuth Setup (Task 2)

Use this setup before testing OAuth login in the app.

## 1) Create OAuth App
1. Open GitHub settings: `Settings -> Developer settings -> OAuth Apps -> New OAuth App`.
2. Set homepage URL to your local/dev URL (example: `http://localhost:5173`).
3. Set authorization callback URL to `http://localhost:5173/auth/callback`.
4. Create the app and copy the client ID.

## 2) Configure Environment
1. Copy `.env.example` to `.env`.
2. Set `VITE_GITHUB_CLIENT_ID`.
3. Confirm `VITE_GITHUB_REDIRECT_URI` matches GitHub callback exactly.
4. Set `VITE_GITHUB_OAUTH_EXCHANGE_URL` to your backend token exchange endpoint.

## 3) Token Exchange Endpoint Contract
The frontend sends:

```json
{
  "code": "<oauth code>",
  "codeVerifier": "<pkce verifier>",
  "redirectUri": "http://localhost:5173/auth/callback",
  "clientId": "<github client id>"
}
```

Endpoint must return:

```json
{
  "access_token": "<github access token>"
}
```

## 4) Validate
1. Click `Connect GitHub`.
2. Complete GitHub consent screen.
3. Ensure callback returns to `/app`.
4. Verify usage page indicates authenticated state.
