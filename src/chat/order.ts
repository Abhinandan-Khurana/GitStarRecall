import type { ChatMessageRecord } from "../db/types";

export function compareChatMessagesByTimeAndSequence(a: ChatMessageRecord, b: ChatMessageRecord): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }

  return a.sequence - b.sequence;
}

export function sortChatMessages(messages: ChatMessageRecord[]): ChatMessageRecord[] {
  return [...messages].sort(compareChatMessagesByTimeAndSequence);
}
