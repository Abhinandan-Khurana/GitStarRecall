# GitStarRecall Manual Test Checklist

## Core Flows

1. OAuth login:
- Open landing page.
- Click OAuth login and complete GitHub auth.
- Confirm usage page loads and token is usable (Fetch Stars works).

2. PAT fallback:
- Logout.
- Login with a valid PAT.
- Confirm app can fetch stars and search.

3. Import/sync:
- Click `Fetch Stars`.
- Verify pagination fetch completes.
- Verify README stats and local DB summary update.
- Verify indexing status transitions are accurate (no stale phase message).
- Verify backend status is visible (`webgpu` or `wasm`).

4. Search:
- Run a semantic query.
- Confirm relevant repo results appear with snippets and metadata.
- Apply language/topic/date filters and verify narrowing behavior.

5. Session continuity:
- Choose `New session` and search.
- Choose `Continue active session` and run follow-up search.
- Reload page and verify session list + message history persist.

6. Data deletion:
- Click `Delete all local data`.
- Verify sessions/results are cleared and re-search requires re-sync.

## LLM Mode

1. Remote provider:
- Select OpenAI-compatible.
- Enable remote consent.
- Provide API key + model and generate answer.
- Verify streaming output and cancel button behavior.

2. Local provider:
- Select Ollama or LM Studio.
- Enable local consent.
- Verify generation succeeds or expected connection/CORS hint appears.

## Edge Cases

1. No stars account:
- Sync should complete without crash and show empty-state behavior.

2. Missing README repos:
- Sync should count missing README and continue.

3. Removed stars:
- Unstar a repo in GitHub and run query-triggered sync.
- Verify removed repo no longer appears in results.

4. OPFS unavailable:
- Force fallback browser mode and confirm local-storage fallback works.

5. Provider/API failures:
- Simulate bad key or endpoint down.
- Confirm user-facing error appears and app remains usable.

## Embedding Acceleration Checks

1. Micro-batching:
- Start a fresh sync on account with at least 200 stars.
- Verify embeddings progress increments in larger grouped steps (not one-by-one stall pattern).
- Confirm search remains functional during ongoing indexing.

2. Worker pool:
- Run indexing and monitor browser responsiveness.
- Confirm no UI freeze and no duplicate/deadlocked progress state.

3. Checkpoint persistence:
- During long indexing, reload only after a reported checkpoint.
- Confirm already-checkpointed embeddings are retained and indexing resumes from remaining chunks.

4. Backend fallback:
- Run in browser/environment with WebGPU disabled.
- Confirm automatic fallback to WASM CPU and successful indexing completion.
- Run in WebGPU-capable browser and confirm backend switches to WebGPU.
