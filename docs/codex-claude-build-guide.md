# GitStarRecall - Codex/Claude Build Guide (Starting Point + Prompting Workflow)

This guide is a starting point for using Codex or Claude Code to build the GitHub Stars RAG app efficiently. It provides a recommended first prompt, a follow-up prompting pattern, and a reading strategy for the planning docs:
- `docs/step-by-step-implementation-plan.md`
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
- Vite + React, SQLite WASM + `sqlite-vec-wasm`, `all-MiniLM-L6-v2` embeddings

Use it as the "rules of the build" and cross-check any proposed change against it.

### 2.2 `docs/step-by-step-implementation-plan.md`
Read this second to plan execution.
Focus on:
- The ordered tasks
- Exit criteria per task
- One-task-at-a-time discipline

Treat this as the canonical build sequence. Do not skip tasks.
Use `rought-UI-design` to match layout and styling as you build the UI tasks.

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
2) docs/step-by-step-implementation-plan.md
3) docs/embedding-acceleration-plan.md

Summarize the build constraints in 6-10 bullets.
Then start Task 1 from the plan only.
Do not jump ahead or combine tasks.
After finishing Task 1, report the exit criteria check.
```

Why this works:
- It anchors the agent on requirements.
- It prevents scope creep.
- It guarantees a single-task flow.

---

## 4) Ongoing Prompting Pattern (Each Next Step)
Use this template for each next task:

```text
Continue with Task N from docs/step-by-step-implementation-plan.md.
Do only this task.
Show what you changed and verify the exit criteria.
If anything blocks you, stop and explain the blocker.
```

Replace `N` with the next task number.

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
At major milestones (Tasks 1, 4, 7, 9, 11), ask the agent for:
- A short recap
- Any deviations from plan
- Updated next step

---

## 9) Final Delivery Prompt (End of MVP)
Once Task 9 is done (search UI), use:

```text
We have completed the MVP tasks. Please provide:
1) A short summary of what works.
2) Any known gaps or bugs.
3) The next recommended task from the plan.
```

---

## 10) Optional: If You Want Faster Iteration
You can allow the agent to batch two tasks **only** if both are small and independent. Otherwise, stick to one task at a time.

---

## 11) Reminder
If any new requirement appears, update the PRD doc first, then proceed.
