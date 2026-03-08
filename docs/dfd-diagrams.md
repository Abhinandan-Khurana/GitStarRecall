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
    UI[UI: Landing + App Shell]
    Auth[OAuth/PAT Handler]
    Shell["Workspace Router + Command Palette"]
    Sync[Stars Sync Engine]
    Orchestrator[Embedding Orchestrator]
    Pool[Embedding Worker Pool]
    CapProbe[Browser Capability Probe]
    Selector["Backend Selector (WebGPU/WASM)"]
    Checkpoint[Checkpoint Writer]
    DB[(SQLite WASM + sqlite-vec)]
    Chat[Chat Session Store]
    Query[Query + RAG]
    Dense[Dense Retrieval fetchK]
    Gate[Dense Confidence Gate]
    Lex[Lexical Safety Net conditional]
    Fuse[Fusion RRF conditional]
    Diversify[MMR + Repo Cap]
    Diag[Diagnostics Logger local]
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
  UI --> Shell
  Auth -->|Token| Sync
  Sync -->|Stars/README| GH
  Sync -->|Repo/README| DB
  Sync -->|Chunks| Orchestrator
  Orchestrator --> CapProbe
  CapProbe -->|model candidates| Pool
  Orchestrator --> Selector
  Orchestrator --> Pool
  Pool -->|Embeddings| DB
  Orchestrator --> Checkpoint
  Checkpoint --> DB
  Selector -->|runtime choice| Pool
  Pool -->|model download| ModelCDN
  Query --> Dense
  Dense --> Gate
  Gate -->|healthy| Diversify
  Gate -.->|suspicious| Lex
  Lex -.-> Fuse
  Fuse --> Diversify
  Diversify -->|KNN + Filters| DB
  Diversify --> Diag
  UI --> Query
  Query --> Chat
  Query -.->|Top-K Context opt-in| LLM
  Query -.->|Top-K Context opt-in| LocalLLM
```

---

## 2) Detailed DFD (Indexing + Query + Chat)

```mermaid
flowchart TD
  User[User] --> UI2[UI: Setup, Recall, Library, Sessions, Settings]

  UI2 --> Auth2[OAuth/PAT]
  Auth2 --> Token[Token in memory plus auth-scoped local persistence keys]

  UI2 --> Sync2[Sync Manager]
  UI2 --> CapUI["Embedding Capability UI (diagnostics)"]
  Sync2 --> GH2[GitHub API]
  GH2 --> Sync2
  Sync2 --> Checksum[Checksum Compute]
  Checksum --> RepoStore[(SQLite: repos)]
  GH2 --> Readme[README Fetch]
  Readme --> Chunker["Chunk + Normalize + Quality Filter"]
  Chunker --> ProfileFmt["Retrieval Profile Formatter"]
  ProfileFmt --> CapProbe2["Browser Capability Probe + Model Candidate Order"]
  CapProbe2 --> Orchestrator2
  ProfileFmt --> Orchestrator2
  Orchestrator2[Embedding Orchestrator]
  Orchestrator2 --> Selector2[Backend Selector]
  Orchestrator2 --> Pool2[Worker Pool]
  Pool2 --> VecStore[(SQLite vec0)]
  Orchestrator2 --> Checkpoint2[Checkpoint Writer]
  Checkpoint2 --> RepoStore
  Pool2 --> ModelCDN2["Model CDN/HF"]

  UI2 --> Query2[Query Engine]
  Query2 --> Guard["Dimension Compatibility Guard"]
  Guard --> Dense2["Dense Candidate Retrieval fetchK"]
  Dense2 --> Confidence2["Dense Confidence Check"]
  Confidence2 -->|healthy| Rerank2["MMR + Per-Repo Cap"]
  Confidence2 -.->|suspicious| Lex2["Lexical Safety Net"]
  Lex2 -.-> Fuse2["RRF Fusion"]
  Fuse2 --> Rerank2
  Rerank2 --> VecStore
  Query2 --> RepoStore
  Query2 --> SessionStore[(SQLite: chat_sessions)]
  Query2 --> MessageStore[(SQLite: chat_messages)]
  UI2 --> CustomWarn["Custom Model Warning Path"]
  UI2 --> SudoToggle["Developer Advanced Mode Toggle + Warning"]
  SudoToggle --> Query2
  CustomWarn --> Query2

  Query2 -.-> RemoteLLM["Remote LLM (opt-in)"]
  Query2 -.-> LocalLLM2["Local LLM (opt-in)"]
```

---

## 3) DFD Notes
- All repo data, embeddings, and chats live inside the browser (SQLite WASM).
- External providers are optional and receive only top-K snippets if enabled.
- Local providers are optional and may be blocked by CORS unless configured.
- Embedding acceleration path remains local-only; no README/chunk content is sent to model hosts beyond normal model file downloads.
