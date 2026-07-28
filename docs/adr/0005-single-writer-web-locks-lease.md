# ADR-0005: One writing tab per identity, enforced by a Web Locks lease

- **Status:** Accepted
- **Recorded:** 2026-07-28

## Context

Each tab holds its own in-memory sql.js database and persists by overwriting the whole scoped snapshot. With two
tabs open on the same identity, this is last-writer-wins over the _entire database_: the second tab's save
silently discards everything the first tab did, including repositories, embeddings, and chat messages.

This is a data-loss defect, not a stale-view annoyance. It needed resolving before public launch.

Two shapes of solution exist. Make concurrent writers safe (a coordinator that merges or serializes across
tabs), or make concurrent writers impossible (elect one writer). The first is a genuine distributed-systems
problem implemented in application code over a non-transactional blob store.

## Decision

Elect a single writer per identity.

On construction, each `LocalDatabase` requests an exclusive Web Lock named for its scope key, using
`ifAvailable: true` so the request resolves immediately rather than queueing. The tab that obtains the lock
is the writer and holds it for its lifetime. A tab that does not obtain it is a reader: it can read and
render, but any write rejects with a typed `LocalDatabaseWriterLeaseError`.

Within the writing tab, writes are additionally serialized through one persistence queue so ordering is
deterministic.

## Consequences

- The whole-database clobber is eliminated for browsers with Web Locks. A second tab cannot destroy the
  first tab's work.
- **The lease deliberately does not fail closed.** When `navigator.locks` is absent — or in memory-only
  storage mode — availability resolves `true`, so such a browser retains the original last-writer-wins
  exposure. We accepted this because Web Locks is available across current browsers and failing closed
  without a detection mechanism would deny writes to every user of such a browser, including the only tab.
  Recorded as a residual risk rather than a solved problem.
- Secondary tabs are refused writes but are **not** notified when the writer commits, so they can display a
  stale view until reloaded.
- The user-visible model is "one active tab per account". This is a real usability cost for anyone who works
  in multiple tabs.
- The lock is held for the tab's lifetime rather than per transaction, which is simple and cheap but means
  ownership does not rotate opportunistically.
- Web Locks releases automatically when the owning tab closes or crashes, so a crashed writer does not
  permanently lock out the identity. This is precisely why the platform primitive was preferred over a
  hand-rolled lease with heartbeats and expiry.

## Alternatives considered

- **Multi-writer coordinator** with per-mutation locking, revision refresh, and commit broadcast. Rejected:
  it would reimplement distributed durability above a whole-database blob store without a demonstrated product
  requirement for concurrent writers.
- **Hand-rolled lease** in localStorage with timestamps and heartbeats. Rejected: it must reimplement crash
  detection and expiry that Web Locks provides natively, and a bug there causes either permanent lockout or
  the very corruption being prevented.
- **Do nothing, warn the user.** Rejected: silent whole-database loss is not an acceptable default.

## Evidence

- Lock name: `src/db/client.ts:37` — `DATABASE_WRITER_LOCK_PREFIX = "gitstarrecall:database-writer"`.
- Request: `src/db/client.ts:1347-1348` — `` `${DATABASE_WRITER_LOCK_PREFIX}:${this.scopeKey}` `` with
  `{ mode: "exclusive", ifAvailable: true }`.
- Typed refusal: `src/db/client.ts:51` — `export class LocalDatabaseWriterLeaseError extends Error`.
- Enforcement on the destructive path: `src/db/client.ts:2440` —
  `if (!(await this.writerLeaseAvailable)) throw new LocalDatabaseWriterLeaseError(...)`.
- Does not fail closed without the API: `src/db/client.ts:1333-1335` — memory mode or absent
  `navigator.locks` returns `Promise.resolve(true)`.
- No `BroadcastChannel` anywhere in `src/`, confirming the absence of commit notification.
