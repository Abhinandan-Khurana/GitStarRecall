# GitStarRecall - DFD Diagrams

This doc includes a top-level Data Flow Diagram (DFD) with trust boundaries and a detailed DFD for core flows.

---

## 1) Top-Level DFD (With Trust Boundaries)

Trust boundaries:
- TB1: User device / browser runtime
- TB2: GitHub API boundary
- TB3: External LLM providers (optional)
- TB4: Local LLM providers on localhost (optional)
- TB5: Model artifact host/CDN boundary (embedding model downloads)

```mermaid
flowchart LR
  subgraph TB1["TB1: User Device (Browser)"]
    UI[UI: Landing + Usage]
    Auth[OAuth/PAT Handler]
    Sync[Stars Sync Engine]
    Orchestrator[Embedding Orchestrator]
    Pool[Embedding Worker Pool]
    Selector["Backend Selector (WebGPU/WASM)"]
    Checkpoint[Checkpoint Writer]
    DB[(SQLite WASM + sqlite-vec)]
    Chat[Chat Session Store]
    Query[Query + RAG]
  end

  subgraph TB2["TB2: GitHub API"]
    GH[GitHub REST API]
  end

  subgraph TB3["TB3: External LLM Providers (Optional)"]
    LLM[Remote LLM APIs]
  end

  subgraph TB4["TB4: Local LLM Providers (Optional)"]
    LocalLLM[Ollama / LM Studio]
  end

  subgraph TB5["TB5: Model Artifact Hosts (CDN/HF)"]
    ModelCDN["Model + tokenizer assets"]
  end

  UI --> Auth
  Auth -->|Token| Sync
  Sync -->|Stars/README| GH
  Sync -->|Repo/README| DB
  Sync -->|Chunks| Orchestrator
  Orchestrator --> Selector
  Orchestrator --> Pool
  Pool -->|Embeddings| DB
  Orchestrator --> Checkpoint
  Checkpoint --> DB
  Selector -->|runtime choice| Pool
  Pool -->|model download| ModelCDN
  Query -->|KNN + Filters| DB
  UI --> Query
  Query --> Chat
  Query -.->|Top-K Context opt-in| LLM
  Query -.->|Top-K Context opt-in| LocalLLM
```

---

## 2) Detailed DFD (Indexing + Query + Chat)

```mermaid
flowchart TD
  User[User] --> UI2[UI: Search, Sessions, Settings]

  UI2 --> Auth2[OAuth/PAT]
  Auth2 --> Token[Token in memory or encrypted store]

  UI2 --> Sync2[Sync Manager]
  Sync2 --> GH2[GitHub API]
  GH2 --> Sync2
  Sync2 --> Checksum[Checksum Compute]
  Checksum --> RepoStore[(SQLite: repos)]
  GH2 --> Readme[README Fetch]
  Readme --> Chunker["Chunk + Normalize"]
  Chunker --> Orchestrator2[Embedding Orchestrator]
  Orchestrator2 --> Selector2[Backend Selector]
  Orchestrator2 --> Pool2[Worker Pool]
  Pool2 --> VecStore[(SQLite vec0)]
  Orchestrator2 --> Checkpoint2[Checkpoint Writer]
  Checkpoint2 --> RepoStore
  Pool2 --> ModelCDN2["Model CDN/HF"]

  UI2 --> Query2[Query Engine]
  Query2 --> VecStore
  Query2 --> RepoStore
  Query2 --> SessionStore[(SQLite: chat_sessions)]
  Query2 --> MessageStore[(SQLite: chat_messages)]

  Query2 -.-> RemoteLLM["Remote LLM (opt-in)"]
  Query2 -.-> LocalLLM2["Local LLM (opt-in)"]
```

---

## 3) DFD Notes
- All repo data, embeddings, and chats live inside the browser (SQLite WASM).
- External providers are optional and receive only top-K snippets if enabled.
- Local providers are optional and may be blocked by CORS unless configured.
- Embedding acceleration path remains local-only; no README/chunk content is sent to model hosts beyond normal model file downloads.
