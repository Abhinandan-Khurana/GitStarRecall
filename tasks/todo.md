# Task Plan

- [x] Inspect `UsagePage` WebLLM consent/download flow around the flagged lines and confirm stale-state path.
- [x] Implement a minimal fix so generation only resumes after consent/download state is committed.
- [x] Add/adjust tests if applicable and run relevant checks.
- [x] Summarize results in a review section.

## Review

- Root cause confirmed: `handleConfirmWebllmDownload` invoked `handleGenerateAnswer()` in the same render tick as consent/download state updates, so generation saw stale values.
- Fix implemented: introduced a `pendingWebllmGenerationRef` handshake and a post-commit `useEffect` gate that resumes generation only when `providerId === "webllm"`, `webllmConsent === true`, and `webllmAllowModelDownload === true`.
- Safety behavior: pending resume is canceled on explicit dialog cancel.
- Validation attempts were blocked by missing private-registry package access in this environment (details recorded in command output).
