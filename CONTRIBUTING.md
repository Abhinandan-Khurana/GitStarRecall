# Contributing to GitStarRecall

Thanks for contributing.  
This project is local-first, security-focused, and performance-oriented.

If a proposed change improves UX but weakens security or privacy defaults, it should not be merged as-is.

---

## Contribution Principles

- Preserve local-first defaults.
- Keep security controls explicit and testable.
- Prefer boring, reliable code over clever fragile code.
- Add observability for non-trivial behavior.
- Update docs when behavior changes.

---

## Before You Start

Read these first:
- `docs/Usage.md`
- `docs/tech-stack-architecture-security-prd.md`
- `docs/threat-modeling-stride.md`
- `docs/security-review-stride.md`
- `docs/embedding-acceleration-plan.md`

If your change affects authentication, storage, or data flow, include a short threat-impact note in the PR description.

---

## Local Setup

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Required runtime assumptions:
- Node.js 20+
- pnpm 9+
- Browser with modern Worker and Indexed storage support

---

## Branch and Commit Expectations

- Use focused branches and focused commits.
- Keep PRs small enough to review safely.
- If you change behavior, include tests in same PR.
- If you change user-facing or security behavior, update docs in same PR.

Suggested commit style:
- `feat: ...`
- `fix: ...`
- `perf: ...`
- `docs: ...`
- `test: ...`

---

## UI Component Rule

- Do not install Radix packages directly for new UI components.
- Use shadcn CLI to add UI components so styling and component patterns stay consistent.

---

## Code Quality Gate (Required)

Run this before opening a PR:

```bash
pnpm lint
pnpm test
pnpm build
```

Or run the combined check:

```bash
pnpm ci
```

PRs that fail lint/test/build should not be merged.

---

## Security Rules (Non-Negotiable)

- Do not introduce default remote data exfiltration.
- Do not weaken CSP without explicit review and documented reason.
- Do not log secrets or tokens.
- Keep OAuth secret handling server-side only.
- Keep local data deletion path functional.
- Keep opt-in semantics clear for remote provider usage.

When touching auth/storage/network code, add or update tests.

---

## Performance Rules

For embedding/indexing changes:
- Measure impact, do not assume impact.
- Avoid regressions in throughput or UI responsiveness.
- Keep fallback behavior deterministic.
- Preserve progress telemetry and error diagnostics.
- For retrieval changes, include dense candidate policy, lexical trigger policy, and MMR/per-repo cap rationale.

When changing worker/batching/checkpoint logic:
- add or adjust unit tests.
- include benchmark notes in PR description (quick local numbers are acceptable).

---

## Testing Guidance

Add tests for:
- deterministic behavior,
- schema/data integrity,
- failure paths and fallback paths,
- ordering guarantees for chat/session persistence.

Prefer unit tests first.
Add integration-style tests only where unit tests are insufficient.

---

## Documentation Requirements

You must update docs when any of these change:
- architecture or data flow,
- security controls,
- env variables,
- user-visible behavior,
- operational usage instructions.

Likely docs to touch:
- `docs/Usage.md`
- `docs/tech-stack-architecture-security-prd.md`
- `docs/embedding-acceleration-plan.md`
- `docs/dfd-diagrams.md`
- `docs/threat-modeling-stride.md`
- `docs/security-review-stride.md`
- `docs/release-notes.md`
- `README.md` architecture Mermaid snapshot

---

## PR Template (Recommended)

Copy this into your PR description:

```md
## Summary

## Problem

## Solution

## Security Impact
- [ ] No change
- [ ] Change (details below)

## Performance Impact
- [ ] No change
- [ ] Improved
- [ ] Regressed (explain)

## Tests
- [ ] pnpm lint
- [ ] pnpm test
- [ ] pnpm build

## Docs Updated
- [ ] Yes
- [ ] Not needed (reason)
```

---

## Reporting Security Issues

Do not open public exploit details in regular issues.
Use GitHub Security Advisories / private disclosure path for sensitive reports.

Include:
- attack preconditions,
- reproduction steps,
- impact,
- proposed fix if available.

---

## Good First Contributions

- Improve error messages and diagnostics.
- Add or improve unit tests around edge cases.
- Tighten docs and setup clarity.
- Reduce performance overhead in deterministic, testable ways.

---

## Maintainer Notes

Author:
- [Abhinandan-Khurana](https://github.com/Abhinandan-Khurana)
