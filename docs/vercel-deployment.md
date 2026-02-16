# GitStarRecall - Vercel Deployment Guide

This guide deploys the app with Vercel CLI and enables GitHub OAuth PKCE token exchange through a Vercel serverless function.

## 1) Prerequisites

- Vercel account and project access.
- GitHub OAuth App created in:
  `GitHub Settings -> Developer settings -> OAuth Apps`.
- Local project path:
  `~/GitStarRecall`.

## 2) OAuth Callback Setup (GitHub)

In your GitHub OAuth App:

- Homepage URL:
  `https://<your-project>.vercel.app`
- Authorization callback URL:
  `https://<your-project>.vercel.app/auth/callback`

Important:
- Callback URL must match exactly.
- Preview URLs are ephemeral; OAuth is best tested on a stable production domain.

## 3) Required Serverless Exchange Endpoint

Created in project:
- `~/GitStarRecall/api/github/oauth/exchange.js`

Frontend should use:
- `VITE_GITHUB_OAUTH_EXCHANGE_URL=/api/github/oauth/exchange`

## 4) Link Project and Add Environment Variables

From project root:

```bash
cd ~/GitStarRecall
npx vercel
```

When prompted:
- Link to existing Vercel project or create one.

Add env vars for production (repeat with `preview` if needed):

```bash
npx vercel env add VITE_GITHUB_CLIENT_ID production
npx vercel env add VITE_GITHUB_REDIRECT_URI production
npx vercel env add VITE_GITHUB_OAUTH_EXCHANGE_URL production
npx vercel env add GITHUB_OAUTH_CLIENT_ID production
npx vercel env add GITHUB_OAUTH_CLIENT_SECRET production
npx vercel env add GITHUB_OAUTH_REDIRECT_URI production
```

Set values as:

- `VITE_GITHUB_CLIENT_ID` = `<github_oauth_client_id>`
- `VITE_GITHUB_REDIRECT_URI` = `https://<your-project>.vercel.app/auth/callback`
- `VITE_GITHUB_OAUTH_EXCHANGE_URL` = `/api/github/oauth/exchange`
- `GITHUB_OAUTH_CLIENT_ID` = `<github_oauth_client_id>`
- `GITHUB_OAUTH_CLIENT_SECRET` = `<github_oauth_client_secret>`
- `GITHUB_OAUTH_REDIRECT_URI` = `https://<your-project>.vercel.app/auth/callback`

## 5) Deploy

Preview deploy:

```bash
npx vercel
```

Production deploy:

```bash
npx vercel --prod
```

## 6) Validate Deployment

1. Open deployed URL.
2. Click OAuth login.
3. Complete GitHub consent.
4. Confirm redirect to `/auth/callback` then `/app`.
5. Confirm `Fetch Stars` works.

## 7) Common Issues

1. `Missing VITE_GITHUB_OAUTH_EXCHANGE_URL`:
- Env var missing at build time. Add in Vercel and redeploy.

2. OAuth mismatch error:
- `redirect_uri` or `client_id` mismatch between frontend and server env.

3. Works locally but not on preview:
- GitHub callback URL usually points to production domain only.
- Use PAT on preview, OAuth on production domain.

4. Env updated but app still uses old values:
- `VITE_*` variables are build-time. Redeploy after changes.
