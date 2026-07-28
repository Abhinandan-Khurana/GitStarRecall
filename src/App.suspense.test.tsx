import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Outlet } from "react-router-dom";
import App from "./App";

vi.mock("./auth/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./features/theme/ThemeProvider", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./features/navigation/RequireAuth", () => ({ RequireAuth: () => <Outlet /> }));
vi.mock("./features/app-shell/AppShell", () => ({
  AppShell: () => (
    <div>
      <p>shell chrome</p>
      <Outlet />
    </div>
  ),
}));
vi.mock("./layouts/PublicLayout", () => ({ default: () => <Outlet /> }));
vi.mock("./pages/auth/AuthCallbackPage", () => ({ default: () => null }));
vi.mock("./pages/LandingPage", () => ({ default: () => null }));
vi.mock("./pages/app/AppHomePage", () => ({ default: () => <p>home page</p> }));
vi.mock("./pages/app/LibraryPage", () => ({ default: () => <p>library page</p> }));
vi.mock("./pages/app/RecallPage", () => ({ default: () => null }));
vi.mock("./pages/app/SessionsPage", () => ({ default: () => null }));
vi.mock("./pages/app/SettingsPage", () => ({ default: () => null }));
vi.mock("./pages/app/SetupPage", () => ({ default: () => null }));

describe("App authenticated route suspense", () => {
  it("announces an accessible fallback while a lazy page resolves, then renders the page", async () => {
    render(
      <MemoryRouter initialEntries={["/app/library"]}>
        <App />
      </MemoryRouter>,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Loading page");

    await waitFor(() => expect(screen.getByText("library page")).toBeInTheDocument());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the shell chrome mounted while the page chunk is pending", async () => {
    render(
      <MemoryRouter initialEntries={["/app"]}>
        <App />
      </MemoryRouter>,
    );

    // The boundary sits at the outlet, so the shell renders alongside the fallback.
    expect(screen.getByText("shell chrome")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("home page")).toBeInTheDocument());
    expect(screen.getByText("shell chrome")).toBeInTheDocument();
  });
});
