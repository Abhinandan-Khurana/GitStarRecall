# GitStarRecall Embedding Acceleration Plan

This document defines the performance roadmap for faster embedding generation while keeping GitStarRecall local-first and secure.

Scope requested:
1. Micro-batch embeddings in one worker.
2. Persist SQLite less frequently (checkpoint strategy).
3. Small embedding worker pool (parallel workers).
4. WebGPU acceleration with safe CPU fallback, plus cross-platform local runtime guidance (CUDA/Metal/MPS/CPU fallback).

---

## 1) Current State (As Implemented)

Embedding pipeline today:
- Worker API accepts `embedBatch(texts[])` and returns ordered vectors with per-item error slots.
- Main thread uses a small worker pool (default 1-2 workers) with bounded queue and downshift-to-1 on errors/memory pressure.
- Worker pool now dispatches micro-batches per worker task (`workerBatchSize`, default `8`) instead of one-text jobs.
- SQLite checkpoint persistence is deferred by policy (`everyEmbeddings`, `everyMs`) with final flush.
- Runtime backend policy is explicit: preferred `webgpu`, automatic fallback to `wasm`, with fallback reason surfaced in UI telemetry.

Strengths:
- Local-first indexing with explicit backend diagnostics.
- Better throughput from reduced worker-call overhead (micro-batch job dispatch).
- Safer operational controls (fallback + downshift + checkpoint metrics).

Known bottlenecks:
- Initial model download/compile remains the largest one-time latency.
- Multi-worker mode duplicates model memory footprint.
- Throughput remains browser/driver dependent for WebGPU-capable systems.

---

## 2) Proposed Target State

### 2.1 New Embedding Architecture

Add an `EmbeddingOrchestrator` in the main thread with:
- `BatchBuilder`: groups chunk texts into micro-batches (`8..32`, adaptive).
- `WorkerPool`: 1-2 workers by default (configurable upper cap).
- `BackendSelector`: decides runtime backend (`webgpu` then `wasm`).
- `CheckpointWriter`: persists SQLite on a timed/record-count cadence.
- `MetricsCollector`: captures throughput, queue depth, ETA, fallback reason, and error counts.

### 2.2 Execution Model

1. Gather pending chunks from DB.
2. Build micro-batches.
3. Dispatch batches across worker pool (bounded concurrency).
4. Upsert vectors in transactional chunks.
5. Persist SQLite on checkpoint intervals, not each tiny insert.
6. Emit live progress metrics to UI.

### 2.3 Non-Goals (for this phase)

- No server-side embedding service dependency.
- No change to retrieval quality model (`all-MiniLM-L6-v2` remains default).
- No mandatory desktop app migration.

---

## 3) Platform and Backend Compatibility

## 3.1 Browser-Only Path (Primary for GitStarRecall)

Backend strategy:
- First try: `webgpu` when available and healthy.
- Fallback: `wasm` CPU path.

Important clarification:
- In browser, you do not directly choose CUDA or MPS.
- Browser WebGPU maps to OS/driver GPU stacks:
  - Windows: typically Direct3D 12 backend
  - macOS (Apple Silicon/Intel): Metal backend
  - Linux: typically Vulkan backend
- If WebGPU is unavailable or unstable, fallback to WASM CPU automatically.

## 3.2 Local Runtime Path (Optional Advanced Mode)

If future architecture allows local-native embedding via Ollama/LM Studio:
- Windows/Linux with NVIDIA GPU: CUDA path (runtime-managed).
- macOS Apple Silicon: Metal path (often described as MPS/Metal acceleration at runtime level).
- All platforms: CPU fallback when GPU unavailable.

Use this as optional enhancement, not baseline, to preserve pure in-browser compatibility.

## 3.3 Compatibility Matrix

| Mode | Windows | macOS (Apple Silicon) | Linux | Notes |
|---|---|---|---|---|
| Browser WebGPU | Yes (browser/driver dependent) | Yes (browser/driver dependent; Metal backend) | Yes (browser/driver dependent) | Primary acceleration path |
| Browser WASM CPU | Yes | Yes | Yes | Guaranteed fallback |
| Local runtime CUDA (optional) | Yes (NVIDIA) | No | Yes (NVIDIA) | Only via local native runtime |
| Local runtime Metal/MPS (optional) | No | Yes | No | Only via local native runtime |
| Local runtime CPU (optional) | Yes | Yes | Yes | Fallback for local runtime mode |

---

## 4) Detailed Design for Items 1-4

## 4.1 Item 1 - Micro-Batch Embedding

Implementation:
- Change worker API from `embed(text)` to `embedBatch(texts: string[])`.
- Batch target starts at `16`; dynamic adaptation:
  - Increase batch size gradually if latency and memory are healthy.
  - Decrease when runtime throws memory/timeouts.
- Return ordered vectors aligned to input chunk IDs.

Tradeoffs:
- Pros: lower overhead, better throughput.
- Cons: higher transient memory, more complex error handling for partial failures.

Mitigation:
- If one batch fails, bisect batch (binary split) to isolate problematic text and continue.

## 4.2 Item 2 - Checkpointed SQLite Persistence

Implementation:
- Keep transactional upsert behavior, but delay `persist()` by policy:
  - `checkpointEveryEmbeddings = 256` (default)
  - `checkpointEveryMs = 3000` (default)
  - Force checkpoint on completion and before page unload.
- Keep "durability window" visible in diagnostics (e.g., "last checkpoint: 2.1s ago").

Tradeoffs:
- Pros: major speedup by reducing DB export frequency.
- Cons: small recent window may be lost on hard crash/tab close.

Mitigation:
- Short interval checkpoints + final forced flush.

## 4.3 Item 3 - Small Worker Pool

Implementation:
- Add orchestrator queue with bounded pool size:
  - Default `poolSize=2`
  - Auto-cap by device memory and hardware concurrency.
- Worker-local model singleton per worker (avoids re-init per batch).
- Central dedupe cache still in main thread for duplicate chunk text.

Tradeoffs:
- Pros: better CPU/GPU utilization, faster wall-clock indexing.
- Cons: higher memory pressure (model loaded per worker), more coordination complexity.

Mitigation:
- Hard cap pool size at 2 by default.
- Auto-downshift to 1 on memory pressure or mobile devices.

## 4.4 Item 4 - WebGPU + Fallback Policy

Implementation:
- At startup run backend probe:
  - Try `webgpu` backend for embeddings.
  - On probe failure, log reason and switch to `wasm`.
- Expose backend status in UI:
  - `Embedding backend: webgpu` or `Embedding backend: wasm (fallback reason: ...)`.
- Keep feature flag to disable WebGPU quickly if regressions occur.

Tradeoffs:
- Pros: potentially large speedup on supported hardware.
- Cons: backend variability by browser/driver, larger operational test matrix.

Mitigation:
- Conservative fallback and runtime telemetry.
- Keep CPU path fully supported and tested.

---

## 5) Step-by-Step Execution Plan (One Task at a Time)

## Task A - Instrumentation Baseline
- Add timing metrics:
  - per-batch embed latency
  - embeddings/sec
  - DB checkpoint time
  - queue depth
- Persist to in-memory debug state and optional local log.

Exit criteria:
- One indexing run emits complete timing stats and backend identity.

## Task B - Batch Worker API
- Implement `embedBatch` worker request/response contracts.
- Add tests for ordering and per-item error handling.

Exit criteria:
- Same embedding correctness as single-item mode, faster throughput in benchmark.

## Task C - Checkpoint Writer
- Add checkpoint policy config and periodic flush.
- Ensure final flush on completion + page hide.

Exit criteria:
- Persist calls reduced significantly without data integrity regressions.

## Task D - Worker Pool Scheduler
- Implement bounded queue and 2-worker pool.
- Add adaptive downshift to 1 on memory pressure/errors.

Exit criteria:
- Stable indexing on large corpus with no UI freeze and no deadlocks.

## Task E - WebGPU Selector + Fallback
- Add backend probe and explicit fallback.
- Add UI status + diagnostics.

Exit criteria:
- Works on WebGPU-capable systems; clean fallback on unsupported systems.

## Task F - Cross-Platform Validation
- Run manual benchmark matrix across:
  - Windows browser
  - macOS browser
  - Linux browser
- Optional local runtime checks:
  - CUDA path (Windows/Linux with NVIDIA)
  - Metal path (macOS Apple Silicon)
  - CPU fallback

Exit criteria:
- Compatibility matrix validated and documented with pass/fail notes.

---

## 6) Security and Privacy Impacts

New considerations:
- More workers means larger in-memory footprint of private README-derived text.
- Deferred persistence introduces a short durability window.
- WebGPU reveals broader hardware execution path characteristics.

Required controls:
- Keep all embedding text local; never send to remote endpoints unless explicit LLM opt-in.
- Keep CSP strict and lock model download hosts.
- Add memory pressure guardrails (max queue size, max pool size).
- Keep clear "Delete all local data" behavior unchanged.

---

## 7) Testing and Benchmark Plan

Automated:
- Unit tests for:
  - batch request ordering
  - scheduler fairness and completion
  - checkpoint interval behavior
  - backend fallback path selection
- Regression tests:
  - retrieval relevance unchanged for fixed query set
  - chat/session behavior unaffected

Manual benchmark protocol:
- Dataset buckets: 200, 1k, 2k starred repos.
- Measure:
  - time to first searchable chunk
  - total indexing time
  - embeddings/sec
  - peak memory (observed)
- Compare:
  - baseline (single worker + eager persist + wasm)
  - optimized variants

Acceptance target:
- 30-60% indexing speed improvement on modern laptops without relevance regression.

---

## 8) Config Defaults (Recommended)

- `embedding.batch.min = 8`
- `embedding.batch.target = 16`
- `embedding.batch.max = 32`
- `embedding.pool.size = 2`
- `embedding.backend.preferred = webgpu`
- `embedding.backend.fallback = wasm`
- `db.checkpoint.everyEmbeddings = 256`
- `db.checkpoint.everyMs = 3000`

All config should be overrideable for diagnostics in development.

---

## 9) Rollout Strategy

Stage 1:
- Ship instrumentation only (no behavior change).

Stage 2:
- Enable micro-batching + checkpointing by default.

Stage 3:
- Enable worker pool behind feature flag, then make default after stability.

Stage 4:
- Enable WebGPU backend preference with runtime fallback and kill switch.

Rollback plan:
- Feature flags for each stage allow immediate fallback to baseline behavior.

---

## 10) Task F Validation Log (Current System: macOS)

Task F scope requested in this run:
- Complete validation for current macOS system.
- Leave Windows/Linux manual validation for follow-up.

### 10.1 Validation Setup (macOS)

- Runtime mode: browser-only local embedding (`@xenova/transformers` in worker).
- Backend policy: `VITE_EMBEDDING_BACKEND_PREFERRED=webgpu` (with automatic wasm fallback).
- Worker scheduling: pooled micro-batch dispatch (`VITE_EMBEDDING_POOL_SIZE=2`, `VITE_EMBEDDING_WORKER_BATCH_SIZE=8`).

### 10.2 macOS Results

| Check | Result | Notes |
|---|---|---|
| Type/lint | Pass | `npm run lint` |
| Unit tests | Pass | `npm run test` |
| Production build | Pass | `npm run build` |
| Backend diagnostics visible | Pass | UI telemetry shows selected backend and fallback reason when applicable |
| Worker micro-batch dispatch active | Pass | `WorkerPool` now sends grouped texts per worker call; unit test asserts call-count reduction |

### 10.3 Remaining Manual Matrix (User to run)

- Windows browser validation: pending.
- Linux browser validation: pending.
- Optional local runtime CUDA/Metal checks: pending (not part of pure browser baseline).
