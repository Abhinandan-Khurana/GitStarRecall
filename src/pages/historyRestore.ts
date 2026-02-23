import type { ChatMessageRecord, ChatSessionRecord, SearchResult } from "../db/types";

export type SearchSession = {
  id: string;
  query: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  results: SearchResult[];
};

export type HistoryLoadState = "idle" | "loading" | "loaded" | "empty" | "error";

export type HistoryRestoreResult = {
  sessions: SearchSession[];
  messagesBySessionId: Record<string, ChatMessageRecord[]>;
  activeSessionId: string | null;
  sessionMode: "new" | "continue";
  historyLoadState: Extract<HistoryLoadState, "loaded" | "empty">;
};

export type RestoreRequestTracker = {
  nextRequestId(): number;
  isCurrent(requestId: number): boolean;
};

export function mapPersistedSessionsToSearchSessions(
  persistedSessions: ChatSessionRecord[],
): SearchSession[] {
  return persistedSessions.map((session) => {
    const title = session.query.length > 48 ? `${session.query.slice(0, 48)}…` : session.query;
    return {
      id: session.id,
      query: session.query,
      title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      results: [],
    };
  });
}

export function reconcileActiveSessionId(
  previousActiveSessionId: string | null,
  sessions: Array<{ id: string }>,
): string | null {
  if (sessions.length === 0) {
    return null;
  }
  if (previousActiveSessionId && sessions.some((session) => session.id === previousActiveSessionId)) {
    return previousActiveSessionId;
  }
  return sessions[0].id;
}

export function shouldRestoreOnAuthTransition(
  previousIsAuthenticated: boolean,
  isAuthenticated: boolean,
): boolean {
  return !previousIsAuthenticated && isAuthenticated;
}

export function createRestoreRequestTracker(): RestoreRequestTracker {
  let activeRequestId = 0;
  return {
    nextRequestId(): number {
      activeRequestId += 1;
      return activeRequestId;
    },
    isCurrent(requestId: number): boolean {
      return requestId === activeRequestId;
    },
  };
}

export function buildHistoryRestoreResult(params: {
  persistedSessions: ChatSessionRecord[];
  previousActiveSessionId: string | null;
  listSessionMessages(sessionId: string): ChatMessageRecord[];
}): HistoryRestoreResult {
  const sessions = mapPersistedSessionsToSearchSessions(params.persistedSessions);
  const messagesBySessionId: Record<string, ChatMessageRecord[]> = {};

  for (const session of sessions) {
    messagesBySessionId[session.id] = params.listSessionMessages(session.id);
  }

  const activeSessionId = reconcileActiveSessionId(params.previousActiveSessionId, sessions);

  return {
    sessions,
    messagesBySessionId,
    activeSessionId,
    sessionMode: sessions.length > 0 ? "continue" : "new",
    historyLoadState: sessions.length > 0 ? "loaded" : "empty",
  };
}
