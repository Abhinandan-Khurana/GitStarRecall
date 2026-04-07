

# GitStarRecall

**Find your starred repos by memory, not by name.**



**GitStarRecall** is a local-first web app that turns your GitHub stars into a searchable memory system.

### Ask it like this

- "I starred a GraphQL security testing repo months ago, what was it?"
- "TypeScript auth starter with clear boundaries."

***TIP: add specific details for better results.***

### LLM chat

- "Recommend the best-fit repos for my use case."

> **This project exists because starred repos are great until your brain says, "I know what it does, but not what it is called."**

### Keywords

`github stars search` · `semantic search` · `local-first rag` · `browser embeddings` · `webllm` · `ollama` · `privacy-focused ai` · `vector search` · `MMR`

---

## Why This Exists

People star a lot of useful repos.
Later, they remember functionality, not names.
GitHub search is good, but semantic memory search is better for this exact problem.

GitStarRecall solves this by:

- Fetching your starred public repositories.
- Pulling README content and metadata.
- Chunking and embedding content locally.
- Letting you search in natural language.
- Optionally generating an LLM answer from the top local matches.

Full usage instructions:

- [Usage Docs](./docs/Usage.md)

---

## Core Principles

- Local-first by default.
- Security before convenience.
- Explainability over magic.
- Practical performance for real star counts (1k+ repos).

---

## Security Model (Short Version)

GitStarRecall is designed to keep your data in the browser unless you explicitly opt into remote LLM usage.

What stays local by default:

- GitHub star metadata.
- README content.
- Chunks and embeddings.
- Chat sessions and message history.
- GitHub-account-scoped local databases and settings, so one GitHub identity does not silently reuse another identity's local index.

What can go remote (opt-in only):

- Prompt context sent to a remote LLM provider when you enable it.

Built-in security posture:

- Strict CSP with explicit allowlist.
- OAuth code exchange via backend endpoint to avoid exposing client secret.
- Public landing now spells out that OAuth and PAT are both read-only paths for reading authorized public repositories.
- PAT fallback supported for power users who want a manual access path.
- Local data delete flow for cleanup/reset.
- Threat-model-driven docs in `docs/`.

Read more:

- [Architecture and PRD](./docs/tech-stack-architecture-security-prd.md)
- [STRIDE Review](./docs/threat-modeling-stride.md)
- [DFD diagram](./docs/dfd-diagrams.md)

---

## Product Capabilities

- Public landing page redesigned with a "Midnight Minimal" design system:
  - CSS atmospheric gradient background with ambient drift animation (Raycast-inspired),
  - Bricolage Grotesque / Outfit / JetBrains Mono font stack,
  - solid card surfaces with hot coral accent, scroll-triggered entrance animations,
  - hero contains a direct "Continue with GitHub" OAuth button (zero-click auth) plus a "Use a PAT instead" secondary CTA,
  - compact auth section one scroll below the hero with OAuth and PAT side-by-side,
  - lean static "How it works" 3-step section downstream of auth,
  - footer with links to docs, changelog, security, and MIT license,
  - explicit read-only access trust badge in hero and auth section.
- GitHub OAuth and PAT authentication paths.
- Route-based workspace with dedicated `Setup`, `Recall`, `Library`, `Sessions`, and `Settings` surfaces.
- Persistent app shell with workspace health, keyboard navigation, and command palette (`Cmd/Ctrl+K`).
- First-time users are auto-routed from `/app` to `/app/setup`; returning users see a compact onboarding stepper and collapsible interactive workspace guide on the home dashboard.
- Star sync with pagination handling (manual via `Fetch Stars`).
- Checksum-based diff sync for changed/new/removed stars.
- README fetch pipeline with missing/failure tracking.
- Adaptive batched README ingestion pipeline (feature-flagged rollout).
- Local chunking + embedding generation.
- GitHub-account-scoped local database/storage isolation for repos, embeddings, chat state, and runtime preferences.
- Browser embedding capability test with model recommendation (mobile-safe fallback).
- Persistent chat sessions with ordered messages.
- Library browsing and session transcript views outside the main Recall workflow.
- Session-aware search and follow-up flow on existing local embeddings.
- Local and remote LLM answer modes.
- Browser-local LLM mode via WebLLM (feature-flagged, explicit download consent).
- Embedding acceleration controls (batching, worker pool, backend fallback).
- Sync status that distinguishes first sync from incremental sync and keeps embedding generation as the primary active stage during overlap.

---

## Architecture Snapshot

```mermaid
flowchart LR
    A[Browser UI] --> B[GitHub API]
    A --> X[OAuth Exchange API]
    A --> C[Local DB: sql.js + OPFS]
    A --> C2[Chat Backup: IndexedDB/localStorage]
    A --> D[Embedding Runtime Selector]
    D --> D1[Browser Capability Test]
    D1 -->|strong desktop + WebGPU| E[Browser Embeddings: embeddinggemma]
    D1 -->|mobile / weak / no-WebGPU| E2[Browser Embeddings: Xenova/all-MiniLM-L6-v2]
    D --> G[Ollama Embeddings: qwen3-embedding:4b / qwen3-embedding:0.6b / mxbai-embed-large :opt-in]
    C --> Q[Search Pipeline v2]
    Q --> Q1[Dense Retrieval fetchK]
    Q1 --> Q2[Dense Confidence Check]
    Q2 -->|dense suspicious| Q3[Lexical Safety Net conditional]
    Q2 -->|dense healthy| Q5[MMR plus Repo Cap]
    Q3 --> Q4[Fusion RRF conditional]
    Q4 --> Q5[MMR plus Repo Cap]
    Q5 --> S[Final Top-K Search Results]
    Q --> M[Retrieval Diagnostics local]
    A --> F[LLM Provider Adapter]
    F --> W[WebLLM in Browser - opt-in]
    F --> L[Local LLM: Ollama/LM Studio - opt-in]
    F --> R[Remote OpenAI-Compatible - opt-in]
```



Notes:

- Star sync is user-triggered via `Fetch Stars`; search runs on existing local embeddings.
- Vector data is stored as Float32 blobs in local SQLite tables.
- Retrieval/search is local; no server-side vector index is required.
- The authenticated app now uses a route-based shell: `/app` auto-navigates first-time users to `/app/setup`; returning users see a home dashboard with onboarding stepper (if indexing incomplete), interactive workspace guide, and quick-nav cards.
- Browser embedding model is capability-driven (`embeddinggemma` on strong desktop, `Xenova/all-MiniLM-L6-v2` on mobile/weak/no-WebGPU); local Ollama embedding is opt-in.
- Retrieval path uses dense fetch + confidence gate + conditional lexical safety net + MMR with per-repo cap.
- WebLLM/local/remote generation paths are explicit opt-in with consent controls.

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- A GitHub OAuth app (recommended) or GitHub PAT with read access to the repositories you want to import

### Install

```bash
pnpm install
```

### Configure environment

Copy `.env.example` to `.env` and set values:

```bash
cp .env.example .env
```

Then follow the complete setup and environment guide:

- `docs/Usage.md`

### Run dev server

```bash
pnpm dev
```

### Production build

```bash
pnpm build
pnpm preview
```

---

## Developer Commands

- `pnpm dev` - start Vite dev server
- `pnpm lint` - run ESLint
- `pnpm test` - run Vitest test suite
- `pnpm build` - typecheck + production build
- `pnpm ci` - lint + test + build

---

## Usage Guide

For full setup, auth, deployment, runtime modes, tuning, and troubleshooting:

- `docs/Usage.md`

---

## Product Docs

- [CODE OF CONDUCT](./CODE_OF_CONDUCT.md)
- [SECURITY](./SECURITY.md)
- [Usage](./docs/Usage.md)
- [Embedding Acceleration Plan](./docs/embedding-acceleration-plan.md)
- [Architecture and PRD](./docs/tech-stack-architecture-security-prd.md)
- [Threat Modelling doc using STRIDE](./docs/threat-modeling-stride.md)
- [STRIDE Review](./docs/threat-modeling-stride.md)
- [Changelogs](./docs/changelogs.md)

---

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

We prioritize:

- security correctness,
- local-first behavior,
- deterministic tests,
- clear operational diagnostics.

---

## License

[MIT](./LICENSE)

---

## Author

- Made with <3 by [Abhinandan-Khurana](https://github.com/Abhinandan-Khurana)

