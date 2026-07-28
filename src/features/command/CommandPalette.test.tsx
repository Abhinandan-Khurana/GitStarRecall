import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ChatSessionRecord, RepoRecord } from "@/db/types";
import { CommandPalette } from "./CommandPalette";

const listRepos = vi.fn<() => RepoRecord[]>();
const listChatSessions = vi.fn<() => ChatSessionRecord[]>();

vi.mock("@/db/client", () => ({
  getLocalDatabase: async () => ({ listRepos, listChatSessions }),
}));

vi.mock("@/features/theme/useTheme", () => ({
  useTheme: () => ({ toggleTheme: vi.fn() }),
}));

function repo(id: number, fullName: string): RepoRecord {
  return {
    id,
    fullName,
    name: fullName.split("/").at(-1) ?? fullName,
    description: null,
    topics: [],
    language: null,
    htmlUrl: `https://github.com/${fullName}`,
    stars: 0,
    forks: 0,
    updatedAt: "2026-01-01T00:00:00Z",
    readmeUrl: null,
    readmeText: null,
    checksum: null,
    lastSyncedAt: 0,
  };
}

function session(id: number, query: string): ChatSessionRecord {
  return { id: String(id), query, createdAt: id, updatedAt: id };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={["/app"]}>
      <CommandPalette open onOpenChange={vi.fn()} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("CommandPalette query handling", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    listRepos.mockReset();
    listChatSessions.mockReset();
    listRepos.mockReturnValue([]);
    listChatSessions.mockReturnValue([]);
  });

  it("preserves the first character of a plain query", async () => {
    listRepos.mockReturnValue([repo(1, "acme/alpha")]);
    const user = userEvent.setup();
    renderPalette();

    await user.type(
      await screen.findByPlaceholderText("Search routes, sessions, and repos..."),
      "xalpha",
    );

    expect(screen.queryByText("acme/alpha")).not.toBeInTheDocument();
  });

  it("filters the complete repository set before limiting displayed results", async () => {
    listRepos.mockReturnValue([
      ...Array.from({ length: 12 }, (_, index) => repo(index + 1, `acme/common-${index + 1}`)),
      repo(13, "acme/unique-thirteenth"),
    ]);
    const user = userEvent.setup();
    renderPalette();

    await user.type(
      await screen.findByPlaceholderText("Search routes, sessions, and repos..."),
      "unique-thirteenth",
    );

    expect(screen.getByText("acme/unique-thirteenth")).toBeVisible();
  });

  it("filters the complete session set before limiting displayed results", async () => {
    listChatSessions.mockReturnValue([
      ...Array.from({ length: 12 }, (_, index) =>
        session(index + 1, `Common session ${index + 1}`),
      ),
      session(13, "Unique thirteenth session"),
    ]);
    const user = userEvent.setup();
    renderPalette();

    await user.type(
      await screen.findByPlaceholderText("Search routes, sessions, and repos..."),
      "Unique thirteenth session",
    );

    expect(screen.getByText("Unique thirteenth session")).toBeVisible();
  });

  it("uses the Recall query parameter for slash commands", async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.type(
      await screen.findByPlaceholderText("Search routes, sessions, and repos..."),
      "/Exact Query",
    );
    await user.click(screen.getByText('Open Recall with "exact query"'));

    expect(screen.getByTestId("location")).toHaveTextContent("/app/recall?query=exact%20query");
  });
});
