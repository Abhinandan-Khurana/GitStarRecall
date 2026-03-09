# Security Review – STRIDE Alignment

This document reviews the GitStarRecall codebase against the threats and mitigations in [threat-modeling-stride.md](./threat-modeling-stride.md). Each STRIDE category is mapped to current implementation status and concrete recommendations.

## 2026-02-24 Update (WebLLM Browser Provider)

- Added feature-flagged Browser WebLLM provider (`VITE_WEBLLM_ENABLED=1`) with explicit consent-before-download gate.
- Added typed error mapping for unsupported browser, download-required, init failure, and stream failure paths.
- Added per-auth persistence for WebLLM consent and preferred/recommended model state.
- Added model recommendation policy (mobile/no-WebGPU -> 360M; strong desktop -> 1B).
- Added deterministic fallback chain when WebLLM is unavailable (`ollama -> lmstudio -> openai-compatible`).
- Added CSP `connect-src` allowances for WebLLM artifact hosts, while preserving explicit allowlisting.
- Calibrated WebLLM capability recommendation to handle missing browser memory hints safely (common on Safari/macOS), reducing false weak-device downgrades.
- Added recommendation diagnostics visibility (`reason`, `webgpu`, `cores`, `mem`, `perf`) for transparent local runtime decisions without exposing secrets.

## 2026-02-23 Update (Embedding Pipeline v2 + Ollama Opt-in)

- Added localhost-only validation for Ollama embedding endpoints (`localhost`, `127.0.0.1`, `[::1]`), enforced in `src/embeddings/ollamaClient.ts`.
- Ollama embedding path is disabled by default and activated via explicit in-app consent toggle (UI-driven, not env-gated).
- Ollama embedding payload contains only text + model fields (no GitHub token or PAT values).
- Ollama API compatibility fallback is handled (`/api/embed` -> `/api/embeddings`).
- Embedding backend/model metadata is tracked to prevent mixed-model vector stores across runs.
- Browser embedding remains default path with automatic fallback semantics.
- Pending embedding SQL hot path now avoids CAST-based joins, reducing failure surface and improving deterministic query plans.
- Production error logging remains message-oriented while dev keeps richer diagnostics.
- README batch pipeline now uses adaptive concurrency + cooldown for rate-limit resilience (reduces abusive retry bursts).
- Conditional README revalidation headers (`If-None-Match`, `If-Modified-Since`) use repo-local validator metadata only; no auth token/session data is written to these fields.

## 2026-03-05 Update (Retrieval v2 + Model Policy)

- Added search-time strict embedding dimension compatibility checks (hard error on mismatch).
- Added retrieval v2 path:
  - dense candidate fetch (`fetchK`)
  - dense confidence gate
  - lexical safety-net branch (conditional)
  - conditional RRF fusion
  - MMR + per-repo cap reranking
- Added custom embedding model warning path for non-curated models.
- Added retrieval diagnostics payload with score summaries and trigger reasons.
- Added sudo-mode retrieval tuning controls with bounded ranges and defaults.
- Added browser embedding capability-based recommendation:
  - strong desktop + WebGPU -> `onnx-community/embeddinggemma-300m-ONNX`
  - mobile / weak / no-WebGPU / probe-failed -> `Xenova/all-MiniLM-L6-v2`
- Added visible developer advanced-mode checkbox + red warning + scoped persistence key (`gitstarrecall.sudo.<scope>`).
- Added explicit `script-src` allowance for pinned transformers jsDelivr dist path used by ORT JSEP module loading in browser embedding runtime.

Security posture notes:

- Positive: lexical branch is conditional, reducing unnecessary broadened retrieval.
- Positive: dimension mismatch now fails fast instead of silently degrading results.
- Residual: custom model path can still degrade quality if model contracts differ; warning is advisory.

## 2026-03-08 Update (Workspace Shell + Auth-Scoped Persistence)

- Reworked the authenticated product into a route-based shell (`/app/setup`, `/app/recall`, `/app/library`, `/app/sessions`, `/app/settings`) while preserving the public landing page and OAuth callback surface.
- Added a command palette and keyboard route switching, improving operator ergonomics without widening data exposure.
- Scoped browser-local database files/keys by stable GitHub account identity:
  - OPFS filenames,
  - localStorage SQLite fallbacks,
  - account-scoped continuity/settings keys.
- Preserved token handling in React memory only; browser persistence scope is derived from the authenticated GitHub user rather than the current credential string, so raw tokens are not stored and token rotation does not strand local data.
- Added scope regression tests for auth helper keys and database naming to reduce cross-identity local-data bleed risk.

## 2026-03-09 Update (GitHub Auth Normalization + Reset Semantics)

- Added shared GitHub token normalization for both OAuth callback tokens and pasted PATs:
  - strips accidental `Bearer ` / `token ` prefixes,
  - trims surrounding quotes,
  - collapses extra whitespace before in-memory use.
- Standardized GitHub API authorization around normalized raw tokens plus `Authorization: Bearer <token>` request headers.
- Updated 401 guidance to focus on invalid, expired, revoked, or incorrectly pasted tokens instead of implying extra scopes are usually required.
- Public auth/login copy now consistently frames OAuth and PAT as read-only access paths for starred public and private repositories when the authorized token can read them.
- `Delete local data` now clears scoped database state, chat backup state, and browser cache entries associated with WebLLM/model runtime artifacts.
- Legacy encrypted provider API-key migration now fails closed if `VITE_LLM_SETTINGS_ENCRYPTION_KEY` or Web Crypto support is unavailable, preserving the old record instead of silently orphaning ciphertext under the new account scope.
- Malformed legacy provider-settings JSON is now treated as unreadable historical data and discarded during one-time migration so the same parse failure does not block every future login.
- Unreadable legacy token-scoped DB snapshots are now discarded during one-time scope migration so historical corruption does not permanently block future logins.

---

## 1) S – Spoofing

| Mitigation | Status | Evidence / Gap |
|------------|--------|-----------------|
| OAuth PKCE; avoid tokens in URL | **Done** | `src/auth/githubOAuth.ts`: `buildGitHubAuthorizeUrl` uses `code_challenge` (S256) and `code_verifier` in sessionStorage; token is obtained via `exchangeOAuthCode` (server-side exchange). Callback uses only `code` and `state` from URL; token never in URL. |
| Clear separation public vs authenticated surfaces | **Done** | Public `LandingPage` remains at `/`, `AuthCallbackPage` remains at `/auth/callback`, and authenticated views now live behind `AppShell` routes (`/app/setup`, `/app/recall`, `/app/library`, `/app/sessions`, `/app/settings`). Auth token state remains in React memory; OAuth PKCE verifier/state use `sessionStorage` only for the OAuth handshake. |
| Normalize pasted OAuth/PAT input before use | **Done** | `src/lib/normalizeGitHubToken.ts` strips header-style prefixes, surrounding quotes, and extra whitespace. `src/auth/AuthContext.tsx` applies it before storing the token in React state, then resolves the authenticated GitHub user before deriving account-scoped local keys. |
| Warning banner when PAT is used; recommend OAuth | **Done** | Auth method is shown in the workspace account panel (`authMethod`: `oauth` / `pat`) and PAT sessions render an explicit warning with a GitHub OAuth action. Public landing/login copy also frames OAuth as the preferred path and PAT as a manual fallback. |
| Strict CSP | **Done** | See Tampering / CSP below. |
| Explicit opt-in for local endpoints; show endpoint origin | **Done** | `allowLocalProvider` is off by default; user must enable local providers in SessionChat model settings. Browser WebLLM additionally requires consent modal before first model download. |

---

## 2) T – Tampering

| Mitigation | Status | Evidence / Gap |
|------------|--------|-----------------|
| Sanitize README rendering | **Done** | `src/components/SafeMarkdown.tsx`: all README and chat markdown is rendered via `ReactMarkdown` with `rehypeSanitize` (no `dangerouslySetInnerHTML`). |
| CSP + no inline scripts | **Partial** | `vite.config.ts`: CSP is set in server/preview headers. `script-src` includes a pinned transformers jsDelivr dist path (instead of broad jsDelivr host access) because browser embedding runtime loads ORT JSEP module from that path. **Gaps:** (1) Production still has `script-src 'self' 'unsafe-eval'` (needed for runtime/tooling; document if intentional). (2) `style-src` includes `'unsafe-inline'` for fonts/styles. (3) No CSP in `index.html` for static hosting without Vite – if the app is deployed without Vite’s server/preview, CSP may not apply. |
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
| “Data sent” notice when remote LLMs enabled | **Done** | `src/components/SessionChat.tsx` renders a visible composer-adjacent notice when `allowRemoteProvider` is enabled: data is sent to the remote provider when the user sends a message. |
| Embedding run metadata | **Done** | `UsagePage` stores and displays embedding run metadata: backend, pool size, downshift, batch count, latency, queue depth, etc. |

No material repudiation gaps identified beyond keeping local audit/status metadata aligned with future provider surfaces.

---

## 4) I – Information Disclosure

| Mitigation | Status | Evidence / Gap |
|------------|--------|-----------------|
| External LLM off by default; explicit opt-in | **Done** | `allowRemoteProvider` and `allowLocalProvider` default to `false` in `UsagePage.tsx`; sending requires enabling the matching checkbox. |
| Send only top-K snippets to LLM | **Done** | `src/llm/providers.ts`: `TOP_K_LIMIT = 8`; `buildContextBlock` uses `snippets.slice(0, TOP_K_LIMIT)`. `UsagePage` passes `filteredResults.slice(0, 8)`. |
| Token in memory or scoped key derivation only | **Done** | `AuthContext` keeps the raw GitHub token in React state only; no token value is written to `localStorage` or SQLite. Local namespacing is derived from the authenticated GitHub account identity instead of the raw token, so token rotation does not change the persisted scope. |
| Chat backup and runtime caches remain local-only and wipeable | **Done** | Chat sessions/messages are backed up client-side (`src/db/chatBackup.ts`) using IndexedDB with localStorage fallback. No token is written to backup. `handleClearLocalData` clears scoped OPFS/localStorage DB bytes, chat backup copy, and browser cache entries used for WebLLM/model artifacts. |
| “Clear all data” and “Clear token” | **Done** | UsagePage: “Clear token” (logout) clears the in-memory GitHub credential only, preserving account-scoped local settings/workspace state for the same GitHub identity. “Delete local data” (`handleClearLocalData` → `database.clearAllData()`) is the destructive reset path for scoped DB/chat/cache state. |
| Restrict debug logs (IDs/counts/timings; no README plaintext) | **Mostly done** | GitHub client logger (DEV-only) logs page/count/total/remaining, repo `full_name`, status, and README **length** only – not token or README content. `UsagePage.tsx` now logs full error objects only in `import.meta.env.DEV`; production console output and local observability keep message-only payloads. **Residual:** sensitive material must still never be embedded into error messages themselves. |

**Recommendations:**

- Keep error constructors and thrown messages free of tokens, README text, or prompt content because local/prod observability now records message strings by design.

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
| Browser embedding path default; local Ollama explicit | **Done** | Default embedding flow is in-browser worker embedding; optional Ollama embedding is explicit and localhost-restricted. Browser WebLLM LLM path is feature-flagged and consent-gated. |

**Recommendation:** Document that OAuth scope `repo` is used for starred repos and README access, and that users using PAT should prefer a fine-grained PAT with minimal permissions (e.g. read-only for repos they need). Consider, if GitHub API allows, narrowing OAuth scopes in the future.

---

## 7) Summary Table

| STRIDE | Overall | Gaps / Follow-ups |
|--------|--------|-------------------|
| **S** Spoofing | Aligned | PAT warning banner; recommend OAuth when PAT is used. |
| **T** Tampering | Aligned | Document CSP (`unsafe-eval`); ensure CSP when not using Vite; optional embedding reconciliation. |
| **R** Repudiation | Aligned | Keep disclosure/audit copy aligned as new provider surfaces are added. |
| **I** Information Disclosure | Mostly aligned | Keep sensitive material out of error messages because local/prod logging persists message text. |
| **D** Denial of Service | Aligned | — |
| **E** Elevation of Privilege | Aligned | Document OAuth scope; recommend fine-grained PAT where applicable. |

---

## 8) Recommended Next Steps (Priority)

1. **Medium:** Document CSP (and `unsafe-eval`) and ensure CSP is applied in all deployment modes (e.g. static host).
2. **Medium:** Add embedding reconciliation (e.g. `chunks_pending + embeddings_created`) for integrity.
3. **Low:** Document OAuth scopes and fine-grained PAT guidance for users who use PAT.
4. **Low:** Keep error-message construction free of sensitive content because production/local observability stores message-only diagnostics.

This review is based on the codebase and [threat-modeling-stride.md](./threat-modeling-stride.md) as of the review date. Re-do after significant auth, LLM, or storage changes.
