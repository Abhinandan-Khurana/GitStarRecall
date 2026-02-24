# Lessons

- When a reviewer/user points out a state-timing issue in React, avoid invoking side-effectful actions in the same tick as `setState`; gate continuation via committed state (`useEffect` or explicit continuation state).
