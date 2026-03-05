# GitStarRecall Usage Guide

This guide is the canonical reference for running and using GitStarRecall end-to-end.

## 1) What GitStarRecall Does

GitStarRecall builds a local-first semantic index of your GitHub starred repositories and lets you:

- sync stars and README content,
- search using natural language,
- continue chat sessions over search results,
- optionally use local or remote LLM providers for answer generation.

By default, data stays in-browser unless you explicitly enable remote providers.

## 2) Prerequisites

- Node.js 20+
- pnpm 9+
- GitHub account with:
  - OAuth app (recommended), or
  - Personal Access Token (PAT) fallback

Optional local runtime tools:

- Ollama (for local embeddings / local chat provider)
- WebGPU-capable browser (for browser embedding acceleration + WebLLM)

## 3) Local Setup

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open: `http://localhost:5173`

## 4) Environment Configuration

## 4.1 Required (OAuth client-side)

- `VITE_GITHUB_CLIENT_ID`
- `VITE_GITHUB_REDIRECT_URI`
- `VITE_GITHUB_OAUTH_EXCHANGE_URL`

For local dev, typical values:

- `VITE_GITHUB_REDIRECT_URI=http://localhost:5173/auth/callback`
- `VITE_GITHUB_OAUTH_EXCHANGE_URL=/api/github/oauth/exchange`

## 4.2 Required (OAuth server-side exchange endpoint)

Used by `api/github/oauth/exchange.js`:

- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_REDIRECT_URI`

These must match your GitHub OAuth app settings exactly.

## 4.3 Optional Runtime Flags

- `VITE_WEBLLM_ENABLED=1` enables Browser WebLLM provider.
- `VITE_EMBEDDING_BACKEND_PREFERRED=webgpu|wasm`
- `VITE_README_BATCH_PIPELINE_V2=1` enables staged README pipeline.
- `VITE_OLLAMA_BASE_URL`, `VITE_OLLAMA_TIMEOUT_MS`
- `VITE_LLM_SETTINGS_ENCRYPTION_KEY` for encrypted provider API key storage.

## 5) GitHub OAuth Setup

In GitHub OAuth App settings:

1. Set callback URL to your exact environment callback:
   - local: `http://localhost:5173/auth/callback`
   - prod: `https://<your-domain>/auth/callback`
2. Copy client ID and configure:
   - `VITE_GITHUB_CLIENT_ID`
   - `GITHUB_OAUTH_CLIENT_ID`
3. Configure:
   - `GITHUB_OAUTH_CLIENT_SECRET`
4. Set redirect URI envs to exact callback URL:
   - `VITE_GITHUB_REDIRECT_URI`
   - `GITHUB_OAUTH_REDIRECT_URI`

Notes:

- Mismatched redirect URI/client ID causes OAuth exchange failure.
- `/auth/callback` must route to app entry on production static hosting.

## 6) Vercel Deployment Notes

Set all of these in Vercel project env vars:

- `VITE_GITHUB_CLIENT_ID`
- `VITE_GITHUB_REDIRECT_URI` = `https://<your-domain>/auth/callback`
- `VITE_GITHUB_OAUTH_EXCHANGE_URL` = `/api/github/oauth/exchange`
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_REDIRECT_URI` = `https://<your-domain>/auth/callback`

Routing:

- Keep SPA fallback rewrite so `/app` and `/auth/callback` refreshes do not 404.
- Current project includes this in `vercel.json`.

## 7) Authentication in App

## 7.1 OAuth (recommended)

- Click GitHub login and complete OAuth flow.
- Token is held in memory; not persisted as raw token storage.

## 7.2 PAT fallback

- Paste raw token (without `Bearer ` prefix).
- Ensure PAT scopes can read `/user/starred` and required repos.

## 8) Daily Usage Flow

1. Login via OAuth or PAT.
2. Click `Fetch Stars` to sync/update stars and embeddings.
3. Use search box to query existing local embeddings.
4. Open or continue chat session.
5. Ask follow-up questions with filters as needed.

Important:

- Search does not auto-refresh stars.
- Fetching latest stars is user-driven via `Fetch Stars`.
- Sync status shows separate stage progress:
  - README fetch progress remains visible while READMEs are still being processed.
  - Embedding stage shows an animated initializing bar first, then switches to numeric embedding progress when target counts are known.

## 9) LLM Modes

## 9.1 Remote OpenAI-compatible

- Requires API key.
- Requires explicit remote consent toggle.
- Top local snippets are sent when you generate an answer.

## 9.2 Local providers (Ollama / LM Studio)

- Requires explicit local consent toggle.
- Endpoint must be reachable from browser.
  - Ollama defaults:
  - URL: `http://localhost:11434`
  - Recommended embedding order:
    1. `qwen3-embedding:4b` (best retrieval quality, recommended when hardware allows)
    2. `qwen3-embedding:0.6b` (best quality/speed balance for most local setups)
    3. `mxbai-embed-large` (strong fallback option)
    4. `nomic-embed-text` (compatible fallback option)
  - Recommendation summary:
    - Prefer `qwen3-embedding` for best results.
    - Use `embeddinggemma` when running browser embeddings on strong desktop + WebGPU.
    - Use `mxbai-embed-large` or `nomic-embed-*` when Qwen3 is unavailable locally.
  - Installed model lists are discovered from local `/api/tags` and shown in dropdowns.
  - Browser embedding recommendation is capability-based:
    - strong desktop + WebGPU -> `onnx-community/embeddinggemma-300m-ONNX`
    - mobile / no-WebGPU / weak desktop / probe-failed -> `Xenova/all-MiniLM-L6-v2`
  - Browser embedding pooling currently uses `mean` for the recommended models (including embeddinggemma).
  - Unknown browser memory/perf hints are treated as neutral (no capability bonus).
  - Embedding settings shows browser capability diagnostics (reason, cores, RAM hint, perf score when available).
  - Custom embedding models are supported but marked experimental with warning.
  - Namespaced Ollama models (for example `myorg/custom-embed:latest`) remain routed to Ollama, not browser embeddings.

## 9.3 Browser WebLLM

- Requires `VITE_WEBLLM_ENABLED=1`.
- First run requires explicit model-download consent.
- No GitHub token is sent in WebLLM requests.
- Recommendation logic:
  - mobile or no-WebGPU -> 360M fallback
  - strong desktop -> 1B default
  - missing memory/perf hints are treated neutrally

## 10) Large Library Guidance (500 to 1.5k+ stars)

Recommended:

- Keep `VITE_README_BATCH_PIPELINE_V2=1`
- Keep worker pool conservative on constrained machines:
  - `VITE_EMBEDDING_POOL_SIZE=1`
  - tune `VITE_EMBEDDING_WORKER_BATCH_SIZE` around `8..16`
- Avoid unnecessary full re-syncs; use checkpoint resume behavior.
- Use `Fetch Stars` only when you need latest starred changes.
- Search pipeline defaults:
  - dense retrieval with `fetchK`,
  - dense confidence gate,
  - lexical safety-net only when dense confidence is weak (or rare-token intent is detected),
  - rare-token lexical trigger is bypassed when dense top-1 is both highly confident and lexically aligned with the query,
  - tiny-corpus high-confidence queries skip the lexical branch to avoid onboarding latency,
  - lexical pool is mixed (recent + oldest + broad deterministic window), not recency-only,
  - when lexical safety-net fusion triggers, fused relevance is used in MMR candidate scoring,
  - MMR rerank with per-repo cap.

## 10.1 Retrieval Tuning (Sudo/Advanced)

Developer advanced mode is available directly in UI as a checkbox (`Enable developer advanced mode (sudo)`).
Settings are persisted per auth scope via `localStorage` (`gitstarrecall.sudo.<scope>`).
When enabled, advanced controls become available:

- `fetchK` (`80..300`)
- `topK` (`10..40`)
- `mmrLambda` (`0.55..0.9`)
- `maxChunksPerRepo` (`1..5`)
- `lexicalTop1Threshold` (`0.05..0.5`)
- `lexicalTop5MeanThreshold` (`0.05..0.5`)
- `Rebuild Embeddings` action to regenerate vectors using current embedding settings/model selection (with confirmation prompt).

Warning behavior:
- UI shows a red warning that advanced tuning may improve corpus-specific quality or reduce relevance/speed/efficiency.

Recommended starting points:

- <=30k chunks: `fetchK=120`, `topK=20`, `mmrLambda=0.72`, `maxChunksPerRepo=2`
- 30k..120k chunks: `fetchK=150`, `topK=20`, `mmrLambda=0.72`, `maxChunksPerRepo=2`
- >120k chunks: consider Ollama local embedding and increase `fetchK` gradually with latency checks

## 11) Data Storage and Reset

Primary local storage:

- SQLite (sql.js) with OPFS when available.
- Fallback local storage modes when persistent quota/backends fail.

Additional local persistence:

- Chat backup in IndexedDB with localStorage fallback.
- Local runtime caches for model artifacts (WebLLM / embedding assets).

Reset actions in UI:

- `Clear token`
- `Delete local data`

## 12) Troubleshooting

## 12.1 PAT 401 / auth errors

- Use raw token only.
- Verify scopes and repository access.

## 12.2 OAuth callback 404

- Verify callback URL in GitHub OAuth app.
- Verify `VITE_GITHUB_REDIRECT_URI` and `GITHUB_OAUTH_REDIRECT_URI` are exact.
- Ensure production rewrite routes callback path to SPA entry.

## 12.3 `/app` refresh 404 in production

- Ensure SPA fallback rewrite is active.
- Keep `vercel.json` route fallback configured.

## 12.4 localStorage quota exceeded

- App may enter memory-only fallback mode for that tab.
- Use `Delete local data`, then re-index incrementally.

## 12.5 WebLLM suggests low model on strong desktop

- Check recommendation diagnostics in UI (`reason`, `webgpu`, `cores`, `mem`, `perf`).
- Manual model selection is supported in chat settings.

## 12.6 Semantic search relevance is weak

- Confirm indexed model and query model match.
- If you switched model families, run full re-index.
- Check search diagnostics logs for:
  - query/index dimensions,
  - lexical safety-net trigger reason,
  - top dense score distribution.
- If top results are from same repo, lower `maxChunksPerRepo` or increase `fetchK`.
- Check diagnostics for lexical pool counters (`lexicalPoolRecentCount`, `lexicalPoolBroadCount`, `lexicalPoolOldestCount`) and trigger reason.

## 12.7 Dimension mismatch error

- Error means query embedding dimension differs from indexed vectors.
- Use same embedding model for indexing and searching.
- Rebuild embeddings after model/profile changes.

## 12.9 Score semantics (MMR vs dense)

- Search result `score` reflects the rerank decision score (MMR objective).
- `denseScore` reflects the relevance signal used by rerank:
  - dense-only path: cosine similarity from dense retrieval,
  - lexical-fusion path: normalized fused (RRF) relevance score used for MMR candidate scoring.
- UI display clamps negative rerank scores to `0.000` for readability.
- UI keeps a compact band (`High/Medium/Low`) and a finite decimal score.

## 12.8 Browser embedding model keeps re-downloading

- Verify browser cache is enabled (DevTools `Disable cache` should be off).
- Avoid private/incognito mode if you want persistent model cache.
- Confirm CSP allows required script/connect hosts (`https://cdn.jsdelivr.net`, `https://huggingface.co`, `https://*.huggingface.co`, `https://xethub.hf.co`).
- Keep one stable recommended model path when possible; frequent model switching can trigger additional downloads.

## 13) Developer Command Cheat Sheet

- `pnpm dev` run local app
- `pnpm test` run test suite
- `pnpm build` typecheck + production build
- `pnpm lint` lint codebase

## 14) Related Docs

- `README.md` (overview)
- `docs/release-notes.md`
- `docs/embedding-acceleration-plan.md`
- `docs/tech-stack-architecture-security-prd.md`
- `docs/threat-modeling-stride.md`
- `docs/security-review-stride.md`

---

## In Depth Performance Tuning Guide:

If embedding feels slow on your machine, tune these first:
- `VITE_EMBEDDING_POOL_SIZE=1` on memory-constrained systems.
- `VITE_EMBEDDING_WORKER_BATCH_SIZE=8` (or try `12`/`16`).
- `VITE_EMBEDDING_BACKEND_PREFERRED=wasm` for backend stability diagnostics.

The app exposes indexing telemetry in UI so you can see:
- backend selection/fallback reason,
- throughput,
- checkpoint behavior,
- queue depth,
- worker pool downshift events.

README batching pipeline controls:
- `VITE_README_BATCH_PIPELINE_V2=1` enables batched README ingestion with adaptive concurrency and incremental chunk writes.
- `VITE_README_BATCH_SIZE` tunes mini-batch write size (higher improves throughput, lower reduces memory spikes).
- `VITE_EMBED_TRIGGER_THRESHOLD` and `VITE_EMBED_WINDOW_SIZE` control rolling embedding windows during README ingestion.

### Ollama Embedding Mode (Opt-in)

- Default behavior stays browser-local (`webgpu` -> `wasm` fallback).
- Ollama mode is disabled by default and requires explicit in-app consent toggle.
- Endpoint is restricted to localhost patterns only.
- Payload to Ollama includes only embedding text + model (no GitHub token).
- If Ollama is unavailable, indexing automatically restarts with browser embeddings.

### Ollama Setup

0. Start by exposing ollama to global CORS `export OLLAMA_ORIGINS="*"`
1. Then start Ollama locally: `ollama serve`
2. Pull one recommended embedding model (for example `ollama pull qwen3-embedding:0.6b`; alternatives: `mxbai-embed-large`, `nomic-embed-text`)
3. In the app, enable `Use Ollama for local embeddings`.
4. Keep base URL as `http://localhost:11434` (or your localhost override).
5. Click `Test connection` (this also refreshes installed model lists).
6. Run `Fetch Stars` to index with Ollama.
7. If Ollama goes down, the app falls back to browser embedding automatically.

If connection fails from browser:

- Ensure Ollama is running: `ollama serve`
- Enable global CORS: `export OLLAMA_ORIGINS="*"`
- Restart Ollama, then click `Test connection` again

### Browser WebLLM Provider (Opt-in, Feature-Flagged)

- Enable with `VITE_WEBLLM_ENABLED=1`.
- Provider appears as `Local (Browser WebLLM)` in chat model settings.
- Before first model download, app requires explicit consent in modal UI.
- No GitHub token/PAT is sent in WebLLM requests.
- Recommendation policy:
  - Mobile or weak/no-WebGPU device -> `SmolLM2-360M-Instruct-q4f16_1-MLC`
  - Strong desktop -> `Llama-3.2-1B-Instruct-q4f16_1-MLC`
- Desktop strength uses multi-signal scoring (`WebGPU`, cores, memory hint, perf probe).
- On Safari/macOS where `navigator.deviceMemory` is often unavailable, missing memory is treated as neutral (not auto-weak).
- Recommendation diagnostics are shown in chat (reason, webgpu, cores, memory/perf hints) to explain model suggestion.
- Supported selectable models:
  - `Llama-3.2-1B-Instruct-q4f16_1-MLC`
  - `SmolLM2-360M-Instruct-q4f16_1-MLC`
  - `Qwen2.5-1.5B-Instruct-q4f16_1-MLC`
  - `Gemma-2-2B-Instruct-q4f16_1-MLC`
  - `Hermes-3-Llama-3-3B-Instruct-q4f16_1-MLC` (auto-substitutes when unavailable)
  - `Llama-3.1-3B-Instruct-q4f16_1-MLC`
- If WebLLM fails, app retries once with 360M fallback model and can then auto-fallback to other configured providers.

### Large-Library Mode

- Automatically enabled when repo count exceeds threshold (`VITE_EMBEDDING_LARGE_LIBRARY_THRESHOLD`, default `500`).
- Prioritizes high-value repos first (stars + recency + README availability).
- Stores resume cursor in `index_meta` so interrupted jobs continue without full restart.
- Search does not refresh stars automatically; click `Fetch Stars` to include newly starred repositories.

### Troubleshooting Large Libraries

1. Check backend/device in embedding run details.
2. Reduce pool size to `1` for memory-constrained systems.
3. Lower worker batch size if batch latency spikes.
4. Keep Ollama enabled only when local endpoint is healthy.
5. Resume from existing checkpoint instead of clearing local data.

### Important variables:
- `VITE_GITHUB_CLIENT_ID`
- `VITE_GITHUB_REDIRECT_URI`
- `VITE_GITHUB_OAUTH_EXCHANGE_URL`
- `VITE_EMBEDDING_BACKEND_PREFERRED` (`webgpu` or `wasm`)
- `VITE_EMBEDDING_POOL_SIZE` (1..2)
- `VITE_EMBEDDING_WORKER_BATCH_SIZE` (1..32)
- `VITE_EMBEDDING_DB_WRITE_BATCH_SIZE` (16..2048)
- `VITE_EMBEDDING_UI_UPDATE_MS` (100..2000)
- `VITE_EMBEDDING_LARGE_LIBRARY_MODE` (`1` or `0`)
- `VITE_EMBEDDING_LARGE_LIBRARY_THRESHOLD` (default `500`)
- `VITE_README_BATCH_PIPELINE_V2` (`1` enables staged README->chunk->embed pipeline)
- `VITE_README_BATCH_SIZE` (default `40`)
- `VITE_EMBED_TRIGGER_THRESHOLD` (pending chunk threshold for rolling embed windows)
- `VITE_EMBED_WINDOW_SIZE` (per rolling embed window)
- `VITE_OLLAMA_BASE_URL` (optional default, must be localhost/127.0.0.1/[::1])
- `VITE_OLLAMA_TIMEOUT_MS`
- `VITE_WEBLLM_ENABLED` (`1` enables Browser WebLLM provider)
- `VITE_LLM_SETTINGS_ENCRYPTION_KEY=` (openssl rand -hex 32)
