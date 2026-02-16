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

Mitigations:
- Use OAuth PKCE and avoid tokens in URL.
- Clear separation between landing and login flow.
- Add warning banner when PAT is used; recommend OAuth.
- Use strict Content Security Policy (CSP).
- Require explicit opt-in for local endpoints and show endpoint origin clearly.

### T - Tampering
Threats:
- Local DB tampering (malicious extensions, XSS).
- Modified embeddings or vectors change search results.
- Injected README content leading to unsafe output.
- Model artifact tampering via untrusted CDN or MITM.
- Queue/scheduler state tampering causing dropped chunks.

Mitigations:
- Sanitize README rendering.
- Use CSP + no inline scripts.
- Validate checksum format and store checksum for integrity checks.
- Use write operations only through controlled code paths.
- Pin model source hosts and versions where possible.
- Add end-to-end embedding count reconciliation (`chunks_pending + embeddings_created`).

### R - Repudiation
Threats:
- User cannot confirm what data was fetched or sent externally.
- No record of consent to external LLM usage.
- User cannot confirm which embedding backend was active when results were generated.

Mitigations:
- Store audit metadata locally: last sync time, LLM usage toggle timestamps.
- Display a “data sent” notice when remote LLMs are enabled.
- Store embedding run metadata: backend, worker pool size, checkpoint policy version, fallback reason.

### I - Information Disclosure
Threats:
- Private README content sent to external LLM provider unintentionally.
- Tokens leaked through logs or URL parameters.
- Local DB accessed by other scripts via XSS.
- Overly verbose debug logs expose private chunk text.

Mitigations:
- External LLM off by default, explicit opt-in.
- Send only top-K snippets, not full repo content.
- Token stored in memory or encrypted storage.
- Add “Clear all data” and “Clear token” actions.
- Restrict debug logs to IDs/counts/timings; never log README plaintext by default.

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

### E - Elevation of Privilege
Threats:
- Over-scoped GitHub token allows repo access beyond need.
- Local LLM endpoints expose sensitive data to other local services.
- Browser origin accidentally gains unintended access to privileged local-native runtimes.

Mitigations:
- Use minimal GitHub scopes or fine-grained PAT.
- Clearly label local endpoints and require explicit opt-in.
- Keep browser embedding path default; local-native runtime integration remains explicit and isolated.

---

## 3) Security Requirements Traceability

Mapped requirements:
- Local-first storage: SQLite WASM + sqlite-vec.
- OAuth PKCE and PAT fallback with warnings.
- Explicit LLM opt-in.
- CSP and README sanitization.
- Checksums for sync integrity.
- Worker-pool and batch-size guardrails.
- Backend fallback policy (`webgpu` -> `wasm`) with telemetry.

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
