import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./AppShell";

const { getLocalDatabaseMock } = vi.hoisted(() => ({
  getLocalDatabaseMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  getLocalDatabase: getLocalDatabaseMock,
}));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({ accessToken: "token", logout: vi.fn() }),
}));

vi.mock("@/features/command/CommandPalette", () => ({
  CommandPalette: () => null,
}));

vi.mock("@/components/ui/ThemeToggleButton", () => ({ ThemeToggleButton: () => null }));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function TestPage() {
  return (
    <>
      <input aria-label="plain input" />
      <textarea aria-label="plain textarea" />
      <select aria-label="plain select">
        <option>One</option>
      </select>
      <div aria-label="editable" contentEditable suppressContentEditableWarning>
        edit
      </div>
      <div role="dialog">
        <input aria-label="dialog input" />
      </div>
      <LocationProbe />
      <Outlet />
    </>
  );
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/app"]}>
      <Routes>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<TestPage />} />
          <Route path="recall" element={<LocationProbe />} />
          <Route path="settings" element={<LocationProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppShell shortcuts", () => {
  beforeEach(() => {
    getLocalDatabaseMock.mockReset();
    getLocalDatabaseMock.mockImplementation(() => new Promise(() => {}));
  });

  it.each(["plain input", "plain textarea", "plain select", "editable", "dialog input"])(
    "ignores global shortcuts while typing in %s",
    (label) => {
      renderShell();
      const target = screen.getByLabelText(label);

      expect(fireEvent.keyDown(target, { key: "k", metaKey: true })).toBe(true);
      fireEvent.keyDown(target, { key: ",", metaKey: true });
      fireEvent.keyDown(target, { key: "g" });
      fireEvent.keyDown(target, { key: "r" });

      expect(screen.getByTestId("location")).toHaveTextContent("/app");
    },
  );

  it("preserves the external G R shortcut", () => {
    renderShell();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "r" });

    expect(screen.getByTestId("location")).toHaveTextContent("/app/recall");
  });

  it("removes every installed keydown listener when unmounted mid-sequence", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const view = renderShell();

    fireEvent.keyDown(window, { key: "g" });
    view.unmount();

    const added = addSpy.mock.calls
      .filter(([type]) => type === "keydown")
      .map(([, listener]) => listener);
    const removed = removeSpy.mock.calls
      .filter(([type]) => type === "keydown")
      .map(([, listener]) => listener);
    expect(added.every((listener) => removed.includes(listener))).toBe(true);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("does not report ready from a positive embedding count when index health is degraded", async () => {
    getLocalDatabaseMock.mockResolvedValue({
      getRepoCount: () => 2,
      getEmbeddingCount: () => 2,
      getEmbeddingHealth: () => ({ status: "degraded" }),
      listChatSessions: () => [],
    });

    renderShell();

    expect(await screen.findByRole("button", { name: "Indexing incomplete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ready" })).not.toBeInTheDocument();
  });
});
