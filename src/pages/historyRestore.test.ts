import { describe, expect, it } from "vitest";
import type { ChatMessageRecord, ChatSessionRecord } from "../db/types";
import {
  buildHistoryRestoreResult,
  createRestoreRequestTracker,
  invalidateHistoryRestore,
  loadHistoryBackupAfterPrimaryFailure,
  reconcileActiveSessionId,
  shouldRestoreOnAuthTransition,
} from "./historyRestore";

function session(overrides: Partial<ChatSessionRecord> = {}): ChatSessionRecord {
  return {
    id: "s-1",
    query: "vector search",
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord {
  return {
    id: "m-1",
    sessionId: "s-1",
    role: "user",
    content: "hello",
    sequence: 1,
    createdAt: 1700000002000,
    ...overrides,
  };
}

describe("history restore flow", () => {
  it("restores sessions/messages when auth transitions to authenticated", () => {
    expect(shouldRestoreOnAuthTransition(false, true)).toBe(true);
    expect(shouldRestoreOnAuthTransition(false, false)).toBe(false);
    expect(shouldRestoreOnAuthTransition(true, true)).toBe(false);

    const restored = buildHistoryRestoreResult({
      persistedSessions: [session()],
      previousActiveSessionId: null,
      listSessionMessages: () => [message()],
    });

    expect(restored.sessions).toHaveLength(1);
    expect(restored.messagesBySessionId["s-1"]).toHaveLength(1);
    expect(restored.activeSessionId).toBe("s-1");
    expect(restored.historyLoadState).toBe("loaded");
    expect(restored.sessionMode).toBe("continue");
  });

  it("reconciles active session id to a valid restored session", () => {
    const sessions = [session({ id: "s-1" }), session({ id: "s-2" })];
    expect(reconcileActiveSessionId("s-2", sessions)).toBe("s-2");
    expect(reconcileActiveSessionId("missing", sessions)).toBe("s-1");
    expect(reconcileActiveSessionId(null, sessions)).toBe("s-1");
    expect(reconcileActiveSessionId("s-1", [])).toBeNull();
  });

  it("keeps message history available even when restored sessions have empty results", () => {
    const restored = buildHistoryRestoreResult({
      persistedSessions: [session()],
      previousActiveSessionId: null,
      listSessionMessages: () => [message({ content: "persisted reply", role: "assistant" })],
    });

    expect(restored.sessions[0]?.results).toEqual([]);
    expect(restored.messagesBySessionId["s-1"]?.[0]?.content).toBe("persisted reply");
  });

  it("invalidates stale restore requests", () => {
    const tracker = createRestoreRequestTracker();
    const first = tracker.nextRequestId();
    const second = tracker.nextRequestId();

    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.isCurrent(second)).toBe(true);
  });

  it("invalidates a delayed account restore when its scope becomes unavailable", async () => {
    const tracker = createRestoreRequestTracker();
    const accountARequest = tracker.nextRequestId();
    let finishAccountARestore: (() => void) | undefined;
    const accountARestore = new Promise<void>((resolve) => {
      finishAccountARestore = resolve;
    }).then(() => tracker.isCurrent(accountARequest));

    invalidateHistoryRestore(tracker);
    finishAccountARestore?.();

    await expect(accountARestore).resolves.toBe(false);
  });

  it("contains a second backup-load rejection after the primary restore fails", async () => {
    const load = vi.fn().mockRejectedValue(new Error("backup unavailable"));
    const isCurrent = vi.fn(() => true);
    const onError = vi.fn();
    const onUnavailable = vi.fn();

    await expect(load()).rejects.toThrow("backup unavailable");
    await expect(
      loadHistoryBackupAfterPrimaryFailure({ load, isCurrent, onError, onUnavailable }),
    ).resolves.toBeNull();

    expect(load).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "backup unavailable" }),
    );
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it("silently discards a fallback that resolves after logout invalidates its scope", async () => {
    const tracker = createRestoreRequestTracker();
    const accountARequest = tracker.nextRequestId();
    let currentScope: string | null = "chat:github:42";
    let resolveFallback: ((value: { sessions: never[] }) => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<{ sessions: never[] }>((resolve) => {
          resolveFallback = resolve;
        }),
    );
    const isCurrent = () => tracker.isCurrent(accountARequest) && currentScope === "chat:github:42";
    const onError = vi.fn();
    const onUnavailable = vi.fn();

    const fallback = loadHistoryBackupAfterPrimaryFailure({
      load,
      isCurrent,
      onError,
      onUnavailable,
    });
    currentScope = null;
    invalidateHistoryRestore(tracker);
    resolveFallback?.({ sessions: [] });

    await expect(fallback).resolves.toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});
