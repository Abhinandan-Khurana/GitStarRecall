import type { ChatMessageRecord, ChatSessionRecord } from "./types";

const BACKUP_DB_NAME = "gitstarrecall-chat-backup";
const BACKUP_DB_VERSION = 1;
const SESSIONS_STORE = "chat_sessions";
const MESSAGES_STORE = "chat_messages";
const MESSAGES_BY_SESSION_INDEX = "by_session_id";
const LOCAL_SESSIONS_KEY = "gitstarrecall.chat.backup.sessions.v1";
const LOCAL_MESSAGES_KEY = "gitstarrecall.chat.backup.messages.v1";
const MAX_BACKUP_SESSIONS = 200;
const MAX_BACKUP_MESSAGES = 5000;

type BackupSource = "indexeddb" | "local-storage";

export type ChatBackupSnapshot = {
  sessions: ChatSessionRecord[];
  messagesBySessionId: Record<string, ChatMessageRecord[]>;
  source: BackupSource | null;
};

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function isLocalStorageAvailable(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }

  const candidate = localStorage as Partial<Storage>;
  return (
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function"
  );
}

function getStorage(): Storage | null {
  if (!isLocalStorageAvailable()) {
    return null;
  }

  return localStorage;
}

function toErrorMessage(error: Error | null): string {
  return error?.message ?? "unknown storage error";
}

function trimMessageList(messages: ChatMessageRecord[]): ChatMessageRecord[] {
  if (messages.length <= MAX_BACKUP_MESSAGES) {
    return messages;
  }
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  return sorted.slice(sorted.length - MAX_BACKUP_MESSAGES);
}

function trimSessionList(sessions: ChatSessionRecord[]): ChatSessionRecord[] {
  if (sessions.length <= MAX_BACKUP_SESSIONS) {
    return sessions;
  }
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  return sorted.slice(0, MAX_BACKUP_SESSIONS);
}

function groupMessagesBySession(messages: ChatMessageRecord[]): Record<string, ChatMessageRecord[]> {
  const grouped: Record<string, ChatMessageRecord[]> = {};
  for (const message of messages) {
    const current = grouped[message.sessionId] ?? [];
    grouped[message.sessionId] = [...current, message].sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt;
      }
      return a.sequence - b.sequence;
    });
  }
  return grouped;
}

function readLocalSessions(): ChatSessionRecord[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  const raw = storage.getItem(LOCAL_SESSIONS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as ChatSessionRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readLocalMessages(): ChatMessageRecord[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  const raw = storage.getItem(LOCAL_MESSAGES_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as ChatMessageRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalSessions(sessions: ChatSessionRecord[]): boolean {
  const storage = getStorage();
  if (!storage) {
    return false;
  }

  try {
    const trimmed = trimSessionList(sessions);
    storage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(trimmed));
    return true;
  } catch {
    return false;
  }
}

function writeLocalMessages(messages: ChatMessageRecord[]): boolean {
  const storage = getStorage();
  if (!storage) {
    return false;
  }

  try {
    const trimmed = trimMessageList(messages);
    storage.setItem(LOCAL_MESSAGES_KEY, JSON.stringify(trimmed));
    return true;
  } catch {
    return false;
  }
}

function upsertLocalSession(session: ChatSessionRecord): boolean {
  const sessions = readLocalSessions();
  const map = new Map(sessions.map((item) => [item.id, item]));
  map.set(session.id, session);
  return writeLocalSessions(Array.from(map.values()));
}

function upsertLocalMessage(message: ChatMessageRecord): boolean {
  const messages = readLocalMessages();
  const map = new Map(messages.map((item) => [item.id, item]));
  map.set(message.id, message);
  return writeLocalMessages(Array.from(map.values()));
}

function clearLocalBackup(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  storage.removeItem(LOCAL_SESSIONS_KEY);
  storage.removeItem(LOCAL_MESSAGES_KEY);
}

function wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(toErrorMessage(request.error)));
  });
}

function wrapTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error(toErrorMessage(transaction.error)));
    transaction.onabort = () => reject(new Error(toErrorMessage(transaction.error)));
  });
}

async function openBackupDb(): Promise<IDBDatabase> {
  const request = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(SESSIONS_STORE)) {
      database.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
    }
    if (!database.objectStoreNames.contains(MESSAGES_STORE)) {
      const messagesStore = database.createObjectStore(MESSAGES_STORE, { keyPath: "id" });
      messagesStore.createIndex(MESSAGES_BY_SESSION_INDEX, "sessionId", { unique: false });
    }
  };
  return wrapRequest(request);
}

async function withBackupDb<T>(fn: (database: IDBDatabase) => Promise<T>): Promise<T> {
  const database = await openBackupDb();
  try {
    return await fn(database);
  } finally {
    database.close();
  }
}

async function upsertSessionIndexedDb(session: ChatSessionRecord): Promise<boolean> {
  if (!isIndexedDbAvailable()) {
    return false;
  }

  try {
    await withBackupDb(async (database) => {
      const transaction = database.transaction([SESSIONS_STORE], "readwrite");
      transaction.objectStore(SESSIONS_STORE).put(session);
      await wrapTransaction(transaction);
    });
    return true;
  } catch {
    return false;
  }
}

async function upsertMessageIndexedDb(message: ChatMessageRecord): Promise<boolean> {
  if (!isIndexedDbAvailable()) {
    return false;
  }

  try {
    await withBackupDb(async (database) => {
      const transaction = database.transaction([MESSAGES_STORE], "readwrite");
      transaction.objectStore(MESSAGES_STORE).put(message);
      await wrapTransaction(transaction);
    });
    return true;
  } catch {
    return false;
  }
}

async function readAllSessionsIndexedDb(): Promise<ChatSessionRecord[]> {
  if (!isIndexedDbAvailable()) {
    return [];
  }

  try {
    return await withBackupDb(async (database) => {
      const transaction = database.transaction([SESSIONS_STORE], "readonly");
      const records = await wrapRequest(
        transaction.objectStore(SESSIONS_STORE).getAll() as IDBRequest<ChatSessionRecord[]>,
      );
      await wrapTransaction(transaction);
      return records;
    });
  } catch {
    return [];
  }
}

async function readAllMessagesIndexedDb(): Promise<ChatMessageRecord[]> {
  if (!isIndexedDbAvailable()) {
    return [];
  }

  try {
    return await withBackupDb(async (database) => {
      const transaction = database.transaction([MESSAGES_STORE], "readonly");
      const records = await wrapRequest(
        transaction.objectStore(MESSAGES_STORE).getAll() as IDBRequest<ChatMessageRecord[]>,
      );
      await wrapTransaction(transaction);
      return records;
    });
  } catch {
    return [];
  }
}

async function pruneIndexedDb(): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return;
  }

  await withBackupDb(async (database) => {
    const readTx = database.transaction([SESSIONS_STORE, MESSAGES_STORE], "readonly");
    const sessions = await wrapRequest(
      readTx.objectStore(SESSIONS_STORE).getAll() as IDBRequest<ChatSessionRecord[]>,
    );
    const messages = await wrapRequest(
      readTx.objectStore(MESSAGES_STORE).getAll() as IDBRequest<ChatMessageRecord[]>,
    );
    await wrapTransaction(readTx);

    const prunedSessions = trimSessionList(sessions);
    const prunedMessages = trimMessageList(messages);

    if (prunedSessions.length === sessions.length && prunedMessages.length === messages.length) {
      return;
    }

    const keepSessionIds = new Set(prunedSessions.map((session) => session.id));
    const keepMessageIds = new Set(prunedMessages.map((message) => message.id));
    const writeTx = database.transaction([SESSIONS_STORE, MESSAGES_STORE], "readwrite");
    const sessionsStore = writeTx.objectStore(SESSIONS_STORE);
    const messagesStore = writeTx.objectStore(MESSAGES_STORE);

    for (const session of sessions) {
      if (!keepSessionIds.has(session.id)) {
        sessionsStore.delete(session.id);
      }
    }

    for (const message of messages) {
      if (!keepMessageIds.has(message.id)) {
        messagesStore.delete(message.id);
      }
    }

    await wrapTransaction(writeTx);
  });
}

export async function backupChatSession(session: ChatSessionRecord): Promise<boolean> {
  const indexedDbOk = await upsertSessionIndexedDb(session);
  if (indexedDbOk) {
    await pruneIndexedDb();
    return true;
  }
  return upsertLocalSession(session);
}

export async function backupChatMessage(message: ChatMessageRecord): Promise<boolean> {
  const indexedDbOk = await upsertMessageIndexedDb(message);
  if (indexedDbOk) {
    await pruneIndexedDb();
    return true;
  }
  return upsertLocalMessage(message);
}

export async function backupChatSnapshot(params: {
  sessions: ChatSessionRecord[];
  messagesBySessionId: Record<string, ChatMessageRecord[]>;
}): Promise<boolean> {
  let wroteAny = false;

  for (const session of params.sessions) {
    const ok = await backupChatSession(session);
    wroteAny = wroteAny || ok;
  }

  const allMessages = Object.values(params.messagesBySessionId).flat();
  for (const message of allMessages) {
    const ok = await backupChatMessage(message);
    wroteAny = wroteAny || ok;
  }

  return wroteAny;
}

export async function loadChatBackup(): Promise<ChatBackupSnapshot> {
  const indexedDbSessions = await readAllSessionsIndexedDb();
  const indexedDbMessages = await readAllMessagesIndexedDb();

  if (indexedDbSessions.length > 0) {
    return {
      sessions: [...indexedDbSessions].sort((a, b) => b.updatedAt - a.updatedAt),
      messagesBySessionId: groupMessagesBySession(indexedDbMessages),
      source: "indexeddb",
    };
  }

  const localSessions = readLocalSessions();
  const localMessages = readLocalMessages();

  if (localSessions.length > 0) {
    return {
      sessions: [...localSessions].sort((a, b) => b.updatedAt - a.updatedAt),
      messagesBySessionId: groupMessagesBySession(localMessages),
      source: "local-storage",
    };
  }

  return {
    sessions: [],
    messagesBySessionId: {},
    source: null,
  };
}

export async function clearChatBackup(): Promise<void> {
  if (isIndexedDbAvailable()) {
    try {
      await withBackupDb(async (database) => {
        const transaction = database.transaction([SESSIONS_STORE, MESSAGES_STORE], "readwrite");
        transaction.objectStore(SESSIONS_STORE).clear();
        transaction.objectStore(MESSAGES_STORE).clear();
        await wrapTransaction(transaction);
      });
    } catch {
      // noop
    }
  }

  clearLocalBackup();
}
