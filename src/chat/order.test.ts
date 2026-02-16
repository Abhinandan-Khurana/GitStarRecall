import { sortChatMessages } from "./order";
import type { ChatMessageRecord } from "../db/types";

function msg(
  id: string,
  createdAt: number,
  sequence: number,
  role: ChatMessageRecord["role"] = "user",
): ChatMessageRecord {
  return {
    id,
    sessionId: "session-1",
    role,
    content: id,
    sequence,
    createdAt,
  };
}

describe("chat ordering", () => {
  test("sorts by created_at then sequence", () => {
    const input = [
      msg("m3", 1000, 3),
      msg("m2", 1000, 2),
      msg("m1", 900, 1),
      msg("m4", 1100, 1),
    ];

    const sorted = sortChatMessages(input);
    expect(sorted.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });
});
