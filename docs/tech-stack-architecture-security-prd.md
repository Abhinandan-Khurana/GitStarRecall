# GitStarRecall - Tech Stack, Architecture, Security, Threat Model, PRD

This document defines the recommended tech stack, architecture, security approach, threat model, and product requirements for GitStarRecall.

Design reference:
- The HTML/CSS in `rought-UI-design` is a reference only, not a pixel-perfect target.
- The final UI should incorporate creative improvements while respecting the overall layout intent.
- Emphasize security and local-first behavior visually and in copy.
- Use a landing page UI that routes to a usage page after GitHub OAuth login.
- Landing page is accessible without login, with developer/security-friendly details and a demo video.

---

## 1) Tech Stack (Recommended)

### 1.1 Frontend (Web App)
- Framework: Vite + React
- Language: TypeScript
- Styling: Tailwind CSS or Panda CSS
- State/Data: TanStack Query for API caching and retries
- Routing: React Router
- Markdown rendering: `react-markdown` + `rehype-sanitize`
- Background tasks: Web Workers for embedding and indexing

### 1.2 Client-Side Storage and Search
- Storage: SQLite WASM (browser) with persistent file storage (OPFS where available)
- Cache: In-memory LRU for hot queries
- Vector index: `sqlite-vec` via `sqlite-vec-wasm` (WASM-compatible)
- Text chunking: simple tokenizer with overlap (e.g., 500-800 chars, 80-120 overlap)
- Fallbacks:
  - If OPFS is unavailable, use in-memory SQLite with export/import.
  - If `sqlite-vec-wasm` fails to load, use a temporary brute-force similarity search.
  - Note: sqlite-vec must be statically compiled into the SQLite WASM build (no dynamic extension loading in WASM).

### 1.3 Embeddings (Local-First)
- Primary: @xenova/transformers
- Model: `all-MiniLM-L6-v2` (384 dims) for speed/accuracy balance
- Runtime backend policy:
  - Preferred: browser `webgpu` (when available and healthy)
  - Fallback: browser `wasm` CPU
- Execution policy:
  - Micro-batch embedding requests (`8..32`, adaptive target `16`)
  - Small worker pool (`2` workers default, auto-downshift to `1` on pressure)
  - Checkpointed SQLite persistence (interval-based, not every mini write)
- Fallback: server embeddings (optional, opt-in)

### 1.4 Backend (Optional Hybrid)
- API layer: Next.js API routes or Fastify
- OAuth callback handling for GitHub login
- Provider gateway for LLM calls (optional)
- Rate limiting and request normalization

### 1.5 LLM Provider Abstraction
- Remote providers: OpenAI, Anthropic, Gemini, DeepSeek, etc.
- Local providers: Ollama and LM Studio (optional)
- Streaming responses with abort support
- Provider interface with consistent request/response shape
- Unified prompt contract: `system`, `user`, `context` (top-K chunks)
- Transport:
  - Remote: HTTPS via provider SDK or REST
  - Local: HTTP to `http://localhost` endpoints

### 1.6 Local Provider Integration (Ollama, LM Studio)
- Ollama:
  - Default base URL: `http://localhost:11434`
  - Model list and availability: `GET /api/tags`
  - Generate (stream): `POST /api/generate`
  - Chat (stream): `POST /api/chat`
- LM Studio:
  - Default base URL: `http://localhost:1234`
  - OpenAI-compatible API:
    - Models: `GET /v1/models`
    - Chat: `POST /v1/chat/completions` (stream supported)
- Local providers should be opt-in and clearly labeled as "Local" in UI.
- If local endpoint is unreachable, fallback to "provider not available" state.
- CORS note: ensure local endpoints allow browser access or provide a local proxy option if needed.

### 1.7 GitHub API
- Endpoints:
  - `GET /user/starred` for user stars (paginated)
  - `GET /repos/{owner}/{repo}/readme` for README
  - `GET /repos/{owner}/{repo}` for repo metadata (if needed)
- Auth: OAuth (PKCE) or fine-grained PAT
- Permissions: `Starring` + `Contents` read for private repos (or full `repo` scope)

### 1.8 Cross-Platform Compute Compatibility
Browser-only (default local-first path):
- Windows/macOS/Linux: WebGPU when available; automatic fallback to WASM CPU
- Browser WebGPU maps to OS-native GPU stack:
  - Windows: Direct3D-based WebGPU backend
  - macOS: Metal-based WebGPU backend
  - Linux: Vulkan-based WebGPU backend

Optional local runtime path (future enhancement):
- Windows/Linux NVIDIA: CUDA via local runtime (Ollama/LM Studio runtime-managed)
- macOS Apple Silicon: Metal/MPS-style acceleration via local runtime
- CPU fallback on all platforms

Reference:
- Detailed rollout and tradeoffs: `docs/embedding-acceleration-plan.md`

---

## 2) Architecture

### 2.1 High-Level Flow
1. User authenticates with GitHub OAuth or provides a PAT.
2. App fetches all starred repositories via GitHub REST API (paginated).
3. For each repo, fetch README and metadata.
4. Chunk README + metadata.
5. Embedding orchestrator schedules micro-batches to worker pool (preferred backend `webgpu`, fallback `wasm`).
6. Store embeddings and repo metadata in SQLite WASM and build vector index.
7. Checkpoint DB periodically and flush on completion.
8. User query is embedded locally and run against the local vector index.
9. Top-K results are shown immediately; optionally, the user can ask an LLM to summarize or suggest.
10. Each query can open a new chat session, and users can also continue an existing session with follow-up queries.
11. On each new query, re-check star data and sync diffs using checksums.

### 2.2 Components
- UI: search, filters, results, suggestions
- Chat session manager: per-query threads, history, and context window
- GitHub client: fetcher with rate-limit handling and retries
- Embedding orchestrator: batching, queueing, worker-pool scheduling, backend selection, checkpoint coordination
- Indexing workers: chunk embedding execution
- Local storage: SQLite WASM DB (repos, chunks, embeddings, index)
- Vector search: `sqlite-vec` via `sqlite-vec-wasm`
- Sync engine: checksum-based repo diffing and incremental updates
- Provider gateway (optional): handles LLM calls and OAuth callback

### 2.3 Data Model (Simplified)
- Repo
  - id, full_name, name, description, topics, language, html_url
  - stars, forks, updated_at, readme_url
  - checksum (repo metadata + README hash)
- ChatSession
  - id, query, created_at, updated_at
- ChatMessage
  - session_id, role (user/assistant), content, sequence, created_at
- Chunk
  - repo_id, chunk_id, text, source (readme/metadata), embedding vector
- Index
  - vector index metadata, extension version, model info, created_at
- IndexMeta (extended)
  - `embedding_backend` (`webgpu` or `wasm`)
  - `embedding_pool_size`
  - `checkpoint_policy_version`
  - `last_checkpoint_at`
  - `embedding_perf_last_run` (JSON summary)

### 2.3.1 Chat Schema Sketch (SQLite)
Example tables for persistence:

```sql
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX chat_messages_session_idx ON chat_messages(session_id);
CREATE INDEX chat_messages_order_idx ON chat_messages(session_id, created_at, sequence);
```

Notes:
- Timestamps use UNIX epoch milliseconds (INTEGER).
- Message ordering is by `(created_at, sequence)` ascending within a session.
- UI should show a session list and a selected session thread; users can start new sessions or continue an existing one.

### 2.3.2 Vector Storage + sqlite-vec-wasm (Implementation Note)
Loading sqlite-vec-wasm (high level):
- Initialize a SQLite WASM build that already includes sqlite-vec (static compile).
- Create a vector table and insert embeddings as float arrays.

Use the latest stable `sqlite-vec-wasm` release from the official sqlite-vec project (avoid alpha builds unless needed). Re-check for newer stable versions before release. If needed, build a custom SQLite WASM bundle with sqlite-vec compiled in. The `sqlite-vec-wasm-demo` package is a demo and may change at any time, so treat it as a prototype reference only.

Concrete init example (browser, demo package):

```ts
import initSqliteVec from "https://cdn.jsdelivr.net/npm/sqlite-vec-wasm-demo@latest/sqlite3.mjs";

const sqlite3 = await initSqliteVec();
const db = new sqlite3.oo1.DB(":memory:");
// sqlite-vec is already compiled in here.
```

Example schema (vectors stored in SQLite using sqlite-vec `vec0`, 384-dim vectors):

```sql
CREATE TABLE repo_chunks (
  chunk_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  text TEXT NOT NULL
);

-- sqlite-vec virtual table with metadata columns
CREATE VIRTUAL TABLE vec_chunks USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding float[384] distance_metric=cosine,
  repo_id TEXT,
  language TEXT
);
```

Example queries (vec0 KNN):

```sql
-- Insert vectors (JSON array or compact binary format)
INSERT INTO vec_chunks (chunk_id, embedding, repo_id, language)
VALUES (?, ?, ?, ?);

-- KNN search with filtering
SELECT
  chunk_id,
  distance,
  repo_id
FROM vec_chunks
WHERE embedding MATCH :query_vec
  AND k = 20
  AND language = 'TypeScript'
ORDER BY distance ASC;

-- Join back to full text
WITH knn AS (
  SELECT chunk_id, distance
  FROM vec_chunks
  WHERE embedding MATCH :query_vec
    AND k = 20
)
SELECT rc.repo_id, rc.text, knn.distance
FROM knn
JOIN repo_chunks rc ON rc.chunk_id = knn.chunk_id
ORDER BY knn.distance ASC;
```

Notes:
- `vec0` supports metadata columns for filtering in the same query.
- Store embeddings as float32 arrays (binary) for speed and size.
- Prefer `k = N` for KNN queries; `LIMIT N` only works on SQLite 3.41+.
- sqlite-vec is pre-v1; expect breaking changes and pin versions.

TypeScript helper (Float32 -> BLOB for sqlite-vec-wasm):

```ts
// Convert Float32Array to Uint8Array for BLOB insertion.
export function float32ToBlob(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

// Optional: L2-normalize to keep cosine similarity stable.
export function l2Normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

// Example insert (pseudo-code)
// const embeddingBlob = float32ToBlob(embeddingFloat32);
// db.exec({
//   sql: "INSERT INTO vec_chunks (chunk_id, embedding, repo_id, language) VALUES (?, ?, ?, ?)",
//   bind: [chunkId, embeddingBlob, repoId, language],
// });

// Example query (pseudo-code)
// const queryVec = l2Normalize(queryEmbeddingFloat32);
// const queryBlob = float32ToBlob(queryVec);
// db.exec({
//   sql: "SELECT chunk_id, distance FROM vec_chunks WHERE embedding MATCH ? AND k = 20",
//   bind: [queryBlob],
// });
```

Normalization note:
- If the vector distance metric is cosine similarity, L2-normalize both stored embeddings and query vectors.
- If the metric is dot-product, normalization may be skipped (or still used for stability).
- Align normalization with the sqlite-vec distance mode used in your build.

Default distance mode recommendation:
- Use `distance_metric=cosine` on the `vec0` table and L2-normalize embeddings and queries.
- This preserves semantic similarity behavior for text embeddings and avoids scale sensitivity.

### 2.3.3 Why HNSW Is Not Used (Browser Compatibility)
- HNSW extensions in SQLite are typically native-first and lack reliable browser WASM builds.
- `sqlite-vec-wasm` is designed for browser compatibility and avoids backend dependencies.
- This preserves the local-first, privacy-centric goal while keeping acceptable retrieval quality.

### 2.3.4 Build Recipe (SQLite WASM + sqlite-vec)
Goal: produce a browser-compatible SQLite WASM bundle with sqlite-vec compiled in.

Prereqs:
- SQLite source tree (full checkout, not amalgamation-only).
- Emscripten SDK installed and activated.
- sqlite-vec source (single C file extension).

Steps (high-level, from upstream guidance):
1. Build SQLite WASM from the SQLite source tree:
   - `./configure --enable-all`
   - `make sqlite3.c`
   - `cd ext/wasm`
   - `make` (builds `sqlite3.js` + `sqlite3.wasm`)
2. Add sqlite-vec to the WASM build using the extra init hook:
   - Create `ext/wasm/sqlite3_wasm_extra_init.c`.
   - Include the sqlite-vec C source and register its entrypoint in the init function.
3. Rebuild in `ext/wasm` so sqlite-vec is compiled in.
4. Verify in browser: `select vec_version();` should return a version string.

Example `sqlite3_wasm_extra_init.c` sketch:

```c
// ext/wasm/sqlite3_wasm_extra_init.c
#include "sqlite3.h"
#include "sqlite3ext.h"
#include "sqlite-vec.c"

int sqlite3_wasm_extra_init(const char *z){
  // Register sqlite-vec entrypoint for all connections
  sqlite3_auto_extension((void(*)(void))sqlite3_vec_init);
  return 0;
}
```

Notes:
- WASM builds cannot dynamically load extensions; compile sqlite-vec in at build time.
- `sqlite3_vec_init` is the sqlite-vec extension entrypoint.

### 2.4 Performance Strategy
Designed for 1k+ starred repos, with explicit current-state baseline and target-state upgrades.

Current state (implemented):
- Pagination with concurrency limits.
- README fetching in batches with backoff on rate limit.
- Incremental sync using checksum diffs.
- Progressive status UI and local-first indexing.
- Single embedding worker with per-text inference loop and frequent DB persistence.

Proposed state (approved):
- Item 1: micro-batch embeddings in each worker (`8..32`, adaptive).
- Item 2: checkpointed SQLite persistence (record-count and time-based flush).
- Item 3: bounded worker pool (`2` default; auto-downshift on pressure).
- Item 4: explicit backend selector (`webgpu` preferred, `wasm` fallback).

Tradeoffs and controls:
- Higher throughput vs. higher peak memory:
  - Control with capped pool size and adaptive batch size.
- Less frequent persistence vs. small crash-loss window:
  - Control with frequent checkpoints and forced final flush.
- WebGPU acceleration vs. compatibility variance:
  - Control with deterministic fallback to WASM + backend diagnostics.

Performance requirements:
- Time to first searchable chunks should improve materially over current baseline.
- Retrieval quality must remain stable (same model, same normalization contract).
- No UI freeze during indexing on 1k+ stars.

Reference:
- Full execution design, rollout stages, and benchmark protocol: `docs/embedding-acceleration-plan.md`

---

## 3) Security Details

### 3.1 Data Handling
- Default: all embeddings and repo content stored locally in SQLite WASM DB
- No server persistence unless user opts in
- Provide a "Delete all data" button
- Store repo checksums for diff-based sync
- Persist chat sessions and messages in SQLite for continuity across reloads
- Checksum uses SHA-256 over canonical repo metadata + README content (empty string if missing)

### 3.2 Token Handling
- GitHub OAuth tokens stored only in memory by default
- Optional encrypted storage using WebCrypto (AES-GCM)
- Never log tokens
- Clear tokens on logout
- Use OAuth PKCE and avoid tokens in URLs

### 3.3 External LLM Usage
- Off by default
- Explicit consent required before sending repo content
- If enabled, send only top-K chunks (minimized context)

### 3.4 Content Safety
- Sanitize all README rendering (avoid XSS)
- Use CSP headers in hosted version
- Disallow inline scripts in README rendering

### 3.5 Rate Limits and Abuse Controls
- Respect GitHub rate limit headers
- Backoff and retry strategy on 403/429
- Avoid heavy parallel requests
- Handle GitHub edge cases: missing README, renamed/deleted repos, and private repo access errors

### 3.6 Embedding Runtime and Worker Safety
- Cap worker pool size (default `2`) to prevent local resource exhaustion.
- Cap micro-batch size and auto-downshift on memory pressure.
- Keep strict allowlist for model download hosts in CSP `connect-src`.
- Record backend fallback reason (`webgpu` -> `wasm`) for auditability and debugging.
- Never transmit embedding input text externally as part of optimization path.

### 3.7 Actionable Security Findings (Pre-Dev Checklist)
- Add strict CSP (no inline scripts, allow only required origins).
- Sanitize README rendering with `rehype-sanitize`.
- Enforce OAuth PKCE flow; never place tokens in URLs.
- PAT warning: show explicit caution when PAT is used.
- Local LLM opt-in toggle with clear data-sent notice.
- Store tokens in memory or encrypted storage only.
- Implement “Clear all data” and “Clear token”.
- Add checksum validation and diff-based sync to prevent stale data drift.
- Add unit tests for checksum, chunking, and diff logic.
- Add worker pool upper bound tests and queue backpressure tests.
- Add checkpoint durability tests (periodic + completion flush).
- Add backend fallback tests (`webgpu` unavailable -> `wasm`).

---

## 4) Threat Model

### 4.1 Assets
- GitHub tokens (OAuth or PAT)
- Private repo README content
- Local embeddings and index
- User query history

### 4.2 Threats
1. Token exfiltration via XSS or dependency compromise
2. Leakage of private repo content to external LLM providers
3. Local provider exposure: sending data to a local endpoint that is not trusted
4. Malicious README content executing scripts
5. SQLite WASM DB corruption or malicious injection
6. Over-permissioned GitHub token misuse
7. Data drift due to stale stars cache if sync is not run reliably
8. Resource exhaustion due to worker-pool or oversized micro-batches
9. Incomplete persistence if crash happens before checkpoint flush
10. Backend variability causing silent acceleration fallback or unstable behavior

### 4.3 Mitigations
1. CSP + strict README sanitization
2. Explicit opt-in for any LLM provider
3. Separate toggle for Local providers with clear "local endpoint" disclosure
4. Token stored in memory or encrypted storage
5. Minimal GitHub scopes or fine-grained PAT
6. Dependency review and integrity checks
7. Rate limiting and backoff to avoid account lockouts
8. Checksum-based sync on each query to keep stars data fresh
9. Worker pool cap + adaptive batch sizing + queue backpressure
10. Time/record checkpoint policy with final flush and UI status
11. Backend probe and deterministic fallback from `webgpu` to `wasm`

### 4.4 Residual Risks
- If user enables external LLMs, repo content leaves the browser
- If local device is compromised, local storage can be accessed
- GPU/browser driver variability may still affect acceleration consistency

---

## 5) PRD (Product Requirements Document)

### 5.1 Problem Statement
Developers star many repositories over time and cannot easily recall them when they remember only functionality or details.

### 5.2 Goals
- Import all starred repos quickly
- Provide fast natural language search
- Keep data local by default
- Support multiple LLM providers optionally

### 5.3 Non-Goals
- Replace GitHub global search
- Multi-user enterprise features in MVP

### 5.4 Target Users
- Developers with 100+ starred repos
- Open-source heavy users
- Individuals who prefer privacy-first tooling

### 5.5 User Stories
1. "Find the repo I starred for a lightweight vector search library in JS."
2. "Show me repos I starred about OAuth middleware."
3. "Suggest repos I starred for scraping or crawling."

### 5.6 Functional Requirements
- GitHub OAuth or PAT login
- Fetch all starred repos with pagination
- Fetch README for each repo
- Local RAG index in the browser using SQLite WASM + `sqlite-vec-wasm`
- Persist repo checksums and sync diffs on each query
- Embedding acceleration controls:
  - micro-batch embedding
  - bounded worker pool
  - checkpointed persistence
  - backend selection (`webgpu` preferred, `wasm` fallback)
- UI diagnostics for indexing backend, throughput, and fallback reason
- Provide multiple chat sessions and allow follow-up queries within a selected session
- Provide a session list UI and ability to switch active sessions
- Natural language search
- Optional LLM-based summary or suggestions
- Public landing page (no login required) with dev/security-friendly details and a demo video
- Login-gated usage page after OAuth
- Clear empty states when a user has no stars or no README content

### 5.7 Non-Functional Requirements
- Fast: indexing visible progress, partial results within 120 seconds for 1k stars
- Secure: no token leakage, no data sent without consent
- Reliable: robust error handling, retry strategy
- Scale: handle 1k+ starred repos without full re-index per query
- Compatible: browser-only functionality on Windows/macOS/Linux with graceful CPU fallback

### 5.8 Success Metrics
- Time to first results < 120 seconds for 1k stars
- Query response time < 2 seconds after indexing
- > 80% success in manual relevance evaluation
- Sync diff on query completes without user-visible delays for 1k+ stars
- Embedding throughput improves by at least 30% from baseline on modern laptops
- No relevance regression on fixed query-set evaluation

### 5.9 MVP Scope
- OAuth/PAT login
- Fetch stars + README
- Local embeddings + SQLite WASM + `sqlite-vec-wasm`
- Search UI with results list
- Local provider support (Ollama, LM Studio) behind explicit toggle
- Multiple chat sessions with the ability to continue an existing session
- Checksum-based incremental sync on new queries
- MVP: use prebuilt sqlite-vec-wasm bundle for speed of iteration

### 5.10 Post-MVP Enhancements
- Cross-device sync (opt-in)
- Repo metadata enrichment (topics, tags)
- Advanced filters (language, date, stars)
- Local model manager (model install, health checks, local endpoint validation)
- Optional local-native embedding runtime bridge (CUDA/Metal/CPU via local providers)
- Production hardening: custom-built SQLite WASM + sqlite-vec bundle with pinned versions

### 5.11 Migration Checklist (Prebuilt -> Custom Bundle)
- Pin SQLite and sqlite-vec versions (document in repo).
- Build SQLite WASM with sqlite-vec statically compiled.
- Verify `vec_version()` matches pinned version.
- Run vector search regression tests (KNN results stable on a fixed set).
- Validate OPFS persistence and fallback behavior.
- Update docs to point to the custom bundle artifact.

### 5.12 Vector Search Sanity Test (Suggested)
Purpose: validate sqlite-vec behavior after a bundle change.

Test dataset:
- 3 vectors with known neighbors (simple 3D or 5D examples).
- Use a fixed query vector with known nearest results.

Pseudo-test:
```sql
-- Create vec table
CREATE VIRTUAL TABLE vec_test USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[5] distance_metric=cosine
);

-- Insert 3 vectors
INSERT INTO vec_test (id, embedding) VALUES
('a', '[1,0,0,0,0]'),
('b', '[0.9,0.1,0,0,0]'),
('c', '[0,1,0,0,0]');

-- Query should rank a, b above c for query [1,0,0,0,0]
SELECT id, distance
FROM vec_test
WHERE embedding MATCH '[1,0,0,0,0]'
  AND k = 2
ORDER BY distance ASC;
```

Expected:
- The first result is `a` and the second is `b`.

TypeScript harness (browser, pseudo-code):
```ts
// Assume sqlite-vec-wasm is already initialized as `db`
await db.exec(`
  CREATE VIRTUAL TABLE vec_test USING vec0(
    id TEXT PRIMARY KEY,
    embedding float[5] distance_metric=cosine
  );
  INSERT INTO vec_test (id, embedding) VALUES
    ('a', '[1,0,0,0,0]'),
    ('b', '[0.9,0.1,0,0,0]'),
    ('c', '[0,1,0,0,0]');
`);

const rows = db.exec({
  sql: `
    SELECT id, distance
    FROM vec_test
    WHERE embedding MATCH '[1,0,0,0,0]'
      AND k = 2
    ORDER BY distance ASC;
  `,
  returnValue: "resultRows",
});

console.assert(rows[0][0] === "a" && rows[1][0] === "b");
```

---

## 6) Implementation Phases (High Level)

### Phase 1 - Foundations
- Project scaffolding, UI shell, GitHub auth
- Stars fetching and pagination

### Phase 2 - Indexing
- README fetcher and chunker
- Embedding generation in Web Worker
- SQLite WASM storage and vector index

### Phase 3 - Search
- Query UI and retrieval
- Result ranking and filters

### Phase 4 - Optional LLM
- Provider abstraction
- Summaries and suggestions

### Phase 5 - Embedding Acceleration
- Micro-batch worker API
- Checkpointed DB persistence
- Worker pool scheduling
- WebGPU preference with WASM fallback
- Cross-platform validation (Windows/macOS/Linux)

---

## 7) Open Decisions
Resolved decisions:
- Frontend: Vite + React
- Embeddings model: `all-MiniLM-L6-v2`
- Local vector strategy: SQLite WASM + `sqlite-vec-wasm`

Active decisions:
- Final default batch-size adaptation policy for low-memory devices
- Whether to enable worker pool by default on first release or behind feature flag
- Whether optional local-native embedding bridge should be added post-MVP
