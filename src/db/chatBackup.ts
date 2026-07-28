import type { ChatMessageRecord, ChatSessionRecord } from "./types";

const BACKUP_DB_NAME = "gitstarrecall-chat-backup";
const BACKUP_DB_VERSION = 2;
const LEGACY_SESSIONS_STORE = "chat_sessions";
const LEGACY_MESSAGES_STORE = "chat_messages";
const SCOPED_SESSIONS_STORE = "chat_sessions_v2";
const SCOPED_MESSAGES_STORE = "chat_messages_v2";
const METADATA_STORE = "chat_backup_metadata";
const BY_SCOPE_INDEX = "by_backup_scope";
const BY_SCOPE_SESSION_INDEX = "by_backup_scope_session";
const BY_SCOPE_UPDATED_AT_INDEX = "by_backup_scope_updated_at";
const BY_SCOPE_CREATED_AT_INDEX = "by_backup_scope_created_at";
const LEGACY_LOCAL_SESSIONS_KEY = "gitstarrecall.chat.backup.sessions.v1";
const LEGACY_LOCAL_MESSAGES_KEY = "gitstarrecall.chat.backup.messages.v1";
const SCOPED_LOCAL_SESSIONS_PREFIX = "gitstarrecall.chat.backup.sessions.v2.";
const SCOPED_LOCAL_MESSAGES_PREFIX = "gitstarrecall.chat.backup.messages.v2.";
const MIGRATION_MARKER_PREFIX = "gitstarrecall.chat.backup.legacy-migrated.v2.";
const BACKEND_HISTORY_PREFIX = "gitstarrecall.chat.backup.backends.v2.";
const MAX_BACKUP_SESSIONS = 200;
const MAX_BACKUP_MESSAGES = 5000;
const OPEN_DATABASE_TIMEOUT_MS = 5000;
const BACKEND_LOST_DURING_CLEAR_MESSAGE =
  "A required chat backup backend became unavailable during scoped deletion";

type BackupSource = "indexeddb" | "local-storage";

export type ChatBackupScope = Readonly<{
  key: string;
  legacySessionPrefix: string;
}>;

export type ChatBackupSnapshot = {
  sessions: ChatSessionRecord[];
  messagesBySessionId: Record<string, ChatMessageRecord[]>;
  source: BackupSource | null;
};

type SnapshotInput = Pick<ChatBackupSnapshot, "sessions" | "messagesBySessionId">;

type ScopedSessionRecord = ChatSessionRecord & {
  backupKey: string;
  backupScope: string;
};

type ScopedMessageRecord = ChatMessageRecord & {
  backupKey: string;
  backupScope: string;
};

type MigrationMarker = {
  key: string;
  migratedAt: number;
};

type BackendHistory = {
  key: string;
  generation: number;
  authorities: BackupSource[];
  replicas: BackupSource[];
  updatedAt: number;
};

type BackendHistoryPayload = Omit<BackendHistory, "key" | "updatedAt">;

/**
 * Reads report three distinct outcomes so a thrown error is never mistaken for
 * an empty backend. Only "unavailable" (the API is absent) is a valid empty;
 * "error" means the bytes may still exist and must not be written over.
 */
type BackendRead<T> =
  | { status: "ok"; value: T }
  | { status: "unavailable" }
  | { status: "error"; error: unknown };

type ParseResult<T> = { status: "ok"; value: T } | { status: "error"; error: unknown };

function emptySnapshot(): SnapshotInput {
  return { sessions: [], messagesBySessionId: {} };
}

function readFailure(message: string, error: unknown): Error {
  return new Error(message, { cause: error });
}

function unscopedSession(record: ScopedSessionRecord): ChatSessionRecord {
  return {
    id: record.id,
    query: record.query,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function unscopedMessage(record: ScopedMessageRecord): ChatMessageRecord {
  return {
    id: record.id,
    sessionId: record.sessionId,
    role: record.role,
    content: record.content,
    sequence: record.sequence,
    createdAt: record.createdAt,
  };
}

const scopeTails = new Map<string, Promise<void>>();

function validateScope(scope: ChatBackupScope): ChatBackupScope {
  if (
    !scope ||
    typeof scope.key !== "string" ||
    scope.key.trim().length === 0 ||
    scope.key.includes("\u0000") ||
    typeof scope.legacySessionPrefix !== "string" ||
    scope.legacySessionPrefix.trim().length === 0
  ) {
    throw new Error("A non-empty chat backup scope and legacy session prefix are required");
  }
  return scope;
}

function enqueueScopes<T>(scopes: ChatBackupScope[], operation: () => Promise<T>): Promise<T> {
  const keys = [...new Set(scopes.map((scope) => validateScope(scope).key))].sort();
  const predecessors = keys.map((key) => scopeTails.get(key)?.catch(() => undefined));
  const result = Promise.all(predecessors).then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  for (const key of keys) {
    scopeTails.set(key, tail);
  }
  void tail.finally(() => {
    for (const key of keys) {
      if (scopeTails.get(key) === tail) {
        scopeTails.delete(key);
      }
    }
  });
  return result;
}

function enqueueScope<T>(scope: ChatBackupScope, operation: () => Promise<T>): Promise<T> {
  return enqueueScopes([scope], operation);
}

function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    const candidate = localStorage as Partial<Storage>;
    return typeof candidate.getItem === "function" &&
      typeof candidate.setItem === "function" &&
      typeof candidate.removeItem === "function"
      ? (candidate as Storage)
      : null;
  } catch {
    return null;
  }
}

function scopedSuffix(scope: ChatBackupScope): string {
  return encodeURIComponent(scope.key);
}

function localSessionsKey(scope: ChatBackupScope): string {
  return `${SCOPED_LOCAL_SESSIONS_PREFIX}${scopedSuffix(scope)}`;
}

function localMessagesKey(scope: ChatBackupScope): string {
  return `${SCOPED_LOCAL_MESSAGES_PREFIX}${scopedSuffix(scope)}`;
}

function migrationMarkerKey(scope: ChatBackupScope): string {
  return `${MIGRATION_MARKER_PREFIX}${scopedSuffix(scope)}`;
}

function backendHistoryKey(scope: ChatBackupScope): string {
  return `${BACKEND_HISTORY_PREFIX}${scopedSuffix(scope)}`;
}

function recordKey(scope: ChatBackupScope, id: string): string {
  return `${scope.key}\u0000${id}`;
}

function trimMessageList(messages: ChatMessageRecord[]): ChatMessageRecord[] {
  if (messages.length <= MAX_BACKUP_MESSAGES) return messages;
  const sorted = [...messages].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  return sorted.slice(sorted.length - MAX_BACKUP_MESSAGES);
}

function trimSessionList(sessions: ChatSessionRecord[]): ChatSessionRecord[] {
  if (sessions.length <= MAX_BACKUP_SESSIONS) return sessions;
  return [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))
    .slice(0, MAX_BACKUP_SESSIONS);
}

function boundSnapshot(snapshot: SnapshotInput): SnapshotInput {
  return {
    sessions: trimSessionList(snapshot.sessions),
    messagesBySessionId: groupMessagesBySession(
      trimMessageList(Object.values(snapshot.messagesBySessionId).flat()),
    ),
  };
}

function normalizedSnapshot(snapshot: SnapshotInput): SnapshotInput {
  return {
    sessions: [...snapshot.sessions].sort((a, b) => a.id.localeCompare(b.id)),
    messagesBySessionId: groupMessagesBySession(
      Object.values(snapshot.messagesBySessionId)
        .flat()
        .sort((a, b) => a.id.localeCompare(b.id)),
    ),
  };
}

function snapshotsEqual(left: SnapshotInput, right: SnapshotInput): boolean {
  return JSON.stringify(normalizedSnapshot(left)) === JSON.stringify(normalizedSnapshot(right));
}

function groupMessagesBySession(
  messages: ChatMessageRecord[],
): Record<string, ChatMessageRecord[]> {
  const grouped: Record<string, ChatMessageRecord[]> = {};
  for (const message of messages) {
    (grouped[message.sessionId] ??= []).push(message);
  }
  for (const messagesForSession of Object.values(grouped)) {
    messagesForSession.sort((a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence);
  }
  return grouped;
}

/** A missing key is a valid empty list; anything else must parse as an array. */
function parseArray<T>(raw: string | null): ParseResult<T[]> {
  if (raw === null) return { status: "ok", value: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { status: "error", error };
  }
  if (!Array.isArray(parsed)) {
    return { status: "error", error: new Error("Chat backup payload is not a JSON array") };
  }
  return { status: "ok", value: parsed as T[] };
}

function readStoragePair(
  storage: Storage,
  sessionsKey: string,
  messagesKey: string,
): BackendRead<{ sessions: ChatSessionRecord[]; messages: ChatMessageRecord[] }> {
  let rawSessions: string | null;
  let rawMessages: string | null;
  try {
    rawSessions = storage.getItem(sessionsKey);
    rawMessages = storage.getItem(messagesKey);
  } catch (error) {
    return { status: "error", error };
  }
  const sessions = parseArray<ChatSessionRecord>(rawSessions);
  if (sessions.status === "error") return { status: "error", error: sessions.error };
  const messages = parseArray<ChatMessageRecord>(rawMessages);
  if (messages.status === "error") return { status: "error", error: messages.error };
  return { status: "ok", value: { sessions: sessions.value, messages: messages.value } };
}

function readLocalScoped(scope: ChatBackupScope): BackendRead<SnapshotInput> {
  const storage = getStorage();
  if (!storage) return { status: "unavailable" };
  const raw = readStoragePair(storage, localSessionsKey(scope), localMessagesKey(scope));
  if (raw.status !== "ok") return raw;
  return {
    status: "ok",
    value: {
      sessions: raw.value.sessions,
      messagesBySessionId: groupMessagesBySession(raw.value.messages),
    },
  };
}

function writeAndVerify(storage: Storage, key: string, value: string): void {
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) {
    throw new Error(`Chat backup storage did not persist ${key}`);
  }
}

function removeAndVerify(storage: Storage, key: string): void {
  storage.removeItem(key);
  if (storage.getItem(key) !== null) {
    throw new Error(`Chat backup storage did not remove ${key}`);
  }
}

function writeLocalSnapshot(scope: ChatBackupScope, snapshot: SnapshotInput): boolean {
  const storage = getStorage();
  if (!storage) return false;
  const sessions = trimSessionList(snapshot.sessions);
  const messages = trimMessageList(Object.values(snapshot.messagesBySessionId).flat());
  writeAndVerify(storage, localSessionsKey(scope), JSON.stringify(sessions));
  writeAndVerify(storage, localMessagesKey(scope), JSON.stringify(messages));
  return true;
}

function toErrorMessage(error: Error | null): string {
  return error?.message ?? "unknown storage error";
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

async function completeWriteTransaction(
  transaction: IDBTransaction,
  completion: Promise<void>,
  pending: Promise<unknown>[],
): Promise<void> {
  try {
    await Promise.all([...pending, completion]);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The request error may already have aborted or completed the transaction.
    }
    await completion.catch(() => undefined);
    throw error;
  }
}

async function openBackupDb(): Promise<IDBDatabase> {
  const request = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    // v1 stores are deliberately retained as immutable legacy input.
    if (!database.objectStoreNames.contains(LEGACY_SESSIONS_STORE)) {
      database.createObjectStore(LEGACY_SESSIONS_STORE, { keyPath: "id" });
    }
    if (!database.objectStoreNames.contains(LEGACY_MESSAGES_STORE)) {
      const store = database.createObjectStore(LEGACY_MESSAGES_STORE, { keyPath: "id" });
      store.createIndex("by_session_id", "sessionId", { unique: false });
    }
    if (!database.objectStoreNames.contains(SCOPED_SESSIONS_STORE)) {
      const store = database.createObjectStore(SCOPED_SESSIONS_STORE, { keyPath: "backupKey" });
      store.createIndex(BY_SCOPE_INDEX, "backupScope", { unique: false });
      store.createIndex(BY_SCOPE_UPDATED_AT_INDEX, ["backupScope", "updatedAt"], { unique: false });
    }
    if (!database.objectStoreNames.contains(SCOPED_MESSAGES_STORE)) {
      const store = database.createObjectStore(SCOPED_MESSAGES_STORE, { keyPath: "backupKey" });
      store.createIndex(BY_SCOPE_INDEX, "backupScope", { unique: false });
      store.createIndex(BY_SCOPE_SESSION_INDEX, ["backupScope", "sessionId"], { unique: false });
      store.createIndex(BY_SCOPE_CREATED_AT_INDEX, ["backupScope", "createdAt"], { unique: false });
    }
    if (!database.objectStoreNames.contains(METADATA_STORE)) {
      database.createObjectStore(METADATA_STORE, { keyPath: "key" });
    }
  };
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const finish = (result: { database: IDBDatabase } | { error: Error }): void => {
      if (settled) {
        if ("database" in result) result.database.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      request.onblocked = null;
      if ("database" in result) resolve(result.database);
      else reject(result.error);
    };
    const timeout = setTimeout(() => {
      finish({ error: new Error("Timed out opening the chat backup database") });
    }, OPEN_DATABASE_TIMEOUT_MS);
    request.onsuccess = () => finish({ database: request.result });
    request.onerror = () => finish({ error: new Error(toErrorMessage(request.error)) });
    // A blocked request may later recover after the old connection closes. The
    // same bounded timer covers that wait; no unbounded pending operation is left.
    request.onblocked = () => undefined;
  });
}

async function withBackupDb<T>(fn: (database: IDBDatabase) => Promise<T>): Promise<T> {
  const database = await openBackupDb();
  try {
    return await fn(database);
  } finally {
    database.close();
  }
}

async function readBackendHistory(scope: ChatBackupScope): Promise<BackendHistoryPayload | null> {
  const proofs: BackendHistoryPayload[] = [];
  const validate = (value: unknown): BackendHistoryPayload => {
    const candidate = value as Partial<BackendHistoryPayload> | null;
    const validList = (items: unknown): items is BackupSource[] =>
      Array.isArray(items) &&
      items.every((item) => item === "indexeddb" || item === "local-storage");
    if (
      !candidate ||
      !Number.isSafeInteger(candidate.generation) ||
      (candidate.generation ?? -1) < 0 ||
      !validList(candidate.authorities) ||
      !validList(candidate.replicas)
    ) {
      throw new Error("Chat backup backend history proof is malformed");
    }
    return {
      generation: candidate.generation as number,
      authorities: [...new Set(candidate.authorities)].sort() as BackupSource[],
      replicas: [...new Set(candidate.replicas)].sort() as BackupSource[],
    };
  };
  const storage = getStorage();
  if (storage) {
    let raw: string | null;
    try {
      raw = storage.getItem(backendHistoryKey(scope));
    } catch (error) {
      throw readFailure("Failed to read chat backup backend history from localStorage", error);
    }
    if (raw !== null) {
      try {
        proofs.push(validate(JSON.parse(raw) as unknown));
      } catch (error) {
        throw readFailure("Failed to parse chat backup backend history", error);
      }
    }
  }
  if (isIndexedDbAvailable()) {
    const record = await withBackupDb(async (database) => {
      const transaction = database.transaction(METADATA_STORE, "readonly");
      const completion = wrapTransaction(transaction);
      const result = await wrapRequest(
        transaction.objectStore(METADATA_STORE).get(backendHistoryKey(scope)) as IDBRequest<
          BackendHistory | undefined
        >,
      );
      await completion;
      return result;
    });
    if (record) {
      proofs.push(validate(record));
    }
  }
  if (proofs.length === 0) return null;
  const generation = Math.max(...proofs.map((proof) => proof.generation));
  const freshest = proofs.filter((proof) => proof.generation === generation);
  const canonical = JSON.stringify(freshest[0]);
  if (freshest.some((proof) => JSON.stringify(proof) !== canonical)) {
    throw new Error("Chat backup backend history proofs conflict at the newest generation");
  }
  return freshest[0] ?? null;
}

async function writeBackendHistory(
  scope: ChatBackupScope,
  authorities: BackupSource[],
  requiredBackends?: ReadonlySet<BackupSource>,
): Promise<void> {
  const previous = await readBackendHistory(scope);
  const indexedDbAvailable = isIndexedDbAvailable();
  const localStorageAvailable = getStorage() !== null;
  if (
    (previous?.replicas.includes("indexeddb") && !indexedDbAvailable) ||
    (previous?.replicas.includes("local-storage") && !localStorageAvailable)
  ) {
    throw new Error("Cannot advance chat backup history while a proof replica is unavailable");
  }
  const payload: BackendHistoryPayload = {
    generation: (previous?.generation ?? 0) + 1,
    authorities: [...new Set(authorities)].sort() as BackupSource[],
    replicas: [
      ...(indexedDbAvailable ? (["indexeddb"] as const) : []),
      ...(localStorageAvailable ? (["local-storage"] as const) : []),
    ],
  };
  const errors: unknown[] = [];
  const written = new Set<BackupSource>();
  if (isIndexedDbAvailable()) {
    try {
      await withBackupDb(async (database) => {
        const transaction = database.transaction(METADATA_STORE, "readwrite");
        const completion = wrapTransaction(transaction);
        transaction.objectStore(METADATA_STORE).put({
          key: backendHistoryKey(scope),
          ...payload,
          updatedAt: Date.now(),
        } satisfies BackendHistory);
        await completion;
      });
      written.add("indexeddb");
    } catch (error) {
      errors.push(error);
    }
  }
  const storage = getStorage();
  if (storage) {
    try {
      writeAndVerify(storage, backendHistoryKey(scope), JSON.stringify(payload));
      written.add("local-storage");
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to persist chat backup backend history");
  }
  if (requiredBackends && [...requiredBackends].some((backend) => !written.has(backend))) {
    throw new Error(BACKEND_LOST_DURING_CLEAR_MESSAGE);
  }
}

async function recordBackendUse(scope: ChatBackupScope, backend: BackupSource): Promise<void> {
  const previous = await readBackendHistory(scope);
  const authorities = new Set(previous?.authorities ?? []);
  authorities.add(backend);
  await writeBackendHistory(scope, [...authorities]);
}

async function assertKnownBackendsAvailable(
  scope: ChatBackupScope,
  operation: "clear" | "migrate",
): Promise<void> {
  const proof = await readBackendHistory(scope);
  const indexedDbAvailable = isIndexedDbAvailable();
  const localStorageAvailable = getStorage() !== null;
  if (!proof && (!indexedDbAvailable || !localStorageAvailable)) {
    throw new Error(
      `No usable chat backup storage proof is available; cannot ${operation} while a backend is unavailable and prior backend use cannot be excluded`,
    );
  }
  if (
    (proof?.authorities.includes("indexeddb") || proof?.replicas.includes("indexeddb")) &&
    !indexedDbAvailable
  ) {
    throw new Error(`Cannot ${operation} chat backup: a known IndexedDB backend is unavailable`);
  }
  if (
    (proof?.authorities.includes("local-storage") || proof?.replicas.includes("local-storage")) &&
    !localStorageAvailable
  ) {
    throw new Error(`Cannot ${operation} chat backup: a known localStorage backend is unavailable`);
  }
}

async function getAllByScope<T>(store: IDBObjectStore, scope: ChatBackupScope): Promise<T[]> {
  return wrapRequest(store.index(BY_SCOPE_INDEX).getAll(scope.key) as IDBRequest<T[]>);
}

async function enforceIndexedDbStoreLimit(
  store: IDBObjectStore,
  scope: ChatBackupScope,
  chronologicalIndex: string,
  limit: number,
): Promise<void> {
  const count = await wrapRequest(store.index(BY_SCOPE_INDEX).count(scope.key));
  let toDelete = count - limit;
  if (toDelete <= 0) return;
  const range = IDBKeyRange.bound(
    [scope.key, Number.NEGATIVE_INFINITY],
    [scope.key, Number.POSITIVE_INFINITY],
  );
  const request = store.index(chronologicalIndex).openKeyCursor(range, "next");
  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(new Error(toErrorMessage(request.error)));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || toDelete <= 0) {
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      toDelete -= 1;
      cursor.continue();
    };
  });
}

async function readIndexedDbScoped(scope: ChatBackupScope): Promise<SnapshotInput> {
  if (!isIndexedDbAvailable()) return emptySnapshot();
  return withBackupDb(async (database) => {
    const transaction = database.transaction(
      [SCOPED_SESSIONS_STORE, SCOPED_MESSAGES_STORE],
      "readonly",
    );
    const completion = wrapTransaction(transaction);
    const [sessionRecords, messageRecords] = await Promise.all([
      getAllByScope<ScopedSessionRecord>(transaction.objectStore(SCOPED_SESSIONS_STORE), scope),
      getAllByScope<ScopedMessageRecord>(transaction.objectStore(SCOPED_MESSAGES_STORE), scope),
    ]);
    await completion;
    return {
      sessions: sessionRecords.map(unscopedSession),
      messagesBySessionId: groupMessagesBySession(messageRecords.map(unscopedMessage)),
    };
  });
}

async function writeIndexedDbSnapshot(
  scope: ChatBackupScope,
  snapshot: SnapshotInput,
): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  await withBackupDb(async (database) => {
    const transaction = database.transaction(
      [SCOPED_SESSIONS_STORE, SCOPED_MESSAGES_STORE],
      "readwrite",
    );
    const completion = wrapTransaction(transaction);
    const sessionStore = transaction.objectStore(SCOPED_SESSIONS_STORE);
    const messageStore = transaction.objectStore(SCOPED_MESSAGES_STORE);
    for (const session of trimSessionList(snapshot.sessions)) {
      sessionStore.put({
        ...session,
        backupKey: recordKey(scope, session.id),
        backupScope: scope.key,
      } satisfies ScopedSessionRecord);
    }
    for (const message of trimMessageList(Object.values(snapshot.messagesBySessionId).flat())) {
      messageStore.put({
        ...message,
        backupKey: recordKey(scope, message.id),
        backupScope: scope.key,
      } satisfies ScopedMessageRecord);
    }
    await completeWriteTransaction(transaction, completion, [
      enforceIndexedDbStoreLimit(
        sessionStore,
        scope,
        BY_SCOPE_UPDATED_AT_INDEX,
        MAX_BACKUP_SESSIONS,
      ),
      enforceIndexedDbStoreLimit(
        messageStore,
        scope,
        BY_SCOPE_CREATED_AT_INDEX,
        MAX_BACKUP_MESSAGES,
      ),
    ]);
  });
  await recordBackendUse(scope, "indexeddb");
  return true;
}

async function upsertIndexedDbSession(
  scope: ChatBackupScope,
  session: ChatSessionRecord,
): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  await withBackupDb(async (database) => {
    const transaction = database.transaction(SCOPED_SESSIONS_STORE, "readwrite");
    const completion = wrapTransaction(transaction);
    const store = transaction.objectStore(SCOPED_SESSIONS_STORE);
    store.put({
      ...session,
      backupKey: recordKey(scope, session.id),
      backupScope: scope.key,
    } satisfies ScopedSessionRecord);
    await completeWriteTransaction(transaction, completion, [
      enforceIndexedDbStoreLimit(store, scope, BY_SCOPE_UPDATED_AT_INDEX, MAX_BACKUP_SESSIONS),
    ]);
  });
  await recordBackendUse(scope, "indexeddb");
  return true;
}

async function upsertIndexedDbMessage(
  scope: ChatBackupScope,
  message: ChatMessageRecord,
): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  await withBackupDb(async (database) => {
    const transaction = database.transaction(SCOPED_MESSAGES_STORE, "readwrite");
    const completion = wrapTransaction(transaction);
    const store = transaction.objectStore(SCOPED_MESSAGES_STORE);
    store.put({
      ...message,
      backupKey: recordKey(scope, message.id),
      backupScope: scope.key,
    } satisfies ScopedMessageRecord);
    await completeWriteTransaction(transaction, completion, [
      enforceIndexedDbStoreLimit(store, scope, BY_SCOPE_CREATED_AT_INDEX, MAX_BACKUP_MESSAGES),
    ]);
  });
  await recordBackendUse(scope, "indexeddb");
  return true;
}

async function deleteIndexedDbRecordsByScope(
  database: IDBDatabase,
  storeName: string,
  scope: ChatBackupScope,
): Promise<void> {
  const transaction = database.transaction(storeName, "readwrite");
  const completion = wrapTransaction(transaction);
  const request = transaction.objectStore(storeName).index(BY_SCOPE_INDEX).openKeyCursor(scope.key);
  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(new Error(toErrorMessage(request.error)));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      transaction.objectStore(storeName).delete(cursor.primaryKey);
      cursor.continue();
    };
  });
  await completion;
}

async function readIndexedDbScopedResult(
  scope: ChatBackupScope,
): Promise<BackendRead<SnapshotInput>> {
  if (!isIndexedDbAvailable()) return { status: "unavailable" };
  try {
    return { status: "ok", value: await readIndexedDbScoped(scope) };
  } catch (error) {
    return { status: "error", error };
  }
}

async function readLegacyIndexedDb(scope: ChatBackupScope): Promise<SnapshotInput> {
  if (!isIndexedDbAvailable()) return emptySnapshot();
  return withBackupDb(async (database) => {
    const transaction = database.transaction(
      [LEGACY_SESSIONS_STORE, LEGACY_MESSAGES_STORE],
      "readonly",
    );
    const completion = wrapTransaction(transaction);
    const [allSessions, allMessages] = await Promise.all([
      wrapRequest(
        transaction.objectStore(LEGACY_SESSIONS_STORE).getAll() as IDBRequest<ChatSessionRecord[]>,
      ),
      wrapRequest(
        transaction.objectStore(LEGACY_MESSAGES_STORE).getAll() as IDBRequest<ChatMessageRecord[]>,
      ),
    ]);
    await completion;
    const sessions = allSessions.filter((session) =>
      session.id.startsWith(scope.legacySessionPrefix),
    );
    const ids = new Set(sessions.map((session) => session.id));
    return {
      sessions,
      messagesBySessionId: groupMessagesBySession(
        allMessages.filter((message) => ids.has(message.sessionId)),
      ),
    };
  });
}

async function readLegacyIndexedDbResult(
  scope: ChatBackupScope,
): Promise<BackendRead<SnapshotInput>> {
  if (!isIndexedDbAvailable()) return { status: "unavailable" };
  try {
    return { status: "ok", value: await readLegacyIndexedDb(scope) };
  } catch (error) {
    return { status: "error", error };
  }
}

/** v1 keys are read-only input; this never writes or trims the legacy bytes. */
function readLegacyLocal(scope: ChatBackupScope): BackendRead<SnapshotInput> {
  const storage = getStorage();
  if (!storage) return { status: "unavailable" };
  const raw = readStoragePair(storage, LEGACY_LOCAL_SESSIONS_KEY, LEGACY_LOCAL_MESSAGES_KEY);
  if (raw.status !== "ok") return raw;
  const sessions = raw.value.sessions.filter(
    (session) =>
      typeof session?.id === "string" && session.id.startsWith(scope.legacySessionPrefix),
  );
  const ids = new Set(sessions.map((session) => session.id));
  const messages = raw.value.messages.filter(
    (message) => typeof message?.sessionId === "string" && ids.has(message.sessionId),
  );
  return {
    status: "ok",
    value: { sessions, messagesBySessionId: groupMessagesBySession(messages) },
  };
}

function mergeSnapshots(base: SnapshotInput, overlay: SnapshotInput): SnapshotInput {
  const sessions = new Map(base.sessions.map((session) => [session.id, session]));
  for (const session of overlay.sessions) sessions.set(session.id, session);
  const messages = new Map(
    Object.values(base.messagesBySessionId)
      .flat()
      .map((message) => [message.id, message]),
  );
  for (const message of Object.values(overlay.messagesBySessionId).flat()) {
    messages.set(message.id, message);
  }
  return {
    sessions: Array.from(sessions.values()),
    messagesBySessionId: groupMessagesBySession(Array.from(messages.values())),
  };
}

async function hasMigrationMarker(scope: ChatBackupScope): Promise<boolean> {
  const storage = getStorage();
  let localFailure: { error: unknown } | null = null;
  if (storage) {
    try {
      if (storage.getItem(migrationMarkerKey(scope)) === "1") return true;
    } catch (error) {
      // IndexedDB may still contain the durable marker.
      localFailure = { error };
    }
  }
  if (isIndexedDbAvailable()) {
    const found = await withBackupDb(async (database) => {
      const transaction = database.transaction(METADATA_STORE, "readonly");
      const completion = wrapTransaction(transaction);
      const record = await wrapRequest(
        transaction.objectStore(METADATA_STORE).get(migrationMarkerKey(scope)) as IDBRequest<
          MigrationMarker | undefined
        >,
      );
      await completion;
      return record !== undefined;
    });
    if (found) return true;
  }
  // Nothing proved the marker present, and a backend that could have held it
  // failed to answer: treating that as "not migrated" would resurrect cleared
  // legacy data.
  if (localFailure) {
    throw readFailure("Failed to read the chat backup migration marker", localFailure.error);
  }
  return false;
}

async function writeMigrationMarker(
  scope: ChatBackupScope,
  requireEveryBackend = false,
  requiredBackends?: ReadonlySet<BackupSource>,
): Promise<void> {
  let wrote = false;
  const errors: unknown[] = [];
  const written = new Set<BackupSource>();
  if (isIndexedDbAvailable()) {
    try {
      await withBackupDb(async (database) => {
        const transaction = database.transaction(METADATA_STORE, "readwrite");
        const completion = wrapTransaction(transaction);
        transaction.objectStore(METADATA_STORE).put({
          key: migrationMarkerKey(scope),
          migratedAt: Date.now(),
        } satisfies MigrationMarker);
        await completion;
      });
      wrote = true;
      written.add("indexeddb");
    } catch (error) {
      errors.push(error);
    }
  }
  const storage = getStorage();
  if (storage) {
    try {
      writeAndVerify(storage, migrationMarkerKey(scope), "1");
      wrote = true;
      written.add("local-storage");
    } catch (error) {
      errors.push(error);
    }
  }
  if (requireEveryBackend && errors.length > 0) {
    throw new AggregateError(errors, "Failed to persist the chat backup deletion marker");
  }
  if (requiredBackends && [...requiredBackends].some((backend) => !written.has(backend))) {
    throw new Error(BACKEND_LOST_DURING_CLEAR_MESSAGE);
  }
  if (!wrote && errors.length > 0) throw errors[0];
}

async function writeSnapshotWithFallback(
  scope: ChatBackupScope,
  snapshot: SnapshotInput,
): Promise<boolean> {
  let indexedDbError: unknown;
  if (isIndexedDbAvailable()) {
    try {
      return await writeIndexedDbSnapshot(scope, snapshot);
    } catch (error) {
      indexedDbError = error;
    }
  }
  const localOk = writeLocalSnapshot(scope, snapshot);
  if (localOk) {
    await recordBackendUse(scope, "local-storage");
    return true;
  }
  if (indexedDbError) throw indexedDbError;
  return false;
}

async function readScopedSnapshot(scope: ChatBackupScope): Promise<ChatBackupSnapshot> {
  const indexedDbRead = await readIndexedDbScopedResult(scope);
  const localRead = readLocalScoped(scope);
  if (localRead.status === "error") {
    // The v2 keys may still hold records we cannot see; callers must not write
    // a snapshot derived from this read.
    throw readFailure("Failed to read the scoped chat backup from localStorage", localRead.error);
  }
  if (indexedDbRead.status === "error") {
    throw readFailure("Failed to read the scoped chat backup from IndexedDB", indexedDbRead.error);
  }
  const indexedDb = indexedDbRead.status === "ok" ? indexedDbRead.value : emptySnapshot();
  const local = localRead.status === "ok" ? localRead.value : emptySnapshot();
  let merged = boundSnapshot(mergeSnapshots(local, indexedDb));
  const hasIndexedDb =
    indexedDb.sessions.length > 0 || Object.keys(indexedDb.messagesBySessionId).length > 0;
  const hasLocal = local.sessions.length > 0 || Object.keys(local.messagesBySessionId).length > 0;
  if (indexedDbRead.status === "ok" && localRead.status === "ok" && hasLocal) {
    await writeIndexedDbSnapshot(scope, merged);
    const verified = boundSnapshot(await readIndexedDbScoped(scope));
    if (!snapshotsEqual(merged, verified)) {
      throw new Error("IndexedDB chat backup promotion verification failed");
    }
    const storage = getStorage();
    if (!storage) {
      throw new Error("localStorage became unavailable during chat backup promotion");
    }
    removeAndVerify(storage, localSessionsKey(scope));
    removeAndVerify(storage, localMessagesKey(scope));
    await writeBackendHistory(scope, ["indexeddb"]);
    merged = verified;
  }
  return {
    sessions: [...merged.sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    messagesBySessionId: merged.messagesBySessionId,
    source:
      hasIndexedDb || (indexedDbRead.status === "ok" && hasLocal)
        ? "indexeddb"
        : hasLocal
          ? "local-storage"
          : null,
  };
}

async function ensureLegacyMigrated(scope: ChatBackupScope): Promise<void> {
  if (await hasMigrationMarker(scope)) return;
  // A legacy backend that is present but unreadable must not be mistaken for an
  // empty one: migrating past it would strand the v1 rows behind a permanent
  // marker. Both reads are non-destructive, so the v1 bytes survive the reject.
  const localLegacy = readLegacyLocal(scope);
  if (localLegacy.status === "unavailable") {
    throw new Error(
      "Cannot complete legacy chat backup migration while localStorage is unavailable",
    );
  }
  if (localLegacy.status === "error") {
    throw readFailure("Failed to read the legacy localStorage chat backup", localLegacy.error);
  }
  const indexedDbLegacy = await readLegacyIndexedDbResult(scope);
  if (indexedDbLegacy.status === "unavailable") {
    throw new Error("Cannot complete legacy chat backup migration while IndexedDB is unavailable");
  }
  if (indexedDbLegacy.status === "error") {
    throw readFailure("Failed to read the legacy IndexedDB chat backup", indexedDbLegacy.error);
  }
  const legacy = mergeSnapshots(localLegacy.value, indexedDbLegacy.value);
  const current = await readScopedSnapshot(scope);
  const merged = mergeSnapshots(legacy, current); // Existing scoped records win.
  if (merged.sessions.length > 0 || Object.keys(merged.messagesBySessionId).length > 0) {
    const persisted = await writeSnapshotWithFallback(scope, merged);
    if (!persisted) throw new Error("No durable storage is available for chat backup migration");
  }
  await writeMigrationMarker(scope);
}

async function clearScopeInternal(scope: ChatBackupScope): Promise<void> {
  await assertKnownBackendsAvailable(scope, "clear");
  const storage = getStorage();
  const requiredBackends = new Set<BackupSource>([
    ...(isIndexedDbAvailable() ? (["indexeddb"] as const) : []),
    ...(storage ? (["local-storage"] as const) : []),
  ]);
  if (requiredBackends.size === 0) {
    // Reporting success here would tell the caller the backup is gone while the
    // bytes are simply out of reach.
    throw new Error(
      "No usable chat backup storage backend is available; the scoped chat backup was not deleted",
    );
  }
  // The marker is committed first so legacy data cannot resurrect after a partial clear.
  await writeMigrationMarker(scope, true, requiredBackends);
  const errors: unknown[] = [];
  // Each captured backend must be cleared now. Skipping one that vanished mid
  // operation would report success while its scoped bytes survive to resurface.
  if (requiredBackends.has("indexeddb")) {
    if (!isIndexedDbAvailable()) {
      errors.push(new Error(BACKEND_LOST_DURING_CLEAR_MESSAGE));
    } else {
      try {
        await withBackupDb(async (database) => {
          await deleteIndexedDbRecordsByScope(database, SCOPED_SESSIONS_STORE, scope);
          await deleteIndexedDbRecordsByScope(database, SCOPED_MESSAGES_STORE, scope);
        });
        const remaining = await readIndexedDbScoped(scope);
        if (remaining.sessions.length || Object.keys(remaining.messagesBySessionId).length) {
          throw new Error("IndexedDB retained scoped chat backup records after deletion");
        }
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (requiredBackends.has("local-storage")) {
    const currentStorage = getStorage();
    if (!currentStorage) {
      errors.push(new Error(BACKEND_LOST_DURING_CLEAR_MESSAGE));
    } else {
      try {
        removeAndVerify(currentStorage, localSessionsKey(scope));
        removeAndVerify(currentStorage, localMessagesKey(scope));
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to clear the scoped chat backup");
  }
  await writeBackendHistory(scope, [], requiredBackends);
}

async function upsertSessionInternal(
  scope: ChatBackupScope,
  session: ChatSessionRecord,
): Promise<boolean> {
  await ensureLegacyMigrated(scope);
  if (isIndexedDbAvailable()) {
    try {
      return await upsertIndexedDbSession(scope, session);
    } catch {
      // Fall through to the localStorage recovery path.
    }
  }
  const current = await readScopedSnapshot(scope);
  const sessions = new Map(current.sessions.map((item) => [item.id, item]));
  sessions.set(session.id, session);
  return writeSnapshotWithFallback(scope, {
    sessions: Array.from(sessions.values()),
    messagesBySessionId: current.messagesBySessionId,
  });
}

async function upsertMessageInternal(
  scope: ChatBackupScope,
  message: ChatMessageRecord,
): Promise<boolean> {
  await ensureLegacyMigrated(scope);
  if (isIndexedDbAvailable()) {
    try {
      return await upsertIndexedDbMessage(scope, message);
    } catch {
      // Fall through to the localStorage recovery path.
    }
  }
  const current = await readScopedSnapshot(scope);
  const messages = new Map(
    Object.values(current.messagesBySessionId)
      .flat()
      .map((item) => [item.id, item]),
  );
  messages.set(message.id, message);
  return writeSnapshotWithFallback(scope, {
    sessions: current.sessions,
    messagesBySessionId: groupMessagesBySession(Array.from(messages.values())),
  });
}

export async function backupChatSession(
  scope: ChatBackupScope,
  session: ChatSessionRecord,
): Promise<boolean> {
  validateScope(scope);
  return enqueueScope(scope, () => upsertSessionInternal(scope, session));
}

export async function backupChatMessage(
  scope: ChatBackupScope,
  message: ChatMessageRecord,
): Promise<boolean> {
  validateScope(scope);
  return enqueueScope(scope, () => upsertMessageInternal(scope, message));
}

export async function backupChatSnapshot(
  scope: ChatBackupScope,
  snapshot: SnapshotInput,
): Promise<boolean> {
  validateScope(scope);
  return enqueueScope(scope, async () => {
    await ensureLegacyMigrated(scope);
    const current = await readScopedSnapshot(scope);
    return writeSnapshotWithFallback(scope, mergeSnapshots(current, snapshot));
  });
}

export async function loadChatBackup(scope: ChatBackupScope): Promise<ChatBackupSnapshot> {
  validateScope(scope);
  return enqueueScope(scope, async () => {
    await ensureLegacyMigrated(scope);
    return readScopedSnapshot(scope);
  });
}

export async function clearChatBackup(scope: ChatBackupScope): Promise<void> {
  validateScope(scope);
  return enqueueScope(scope, () => clearScopeInternal(scope));
}

function rewriteSessionId(id: string, from: ChatBackupScope, to: ChatBackupScope): string {
  return id.startsWith(from.legacySessionPrefix)
    ? `${to.legacySessionPrefix}${id.slice(from.legacySessionPrefix.length)}`
    : id;
}

export async function migrateChatBackupScope(
  from: ChatBackupScope,
  to: ChatBackupScope,
): Promise<void> {
  validateScope(from);
  validateScope(to);
  if (from.key === to.key) return;
  return enqueueScopes([from, to], async () => {
    await assertKnownBackendsAvailable(from, "migrate");
    await ensureLegacyMigrated(from);
    await ensureLegacyMigrated(to);
    const [source, target] = await Promise.all([readScopedSnapshot(from), readScopedSnapshot(to)]);
    if (source.sessions.length === 0 && Object.keys(source.messagesBySessionId).length === 0)
      return;

    const rewrittenSource: SnapshotInput = {
      sessions: source.sessions.map((session) => ({
        ...session,
        id: rewriteSessionId(session.id, from, to),
      })),
      messagesBySessionId: groupMessagesBySession(
        Object.values(source.messagesBySessionId)
          .flat()
          .map((message) => ({
            ...message,
            sessionId: rewriteSessionId(message.sessionId, from, to),
          })),
      ),
    };
    const merged = boundSnapshot(mergeSnapshots(rewrittenSource, target)); // Target wins collisions.
    const persisted = await writeSnapshotWithFallback(to, merged);
    if (!persisted) throw new Error("No durable storage is available for chat backup migration");
    const verified = await readScopedSnapshot(to);
    if (!snapshotsEqual(merged, verified)) {
      throw new Error("Target chat backup verification failed");
    }
    await clearScopeInternal(from);
  });
}
