// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatBackupSnapshot } from "../db/chatBackup";
import { EMBEDDING_DIMENSION_META_KEY } from "../db/embeddingIntegrity";
import type { ChatMessageRecord, ChatSessionRecord, SearchResult } from "../db/types";
import { DEFAULT_BROWSER_EMBEDDING_MODEL } from "../embeddings/retrievalProfile";
import UsagePage from "./UsagePage";

const mocks = vi.hoisted(() => {
  const auth = {
    accessToken: "token" as string | null,
    authScopeIdentity: "github:42" as string | null,
    isAuthenticated: true,
    authMethod: "oauth",
    loginWithPat: vi.fn(),
    beginOAuthLogin: vi.fn(),
    oauthConfig: { redirectUri: "http://localhost/auth/callback" },
    logout: vi.fn(),
  };

  const database = {
    storageMode: "opfs",
    getRepoCount: vi.fn(() => 1),
    getEmbeddingCount: vi.fn(() => 1),
    getEmbeddingHealth: vi.fn<() => { status: "ready"; dimension: number | null }>(() => ({
      status: "ready",
      dimension: null,
    })),
    getDominantEmbeddingModel: vi.fn<() => string | null>(() => null),
    listChatSessions: vi.fn<() => ChatSessionRecord[]>(() => []),
    listChatMessages: vi.fn<() => ChatMessageRecord[]>(() => []),
    upsertChatSession: vi.fn<(record: ChatSessionRecord) => Promise<void>>(async () => undefined),
    addChatMessage: vi.fn<(record: ChatMessageRecord) => Promise<void>>(async () => undefined),
    upsertIndexMeta: vi.fn(async () => undefined),
    clearIndexMetaValue: vi.fn(async () => undefined),
    getIndexMetaValue: vi.fn(() => null),
    findSimilarChunks: vi.fn<() => Promise<SearchResult[]>>(async () => []),
    clearAllData: vi.fn(async () => undefined),
    flushPendingEmbeddingCheckpoint: vi.fn(async () => undefined),
  };

  return {
    auth,
    database,
    getLocalDatabase: vi.fn(async () => database),
    loadChatBackup: vi.fn<() => Promise<ChatBackupSnapshot>>(async () => ({
      sessions: [],
      messagesBySessionId: {},
      source: "indexeddb",
    })),
    backupChatSnapshot: vi.fn(async () => undefined),
    captureLocalError: vi.fn(),
    clearLocalLogsStrict: vi.fn(async () => undefined),
    clearSettingsStrict: vi.fn(async () => undefined),
    clearModelCaches: vi.fn(async () => undefined),
    clearScopedPreferences: vi.fn(async () => undefined),
    unloadWebLLM: vi.fn(async () => undefined),
    executeUsageGeneration: vi.fn<
      (
        generation: unknown,
        dependencies: { controllerRef: { current: AbortController | null } },
      ) => Promise<void>
    >(async () => undefined),
    cancelPendingGeneration: vi.fn(() => null),
  };
});

vi.mock("../auth/useAuth", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
}));

vi.mock("../db/client", () => ({
  getLocalDatabase: mocks.getLocalDatabase,
}));

vi.mock("../db/chatBackup", () => ({
  loadChatBackup: mocks.loadChatBackup,
  backupChatSnapshot: mocks.backupChatSnapshot,
}));

vi.mock("../observability/localLog", () => ({
  captureLocalError: mocks.captureLocalError,
  captureLocalWarn: vi.fn(),
  clearLocalLogsStrict: mocks.clearLocalLogsStrict,
}));

vi.mock("../lib/settings", () => ({
  clearSettingsStrict: mocks.clearSettingsStrict,
}));

vi.mock("../localData/clearLocalDataPrimitives", () => ({
  clearModelCaches: mocks.clearModelCaches,
  clearScopedPreferences: mocks.clearScopedPreferences,
}));

vi.mock("../embeddings/browserCapability", () => ({
  recommendBrowserEmbeddingModel: vi.fn(async () => ({
    modelId: "test-model",
    modelCandidates: ["test-model"],
    reason: "test",
  })),
}));

vi.mock("../embeddings/Embedder", () => ({
  Embedder: class {
    async embed() {
      return new Float32Array([1, 0]);
    }
    terminate() {}
  },
}));

vi.mock("../llm/providers", () => {
  const definition = {
    id: "openai-compatible",
    label: "OpenAI compatible",
    kind: "remote",
    defaultBaseUrl: "https://example.test/v1",
    defaultModel: "test-model",
    requiresApiKey: false,
  };
  return {
    formatProviderError: (error: unknown) => String(error),
    getProviderById: () => ({ definition }),
    getProviderDefinitions: () => [definition],
    isWebLLMEnabled: () => false,
    unloadWebLLM: mocks.unloadWebLLM,
  };
});

vi.mock("../hooks/useProviderSettingsPersistence", () => ({
  useProviderSettingsPersistence: () => ({
    providerId: "openai-compatible",
    setProviderId: vi.fn(),
    providerBaseUrl: "https://example.test/v1",
    setProviderBaseUrl: vi.fn(),
    providerModel: "test-model",
    setProviderModel: vi.fn(),
    providerApiKey: "",
    setProviderApiKey: vi.fn(),
    ollamaPreferredChatModel: "llama3.1:8b",
    setOllamaPreferredChatModel: vi.fn(),
    allowRemoteProvider: true,
    setAllowRemoteProvider: vi.fn(),
    allowLocalProvider: true,
    setAllowLocalProvider: vi.fn(),
    webllmConsent: false,
    setWebllmConsent: vi.fn(),
    webllmSelectedModel: "",
    setWebllmSelectedModel: vi.fn(),
    webllmModelManuallySet: false,
    setWebllmModelManuallySet: vi.fn(),
    webllmLastRecommendedModel: "",
    setWebllmLastRecommendedModel: vi.fn(),
    saveState: "saved",
    statusMessage: null,
  }),
}));

vi.mock("../llm/usageGenerationAdapter", () => ({
  executeUsageGeneration: mocks.executeUsageGeneration,
}));

vi.mock("../llm/generationState", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm/generationState")>();
  return {
    ...actual,
    cancelPendingGeneration: mocks.cancelPendingGeneration,
  };
});

vi.mock("../components/DeleteLocalDataDialog", () => ({
  DeleteLocalDataDialog: (props: {
    open: boolean;
    pending: boolean;
    blocked: boolean;
    blockReason?: string;
    failures: Array<{ category: string; message: string }>;
    onCancel: () => void;
    onConfirm: () => void;
  }) =>
    props.open ? (
      <section aria-label="delete-dialog">
        <p>Delete confirmation</p>
        {props.blockReason ? <p>{props.blockReason}</p> : null}
        {props.failures.map((failure) => (
          <p key={failure.category}>{failure.message}</p>
        ))}
        <button type="button" onClick={props.onCancel} disabled={props.pending}>
          Cancel deletion
        </button>
        <button type="button" onClick={props.onConfirm} disabled={props.pending || props.blocked}>
          Confirm deletion
        </button>
      </section>
    ) : null,
}));

vi.mock("../components/WebLLMDownloadDialog", () => ({
  WebLLMDownloadDialog: () => null,
}));

vi.mock("../components/SearchBar", () => ({
  SearchBar: (props: {
    query: string;
    onQueryChange: (value: string) => void;
    onSearch: () => void;
  }) => (
    <div>
      <label>
        Search query
        <input
          aria-label="Search query"
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
        />
      </label>
      <button type="button" onClick={props.onSearch}>
        Run search
      </button>
    </div>
  ),
}));

vi.mock("../components/SyncStatusBar", () => ({
  SyncStatusBar: (props: {
    historyLoadState: string;
    historyDataSource: string | null;
    onRetryHistory: () => void;
  }) => (
    <div>
      <output data-testid="history-state">{props.historyLoadState}</output>
      <output data-testid="history-source">{props.historyDataSource ?? "none"}</output>
      <button type="button" onClick={props.onRetryHistory}>
        Retry history
      </button>
    </div>
  ),
}));

vi.mock("../components/SessionChat", () => ({
  SessionChat: (props: {
    prompt: string;
    onPromptChange: (value: string) => void;
    onSend: () => void;
  }) => (
    <div>
      <label>
        Chat prompt
        <input
          aria-label="Chat prompt"
          value={props.prompt}
          onChange={(event) => props.onPromptChange(event.target.value)}
        />
      </label>
      <button type="button" onClick={props.onSend}>
        Send prompt
      </button>
    </div>
  ),
}));

vi.mock("../components/OllamaConfigPanel", () => ({
  OllamaConfigPanel: () => null,
}));
vi.mock("../components/DeveloperModePanel", () => ({
  DeveloperModePanel: () => null,
}));
vi.mock("../components/ProviderSettingsForm", () => ({
  ProviderSettingsForm: () => null,
}));
vi.mock("../components/ProviderSettingsStatus", () => ({
  ProviderSettingsStatus: () => null,
}));
vi.mock("../components/FilterBar", () => ({
  FilterBar: () => null,
}));
vi.mock("../components/RepoResultCard", () => ({
  RepoResultCard: () => null,
}));
vi.mock("../components/SessionSidebar", () => ({
  SessionSidebar: (props: { sessions: Array<{ id: string }> }) => (
    <output data-testid="session-ids">{props.sessions.map((item) => item.id).join(",")}</output>
  ),
}));
vi.mock("../components/LoginCard", () => ({
  LoginCard: () => <div>Login</div>,
}));
vi.mock("../components/EmptyState", () => ({
  EmptyState: () => <div>Empty</div>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function session(id = "chat:github:42:session-1") {
  return {
    id,
    query: "security tooling",
    createdAt: 100,
    updatedAt: 200,
  };
}

function message(sessionId = "chat:github:42:session-1"): ChatMessageRecord {
  return {
    id: "message-1",
    sessionId,
    role: "assistant" as const,
    content: "restored",
    createdAt: 150,
    sequence: 0,
  };
}

function searchResult(): SearchResult {
  return {
    chunkId: "chunk-1",
    repoId: 1,
    score: 0.9,
    denseScore: 0.9,
    text: "Security details",
    repoName: "repo",
    repoFullName: "octocat/repo",
    repoDescription: null,
    repoUrl: "https://github.com/octocat/repo",
    language: "TypeScript",
    topics: ["security"],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function renderSettled(view: "legacy" | "recall" | "settings" | "setup" = "legacy") {
  const result = render(<UsagePage view={view} />);
  await waitFor(() => expect(mocks.getLocalDatabase).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByTestId("history-state")).not.toHaveTextContent("loading"));
  return result;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("UsagePage scoped history and deletion integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Object.assign(mocks.auth, {
      accessToken: "token",
      authScopeIdentity: "github:42",
      isAuthenticated: true,
      authMethod: "oauth",
    });
    mocks.database.getRepoCount.mockReturnValue(1);
    mocks.database.getEmbeddingCount.mockReturnValue(1);
    mocks.database.getEmbeddingHealth.mockReturnValue({ status: "ready", dimension: null });
    mocks.database.getDominantEmbeddingModel.mockReturnValue(null);
    mocks.database.listChatSessions.mockReturnValue([]);
    mocks.database.listChatMessages.mockReturnValue([]);
    mocks.database.upsertChatSession.mockResolvedValue(undefined);
    mocks.database.addChatMessage.mockResolvedValue(undefined);
    mocks.database.upsertIndexMeta.mockResolvedValue(undefined);
    mocks.database.clearIndexMetaValue.mockResolvedValue(undefined);
    mocks.database.clearAllData.mockResolvedValue(undefined);
    mocks.database.findSimilarChunks.mockResolvedValue([]);
    mocks.getLocalDatabase.mockResolvedValue(mocks.database);
    mocks.loadChatBackup.mockResolvedValue({
      sessions: [],
      messagesBySessionId: {},
      source: "indexeddb",
    });
    mocks.backupChatSnapshot.mockResolvedValue(undefined);
    mocks.clearLocalLogsStrict.mockResolvedValue(undefined);
    mocks.clearSettingsStrict.mockResolvedValue(undefined);
    mocks.clearModelCaches.mockResolvedValue(undefined);
    mocks.clearScopedPreferences.mockResolvedValue(undefined);
    mocks.unloadWebLLM.mockResolvedValue(undefined);
  });

  it("restores primary scoped history and refreshes the scoped backup", async () => {
    const restoredSession = session();
    const restoredMessage = message();
    mocks.database.listChatSessions.mockReturnValue([restoredSession]);
    mocks.database.listChatMessages.mockReturnValue([restoredMessage]);

    await renderSettled();

    await waitFor(() => expect(screen.getByTestId("history-state")).toHaveTextContent("loaded"));
    expect(screen.getByTestId("history-source")).toHaveTextContent("sqlite");
    expect(mocks.loadChatBackup).not.toHaveBeenCalled();
    expect(mocks.backupChatSnapshot).toHaveBeenCalledWith(
      {
        key: "chat:github:42",
        legacySessionPrefix: "chat:github:42:",
      },
      {
        sessions: [restoredSession],
        messagesBySessionId: { [restoredSession.id]: [restoredMessage] },
      },
    );
    expect(mocks.database.upsertIndexMeta).toHaveBeenCalledWith(
      expect.objectContaining({ key: "history_last_restored_at" }),
    );
  });

  it("rehydrates an empty primary store from the authenticated backup scope", async () => {
    const restoredSession = session();
    const restoredMessage = message();
    mocks.loadChatBackup.mockResolvedValue({
      sessions: [restoredSession, session("chat:github:99:foreign")],
      messagesBySessionId: {
        [restoredSession.id]: [restoredMessage],
        "chat:github:99:foreign": [message("chat:github:99:foreign")],
      },
      source: "local-storage",
    });

    await renderSettled();

    await waitFor(() =>
      expect(screen.getByTestId("history-source")).toHaveTextContent("local-storage"),
    );
    expect(mocks.loadChatBackup).toHaveBeenCalledWith({
      key: "chat:github:42",
      legacySessionPrefix: "chat:github:42:",
    });
    expect(mocks.database.upsertChatSession).toHaveBeenCalledWith(restoredSession);
    expect(mocks.database.upsertChatSession).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "chat:github:99:foreign" }),
    );
    expect(mocks.database.addChatMessage).toHaveBeenCalledWith(restoredMessage);
  });

  it("falls back to scoped backup after primary failure and reports backup failure safely", async () => {
    const restoredSession = session();
    mocks.database.listChatSessions.mockImplementation(() => {
      throw new Error("sqlite unavailable");
    });
    mocks.loadChatBackup.mockResolvedValue({
      sessions: [restoredSession],
      messagesBySessionId: { [restoredSession.id]: [message()] },
      source: "indexeddb",
    });

    const first = await renderSettled();
    await waitFor(() => expect(screen.getByTestId("history-state")).toHaveTextContent("loaded"));
    expect(screen.getByTestId("history-source")).toHaveTextContent("indexeddb");
    expect(mocks.captureLocalError).toHaveBeenCalledWith(
      "github:42",
      "history_restore_failed",
      expect.any(Error),
    );
    first.unmount();

    vi.clearAllMocks();
    mocks.getLocalDatabase.mockResolvedValue(mocks.database);
    mocks.database.getRepoCount.mockReturnValue(1);
    mocks.database.getEmbeddingCount.mockReturnValue(1);
    mocks.database.getEmbeddingHealth.mockReturnValue({ status: "ready", dimension: null });
    mocks.database.listChatSessions.mockImplementation(() => {
      throw new Error("sqlite unavailable");
    });
    mocks.loadChatBackup.mockRejectedValue(new Error("backup unavailable"));
    await renderSettled();

    await waitFor(() => expect(screen.getByTestId("history-state")).toHaveTextContent("error"));
    expect(screen.getByTestId("history-source")).toHaveTextContent("none");
    expect(mocks.captureLocalError).toHaveBeenCalledWith(
      "github:42",
      "history_backup_restore_failed",
      expect.any(Error),
    );
  });

  it("does not read an unscoped backup when the authenticated identity is unavailable", async () => {
    mocks.auth.authScopeIdentity = null;
    mocks.auth.isAuthenticated = false;

    render(<UsagePage view="legacy" />);

    await waitFor(() => expect(screen.getByText("Login")).toBeInTheDocument());
    expect(mocks.getLocalDatabase).not.toHaveBeenCalled();
    expect(mocks.loadChatBackup).not.toHaveBeenCalled();
    expect(mocks.backupChatSnapshot).not.toHaveBeenCalled();
  });

  it("ignores a stale restore after the authenticated scope changes", async () => {
    const oldSession = session();
    const oldDatabase = {
      ...mocks.database,
      listChatSessions: vi.fn(() => [oldSession]),
      listChatMessages: vi.fn(() => [message()]),
    };
    const oldRestore = deferred<typeof oldDatabase>();
    mocks.getLocalDatabase
      .mockResolvedValueOnce(mocks.database)
      .mockReturnValueOnce(oldRestore.promise)
      .mockResolvedValue(mocks.database);

    const page = render(<UsagePage view="legacy" />);
    await waitFor(() => expect(mocks.getLocalDatabase).toHaveBeenCalledTimes(2));

    mocks.auth.authScopeIdentity = "github:99";
    page.rerender(<UsagePage view="legacy" />);
    await waitFor(() => expect(screen.getByTestId("history-state")).toHaveTextContent("empty"));

    await act(async () => {
      oldRestore.resolve(oldDatabase);
      await oldRestore.promise;
      await Promise.resolve();
    });
    expect(oldDatabase.listChatSessions).toHaveBeenCalled();
    expect(screen.getByTestId("session-ids")).not.toHaveTextContent(oldSession.id);
    expect(screen.getByTestId("history-state")).toHaveTextContent("empty");
  });

  it("ignores an authenticated restore that settles after logout clears the scope", async () => {
    const oldSession = session();
    const oldDatabase = {
      ...mocks.database,
      listChatSessions: vi.fn(() => [oldSession]),
      listChatMessages: vi.fn(() => [message()]),
    };
    const oldRestore = deferred<typeof oldDatabase>();
    mocks.getLocalDatabase
      .mockResolvedValueOnce(mocks.database)
      .mockReturnValueOnce(oldRestore.promise)
      .mockResolvedValue(mocks.database);

    const page = render(<UsagePage view="legacy" />);
    await waitFor(() => expect(mocks.getLocalDatabase).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("history-state")).toHaveTextContent("loading");

    mocks.auth.accessToken = null;
    mocks.auth.authScopeIdentity = null;
    mocks.auth.isAuthenticated = false;
    page.rerender(<UsagePage view="legacy" />);
    await waitFor(() => expect(screen.getByText("Login")).toBeInTheDocument());

    await act(async () => {
      oldRestore.resolve(oldDatabase);
      await oldRestore.promise;
      await Promise.resolve();
    });
    expect(oldDatabase.listChatSessions).toHaveBeenCalled();
    expect(screen.getByText("Login")).toBeInTheDocument();
    expect(screen.queryByTestId("session-ids")).not.toBeInTheDocument();
    expect(mocks.captureLocalError).not.toHaveBeenCalled();
    expect(mocks.loadChatBackup).not.toHaveBeenCalled();
    expect(mocks.database.upsertIndexMeta).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: "history_last_restored_at" }),
    );
  });

  it("blocks confirmation while history restoration is active", async () => {
    const user = userEvent.setup();
    const pendingDatabase = deferred<typeof mocks.database>();
    mocks.getLocalDatabase.mockReturnValue(pendingDatabase.promise);

    render(<UsagePage view="settings" />);
    await user.click(screen.getByRole("button", { name: "Delete local data" }));

    const dialog = screen.getByRole("region", { name: "delete-dialog" });
    expect(
      within(dialog).getByText("Wait for chat history restore to finish."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm deletion" })).toBeDisabled();
    expect(mocks.database.clearAllData).not.toHaveBeenCalled();

    pendingDatabase.resolve(mocks.database);
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Confirm deletion" })).toBeEnabled(),
    );
  });

  it("opens and cancels deletion from settings without mutating data", async () => {
    const user = userEvent.setup();
    await renderSettled("settings");

    await user.click(screen.getByRole("button", { name: "Delete local data" }));
    const dialog = screen.getByRole("region", { name: "delete-dialog" });
    expect(within(dialog).getByText("Delete confirmation")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel deletion" }));
    expect(screen.queryByRole("region", { name: "delete-dialog" })).not.toBeInTheDocument();
    expect(mocks.database.clearAllData).not.toHaveBeenCalled();
    expect(mocks.auth.logout).not.toHaveBeenCalled();
  });

  it("runs the complete scoped deletion wiring and logs out only after success", async () => {
    const user = userEvent.setup();
    const restoredSession = session();
    mocks.database.listChatSessions.mockReturnValue([restoredSession]);
    mocks.database.listChatMessages.mockReturnValue([message()]);
    await renderSettled("legacy");
    expect(screen.getByTestId("session-ids")).toHaveTextContent(restoredSession.id);
    const restoreReadCount = mocks.database.listChatSessions.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Delete local data" }));
    await user.click(screen.getByRole("button", { name: "Confirm deletion" }));

    await waitFor(() => expect(mocks.auth.logout).toHaveBeenCalledOnce());
    expect(mocks.cancelPendingGeneration).toHaveBeenCalledOnce();
    expect(mocks.database.clearAllData).toHaveBeenCalledOnce();
    expect(mocks.unloadWebLLM).toHaveBeenCalledOnce();
    expect(mocks.clearModelCaches).toHaveBeenCalledOnce();
    expect(mocks.clearSettingsStrict).toHaveBeenCalledWith("github:42");
    expect(mocks.clearScopedPreferences).toHaveBeenCalledWith("github:42");
    expect(mocks.clearLocalLogsStrict).toHaveBeenCalledWith("github:42");
    const cancelOrder = mocks.cancelPendingGeneration.mock.invocationCallOrder[0];
    const repositoryOrder = mocks.database.clearAllData.mock.invocationCallOrder[0];
    const unloadOrder = mocks.unloadWebLLM.mock.invocationCallOrder[0];
    const modelCacheOrder = mocks.clearModelCaches.mock.invocationCallOrder[0];
    const settingsOrder = mocks.clearSettingsStrict.mock.invocationCallOrder[0];
    const preferencesOrder = mocks.clearScopedPreferences.mock.invocationCallOrder[0];
    const logsOrder = mocks.clearLocalLogsStrict.mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(repositoryOrder);
    expect(repositoryOrder).toBeLessThan(unloadOrder);
    expect(unloadOrder).toBeLessThan(modelCacheOrder);
    expect(modelCacheOrder).toBeLessThan(settingsOrder);
    expect(settingsOrder).toBeLessThan(preferencesOrder);
    expect(preferencesOrder).toBeLessThan(logsOrder);
    expect(screen.queryByRole("region", { name: "delete-dialog" })).not.toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("session-ids")).not.toHaveTextContent(restoredSession.id);
    expect(screen.getByTestId("history-state")).toHaveTextContent("empty");
    expect(mocks.database.listChatSessions).toHaveBeenCalledTimes(restoreReadCount);
  });

  it("aborts and awaits an active generation before deleting repository data", async () => {
    const user = userEvent.setup();
    const generation = deferred<void>();
    let generationSignal: AbortSignal | null = null;
    mocks.database.findSimilarChunks.mockResolvedValue([searchResult()]);
    mocks.executeUsageGeneration.mockImplementationOnce(async (_request, dependencies) => {
      const controller = new AbortController();
      dependencies.controllerRef.current = controller;
      generationSignal = controller.signal;
      await generation.promise;
    });
    await renderSettled("legacy");

    await user.type(screen.getByRole("textbox", { name: "Search query" }), "security");
    await user.click(screen.getByRole("button", { name: "Run search" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Chat prompt" })).toBeInTheDocument(),
    );

    await user.type(screen.getByRole("textbox", { name: "Chat prompt" }), "Summarize");
    await user.click(screen.getByRole("button", { name: "Send prompt" }));
    await waitFor(() => expect(mocks.executeUsageGeneration).toHaveBeenCalledOnce());

    await user.click(screen.getByRole("button", { name: "Delete local data" }));
    await user.click(screen.getByRole("button", { name: "Confirm deletion" }));

    await waitFor(() => expect(generationSignal?.aborted).toBe(true));
    expect(mocks.database.clearAllData).not.toHaveBeenCalled();
    expect(mocks.auth.logout).not.toHaveBeenCalled();

    generation.resolve();
    await waitFor(() => expect(mocks.database.clearAllData).toHaveBeenCalledOnce());
    expect(mocks.auth.logout).toHaveBeenCalledOnce();
  });

  it("refuses to start a new generation while deletion is in progress", async () => {
    const user = userEvent.setup();
    const clearing = deferred<void>();
    mocks.database.findSimilarChunks.mockResolvedValue([searchResult()]);
    mocks.database.clearAllData.mockImplementationOnce(async () => {
      await clearing.promise;
    });
    await renderSettled("legacy");

    await user.type(screen.getByRole("textbox", { name: "Search query" }), "security");
    await user.click(screen.getByRole("button", { name: "Run search" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Chat prompt" })).toBeInTheDocument(),
    );
    await user.type(screen.getByRole("textbox", { name: "Chat prompt" }), "Summarize");

    // Prove the same click reaches generation while no deletion is running, so
    // the refusal below cannot pass for an unrelated missing precondition.
    await user.click(screen.getByRole("button", { name: "Send prompt" }));
    await waitFor(() => expect(mocks.executeUsageGeneration).toHaveBeenCalledOnce());

    await user.click(screen.getByRole("button", { name: "Delete local data" }));
    await user.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(mocks.database.clearAllData).toHaveBeenCalledOnce());

    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    expect(mocks.executeUsageGeneration).toHaveBeenCalledOnce();

    clearing.resolve();
    await waitFor(() => expect(mocks.auth.logout).toHaveBeenCalledOnce());
    expect(mocks.executeUsageGeneration).toHaveBeenCalledOnce();
  });

  it("clears unknown embedding dimension metadata instead of persisting an empty sentinel", async () => {
    const user = userEvent.setup();
    mocks.database.getDominantEmbeddingModel.mockReturnValue(DEFAULT_BROWSER_EMBEDDING_MODEL);
    mocks.database.getEmbeddingHealth.mockReturnValue({ status: "ready", dimension: null });
    mocks.database.findSimilarChunks.mockResolvedValue([searchResult()]);
    await renderSettled("legacy");

    await user.type(screen.getByRole("textbox", { name: "Search query" }), "security");
    await user.click(screen.getByRole("button", { name: "Run search" }));

    await waitFor(() =>
      expect(mocks.database.clearIndexMetaValue).toHaveBeenCalledWith(EMBEDDING_DIMENSION_META_KEY),
    );
    expect(mocks.database.upsertIndexMeta).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: EMBEDDING_DIMENSION_META_KEY, value: "" }),
    );
  });

  it("keeps partial failures visible, stays signed in, and permits retry", async () => {
    const user = userEvent.setup();
    mocks.clearSettingsStrict.mockRejectedValueOnce(new Error("settings remained"));
    await renderSettled("settings");

    await user.click(screen.getByRole("button", { name: "Delete local data" }));
    await user.click(screen.getByRole("button", { name: "Confirm deletion" }));

    await waitFor(() => expect(screen.getByText("settings remained")).toBeInTheDocument());
    expect(mocks.auth.logout).not.toHaveBeenCalled();
    expect(screen.getByText(/Some local data could not be deleted/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(mocks.auth.logout).toHaveBeenCalledOnce());
    expect(mocks.clearSettingsStrict).toHaveBeenCalledTimes(2);
  });

  it("exposes the legacy account delete entry point", async () => {
    const user = userEvent.setup();
    await renderSettled("legacy");

    const account = screen.getByText("Account").closest("section");
    if (!account) {
      throw new Error("Account section was not rendered");
    }
    await user.click(within(account).getByRole("button", { name: "Delete local data" }));
    expect(screen.getByRole("region", { name: "delete-dialog" })).toBeInTheDocument();
  });
});
