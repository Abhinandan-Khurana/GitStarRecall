# Release Notes

## 2026-03-05 (Sync Progress UX Fix - README + Ollama Embeddings)

- Fixed sync progress visibility during staged indexing:
  - README progress now remains visible during active README work even when incremental embedding metrics are present.
  - Embedding initialization now renders an indeterminate animated progress bar until a concrete embedding target is known.
  - Embedding progress automatically switches to determinate (`completed/target`) once chunk targets are available.
- Added progress-state regression coverage in `src/components/SyncStatusBar.test.ts`.

## 2026-03-05 (Remaining Concerns Follow-up - Score Display + Pooling Verification)

- Search result score display now clamps negative rerank values to `0.000` in UI for readability (ranking/order unchanged).
- Browser embedding pooling strategy is now explicit and centralized:
  - `embeddinggemma` uses `mean` pooling with source-backed rationale from Hugging Face Text Embeddings Inference guidance.
  - fallback/default remains `mean` for current browser embedding candidates.
- Search diagnostics signal is now less ambiguous:
  - `denseSuspicious` reports dense-confidence concerns (`low_top1`, `low_top5_mean`, `low_repo_diversity`),
  - `lexicalTriggered` still reports whether lexical safety-net executed (including rare-token triggers).
- Rare-token lexical trigger now has a confidence/alignment bypass:
  - lexical safety-net is skipped when dense top-1 is highly confident *and* lexically aligned with the rare-token query,
  - lexical safety-net still runs for high-confidence but lexically mismatched dense top-1 results.
- Qwen3 retrieval prompting now follows model-card format:
  - queries use `Instruct: ...` + `Query: ...`,
  - passages/documents are embedded as raw text (no `passage:` prefix).
- Lexical broad sampling now targets the corpus interior slice first (excluding oldest/newest windows) to reduce overlap and improve unique lexical candidate coverage.
- Curated embedding warning logic now matches retrieval-profile model families (for example `mxbai-embed*`, `nomic-embed*`) to avoid false custom-model warnings on valid variants.
- `Rebuild Embeddings` now requires explicit user confirmation before clearing and regenerating the embedding index.
- README section splitting for large-readme chunking is now code-fence-aware, so heading-like lines inside fenced code blocks do not create artificial section boundaries.
- Chunk budgeting for large READMEs now intentionally under-fills when fewer than 120 windows clear the quality floor (no low-quality padding fallback).
- Pooling profile resolution now inspects model identity and emits a one-time warning for unknown model families before using mean pooling fallback.
- Verified dependency concern: `@huggingface/transformers@3.8.1` currently pulls `onnxruntime-node` and `sharp` as required transitive dependencies; tracked as a portability/CI risk pending upstream or package-level mitigation.

## 2026-03-05 (Minor PR Review Remediation - CSP + Model Warning + Ollama Order)

- Tightened CSP `script-src` allowance for transformers runtime script loading:
  - replaced broad `https://cdn.jsdelivr.net` host allowance with a pinned transformers dist path (`@huggingface/transformers@<resolved-version>/dist/`).
- Fixed curated custom-model warning regression:
  - `nomic-embed-text` now treated as curated/supported in embedding warning logic.
  - curated checks now support tagged model forms (e.g. `:latest`) for supported families.
- Removed dead `embeddinggemma` entry from Ollama embedding recommendation order.
- Improved Ollama embedding recommendation matching to support tagged model names (prefix match for curated defaults).
- Added model-catalog regression test for tagged embedding model names.

## 2026-03-05 (Docs + Retrieval Follow-up Alignment)

- Updated retrieval/chunking notes to match latest behavior:
  - large-README chunk budget quality scoring now evaluates normalized window text before budget selection,
  - lexical safety-net fused candidates now carry fused relevance into MMR reranking (lexical-only candidates no longer enter rerank as hard-zero relevance).

## 2026-03-05 (Follow-up PR Review Fixes - Model Routing + Capability + Chunk Budget)

- Fixed browser capability scoring so `perfScore == null` is neutral (`+0`), preventing weak/timeout devices from receiving an unintended heavy-model boost.
- Fixed embedding backend routing heuristic:
  - removed slash-based browser detection,
  - now routes browser embeddings only for explicit browser model prefixes (`onnx-community/`, `xenova/`),
  - prevents namespaced Ollama models (`myorg/custom-embed:latest`) from being misrouted to browser runtime.
- Fixed chunk budgeting quality gate:
  - removed unconditional inclusion of first 3 windows,
  - all windows now pass through quality selection.
- Added regression coverage:
  - `src/embeddings/modelRouting.test.ts`
  - `src/embeddings/browserCapability.test.ts` (null perf signal)
  - `src/chunking/chunker.test.ts` (first-window quality bypass)

## 2026-03-05 (PR Review Remediation - Search Correctness and Stability)

- Fixed critical dense cosine bug in `src/db/client.ts` where zero-norm vectors could produce `NaN` and corrupt ranking order.
- Added shared safe cosine utility and aligned search/rerank vector math behavior.
- Updated lexical safety-net policy:
  - tiny-corpus + high-confidence dense results now skip lexical branch (lower onboarding latency),
  - lexical candidate pool now combines recent + oldest + broad deterministic coverage (removes recency-only bias).
- Added/expanded retrieval diagnostics:
  - `denseNaNClampedCount`
  - lexical pool composition counters
  - corpus counters
  - rerank vector mismatch counters
- Fixed browser embedding capability scoring so unknown `deviceMemory` is neutral (no positive boost).
- Updated chunk budgeting flow so quality scoring runs on normalized windows before final chunk selection.
- Deduplicated query tokens in lexical overlap and rare-token counting.
- Hardened rerank behavior for vector-size mismatch (no full-pass hard fail).
- Rerank output now preserves both MMR ranking score (`score`) and rerank relevance signal (`denseScore`).

## 2026-03-05 (Browser Embedding Capability UX + Advanced Tuning Visibility)

- Browser embedding recommendation is now capability-driven:
  - strong desktop + WebGPU -> `onnx-community/embeddinggemma-300m-ONNX`
  - mobile / weak / no-WebGPU / probe-failed -> `Xenova/all-MiniLM-L6-v2`
- Browser capability test results are now shown in Embedding settings (reason, cores, RAM hint, perf score when available).
- Search/embedder worker now reuses capability-ordered model candidates, preventing unnecessary model re-download churn from candidate-order drift.
- Developer advanced mode (`sudo`) is now a visible UI checkbox (not hidden-only), with:
  - red warning about quality/speed/efficiency tradeoffs
  - scoped persistence (`gitstarrecall.sudo.<scope>`)
  - `Rebuild Embeddings` action to regenerate vectors with updated settings.
- Updated CSP `script-src` allowlist to include `https://cdn.jsdelivr.net` for runtime ORT JSEP module loading used by browser embeddings.
- Browser embedding runtime now uses `@huggingface/transformers` package path.

## 2026-03-05 (Semantic Retrieval v2 + Model Policy Refresh)

- Search pipeline upgraded to retrieval v2:
  - dense candidate fetch (`fetchK`)
  - dense confidence gate
  - lexical safety-net branch (conditional only)
  - RRF fusion (conditional)
  - MMR rerank + per-repo cap
- Added strict embedding dimension compatibility checks during search (no silent zero-score fallback).
- Added retrieval diagnostics payload (`queryDim`, sampled index dims, trigger reason, dense top scores).
- Browser embedding baseline switched to `embeddinggemma` (later superseded by capability-driven recommendation policy in the same release cycle).
- Ollama embedding recommendations now prioritize:
  1. `qwen3-embedding:4b`
  2. `qwen3-embedding:0.6b`
  3. `mxbai-embed-large`
- Custom embedding model path now shows warning because tuned retrieval assumptions may not hold.
- Added advanced retrieval tuning controls for sudo mode (`fetchK`, `topK`, `mmrLambda`, `maxChunksPerRepo`, lexical thresholds).
- Updated docs and DFD Mermaid diagrams to reflect retrieval v2 architecture and threat-model deltas.

## 2026-03-04 (Ollama Model Discovery + UI Selection)

- Removed env-coupled embedding model selection from runtime (`VITE_OLLAMA_MODEL` is no longer used by app flow).
- Added baseline Ollama embedding default of `nomic-embed-text` when no user preference exists.
- Added automatic local model catalog discovery from Ollama (`GET /api/tags`) with typed parsing/classification:
  - embedding-capable model list
  - chat/LLM model list
- Added embedding settings dropdown backed by discovered embedding models, with custom model override.
- Added chat settings Ollama dropdown backed by discovered LLM models, with custom model override.
- Added auto-selection policy:
  - prefer last-used model if still installed
  - otherwise use recommended default
  - then first available model
- Expanded connection diagnostics for unreachable/CORS/timeouts with actionable remediation:
  - run `ollama serve`
  - set global CORS `OLLAMA_ORIGINS=\"*\"`
  - retry connection test
- Added new model catalog tests in `src/ollama/modelCatalog.test.ts`.
- Updated docs/env guidance to remove `VITE_OLLAMA_MODEL` references and document UI-first model selection.

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
