# Task Plan

- [x] Verify current `WebLLMDownloadDialog` accessibility behavior against requested ARIA/focus requirements.
- [x] Implement dialog semantics, focus management, escape handling, and focus trapping in `WebLLMDownloadDialog`.
- [x] Verify and fix `UsagePage` WebLLM selected-model initialization for non-WebLLM saved providers (sync + async paths).
- [x] Run relevant checks and document outcomes.

## Review

- Confirmed dialog previously lacked explicit `role="dialog"`, `aria-modal`, labelled/description wiring, initial focus placement, focus trap, and focus restore.
- Implemented keyboard/focus handling directly in `WebLLMDownloadDialog`:
  - ARIA semantics (`role`, `aria-modal`, `aria-labelledby`, `aria-describedby`)
  - initial focus on open
  - focus trap on Tab/Shift+Tab
  - Escape-to-close when not downloading
  - restore previously focused element when dialog closes.
- Confirmed `UsagePage` incorrectly seeded `webllmSelectedModel` from `sync.model`/`saved.model` even when saved provider was non-WebLLM.
- Updated both sync and async load paths to only use `*.model` for WebLLM provider; non-WebLLM providers now initialize WebLLM model from `webllmPreferredModel || webllmLastRecommendedModel || WEBLLM_PRIMARY_MODEL_ID` and only mark manual set when preferred model exists.
