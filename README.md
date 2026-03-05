<p align="center">
  <img src="./static/gitstarrecall-logo.png" width="220" alt="GitStarRecall logo">
</p>

<h1 align="center">GitStarRecall</h1>

<p align="center">
  <strong>Find your starred repos by memory, not by name.</strong>
</p>

<p align="center">
  <a href="https://deepwiki.com/Abhinandan-Khurana/GitStarRecall"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
  <a href="./docs/Usage.md"><img alt="Usage Guide" src="https://img.shields.io/badge/docs-Usage_Guide-0ea5e9"></a>
  <a href="./docs/release-notes.md"><img alt="Release Notes" src="https://img.shields.io/badge/docs-Release_Notes-1d4ed8"></a>
  <a href="./docs/security-review-stride.md"><img alt="Security Review" src="https://img.shields.io/badge/security-STRIDE_Reviewed-059669"></a>
</p>

**GitStarRecall** is a local-first web app that turns your GitHub stars into a searchable memory system.

### Ask it like this

- "I starred a GraphQL security testing repo months ago, what was it?"
- "Show me TypeScript auth projects with clean architecture vibes."
- "Recommend the best-fit repos from my stars for my use case."

> **This project exists because starred repos are great until your brain says, "I know what it does, but not what it is called."**

### Keywords

`github stars search` · `semantic search` · `local-first rag` · `browser embeddings` · `webllm` · `ollama` · `privacy-focused ai` · `vector search`

---

## Why This Exists

People star a lot of useful repos.
Later, they remember functionality, not names.
GitHub search is good, but semantic memory search is better for this exact problem.

GitStarRecall solves this by:
- Fetching your starred repositories (including private stars if token scope allows).
- Pulling README content and metadata.
- Chunking and embedding content locally.
- Letting you search in natural language.
- Optionally generating an LLM answer from the top local matches.

Full usage instructions:
- `docs/Usage.md`

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

What can go remote (opt-in only):
- Prompt context sent to a remote LLM provider when you enable it.

Built-in security posture:
- Strict CSP with explicit allowlist.
- OAuth code exchange via backend endpoint to avoid exposing client secret.
- PAT fallback supported for power users.
- Local data delete flow for cleanup/reset.
- Threat-model-driven docs in `docs/`.

Read more:
- `docs/tech-stack-architecture-security-prd.md`
- `docs/threat-modeling-stride.md`
- `docs/dfd-diagrams.md`

---

## Product Capabilities

- GitHub OAuth and PAT authentication paths.
- Star sync with pagination handling (manual via `Fetch Stars`).
- Checksum-based diff sync for changed/new/removed stars.
- README fetch pipeline with missing/failure tracking.
- Adaptive batched README ingestion pipeline (feature-flagged rollout).
- Local chunking + embedding generation.
- Browser embedding capability test with model recommendation (mobile-safe fallback).
- Persistent chat sessions with ordered messages.
- Session-aware search and follow-up flow on existing local embeddings.
- Local and remote LLM answer modes.
- Browser-local LLM mode via WebLLM (feature-flagged, explicit download consent).
- Embedding acceleration controls (batching, worker pool, backend fallback).

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
    D --> G[Ollama Embeddings: qwen3-embedding:4b / qwen3-embedding:0.6b / mxbai-embed-large (opt-in)]
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
- Browser embedding model is capability-driven (`embeddinggemma` on strong desktop, `Xenova/all-MiniLM-L6-v2` on mobile/weak/no-WebGPU); local Ollama embedding is opt-in.
- Retrieval path uses dense fetch + confidence gate + conditional lexical safety net + MMR with per-repo cap.
- WebLLM/local/remote generation paths are explicit opt-in with consent controls.

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- A GitHub OAuth app (recommended) or GitHub PAT

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

- `docs/Usage.md`
- `docs/codex-claude-build-guide.md`
- `docs/embedding-acceleration-plan.md`
- `docs/tech-stack-architecture-security-prd.md`
- `docs/threat-modeling-stride.md`
- `docs/security-review-stride.md`
- `docs/release-notes.md`

---

## Contributing

Please read `CONTRIBUTING.md` before opening a PR.

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
