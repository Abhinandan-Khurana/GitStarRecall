# Security Policy

## Supported Versions

GitStarRecall is maintained as a fast-moving project. Security fixes are expected to land on the latest code first.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Most recent tagged release | Yes, when one exists |
| Older releases | No |

If you are running an older snapshot, upgrade to the latest version before reporting a suspected fixed issue.

## Reporting a Vulnerability

Do not open public GitHub issues or pull requests for suspected security vulnerabilities.

Instead, report them privately to [l0u51f3r007@gmail.com](mailto:l0u51f3r007@gmail.com) with the subject line `GitStarRecall security report`.

Please include:
- a clear description of the issue,
- attack preconditions and affected configuration,
- step-by-step reproduction details,
- proof-of-concept material if safe to share,
- the potential impact,
- any suggested mitigation or fix.

If the report involves leaked credentials, active exploitation, or user-safety risk, call that out explicitly at the top of the message.

## What to Expect

- Reports will be acknowledged as soon as practical.
- Triage will focus on severity, exploitability, and user impact.
- Status updates will be shared when there is meaningful progress.
- Valid reports may result in a coordinated fix and disclosure timeline.

Please keep vulnerability details private until a fix is available and maintainers confirm disclosure is safe.

## Scope and Priorities

Priority areas for this project include:
- authentication and token handling,
- local data isolation and deletion flows,
- README fetch and sync pipelines,
- CSP and remote-provider opt-in behavior,
- any path that could expose private repository content or user secrets.

Reports that only concern unsupported old versions or purely theoretical issues without a plausible impact may be deprioritized.

## Safe Harbor

If you make a good-faith effort to avoid privacy violations, data destruction, service disruption, or credential abuse while investigating, the project will treat your research as authorized and intended to improve user safety.
