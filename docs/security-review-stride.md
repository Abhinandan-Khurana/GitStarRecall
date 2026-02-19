# Security Review – STRIDE Alignment

This document reviews the GitStarRecall codebase against the threats and mitigations in [threat-modeling-stride.md](./threat-modeling-stride.md). Each STRIDE category is mapped to current implementation status and concrete recommendations.

---

## 1) S – Spoofing

| Mitigation | Status | Evidence / Gap |
|------------|--------|-----------------|
| OAuth PKCE; avoid tokens in URL | **Done** | `src/auth/githubOAuth.ts`: `buildGitHubAuthorizeUrl` uses `code_challenge` (S256) and `code_verifier` in sessionStorage; token is obtained via `exchangeOAuthCode` (server-side exchange). Callback uses only `code` and `state` from URL; token never in URL. |
| Clear separation landing vs login | **Done** | `LandingPage` at `/`, `UsagePage` at `/app`, `AuthCallbackPage` at `/auth/callback`; auth state in React/sessionStorage. |
| Warning banner when PAT is used; recommend OAuth | **Done** | Auth method is shown in the sessions collapsible (`authMethod`: "oauth" / "pat") and there is **explicit warning** when user is logged in with PAT (e.g. “You’re using a PAT. Prefer OAuth for better security.”).
| Strict CSP | **Done** | See Tampering / CSP below. |
| Explicit opt-in for local endpoints; show endpoint origin | **Done** | `allowLocalProvider` is off by default; user must enable “Local (Ollama)” in SessionChat model settings. Base URL is user-configured and visible in the same popover. |

---

## 2) T – Tampering

| Mitigation | Status | Evidence / Gap |
|------------|--------|-----------------|
| Sanitize README rendering | **Done** | `src/components/SafeMarkdown.tsx`: all README and chat markdown is rendered via `ReactMarkdown` with `rehypeSanitize` (no `dangerouslySetInnerHTML`). |
| CSP + no inline scripts | **Partial** | `vite.config.ts`: CSP is set in server/preview headers. **Gaps:** (1) Production still has `script-src 'self' 'unsafe-eval'` (needed for some tooling; document if intentional). (2) `style-src` includes `'unsafe-inline'` for fonts/styles. (3) No CSP in `index.html` for static hosting without Vite – if the app is deployed without Vite’s server/preview, CSP may not apply. |
| Checksum format and integrity | **Done** | `src/github/checksum.ts`: `sha256Hex` and `canonicalChecksumInput`; used in `github/client.ts` for repo/README checksums. DB stores `checksum` and uses it for diffing (e.g. `UsagePage` “Diffing repos with checksum state”). |
| Write operations only through controlled paths | **Done** | DB writes go through `src/db/client.ts` (e.g. `upsertRepos`, `upsertChunks`, etc.); no raw SQL from user input. |
| Pin model source / versions | **Context** | Embedding model is loaded from Hugging Face / CDN; CSP `connect-src` restricts to known hosts. Version pinning is build/deploy concern. |
| End-to-end embedding count reconciliation | **Gap** | Threat model suggests “chunks_pending + embeddings_created” reconciliation. Code has `getPendingEmbeddingChunkCount`, batch processing, and embedding run metrics, but no explicit reconciliation step that asserts `chunks_pending + embeddings_created` consistency. |

**Recommendations:**

- Document why `unsafe-eval` is required in production CSP, or remove it if no longer needed.
- If the app is served without Vite (e.g. static export), add CSP via meta tag or server config and keep it aligned with `vite.config.ts`.
- Consider adding a reconciliation check (e.g. after sync/embedding run) that verifies pending vs created counts and surfaces or logs mismatches.

---

## 3) R – Repudiation

| Mitigation | Status | Evidence / Gap |
|------------|--------|-----------------|
| Store audit metadata locally | **Done** | Last sync and indexing state are reflected in UI (e.g. `indexingStatus`, `starsSummary`, sync phase). LLM usage is gated by `allowRemoteProvider` / `allowLocalProvider` (opt-in). |
| “Data sent” notice when remote LLMs enabled | **Gap** | Remote/Local are explicit checkboxes; sending is blocked until consent. There is **no persistent notice** when remote is enabled such as “Data will be sent to the configured remote provider.” |
| Embedding run metadata | **Done** | `UsagePage` stores and displays embedding run metadata: backend, pool size, downshift, batch count, latency, queue depth, etc. |

**Recommendation:** When `allowRemoteProvider` is true, show a short, visible notice near the chat composer (e.g. “Data is sent to the remote provider when you send a message”) so users have a clear “data sent” disclosure.

---

## 4) I – Information Disclosure

| Mitigation | Status | Evidence / Gap |
|------------|--------|-----------------|
| External LLM off by default; explicit opt-in | **Done** | `allowRemoteProvider` and `allowLocalProvider` default to `false` in `UsagePage.tsx`; sending requires enabling the matching checkbox. |
| Send only top-K snippets to LLM | **Done** | `src/llm/providers.ts`: `TOP_K_LIMIT = 8`; `buildContextBlock` uses `snippets.slice(0, TOP_K_LIMIT)`. `UsagePage` passes `filteredResults.slice(0, 8)`. |
| Token in memory or encrypted storage | **Done** | `AuthContext` keeps token in React state only; no `localStorage`/sessionStorage for token. “Clear token” and “Delete local data” are available. |
| “Clear all data” and “Clear token” | **Done** | UsagePage: “Clear token” (logout) and “Delete local data” (`handleClearLocalData` → `database.clearAllData()`). |
| Restrict debug logs (IDs/counts/timings; no README plaintext) | **Mostly done** | GitHub client logger (DEV-only) logs page/count/total/remaining, repo `full_name`, status, and README **length** only – not token or README content. **Gap:** `UsagePage.tsx` uses `console.error("Embedding generation failed", err)` and `console.error("Search failed", err)`; if any error ever includes token or user content in its message, it could leak. |

**Recommendations:**

- Avoid logging full `err` objects in production; log only `err.message` or a stable error code, and ensure error constructors never include tokens or README text.
- Optionally gate these `console.error` calls to `import.meta.env.DEV` so production builds don’t log stack/details.

---

## 5) D – Denial of Service

| Mitigation | Status | Evidence / Gap |
|------------|--------|-----------------|
| Rate limit handling with backoff | **Done** | `src/github/client.ts`: `requestWithBackoff`, `shouldRetry` (429 and 403 with remaining=0), `getRetryDelayMs` (Retry-After, x-ratelimit-reset, exponential backoff with cap 30s). |
| Concurrency caps for README fetch | **Done** | `DEFAULT_README_CONCURRENCY = 6`; pool of workers processes repos with that concurrency. |
| Chunking and truncation of huge READMEs | **Done** | `src/chunking/chunker.ts`: `MAX_README_LENGTH = 100_000`; chunk sizes and overlaps defined. |
| Web Worker for embedding | **Done** | Embeddings run in worker (`src/embeddings/worker.ts`); `Embedder` uses worker; `EmbeddingWorkerPool` uses multiple embedders. |
| Cap worker pool size and queue depth | **Done** | `EmbeddingWorkerPool`: `maxQueueSize` (default 1024), `configuredPoolSize`, `workerBatchSize`; `embedBatch` throws if `texts.length > maxQueueSize`. |
| Adaptive micro-batch downshift on failures | **Done** | Pool downshifts on memory-pressure-style errors; `WorkerPool` and `UsagePage` track downshift state and reason. |
| Deterministic fallback webgpu → wasm | **Done** | Worker/embedder supports backend preference and fallback; fallback reason is tracked in run metadata. |

No material gaps identified for DoS mitigations.

---

## 6) E – Elevation of Privilege

| Mitigation | Status | Evidence / Gap |
|------------|--------|-----------------|
| Minimal GitHub scopes / fine-grained PAT | **Context** | OAuth uses `["read:user", "repo"]` in `getOAuthConfig()`. “repo” is broad (full repo access). For “starred repos + READMEs” the threat model recommends minimal scopes or fine-grained PAT. |
| Local endpoints clearly labeled; explicit opt-in | **Done** | Local provider is labeled “Local (Ollama)” in SessionChat; base URL is user-editable in the same panel; use requires `allowLocalProvider`. |
| Browser embedding path default; local-native explicit | **Done** | Default flow is in-browser embedding (worker); no automatic local-native runtime; optional local LLM is user-configured and opt-in. |

**Recommendation:** Document that OAuth scope `repo` is used for starred repos and README access, and that users using PAT should prefer a fine-grained PAT with minimal permissions (e.g. read-only for repos they need). Consider, if GitHub API allows, narrowing OAuth scopes in the future.

---

## 7) Summary Table

| STRIDE | Overall | Gaps / Follow-ups |
|--------|--------|-------------------|
| **S** Spoofing | Aligned | PAT warning banner; recommend OAuth when PAT is used. |
| **T** Tampering | Aligned | Document CSP (`unsafe-eval`); ensure CSP when not using Vite; optional embedding reconciliation. |
| **R** Repudiation | Mostly aligned | Add explicit “data sent” notice when remote LLM is enabled. |
| **I** Information Disclosure | Mostly aligned | Restrict/sanitize `console.error` in production; avoid logging full error objects. |
| **D** Denial of Service | Aligned | — |
| **E** Elevation of Privilege | Aligned | Document OAuth scope; recommend fine-grained PAT where applicable. |

---

## 8) Recommended Next Steps (Priority)

1. **High:** When `allowRemoteProvider` is true, show a clear “data sent to remote provider” notice in the chat UI.
2. **Medium:** Replace or narrow `console.error(..., err)` so production logs never receive full error objects (log message/code only, and ensure no token/content in messages).
3. **Medium:** Document CSP (and `unsafe-eval`) and ensure CSP is applied in all deployment modes (e.g. static host).
4. **Low:** Add embedding reconciliation (e.g. chunks_pending + embeddings_created) for integrity; optional “data sent” audit line for local LLM if desired.
5. **Low:** Document OAuth scopes and fine-grained PAT guidance for users who use PAT.

This review is based on the codebase and [threat-modeling-stride.md](./threat-modeling-stride.md) as of the review date. Re-do after significant auth, LLM, or storage changes.
