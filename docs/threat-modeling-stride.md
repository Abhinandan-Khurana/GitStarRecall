# GitStarRecall - Threat Modeling (STRIDE)

This document maps risks using the STRIDE model and lists mitigations aligned with the architecture and DFDs.

---

## 1) Scope and Assets

In scope:
- GitHub tokens (OAuth/PAT)
- Starred repo metadata and README content (including private repos)
- Embeddings and vector index
- Embedding model artifacts downloaded at runtime (browser cache)
- Embedding runtime selection state (`webgpu` / `wasm`) and performance diagnostics
- Browser embedding capability recommendation state (mobile/webgpu/cores/memory/perf probe)
- Optional local Ollama embedding endpoint configuration (`localhost` only)
- Developer advanced-mode (`sudo`) retrieval tuning state (scoped local persistence)
- Auth-scoped browser persistence keys and per-identity local SQLite database files
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
- Malicious local endpoint impersonates trusted local runtime.
- Unintended model artifact host access when Browser WebLLM is enabled.

Mitigations:
- Use OAuth PKCE and avoid tokens in URL.
- Clear separation between landing and login flow.
- Add warning banner when PAT is used; recommend OAuth.
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
- Private README content sent to external LLM provider unintentionally.
- Tokens leaked through logs or URL parameters.
- Local DB accessed by other scripts via XSS.
- Overly verbose debug logs expose private chunk text.

Mitigations:
- External LLM off by default, explicit opt-in.
- Browser WebLLM download is explicit opt-in; no GitHub token in request payloads.
- Send only top-K snippets, not full repo content.
- Token stored in memory or encrypted storage.
- Scope local SQLite/localStorage persistence by auth token hash so one authenticated identity does not inherit another identity's indexed corpus.
- Add “Clear all data” and “Clear token” actions.
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

### E - Elevation of Privilege
Threats:
- Over-scoped GitHub token allows repo access beyond need.
- Local LLM endpoints expose sensitive data to other local services.
- Browser origin accidentally gains unintended access to privileged local runtime endpoints.
- Browser model runtime unsupported/failing causes repeated initialization attempts.
- Capability probe misclassification can force unnecessarily weak local model selection on strong desktops.
- Unsafe advanced retrieval tuning can degrade quality/latency if accidentally enabled.

Mitigations:
- Use minimal GitHub scopes or fine-grained PAT.
- Clearly label local endpoints and require explicit opt-in.
- Keep browser embedding path default; local Ollama runtime integration remains explicit and isolated.
- Add deterministic fallback chain when WebLLM fails to avoid repeated hard-fail loops.
- Use tolerant recommendation heuristics for missing browser capability hints (e.g., Safari/macOS memory hints), plus threshold anti-flap behavior.
- Keep advanced tuning behind explicit developer checkbox + warning banner and bounded setting ranges.

---

## 3) Security Requirements Traceability

Mapped requirements:
- Local-first storage: SQLite WASM + sqlite-vec.
- Auth-scoped local persistence for SQLite and settings continuity.
- OAuth PKCE and PAT fallback with warnings.
- Explicit LLM opt-in.
- CSP and README sanitization.
- Checksums for sync integrity.
- Worker-pool and batch-size guardrails.
- Backend fallback policy (`webgpu` -> `wasm`) with telemetry.
- Capability-based browser embedding model recommendation with mobile-safe fallback.

---

## 4) Residual Risk Summary
- External LLM usage still sends data off-device by design.
- Client device compromise exposes local data.

---

## 5) Privacy Impact Assessment (PIA)

### 5.1 Data Categories
- GitHub user identity (username, avatar, profile URL)
- Starred repo metadata and README content
- Private repo content (if authorized)
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

### 5.6 Risk Assessment
- Low risk for users who keep LLMs off (local-only)
- Medium risk for users who enable remote LLMs (data leaves device)
- Mitigated by explicit opt-in and minimal top-K context
- Medium operational risk for WebGPU variability, mitigated by deterministic CPU fallback

---

## 6) Recommended Tests
- Simulate XSS in README rendering.
- Token leakage scanning (no tokens in logs).
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
