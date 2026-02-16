# GitStarRecall QA + Release Checklist

## Automated Validation

Run:

```bash
npm run lint
npm run test
npm run build
```

Current automated suite covers:
- GitHub API client integration (pagination + README fetch handling).
- Checksum canonicalization and hash determinism.
- Chunking and markdown normalization behavior.
- Embedding helper normalization and blob conversion.
- Chat message ordering using `(created_at, sequence)`.
- Diff/sync planning for add/update/remove repo states.
- Semantic search hydration/regression behavior for embedded chunks.

## Manual Validation Required Before Release

- OAuth login and callback flow with real GitHub app.
- PAT fallback flow with real user token.
- End-to-end sync/search behavior against a real account (including 1k+ stars).
- Embedding acceleration pass:
  - micro-batch generation works
  - worker pool does not deadlock
  - checkpoint flush happens during long indexing
  - backend status shows `webgpu` or `wasm` with clear fallback reason
- Cross-platform browser verification: Windows, macOS, Linux (WebGPU path where available and WASM fallback path).
- LLM remote provider stream/cancel with real API key.
- Local provider connectivity checks (Ollama/LM Studio).
- Optional local runtime hardware checks:
  - CUDA path on Windows/Linux with NVIDIA
  - Metal/MPS-style path on macOS Apple Silicon
  - CPU fallback on all platforms
- Edge-case regression pass from `docs/manual-test-checklist.md`.

## Release Gate

Ship only when:
- Automated checks pass in CI.
- Manual validation checklist is fully marked complete.
- Security controls confirmed (CSP, token handling, local data wipe).
