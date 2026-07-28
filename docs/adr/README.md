# Architecture decision record

The v0.14.0 release records its one material architectural trade-off: refusing a second browser tab's writes
instead of building a multi-writer coordinator over whole-database snapshots.

- [ADR-0005: One writing tab per identity, enforced by a Web Locks lease](0005-single-writer-web-locks-lease.md)

The concise release ledger in [`../remediation/v0.14.0.md`](../remediation/v0.14.0.md) records the other
implemented and deferred work. [`../../README.md`](../../README.md) and [`../Usage.md`](../Usage.md) are the
current architecture and operational references.
