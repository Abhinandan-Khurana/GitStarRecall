// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthContext";
import { buildChatBackupScope, buildLegacyTokenChatScopeKey } from "./authScope";
import { useAuth } from "./useAuth";

const mocks = vi.hoisted(() => ({
  fetchAuthenticatedUser: vi.fn(),
  migrateLocalDatabaseScope: vi.fn(),
  setLocalDatabaseScope: vi.fn(),
  migrateChatBackupScope: vi.fn(),
  migrateLegacySettingsScope: vi.fn(),
  captureLocalError: vi.fn(),
}));

vi.mock("@/github/client", () => ({
  createGitHubApiClient: () => ({
    fetchAuthenticatedUser: mocks.fetchAuthenticatedUser,
  }),
}));

vi.mock("@/db/client", () => ({
  migrateLocalDatabaseScope: mocks.migrateLocalDatabaseScope,
  setLocalDatabaseScope: mocks.setLocalDatabaseScope,
}));

vi.mock("@/db/chatBackup", () => ({
  migrateChatBackupScope: mocks.migrateChatBackupScope,
}));

vi.mock("@/lib/settings", () => ({
  migrateLegacySettingsScope: mocks.migrateLegacySettingsScope,
}));

vi.mock("./githubOAuth", () => ({
  buildGitHubAuthorizeUrl: vi.fn(),
  exchangeOAuthCode: vi.fn(),
  getOAuthConfig: () => ({
    clientId: "client-id",
    redirectUri: "http://localhost/auth/callback",
    exchangeUrl: "/api/github/oauth/exchange",
  }),
}));

vi.mock("@/observability/localLog", () => ({
  captureLocalError: mocks.captureLocalError,
  clearLocalLogs: vi.fn(),
}));

function Harness() {
  const auth = useAuth();
  return (
    <>
      <output data-testid="state">
        {auth.authScopeIdentity ?? "none"}:{auth.accessToken ?? "none"}
      </output>
      <button
        type="button"
        onClick={() => void auth.loginWithPat("ghp_token").catch(() => undefined)}
      >
        Login
      </button>
      <button type="button" onClick={auth.logout}>
        Logout
      </button>
    </>
  );
}

describe("AuthProvider scoped storage migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchAuthenticatedUser.mockResolvedValue({ id: 42, login: "octocat" });
    mocks.migrateLocalDatabaseScope.mockResolvedValue(false);
    mocks.migrateChatBackupScope.mockResolvedValue(undefined);
    mocks.migrateLegacySettingsScope.mockResolvedValue(undefined);
  });

  it("migrates chat backup even when the stable database target already exists", async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("github:42:ghp_token"),
    );
    expect(mocks.migrateLocalDatabaseScope).toHaveBeenCalledOnce();
    const expectedLegacyScope = buildChatBackupScope(buildLegacyTokenChatScopeKey("ghp_token"));
    expect(mocks.migrateChatBackupScope).toHaveBeenCalledWith(expectedLegacyScope, {
      key: "chat:github:42",
      legacySessionPrefix: "chat:github:42:",
    });
    expect(mocks.setLocalDatabaseScope).toHaveBeenCalledWith("auth:github:42", {
      key: "chat:github:42",
      legacySessionPrefix: "chat:github:42:",
    });
  });

  it("installs the target scope and reports diagnostics when chat migration rejects", async () => {
    const user = userEvent.setup();
    const migrationError = new Error("backup unavailable");
    mocks.migrateChatBackupScope.mockRejectedValueOnce(migrationError);
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("github:42:ghp_token"),
    );
    expect(mocks.captureLocalError).toHaveBeenCalledWith(
      "github:42",
      "chat_backup_scope_migration_failed",
      migrationError,
    );
    expect(mocks.migrateLegacySettingsScope).toHaveBeenCalledOnce();
    expect(mocks.setLocalDatabaseScope).toHaveBeenCalledWith("auth:github:42", {
      key: "chat:github:42",
      legacySessionPrefix: "chat:github:42:",
    });
  });

  it("does not install auth state when the primary database migration rejects", async () => {
    const user = userEvent.setup();
    mocks.migrateLocalDatabaseScope.mockRejectedValueOnce(new Error("database migration failed"));
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => expect(mocks.migrateLocalDatabaseScope).toHaveBeenCalledOnce());
    expect(screen.getByTestId("state")).toHaveTextContent("none:none");
    expect(mocks.migrateChatBackupScope).not.toHaveBeenCalled();
    expect(mocks.migrateLegacySettingsScope).not.toHaveBeenCalled();
    expect(mocks.setLocalDatabaseScope).not.toHaveBeenCalled();
  });

  it("installs the anonymous database with no backup scope on logout", async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Logout" }));

    expect(mocks.setLocalDatabaseScope).toHaveBeenCalledWith("anon", null);
  });
});
