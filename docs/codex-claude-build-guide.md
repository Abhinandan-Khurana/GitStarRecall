# GitStarRecall - Codex/Claude Build Guide (Starting Point + Prompting Workflow)

> **HISTORICAL — original greenfield bootstrapping guide. Retained for provenance; superseded.**
>
> This describes how the project was first scaffolded from the planning documents and references
> architecture that was never shipped. It is not a guide to working on the current codebase.
>
> For the current system, use these sources instead:
>
> - Architecture and setup: [`../README.md`](../README.md)
> - Runtime, configuration, storage, and troubleshooting: [`Usage.md`](Usage.md)
> - Security posture: [`security-review-stride.md`](security-review-stride.md) and
>   [`threat-modeling-stride.md`](threat-modeling-stride.md)
> - v0.14.0 remediation evidence: [`remediation/v0.14.0.md`](remediation/v0.14.0.md)

This guide is a starting point for using Codex or Claude Code to build the GitHub Stars RAG app efficiently. It provides a recommended first prompt, a follow-up prompting pattern, and a reading strategy for the planning docs:

- `docs/Usage.md`
- `docs/tech-stack-architecture-security-prd.md`
- `docs/embedding-acceleration-plan.md`
  It also references the UI baseline in `rought-UI-design`.

---

## 1) Purpose of This Guide

You are about to execute a multi-step build. The highest risk is skipping steps or mixing tasks. This guide ensures the agent:

- Reads the right docs at the right time.
- Works on one task at a time.
- Verifies exit criteria before moving on.
- Keeps security and architecture constraints consistent.

---

## 2) How to Read the Planning Docs

### 2.1 `docs/tech-stack-architecture-security-prd.md`

Read this first to lock design constraints and decisions.
Focus on:

- Tech stack and architecture flow
- Security requirements and threat model
- PRD requirements and MVP scope
- UI baseline from `rought-UI-design`
- Local provider requirements (Ollama, LM Studio) and opt-in rules
- RAG storage: SQLite WASM + `sqlite-vec-wasm`
- Design is reference-only; be creative and highlight security/local-first
- Landing page -> usage page flow after OAuth
- Session list UI with ability to continue existing chat sessions
- Public landing page with demo video and dev/security-friendly details
- Vite + React, SQLite WASM + `sqlite-vec-wasm`, capability-driven browser embeddings (`embeddinggemma` strong desktop, MiniLM fallback on mobile/weak/no-WebGPU)

Use it as the "rules of the build" and cross-check any proposed change against it.

### 2.2 `docs/Usage.md`

Read this second to align setup/runtime behavior.
Focus on:

- auth and environment setup
- usage and runtime toggles
- deployment and troubleshooting behavior

### 2.3 `docs/embedding-acceleration-plan.md`

Read this when implementing performance tasks.
Focus on:

- Current vs proposed embedding pipeline
- Micro-batching, checkpoint persistence, worker pool, backend fallback
- Cross-platform validation matrix (Windows/macOS/Linux)
- Tradeoffs, guardrails, and rollout order

---

## 3) Starting Prompt (First Run)

Copy-paste this as the first instruction to the agent:

```text
Read these docs:
1) docs/tech-stack-architecture-security-prd.md
2) docs/Usage.md
3) docs/embedding-acceleration-plan.md

Summarize the build constraints in 6-10 bullets.
Then suggest a concrete implementation order in 5-8 steps.
Do not jump ahead while implementing.
After finishing Step 1, report verification status.
```

Why this works:

- It anchors the agent on requirements.
- It prevents scope creep.
- It guarantees a single-task flow.

---

## 4) Ongoing Prompting Pattern (Each Next Step)

Use this template for each next task:

```text
Continue with Step N from your implementation order.
Do only this step.
Show what you changed and verify completion checks.
If anything blocks you, stop and explain the blocker.
```

Replace `N` with the next step number.

---

## 5) When to Pause or Replan

The agent must pause and ask for confirmation if:

- A decision is needed that affects architecture or security.
- The task requires adding dependencies not in the stack.
- A task cannot meet exit criteria.

Prompt example:

```text
We need to choose between Next.js and Vite before proceeding.
Please confirm which one to use.
```

---

## 6) Rules for Efficient Execution

- One task at a time.
- Do not implement features from later tasks early.
- If a task fails, undo only that task’s changes.
- Keep security requirements in mind during each task.
- Keep a simple log of what was done.

---

## 7) Suggested Progress Log Format

After each task, the agent should report:

- Task name
- Files changed
- Exit criteria status
- Any follow-up or risks

Example:

```text
Task 1 - Project Scaffolding
Files changed: package.json, src/app/page.tsx
Exit criteria: met (app renders, no console errors)
Risks: none
```

---

## 8) Lightweight Checkpoints

At major milestones (Steps 1, 3, 5, 7), ask the agent for:

- A short recap
- Any deviations from plan
- Updated next step

---

## 9) Final Delivery Prompt

Once your planned steps are done, use:

```text
We have completed the planned steps. Please provide:
1) A short summary of what works.
2) Any known gaps or bugs.
3) The next recommended improvement.
```

---

## 10) Optional: If You Want Faster Iteration

You can allow the agent to batch two tasks **only** if both are small and independent. Otherwise, stick to one task at a time.

---

## 11) Reminder

If any new requirement appears, update the PRD doc first, then proceed.
