# Contributing to GitStarRecall

Thanks for contributing.
This project is local-first, security-focused, and problem-solving centric.

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

1. Read the architecture and security docs:
- `docs/tech-stack-architecture-security-prd.md`
- `docs/threat-modeling-stride.md`
- `docs/embedding-acceleration-plan.md`

2. Check if there is an implementation plan task already covering your work:
- `docs/step-by-step-implementation-plan.md`

3. If your change affects authentication, storage, or data flow, include a short threat-impact note in the PR description.

---

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Required runtime assumptions:
- Node.js 20+
- npm 10+
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

## Code Quality Gate (Required)

Run this before opening a PR:

```bash
npm run lint
npm run test
npm run build
```

Or run the combined check:

```bash
npm run ci
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

When changing worker/batching/checkpoint logic:
- add/adjust unit tests,
- include benchmark notes in PR description (even if quick local numbers).

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
- implementation plan states.

Likely docs to touch:
- `docs/tech-stack-architecture-security-prd.md`
- `docs/step-by-step-implementation-plan.md`
- `docs/embedding-acceleration-plan.md`
- `docs/deployment-vercel.md`

---

## SPDX Header Guidance

For new source files, add a short SPDX license identifier header where appropriate.

Examples:

```ts
// SPDX-License-Identifier: Apache-2.0
```

```js
// SPDX-License-Identifier: Apache-2.0
```

```css
/* SPDX-License-Identifier: Apache-2.0 */
```

```md
<!-- SPDX-License-Identifier: Apache-2.0 -->
```

Notes:
- Keep the header at the top of the file.
- Do not retroactively reformat third-party vendored code.
- If a file has a different upstream license, preserve the upstream notice and do not overwrite it.

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
- [ ] npm run lint
- [ ] npm run test
- [ ] npm run build

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

This repository has also been iterated with help from multiple LLM collaborators for drafting, review, threat modeling, and debugging support.

no AI agents were harmed during the process lol
