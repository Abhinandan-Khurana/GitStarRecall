## Summary

<!-- Describe the user-visible or engineering outcome, not just the files changed. -->

## Findings and Problem Evidence

- Finding IDs: <!-- Example: #1, #18 -->
- Baseline commit/tag:
- Baseline failure or risk:
- Reproduction command, test, log, or artifact:

## Solution and Fix Evidence

- Implementation approach:
- Regression proof that fails before and passes after:
- Preserved behavior and invariants:

## Data, Migration, and Rollback

- [ ] No stored-data or schema change
- [ ] Migration is additive, idempotent, and covered by compatibility tests
- Migration/compatibility details:
- Rollback procedure:
- Evidence that rollback does not delete user data:

## Security and Privacy Impact

- [ ] No security or privacy boundary changes
- [ ] Security or privacy behavior changes and is described below
- Threat/data-flow notes:
- Secret, token, log, storage-scope, or dependency impact:

## Performance Impact

- [ ] No expected performance or bundle impact
- [ ] Improvement measured below
- [ ] Regression accepted and justified below
- Before/after bundle, latency, memory, or CPU evidence:

## UI, UX, and Accessibility

- [ ] No intentional DOM, copy, style, route, or interaction change
- [ ] Intentional UI/UX change described below
- [ ] Relevant viewport/theme/reduced-motion visual diffs reviewed
- [ ] Accessibility checks pass or exceptions are documented
- Screenshots or visual-diff links:

## Documentation and Operations

- [ ] Relevant documentation and examples updated
- [ ] Environment, deployment, monitoring, or runbook changes documented
- [ ] No documentation or operational change is needed (explain below)
- Notes:

## Exact Verification

<!-- Paste the exact commands and concise results. Do not substitute “CI is green” for evidence. -->

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test:coverage`
- [ ] `pnpm build`
- [ ] `pnpm check:bundle`
- [ ] `pnpm test:e2e`
- [ ] Migration/compatibility tests, if applicable
- [ ] Security/dependency checks, if applicable
- [ ] Vercel preview and live smoke checks, if applicable

```text
Command:
Result:
```

## Risk and Reviewer Focus

- Highest-risk behavior changed:
- Failure modes exercised:
- Files or flows requiring careful review:
- Follow-up work explicitly out of scope:
