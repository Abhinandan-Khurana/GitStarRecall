# Lessons

- When a reviewer/user points out a state-timing issue in React, avoid invoking side-effectful actions in the same tick as `setState`; gate continuation via committed state (`useEffect` or explicit continuation state).
- After accessibility feedback on modal UI, prefer using robust dialog semantics and lifecycle behaviors (labeling, initial focus, tab trap, escape close, focus restore) instead of visual-only overlays.
