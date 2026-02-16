# GitStarRecall - Step-by-Step Implementation Plan (One Task at a Time)

This plan is optimized for building the app safely and incrementally. Each task produces a clear, testable outcome before moving on. Follow tasks in order and avoid parallel changes.

Design reference:
- The HTML/CSS in `rought-UI-design` is a reference only, not a pixel-perfect target.
- Use creative improvements while keeping the layout intent.
- Emphasize security and local-first behavior in UI and copy.
- Use a landing page UI that routes to a usage page after GitHub OAuth login.
- Landing page is public (no login) and includes a demo video plus dev/security-focused details.

Current vs proposed embedding state:
- Current: single worker, per-text embedding calls, frequent DB persistence, no explicit backend selector.
- Proposed: micro-batch worker API + checkpoint persistence + bounded worker pool + WebGPU preference with WASM fallback.
- Full technical plan: `docs/embedding-acceleration-plan.md`

---

## 0) Preflight and Decisions
Goal: lock core choices to avoid rework.

1. Framework: Vite + React.
2. Embeddings: @xenova/transformers with `all-MiniLM-L6-v2`.
3. Storage/index: SQLite WASM + `sqlite-vec-wasm`.
4. Embedding runtime policy:
   - prefer browser WebGPU
   - fallback to WASM CPU
   - keep pure-browser compatibility as default
5. Auth flow:
   - OAuth with GitHub app
   - PAT input fallback
6. Define MVP scope: OAuth/PAT, stars import, README fetch, local RAG, query UI.

Exit criteria:
- A short architecture note confirming framework, embeddings, auth choice, and MVP scope.

---

## 1) Project Scaffolding
Goal: clean base project with linting, formatting, and minimal UI shell.

Tasks:
1. Initialize project using chosen framework.
2. Add TypeScript, lint (eslint), format (prettier), and basic CI script.
3. Add Tailwind or Panda CSS.
4. Create a minimal layout with top nav, main content area, and status area.
5. Create a public landing page and a login-gated usage page with routing.
6. Add a placeholder demo video section on the landing page (YouTube/Vimeo embed).

Exit criteria:
- `npm run dev` renders a blank page with layout and no console errors.

---

## 2) GitHub Auth (OAuth + PAT Fallback)
Goal: user can authenticate and we can call GitHub API.

Tasks:
1. Create GitHub OAuth app and register callback.
2. Implement OAuth login button and callback handler.
3. Store token in memory by default.
4. Add PAT input fallback flow.
5. Add logout button that clears tokens.
6. Route user to usage page after successful OAuth login.

Exit criteria:
- User can login, and token is available for API calls.

---

## 3) GitHub API Client
Goal: reliable fetching with pagination and rate limits.

Tasks:
1. Create GitHub API wrapper (fetch with auth headers).
2. Implement paginated `GET /user/starred`.
3. Add rate-limit detection and backoff.
4. Add basic logging (dev only).
5. Plan for 1k+ stars (pagination + concurrency limits).
6. Track removals: detect repos no longer starred.

Exit criteria:
- Can fetch all starred repos without crashing or 403 loops.

---

## 4) Data Model and Local Storage (SQLite WASM)
Goal: store repos and indexing artifacts locally using SQLite WASM.

Tasks:
1. Define local schema: Repo, Chunk, Embedding, IndexMeta, ChatSession, ChatMessage.
2. Set up SQLite WASM DB with persistent storage (OPFS where available).
3. Implement CRUD helpers.
4. Add "delete all data" button (drop tables or delete DB file).

Exit criteria:
- Local SQLite DB stores fetched repos and can be wiped clean.

---

## 5) README Fetcher
Goal: retrieve README content for each repo safely.

Tasks:
1. Implement `GET /repos/{owner}/{repo}/readme`.
2. Handle 404 with graceful skip.
3. Store README text with repo metadata.
4. Define checksum fields (repo metadata + README hash, empty hash if no README).
5. Compute checksum and store it.
6. Define canonical string format for checksum (stable ordering).
7. Add fetch concurrency limit.

Exit criteria:
- README text stored for most repos and errors handled cleanly.

---

## 6) Chunking and Text Normalization
Goal: prepare text for embedding.

Tasks:
1. [x] Define chunk size (e.g., 800 chars) and overlap.
2. [x] Normalize README: strip HTML, markdown artifacts.
3. [x] Combine README with repo metadata (name, description, topics).
4. [x] Truncate extremely large README content to a safe max length.
5. [x] Store chunks in SQLite.

Exit criteria:
- [x] Chunks stored with clear repo association.

---

## 7) Embeddings (Local-First)
Goal: generate embeddings in browser without blocking UI.

Tasks:
1. [x] Add embedding model via onnxruntime-web or @xenova/transformers.
2. [x] Move embedding generation to Web Worker.
3. [x] Batch embed chunks with progress updates.
4. [x] Persist embeddings in SQLite.

Exit criteria:
- [x] Indexing completes on 100 repos without UI freeze.

---

## 8) Vector Index
Goal: fast semantic retrieval.

Tasks:
1. [x] Add `sqlite-vec-wasm` extension (static-compiled into SQLite WASM). *implemented as brute-force fallback for MVP*
2. [x] Build index incrementally from embeddings. *handled via upsertEmbeddings*
3. [x] Store index metadata and version. *embeddings table has model column*
4. [x] Add rebuild logic if model/extension version changes. *n/a for brute force*
5. [x] Add fallback to brute-force search if `sqlite-vec-wasm` fails to load. *primary implementation for MVP*
6. [ ] Build command checklist:
   - Build SQLite WASM (`ext/wasm`) with sqlite-vec compiled in.
   - Verify `select vec_version();` returns a version string.
   - Smoke test KNN query on a small vector set.
7. [x] MVP vs production:
   - MVP: use prebuilt sqlite-vec-wasm bundle to move fast. *Used JS brute-force for MVP stability*
   - Production: build and pin your own SQLite WASM + sqlite-vec bundle.

Exit criteria:
- [x] Query embedding returns top-K chunk results in < 2 seconds. *Verified 10k vectors in ~8ms*

---

## 9) Search UI
Goal: searchable UX with relevant results.

Tasks:
1. Add search bar and result list.
2. Show repo name, description, and matched snippet.
3. Add filters: language, topics, last updated.
4. Add session list UI and ability to switch active sessions.
5. Add loading states and progress indicators.

Exit criteria:
- Queries return usable results with clear UI.
- Users can switch between chat sessions.

---

## 10) LLM Answer Mode (Optional)
Goal: generate summaries or suggestions from top-K results.

Tasks:
1. Add provider selection (Remote: OpenAI/Anthropic/etc, Local: Ollama/LM Studio).
2. Implement provider interface with consistent request/response shape.
3. Local providers:
   - Ollama: `http://localhost:11434` (`/api/chat` or `/api/generate`)
   - LM Studio: `http://localhost:1234` (OpenAI-compatible `/v1/chat/completions`)
4. Send only top-K chunks to provider.
5. Stream output and allow cancel.
6. Add explicit consent toggle for remote providers and separate toggle for local endpoints.
7. Handle local CORS limitations and provide a user-facing hint if blocked.

Exit criteria:
- User can toggle providers, and responses stream correctly from both local and remote.

---

## 11) Security Hardening
Goal: mitigate key risks before launch.

Tasks:
1. Add README sanitization (rehype-sanitize).
2. Add CSP headers if hosted.
3. Ensure tokens not persisted by default.
4. Add "clear all data" and "clear token" actions.

Exit criteria:
- No XSS in README rendering; tokens not leaked in logs.

---

## 12) Performance + UX Polish
Goal: optimize speed and user experience.

Tasks:
1. Add progressive indexing (partial results as soon as possible).
2. Add caching for embeddings and index.
3. Optimize chunk size and overlap.
4. Add detailed progress and status feedback.
5. Implement embedding acceleration Item 1:
   - change worker API to `embedBatch(texts[])`
   - add adaptive micro-batch sizing (`8..32`, target `16`)
   - keep deterministic ordering between chunks and returned vectors
6. Implement embedding acceleration Item 2:
   - add checkpointed DB persistence (count/time based flush)
   - force flush on completion and page hide
   - expose last-checkpoint timestamp in debug status
7. Implement embedding acceleration Item 3:
   - add bounded worker pool (default `2`)
   - add queue backpressure and auto-downshift on memory pressure
8. Implement embedding acceleration Item 4:
   - backend selector (`webgpu` preferred, `wasm` fallback)
   - show active backend and fallback reason in status UI
9. Add benchmark harness for before/after comparison (200, 1k, 2k stars).

Exit criteria:
- 1k stars indexed in ~120s on a modern laptop.
- Throughput improves at least 30% over baseline in local benchmark.
- No quality regression on fixed retrieval query set.
- Windows/macOS/Linux browser path verified (`webgpu` where available, `wasm` fallback).

Reference:
- Detailed architecture and rollout: `docs/embedding-acceleration-plan.md`

---

## 13) Chat Sessions and Query Sync
Goal: create multiple chat sessions and keep stars data fresh.

Tasks:
1. Create ChatSession table and messages table.
2. On a new query, allow either creating a new session or continuing a selected session.
3. Store the query as the first message in a new session, or as the next message in an existing session.
4. Add `sequence` column to chat messages to guarantee ordering.
5. Persist chat sessions and messages in SQLite for continuity across reloads.
6. Before running retrieval, compute diff using stored checksums.
7. Remove repos that are no longer starred from local DB and index.
8. Fetch only updated/new repos and re-index affected chunks.
9. Update checksums and index metadata.

Exit criteria:
- Each query creates a chat session.
- New/updated stars are detected and merged without full re-index.
- Sessions persist across reloads and can be resumed.

---

## 14) QA and Release
Goal: stability and production readiness.

Tasks:
1. Add basic integration tests for GitHub API client.
2. Add unit tests for:
   - Checksum generation and canonical string format
   - Chunking and normalization logic
   - Embedding normalization (L2) and blob conversion
   - Chat session ordering using `(created_at, sequence)`
   - Diff/sync logic (add/update/remove)
3. Add manual test checklist for OAuth, import, search, and delete.
4. Add error reporting (local logs or optional telemetry).
5. Deploy to preview and confirm functionality.
6. Verify edge cases: no stars, missing README, removed stars, OPFS unavailable, sqlite-vec-wasm extension failure, local provider CORS blocks.
7. Validate embedding runtime compatibility matrix:
   - Browser: Windows/macOS/Linux (`webgpu` success path and `wasm` fallback path).
   - Optional local runtime checks: CUDA (Windows/Linux NVIDIA), Metal/MPS-style acceleration (macOS Apple Silicon), CPU fallback.

Exit criteria:
- All MVP flows validated without blockers.
- Embedding acceleration features pass compatibility validation and fallback behavior is deterministic.

---

## Execution Rules (To Avoid Errors)
1. Only complete one task before starting the next.
2. Define an exit criteria for each task and verify it.
3. If a task fails, roll back only the task’s changes.
4. Avoid optimizations until the base flow works end-to-end.
