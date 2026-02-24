# Release Notes

## 2026-02-24 (WebLLM Recommendation Calibration for macOS/Desktop)

- Fixed WebLLM model recommendation logic that could incorrectly classify strong Mac desktops as weak when memory hints were unavailable.
- Replaced strict hard-gate recommendation with score-based desktop strength evaluation using:
  - hardware concurrency
  - memory hint (neutral when unavailable)
  - perf probe (neutral when unavailable)
- Preserved hard fallback semantics for `mobile` and `no-webgpu` paths.
- Added anti-flap behavior near threshold to avoid unstable strong/weak recommendation flipping.
- Added recommendation diagnostics in chat UI (`reason`, `webgpu`, `cores`, `mem`, `perf`) for explainability.
- Added expanded tests in `src/llm/webllm/capability.test.ts` covering macOS-like and boundary scenarios.

## 2026-02-24 (WebLLM Browser LLM Integration)

- Added feature-flagged Browser WebLLM provider (`VITE_WEBLLM_ENABLED=1`) in the LLM provider stack.
- Added explicit consent-first model download flow:
  - generation blocks until user confirms download
  - no implicit model download before consent
  - runtime progress/status is shown in UI
- Added adaptive model recommendation and defaults:
  - strong desktop -> `Llama-3.2-1B-Instruct-q4f16_1-MLC`
  - mobile/weak/no-WebGPU -> `SmolLM2-360M-Instruct-q4f16_1-MLC`
- Added six selectable WebLLM models in catalog:
  - Llama 3.2 1B, SmolLM2 360M, Qwen2.5 1.5B, Gemma 2 2B, Hermes 3 Llama 3 3B, Llama 3.1 3B.
- Added Hermes compatibility substitution (`Hermes-3-Llama-3-3B...` -> `Llama-3.1-3B...`) when needed.
- Added typed WebLLM runtime errors and user-facing mapping for unsupported/download/init/stream failures.
- Added deterministic provider fallback resolver and tests for fallback order:
  - `webllm -> ollama -> lmstudio -> openai-compatible`.
- Added WebLLM cache cleanup in local data delete flow.
- Added tests:
  - `src/llm/webllm/modelCatalog.test.ts`
  - `src/llm/webllm/capability.test.ts`
  - `src/llm/fallback.test.ts`
  - `src/lib/settings.test.ts`
- Added CSP `connect-src` host allowances required for WebLLM model artifact download paths.

## 2026-02-23 (README Batch Pipeline v2 + Incremental Sync)

- Added feature-flagged staged sync pipeline (`VITE_README_BATCH_PIPELINE_V2`) for large star libraries.
- README ingestion now supports adaptive concurrency with retry/rate-limit telemetry and cooldown downshift.
- Added conditional README revalidation support and persisted validators:
  - new repo fields: `readme_etag`, `readme_last_modified`
  - request headers: `If-None-Match`, `If-Modified-Since`
  - `304 Not Modified` path reuses previously indexed README checksum/content metadata.
- Added mini-batch README processing callbacks to overlap README fetch with chunk upserts.
- Added rolling embedding windows during sync (`VITE_EMBED_TRIGGER_THRESHOLD`, `VITE_EMBED_WINDOW_SIZE`) so first embeddings can appear before full README completion.
- Persisted pipeline metrics in `index_meta` under `last_star_sync_pipeline_metrics` (star fetch time, README stage time, p95 README latency, first embedding timing).
- Added/updated tests for new README client behavior:
  - conditional revalidation
  - batch callback execution

## 2026-02-23 (Search Uses Existing Local Index Only)

- Removed automatic star refresh from search execution flow.
- Search now runs only on currently indexed local embeddings for predictable latency on large libraries.
- Star/README sync and embedding updates now happen only when user explicitly clicks `Fetch Stars`.
- Added in-app guidance text near search: to query latest stars, run `Fetch Stars` first.

## 2026-02-23 (Ollama Embedding UI-First Integration)

- Replaced generic native embedding runtime path in app flow with dedicated Ollama embedding client integration:
  - health/model probe via `GET /api/tags`
  - embedding endpoint detection (`/api/embed` with `/api/embeddings` fallback)
  - strict localhost-only endpoint allowlist enforcement
- Added authenticated UI controls for Ollama embedding:
  - explicit opt-in toggle (default OFF per auth identity)
  - editable Ollama base URL + model inputs
  - `Test connection` action with runtime status messaging
- Added scope-aware preference persistence for Ollama consent/settings using token-hash keyed localStorage entries.
- Added embedding model/backend isolation:
  - `index_meta` now tracks `embedding_active_backend` and `embedding_active_model`
  - embeddings are reset if active backend/model changes to prevent mixed-model vector stores
- Added deterministic failure handling for mid-run Ollama outages:
  - if Ollama batch embedding fails, run restarts on browser embedding backend
  - status is surfaced in UI and local diagnostics
- Updated query embedding path to honor active embedding backend metadata so search/query vectors stay aligned with indexed vectors.
- Added/updated tests:
  - `src/embeddings/ollamaClient.test.ts`
  - `src/db/client.embedding-queue.test.ts`

## 2026-02-23 (Embedding Pipeline v2)

- Reworked embedding generation to a queue-materialized pipeline:
  - pending chunks are loaded once per run (`listPendingChunksForEmbedding`)
  - hot-loop `CAST` joins were removed from pending-chunk SQL paths
  - added DB indexes for `chunks(created_at)` and `embeddings(chunk_id)`
- Added true batched worker inference path with robust output-shape normalization and per-item fallback.
- Added adaptive batch tuning and character-budget guard in the embedding loop.
- Decoupled embedding compute from DB writes:
  - embeddings are buffered and flushed in larger write batches
  - checkpoint policy remains active with final forced flush
- Throttled indexing UI updates to reduce main-thread pressure while preserving terminal-state updates.
- Added large-library mode (`>500` repos by default):
  - priority scoring uses stars, recency, and README availability
  - resume cursor persisted via `index_meta` (`embedding_job_cursor` and related keys)
- Added initial opt-in local embedding client path with localhost-only endpoint validation (legacy path later superseded by dedicated Ollama integration):
  - runtime probe endpoint (`/v1/runtime`)
  - batch embedding endpoint (`/v1/embeddings`)
  - automatic fallback to browser path on batch failure
- Added explicit user consent toggle for local embeddings in UI.
- Added new tests:
  - `src/embeddings/nativeClient.test.ts`
  - `src/db/client.embedding-queue.test.ts`

## 2026-02-23 (Chat History Isolation + Restore Race Fix)

- Fixed cross-PAT chat history bleed by scoping chat sessions to the active auth token scope:
  - new sessions are created with scoped IDs (`chat:<scope>:<uuid>`)
  - history restore now filters both SQLite and backup snapshots by active scope
  - on auth scope change, in-memory sessions/messages are cleared and restored only for the new scope
- Hardened backup rehydrate path to import only scoped backup sessions/messages into SQLite.
- Fixed first-search empty-session bug caused by async restore clobbering in-memory search results:
  - restore apply now merges with current in-memory state
  - non-empty in-memory session results are preserved
  - active session selection is stabilized during restore merges

## 2026-02-23

- Fixed disappearing chat history after refresh by adding resilient chat backup storage:
  - primary backup in IndexedDB
  - fallback backup in localStorage when IndexedDB is unavailable
- Wired backup writes into chat persistence paths (`upsertChatSession`, `addChatMessage`) so backup is updated even if primary DB persistence later fails.
- Added restore fallback in Usage page: if SQLite/OPFS history is empty or restore fails, chat sessions/messages are recovered from backup.
- Added restore-source visibility in UI (`sqlite`, `indexeddb`, or `local-storage`) for diagnostics.
- Updated clear-data behavior to wipe chat backup copies along with local DB storage.
- Added tests for chat backup fallback/pruning/clear behavior.

## 2026-02-22

- Fixed chat history restore after refresh + PAT re-auth by rerunning deterministic local restore on auth transition.
- Added explicit history restore state in UI and persisted `history_last_restored_at` metadata.
- Clarified restored-history vs in-memory retrieval context behavior and added one-click rehydrate action for empty in-memory results.
- Persisted minimal retrieval context IDs per session (`session_context_ids:<sessionId>`) for continuity/debugging.
- Consolidated Vite config usage to `vite.config.ts` and prevented `vite.config.js` drift.
