import { render, screen } from "@testing-library/react";
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
vi.mock("./pages/app/LibraryPage", () =>
  Promise.reject(new Error("simulated route chunk load failure")),
);

it("keeps the authenticated shell mounted when a lazy route import rejects", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  render(
    <MemoryRouter initialEntries={["/app/library"]}>
      <App />
    </MemoryRouter>,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent("Page failed to load");
  expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
  expect(screen.getByText("shell chrome")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
