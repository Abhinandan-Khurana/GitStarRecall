import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { buildGitHubAuthorizeUrl, exchangeOAuthCode } from "../../auth/githubOAuth";
import type { OAuthCallbackInput } from "../../auth/auth-types";
import AuthCallbackPage from "./AuthCallbackPage";

const mocks = vi.hoisted(() => ({
  handleOAuthCallback: vi.fn<(input: OAuthCallbackInput) => Promise<void>>(),
  navigate: vi.fn(),
}));

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ handleOAuthCallback: mocks.handleOAuthCallback }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

function oauthResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ access_token: "issued-token" }),
  } as unknown as Response;
}

async function setCallbackLocation(code = "callback-code"): Promise<OAuthCallbackInput> {
  const authorizeUrl = new URL(await buildGitHubAuthorizeUrl());
  const state = authorizeUrl.searchParams.get("state");
  if (!state) {
    throw new Error("OAuth test state was not created");
  }

  window.history.replaceState({}, "", `/auth/callback?code=${code}&state=${state}`);
  return { code, state, error: undefined };
}

describe("AuthCallbackPage", () => {
  beforeEach(() => {
    mocks.handleOAuthCallback.mockReset();
    mocks.navigate.mockReset();
    vi.stubEnv("VITE_GITHUB_CLIENT_ID", "client-id-123");
    vi.stubEnv("VITE_GITHUB_REDIRECT_URI", "http://localhost:5173/auth/callback");
    vi.stubEnv("VITE_GITHUB_OAUTH_EXCHANGE_URL", "/api/github/oauth/exchange");
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("performs exactly one token exchange under React StrictMode", async () => {
    const callback = await setCallbackLocation();
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    mocks.handleOAuthCallback.mockImplementation(async (input) => {
      await exchangeOAuthCode({ code: input.code!, state: input.state! });
    });

    render(
      <StrictMode>
        <AuthCallbackPage />
      </StrictMode>,
    );

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(mocks.handleOAuthCallback).toHaveBeenCalledWith(callback);
    resolveFetch(oauthResponse());

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/app", { replace: true }));
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.handleOAuthCallback).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledOnce();
  });

  it("retries a transient callback directly with the same payload", async () => {
    const user = userEvent.setup();
    const callback = await setCallbackLocation();
    const verifier = sessionStorage.getItem("gitstarrecall.oauth.verifier");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ...oauthResponse(), ok: false, status: 503 })
        .mockResolvedValueOnce(oauthResponse()),
    );
    mocks.handleOAuthCallback.mockImplementation(async (input) => {
      await exchangeOAuthCode({ code: input.code!, state: input.state! });
    });

    render(<AuthCallbackPage />);

    expect(
      await screen.findByText("OAuth token exchange is temporarily unavailable (503)"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry callback" }));

    await waitFor(() => expect(mocks.handleOAuthCallback).toHaveBeenCalledTimes(2));
    expect(mocks.handleOAuthCallback).toHaveBeenNthCalledWith(1, callback);
    expect(mocks.handleOAuthCallback).toHaveBeenNthCalledWith(2, callback);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/app", { replace: true }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body))),
    ).toEqual([
      expect.objectContaining({ codeVerifier: verifier }),
      expect.objectContaining({ codeVerifier: verifier }),
    ]);
  });

  it("does not offer retry after terminal callback validation failure", async () => {
    await setCallbackLocation();
    window.history.replaceState({}, "", "/auth/callback?error=access_denied");
    mocks.handleOAuthCallback.mockRejectedValueOnce(
      new Error("GitHub returned an OAuth error: access_denied"),
    );

    render(<AuthCallbackPage />);

    expect(await screen.findByText("GitHub returned an OAuth error: access_denied")).toBeVisible();
    expect(sessionStorage.getItem("gitstarrecall.oauth.state")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry callback" })).not.toBeInTheDocument();
  });
});
