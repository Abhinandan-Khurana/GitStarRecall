# Contributing to GitStarRecall

Thanks for contributing.  
This project is local-first, security-focused, and performance-oriented.

By participating, you agree to follow the project's [Code of Conduct](./CODE_OF_CONDUCT.md).
Security disclosures must follow the project's [Security Policy](./SECURITY.md).

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

- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `docs/Usage.md` - canonical runtime, configuration, storage, and troubleshooting reference
- `docs/adr/README.md` - current multi-tab storage decision
- `docs/threat-modeling-stride.md`
- `docs/security-review-stride.md`
- `docs/embedding-acceleration-plan.md`

`docs/tech-stack-architecture-security-prd.md` and `docs/codex-claude-build-guide.md` are retained for
provenance only. Both are marked HISTORICAL and describe an architecture that was never shipped (most
notably `sqlite-vec` for vector search). Do not treat either as a description of the current system.

If your change affects authentication, storage, or data flow, include a short threat-impact note in the PR description.

---

## Local Setup

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Required runtime assumptions:

- Node.js 22 or 24 (active LTS lines; enforced by `engines`)
- pnpm 11.17.0 (pinned via `packageManager`)
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

Run the full gate before opening a PR. It is the same sequence CI runs in
`.github/workflows/quality.yml`:

```bash
pnpm ci
```

`pnpm ci` expands to, in order:

| Step                       | Command               |
| -------------------------- | --------------------- |
| Formatting                 | `pnpm format:check`   |
| Lint (zero warnings)       | `pnpm lint`           |
| Types                      | `pnpm typecheck`      |
| Component tests (jsdom)    | `pnpm test:component` |
| Unit tests with coverage   | `pnpm test:coverage`  |
| Coverage gates             | `pnpm check:coverage` |
| Production build           | `pnpm build`          |
| Bundle budget              | `pnpm check:bundle`   |
| Browser smoke (Playwright) | `pnpm test:e2e`       |

The last step needs a browser binary. Install it once before your first `pnpm ci` run, or that step
fails on a clean checkout:

```bash
pnpm exec playwright install --with-deps chromium
```

For a faster inner loop while developing, `pnpm lint`, `pnpm test`, and `pnpm build` are the useful
subset. `pnpm ci` is what must pass before review.

PRs that fail any gate step should not be merged.

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
- `docs/adr/0005-single-writer-web-locks-lease.md` when changing multi-tab storage behavior
- `docs/embedding-acceleration-plan.md`
- `docs/dfd-diagrams.md`
- `docs/threat-modeling-stride.md`
- `docs/security-review-stride.md`
- `docs/changelogs.md`
- `README.md` architecture Mermaid snapshot

Do not update `docs/tech-stack-architecture-security-prd.md` or `docs/codex-claude-build-guide.md`. Both
are frozen historical records.

---

## PR Template

GitHub preloads [`.github/pull_request_template.md`](./.github/pull_request_template.md) automatically.
Fill in every applicable section for any non-trivial change.

Read that file directly rather than a copy reproduced here, so the two cannot drift. It asks for, among
other things:

- finding IDs, baseline commit, and the baseline failure or risk,
- a regression proof that fails before the fix and passes after,
- migration, compatibility, and rollback notes, including evidence that rollback does not delete user data,
- security, privacy, storage-scope, and dependency impact,
- exact verification commands with pasted results.

"CI is green" is explicitly not accepted in place of pasted evidence.

---

## Reporting Security Issues

Do not open public exploit details in regular issues.
Follow `SECURITY.md` and use the private disclosure path for sensitive reports.

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
