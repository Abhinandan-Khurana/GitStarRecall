import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatMessageRecord, ChatSessionRecord } from "./types";
import {
  backupChatMessage,
  backupChatSession,
  clearChatBackup,
  loadChatBackup,
} from "./chatBackup";

class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

function session(overrides: Partial<ChatSessionRecord> = {}): ChatSessionRecord {
  return {
    id: "s-1",
    query: "vector db",
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

describe("chat backup fallback storage", () => {
  let originalLocalStorage: Storage | undefined;

  beforeEach(async () => {
    originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: new MemoryStorage(),
      configurable: true,
    });
    await clearChatBackup();
  });

  afterEach(async () => {
    await clearChatBackup();
    if (originalLocalStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
      return;
    }
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it("backs up and restores sessions/messages through local-storage fallback", async () => {
    await backupChatSession(session());
    await backupChatMessage(message());

    const snapshot = await loadChatBackup();

    expect(snapshot.source).toBe("local-storage");
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]?.id).toBe("s-1");
    expect(snapshot.messagesBySessionId["s-1"]).toHaveLength(1);
    expect(snapshot.messagesBySessionId["s-1"]?.[0]?.id).toBe("m-1");
  });

  it("prunes message backup to bounded size", async () => {
    await backupChatSession(session());
    const seededMessages = Array.from({ length: 5000 }, (_, index) =>
      message({
        id: `m-${index}`,
        sequence: index + 1,
        createdAt: 1700000002000 + index,
        content: `message-${index}`,
      }),
    );
    localStorage.setItem("gitstarrecall.chat.backup.messages.v1", JSON.stringify(seededMessages));

    await backupChatMessage(
      message({
        id: "m-5000",
        sequence: 5001,
        createdAt: 1700000007000,
        content: "message-5000",
      }),
    );

    const snapshot = await loadChatBackup();
    const restoredMessages = snapshot.messagesBySessionId["s-1"] ?? [];
    expect(restoredMessages).toHaveLength(5000);
    expect(restoredMessages[0]?.id).toBe("m-1");
    expect(restoredMessages.at(-1)?.id).toBe("m-5000");
  });

  it("clears backup data", async () => {
    await backupChatSession(session());
    await backupChatMessage(message());

    await clearChatBackup();
    const snapshot = await loadChatBackup();

    expect(snapshot.sessions).toHaveLength(0);
    expect(Object.keys(snapshot.messagesBySessionId)).toHaveLength(0);
    expect(snapshot.source).toBeNull();
  });
});
