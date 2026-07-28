# GitStarRecall - Threat Modeling (STRIDE)

This document maps risks using the STRIDE model and lists mitigations aligned with the architecture and DFDs.

---

## 1) Scope and Assets

In scope:

- GitHub tokens (OAuth/PAT)
- Starred public-repo metadata and README content
- Embeddings and vector index
- Embedding model artifacts downloaded at runtime (browser cache)
- Embedding runtime selection state (`webgpu` / `wasm`) and performance diagnostics
- Browser embedding capability recommendation state (mobile/webgpu/cores/memory/perf probe)
- Optional local Ollama embedding endpoint configuration (`localhost` only)
- Developer advanced-mode (`sudo`) retrieval tuning state (scoped local persistence)
- GitHub-account-scoped browser persistence keys and per-identity local SQLite database files
- Optional Browser WebLLM model runtime and downloaded model artifacts
- Chat sessions and messages
- User queries

Out of scope:

- GitHub platform internals
- Third-party LLM provider infrastructure

---

## 2) STRIDE Analysis

### S - Spoofing

Threats:

- Attacker impersonates user in the browser (session spoofing).
- Malicious site tricks user into pasting PAT into a fake UI.
- User pastes a header-form or quoted token value and auth flow misinterprets it, leading to avoidable 401s and unsafe retry behavior.
- Malicious local endpoint impersonates trusted local runtime.
- Unintended model artifact host access when Browser WebLLM is enabled.

Mitigations:

- Use OAuth PKCE and avoid tokens in URL.
- Clear separation between landing and login flow.
- Add warning banner when PAT is used; recommend OAuth.
- Normalize OAuth/PAT token input before use (strip `Bearer ` / `token ` prefixes, quotes, and extra whitespace).
- Use strict Content Security Policy (CSP).
- Require explicit opt-in for local endpoints and show endpoint origin clearly.
- Enforce localhost-only allowlist for Ollama embedding service base URL.
- Gate Browser WebLLM behind explicit feature flag and user consent-before-download.

### T - Tampering

Threats:

- Local DB tampering (malicious extensions, XSS).
- Modified embeddings or vectors change search results.
- Injected README content leading to unsafe output.
- Model artifact tampering via untrusted CDN or MITM.
- Queue/scheduler state tampering causing dropped chunks.
- Runtime script load blocked by CSP drift (ORT module load failure).

Mitigations:

- Sanitize README rendering.
- Use CSP + no inline scripts.
- Validate checksum format and store checksum for integrity checks.
- Use write operations only through controlled code paths.
- Pin model source hosts and versions where possible.
- Restrict CSP `connect-src` to required model artifact hosts only.
- Restrict CSP `script-src` to required runtime module hosts (including jsDelivr for ORT JSEP).
- Add end-to-end embedding count reconciliation (`chunks_pending + embeddings_created`).

### R - Repudiation

Threats:

- User cannot confirm what data was fetched or sent externally.
- No record of consent to external LLM usage.
- No record of Browser WebLLM model-download consent.
- User cannot confirm which embedding backend was active when results were generated.

Mitigations:

- Store audit metadata locally: last sync time, LLM usage toggle timestamps.
- Display a “data sent” notice when remote LLMs are enabled.
- Store and restore per-auth WebLLM consent + model preference locally.
- Store embedding run metadata: backend, worker pool size, checkpoint policy version, fallback reason.

### I - Information Disclosure

Threats:

- README content sent to external LLM provider unintentionally.
- Tokens leaked through logs or URL parameters.
- Local DB accessed by other scripts via XSS.
- Overly verbose debug logs expose sensitive chunk text.
- Local reset leaves browser-cached model/runtime artifacts behind after the user expects a full wipe.

Mitigations:

- External LLM off by default, explicit opt-in.
- Browser WebLLM download is explicit opt-in; no GitHub token in request payloads.
- Send only top-K snippets, not full repo content.
- Keep GitHub tokens in memory only; provider/API-key settings may use scoped local storage with optional encryption support when configured.
- Discard malformed legacy provider-settings JSON during one-time scope migration so unreadable historical records do not permanently block login.
- Fail closed if encrypted provider settings cannot be safely re-encrypted during legacy-scope migration; preserve the legacy record instead of silently copying ciphertext to the wrong key scope.
- Scope local SQLite/localStorage persistence by stable GitHub account identity so one authenticated identity does not inherit another identity's indexed corpus, while OAuth/PAT rotation for the same account keeps the same workspace.
- Add “Clear all data” and “Clear token” actions.
- Keep “Clear token” limited to signing out; reserve destructive local-data deletion for “Delete local data”.
- Clear browser cache entries used for WebLLM/model artifacts during `Delete local data`.
- Restrict debug logs to IDs/counts/timings; never log README plaintext by default.
- Ollama embedding request payload must not include GitHub tokens or PAT values.

### D - Denial of Service

Threats:

- GitHub API rate-limits block sync.
- Large number of stars (1k+) causes UI freeze.
- Long README content creates memory pressure.
- Worker pool over-parallelization causes memory exhaustion.
- WebGPU driver/runtime instability causes repeated failures.

Mitigations:

- Rate limit handling with backoff.
- Concurrency caps for README fetching.
- Chunking and truncation of huge README files.
- Web Worker for embedding.
- Cap worker pool size and queue depth.
- Adaptive micro-batch downshift on failures.
- Deterministic fallback from `webgpu` to `wasm`.
- Preload pending chunk queue once per run to avoid repeated hot-loop DB scans.
- Buffer embedding writes to reduce checkpoint overhead and main-thread contention.
- Discard unreadable legacy token-scoped DB snapshots during one-time scope migration so corrupt historical data does not permanently block login.

### E - Elevation of Privilege

Threats:

- Over-scoped GitHub token allows repo access beyond need.
- Local LLM endpoints expose sensitive data to other local services.
- Browser origin accidentally gains unintended access to privileged local runtime endpoints.
- Browser model runtime unsupported/failing causes repeated initialization attempts.
- Capability probe misclassification can force unnecessarily weak local model selection on strong desktops.
- Unsafe advanced retrieval tuning can degrade quality/latency if accidentally enabled.
- Misleading auth troubleshooting guidance nudges users toward creating broader-scope tokens when the real issue is token validity or formatting.

Mitigations:

- Use minimal GitHub scopes or fine-grained PAT.
- Clearly label local endpoints and require explicit opt-in.
- Keep browser embedding path default; local Ollama runtime integration remains explicit and isolated.
- Add deterministic fallback chain when WebLLM fails to avoid repeated hard-fail loops.
- Use tolerant recommendation heuristics for missing browser capability hints (e.g., Safari/macOS memory hints), plus threshold anti-flap behavior.
- Keep advanced tuning behind explicit developer checkbox + warning banner and bounded setting ranges.
- Focus 401 guidance on invalid, expired, revoked, or incorrectly pasted tokens before recommending broader-scope credential changes.

---

## 3) Security Requirements Traceability

Mapped requirements:

- Local-first storage: SQLite WASM via sql.js, persisted to OPFS with a scoped localStorage snapshot
  fallback. Embeddings are Float32 blobs in ordinary tables ranked in-process (exact cosine + MMR);
  no `sqlite-vec` extension is used.
- GitHub-account-scoped local persistence for SQLite and settings continuity.
- Shared GitHub token normalization before in-memory storage/use.
- OAuth PKCE and PAT fallback with warnings.
- Explicit LLM opt-in.
- CSP and README sanitization.
- Checksums for sync integrity.
- Worker-pool and batch-size guardrails.
- Backend fallback policy (`webgpu` -> `wasm`) with telemetry.
- Capability-based browser embedding model recommendation with mobile-safe fallback.
- Full local reset includes chat-backup and runtime-cache cleanup.

---

## 4) Residual Risk Summary

- External LLM usage still sends data off-device by design.
- Client device compromise exposes local data.

---

## 5) Privacy Impact Assessment (PIA)

### 5.1 Data Categories

- GitHub user identity (username, avatar, profile URL)
- Starred repo metadata and README content
- Public repo content
- Chat session history and user queries
- Local embeddings and vector index

### 5.2 Purpose of Processing

- Local-first semantic search over user’s starred repositories
- Optional LLM-based summaries and recommendations
- Sync and integrity validation of starred repo data

### 5.3 Data Storage and Retention

- Stored locally in browser (SQLite WASM + OPFS where available)
- No server-side retention unless user opts in
- User can delete all data at any time

### 5.4 Data Sharing

- None by default
- Optional sharing with external LLM providers (explicit opt-in only)
- Optional sharing with local LLM endpoints (explicit opt-in only)

### 5.5 User Rights and Controls

- Clear toggle for remote/local LLM usage
- “Clear all data” and “Clear token” actions
- Visible disclosure when data is sent externally
- Local data reset also clears WebLLM/model runtime caches where supported

### 5.6 Risk Assessment

- Low risk for users who keep LLMs off (local-only)
- Medium risk for users who enable remote LLMs (data leaves device)
- Mitigated by explicit opt-in and minimal top-K context
- Medium operational risk for WebGPU variability, mitigated by deterministic CPU fallback

---

## 6) Recommended Tests

- Simulate XSS in README rendering.
- Token leakage scanning (no tokens in logs).
- Token normalization coverage for `Bearer ` / `token ` / quoted GitHub token pastes.
- CORS failure handling for local LLMs.
- Diff sync correctness (removals + updates).
- Worker pool pressure tests (queue growth, memory behavior).
- Checkpoint durability tests (forced reload before/after checkpoint).
- WebGPU failure injection and fallback correctness tests.

---

## 7) Retrieval v2 Threat Delta (2026-03-05)

New/changed components:

- Dense confidence gate in query-time retrieval.
- Conditional lexical safety-net branch.
- Conditional RRF fusion stage.
- MMR + per-repo cap reranking stage.
- Advanced retrieval tuning controls (sudo mode).
- Retrieval diagnostics payload (dimensions, trigger reasons, top-score summary).

Threat notes:

- Misconfigured tuning can increase latency or reduce relevance quality.
- Incompatible custom embedding model assumptions can degrade retrieval quality.
- Overly verbose diagnostics could expose sensitive content if not sanitized.

Mitigations:

- Clamp tuning ranges and provide safe defaults.
- Enforce strict query/index dimension compatibility checks.
- Show explicit warning for custom model path.
- Keep diagnostics text-free by default (IDs, counts, dimensions, scores only).

---

## 8) Auth Input + Reset Threat Delta (2026-03-09)

New/changed components:

- Shared `normalizeGitHubToken` helper for OAuth callback tokens and pasted PATs.
- GitHub API requests standardized on normalized raw tokens plus `Authorization: Bearer <token>`.
- Public auth/login surfaces now describe OAuth and PAT as read-only access paths for starred public repositories.
- Local data deletion clears scoped DB state, chat backups, and browser cache entries used for WebLLM/model artifacts.

Threat notes:

- Misformatted pasted tokens should not trigger avoidable auth failure loops or push users toward broader-scope replacement tokens.
- A user-requested local wipe should also remove cached model artifacts so the residual on-device footprint matches UI expectations.

Mitigations:

- Strip header-style prefixes, quotes, and extra whitespace before using GitHub tokens.
- Keep raw GitHub tokens in memory only and derive scoped local keys from the authenticated GitHub account identity rather than persisting the raw value or tying persistence to rotating credentials.
- Keep 401 remediation focused on token validity/formatting issues before scope expansion.
- Clear browser runtime/model caches during local data reset.

---

## 9) v0.14.0 Public-Launch Threat Delta (2026-07-28)

Covers the lean remediation program (PRs #46, #47, #54, #55, #56). Per-commit evidence and the list of
deliberately deferred work: [`remediation/v0.14.0.md`](./remediation/v0.14.0.md).

New/changed components:

- Serverless OAuth exchange endpoint hardened at the request boundary (`api/github/oauth/exchange.js`).
- Production security headers served from `vercel.json`, and explicit entry-route rewrites replacing the
  catch-all SPA rewrite.
- Single-writer storage: a Web Locks exclusive lease per scope (`acquireWriterLease`,
  `LocalDatabaseWriterLeaseError`), plus a serialized workspace persistence queue.
- Per-identity scoping extended to chat backups, local diagnostic logs, provider settings, and preferences.
- Confirmed, category-enumerating local-data deletion with partial-failure reporting.
- Embedding integrity enforcement: one current embedding per chunk with model/dimension/coverage validation.
- Lazily loaded authenticated route chunks behind a Suspense boundary.

Threat notes:

| Category | Threat                                                                                                                          | Mitigation                                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T        | Two tabs on one scope interleave whole-database exports, so the later writer silently discards the earlier one's committed rows | One writing tab per scope via a Web Locks exclusive lease; a second tab is refused writes instead of last-writer-wins. Writes are serialized through a single persistence queue so the newest acknowledged mutation is the durable one |
| T        | Unbounded or non-JSON request bodies to the exchange endpoint, or a hung upstream call                                          | POST-only, JSON content-type check, 8 KiB body cap returning 413, exact field validation, and an `AbortController` upstream timeout                                                                                                    |
| I        | A cross-identity read of local data on a shared browser profile                                                                 | Database file/key, chat backups, logs, provider settings, and preferences are all scoped per authenticated GitHub identity; a scoped clear fails closed rather than reporting success                                                  |
| I        | Diagnostic logs retaining tokens, README text, or query strings                                                                 | Error details are dropped entirely at capture; warning payloads are reduced to an allowlisted set of numeric and boolean fields; entries are capped at 200 and expire after 7 days                                                     |
| I        | An unknown public path returning a 200 HTML shell, exposing authenticated route structure to crawlers                           | Explicit entry-route rewrites; unknown paths return a real 404, and authenticated routes are absent from the sitemap                                                                                                                   |
| R        | Deletion reporting success while data survives                                                                                  | Every category is attempted, failures are collected per category and surfaced, sign-out happens only on full success, and OPFS removal failures propagate rather than being swallowed                                                  |
| E        | A stale or mixed-model vector store producing meaningless similarity scores                                                     | One current embedding per chunk enforced, with model, dimension, and coverage readiness validation, plus a hard query/index dimension guard                                                                                            |

Residual risks accepted in this release:

- The Web Locks lease resolves as available when `navigator.locks` is absent, so a browser without Web
  Locks does not fail closed for a second writer.
- `migrateLocalDatabaseScope` still treats OPFS cleanup as best effort, so a stale snapshot can survive
  the scope-migration path even though `clearAllData` now propagates failures.
- `clearAllData` swaps the in-memory database before removing persisted bytes, so a failed deletion
  leaves an empty in-memory view over surviving persisted rows, reported as a partial deletion.
- The production CSP retains `'unsafe-eval'`, which the in-browser model runtimes require. This is a
  documented runtime-compatibility trade-off, not a separate ADR.
- Whether a platform-side rate limit is enabled for `/api/github/oauth/exchange` is not verifiable from
  this repository; no in-tree limiter was added.
