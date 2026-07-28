# GitStarRecall Feature Inventory

The complete product surface. `README.md` keeps a short summary; this document holds the detail.
Operational instructions live in [Usage.md](./Usage.md); dated change history lives in
[changelogs.md](./changelogs.md).

## Search and recall

- Natural-language search over starred repositories' README content.
- Retrieval pipeline: dense candidate retrieval (`fetchK`), a dense confidence gate, a conditional
  lexical safety net, conditional RRF fusion, then MMR reranking with a per-repo cap.
- Rare-token lexical triggering, bypassed when dense top-1 is both highly confident and lexically
  aligned with the query; tiny-corpus high-confidence queries skip the lexical branch entirely.
- Lexical candidate pool is mixed (recent, oldest, and a broad deterministic window), not recency-only.
- Dimension compatibility guard: a query whose vector length disagrees with the index is rejected rather
  than scored meaninglessly.
- Local retrieval diagnostics: query and index dimensions, dense score distribution, lexical trigger
  reason, pool counters, corpus counts.
- Session-aware search and follow-up flow over existing local embeddings.
- Library browsing and session transcript views outside the main Recall workflow.

## Retrieval tuning (developer advanced mode)

Enabled by an explicit in-UI checkbox, persisted per auth scope. Exposes `fetchK`, `topK`, `mmrLambda`,
`maxChunksPerRepo`, `lexicalTop1Threshold`, `lexicalTop5MeanThreshold`, and a `Rebuild Embeddings`
action. Includes a guidance warning when `fetchK < topK * 6`, and a standing warning that advanced
tuning can reduce relevance, speed, or efficiency. See [Usage §10.1](./Usage.md).

## Indexing

- GitHub OAuth and PAT authentication paths.
- Star sync with pagination handling, user-triggered via `Fetch Stars`.
- Checksum-based diff sync for new, changed, and removed stars.
- README fetch pipeline with missing/failure tracking: a transient failure preserves stored text,
  validators, checksum, and chunks, then marks the repository for retry; 404 is a stable known-empty
  state; 304 preserves stored content.
- Retry waits are abortable and honor GitHub rate limits; star and fork counts refresh even when other
  repository metadata is unchanged.
- Adaptive batched README ingestion pipeline (feature-flagged via `VITE_README_BATCH_PIPELINE_V2`).
- Local chunking, normalization, quality filtering, and embedding generation.
- Embedding worker pool with micro-batching, adaptive downshift under memory pressure, checkpoint
  resume via `index_meta`, and deterministic WebGPU to WASM backend fallback.
- Browser embedding capability probe with model recommendation: `onnx-community/embeddinggemma-300m-ONNX`
  on strong desktop with WebGPU, `Xenova/all-MiniLM-L6-v2` on mobile, weak desktop, or no WebGPU.
- Opt-in local Ollama embeddings, restricted to localhost endpoints, with automatic fallback to browser
  embeddings when the endpoint is unhealthy.
- Large-library mode above a configurable repo threshold: prioritizes high-value repos first and stores a
  resume cursor so interrupted jobs continue without a full restart.
- One current embedding per chunk enforced, with model, dimension, and coverage readiness validation.
- Sync status distinguishes first sync from incremental sync and keeps embedding generation as the
  primary active stage when stages overlap.

## Answering

- Persistent chat sessions with ordered message history.
- Local providers: Ollama and LM Studio, behind an explicit local-provider consent toggle.
- In-browser provider: WebLLM, feature-flagged via `VITE_WEBLLM_ENABLED`, with consent required before
  the first model download and no GitHub token in any request.
- Remote providers: OpenAI-compatible endpoints, behind an explicit remote-provider consent toggle, with
  a visible "data is sent" notice in the composer.
- Deterministic provider fallback chain, and generation against an immutable request config so a later
  render cannot change the endpoint mid-request.
- Provider API keys optionally encrypted at rest via `VITE_LLM_SETTINGS_ENCRYPTION_KEY`.

## Workspace

- Route-based shell with `Setup`, `Recall`, `Library`, `Sessions`, and `Settings` surfaces.
- Authenticated route pages load lazily behind an accessible Suspense boundary at the shell outlet, so
  shell chrome stays visible while a chunk resolves. `/` and `/auth/callback` remain eager.
- Command palette (`Cmd/Ctrl+K`), `Cmd/Ctrl+,` for Settings, and `G` then `R`/`L`/`S` for
  Recall/Library/Sessions.
- First-time users are routed from `/app` to `/app/setup`. Users with repos but an incomplete index see a
  3-step onboarding stepper; returning users land on a home dashboard with a collapsible workspace guide
  and quick-nav cards.
- Workspace health and embedding run telemetry surfaced in-app: backend selection and fallback reason,
  throughput, checkpoint behavior, queue depth, worker pool downshift events.

## Privacy and data controls

- Every local store is scoped per authenticated GitHub identity: database, chat backups, provider
  settings, scoped preferences, and local logs. One identity never reads another's index, and the same
  identity keeps its workspace across OAuth token refreshes or PAT re-entry.
- Single-writer enforcement where Web Locks is available: one tab holds a lease per scope; a second tab is
  refused write access rather than silently last-writer-wins. Browsers without Web Locks retain the
  documented residual multi-tab risk.
- Confirmed local-data deletion across five categories (repository data, model caches, provider
  settings, scoped preferences, logs), attempting every category and reporting partial failure rather
  than false success. See [Usage §11](./Usage.md).
- Local diagnostic logs are redacted at capture, capped, expire after 7 days, and are deletable.
- Chat history backup in scoped IndexedDB with a scoped localStorage fallback; a scoped clear fails
  closed rather than reporting success when a storage backend cannot be written.

## Public landing page

Design system: "Midnight Minimal".

- CSS atmospheric gradient background with ambient drift animation.
- Bricolage Grotesque / Outfit / JetBrains Mono font stack.
- Solid card surfaces with a hot coral accent and scroll-triggered entrance animations.
- Hero contains a direct "Continue with GitHub" OAuth button (zero-click auth) plus a "Use a PAT
  instead" secondary CTA; authenticated visitors see "Open app".
- Compact auth section one scroll below the hero, with OAuth and PAT side by side.
- Lean static "How it works" 3-step section downstream of auth.
- Minimal footer with brand lockup, Star on GitHub pill, categorized resource and security link columns,
  theme-native badge pills (DeepWiki, MIT, STRIDE), and author attribution.
- Explicit read-only access trust badge in both the hero and the auth section.
