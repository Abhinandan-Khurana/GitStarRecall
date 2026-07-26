import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";

vi.mock("../auth/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../features/theme/ThemeProvider", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../features/navigation/RequireAuth", () => ({ RequireAuth: () => null }));
vi.mock("../features/app-shell/AppShell", () => ({ AppShell: () => null }));
vi.mock("../layouts/PublicLayout", () => ({ default: () => null }));
vi.mock("./auth/AuthCallbackPage", () => ({ default: () => null }));
vi.mock("./app/AppHomePage", () => ({ default: () => null }));
vi.mock("./app/LibraryPage", () => ({ default: () => null }));
vi.mock("./app/RecallPage", () => ({ default: () => null }));
vi.mock("./app/SessionsPage", () => ({ default: () => null }));
vi.mock("./app/SettingsPage", () => ({ default: () => null }));
vi.mock("./app/SetupPage", () => ({ default: () => null }));
vi.mock("./LandingPage", () => ({ default: () => null }));

describe("App not-found route", () => {
  it("routes an unknown path to a page with a link back home", () => {
    render(
      <MemoryRouter initialEntries={["/missing"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute("href", "/");
  });
});
