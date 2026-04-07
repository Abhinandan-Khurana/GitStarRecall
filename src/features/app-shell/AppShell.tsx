import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Command, History, Home, LogOut, Menu, Search, Settings, Sparkles, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggleButton } from "@/components/ui/ThemeToggleButton";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { getLocalDatabase } from "@/db/client";
import { useAuth } from "@/auth/useAuth";
import { CommandPalette } from "@/features/command/CommandPalette";
import { detectClientShortcutPlatform, formatPrimaryModifierShortcut } from "@/lib/platformShortcuts";
import { cn } from "@/lib/utils";

type WorkspaceStats = {
  repoCount: number;
  embeddingCount: number;
  sessionCount: number;
};

const NAV_ITEMS = [
  { to: "/app", label: "Home", icon: Home },
  { to: "/app/recall", label: "Recall", icon: Search },
  { to: "/app/library", label: "Library", icon: BookOpen },
  { to: "/app/sessions", label: "Sessions", icon: History },
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const;

function getTitle(pathname: string): string {
  if (pathname === "/app") return "Workspace";
  if (pathname.startsWith("/app/library")) return "Library";
  if (pathname.startsWith("/app/sessions")) return "Sessions";
  if (pathname.startsWith("/app/settings")) return "Settings";
  if (pathname.startsWith("/app/setup")) return "Setup";
  return "Recall";
}

function getDescription(pathname: string): string {
  if (pathname === "/app") return "Open setup, recall, browsing, history, and settings from one place.";
  if (pathname.startsWith("/app/library")) return "Browse your indexed stars as a local inventory.";
  if (pathname.startsWith("/app/sessions")) return "Resume and inspect prior recall threads.";
  if (pathname.startsWith("/app/settings")) return "Manage providers, sync settings, privacy, and local data.";
  if (pathname.startsWith("/app/setup")) return "Connect GitHub, build your local index, and get ready.";
  return "Search, review matches, and build explicit chat context.";
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { accessToken, logout } = useAuth();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [syncCenterOpen, setSyncCenterOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [stats, setStats] = useState<WorkspaceStats>({
    repoCount: 0,
    embeddingCount: 0,
    sessionCount: 0,
  });
  const shortcutPlatform = useMemo(() => detectClientShortcutPlatform(), []);
  const openPaletteShortcut = useMemo(
    () => formatPrimaryModifierShortcut("K", shortcutPlatform),
    [shortcutPlatform],
  );
  const openSettingsShortcut = useMemo(
    () => formatPrimaryModifierShortcut(",", shortcutPlatform),
    [shortcutPlatform],
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const database = await getLocalDatabase();
      const nextStats = {
        repoCount: database.getRepoCount(),
        embeddingCount: database.getEmbeddingCount(),
        sessionCount: database.listChatSessions().length,
      };
      if (!cancelled) {
        setStats(nextStats);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [accessToken, location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((current) => !current);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        navigate("/app/settings");
        return;
      }

      if (event.key.toLowerCase() === "g") {
        const handleSecondKey = (nextEvent: KeyboardEvent) => {
          const key = nextEvent.key.toLowerCase();
          if (key === "r") navigate("/app/recall");
          if (key === "l") navigate("/app/library");
          if (key === "s") navigate("/app/sessions");
          window.removeEventListener("keydown", handleSecondKey);
        };

        window.addEventListener("keydown", handleSecondKey, { once: true });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [navigate]);

  const healthLabel = useMemo(() => {
    if (stats.repoCount === 0) return "Setup required";
    if (stats.embeddingCount === 0) return "Indexing incomplete";
    return "Ready";
  }, [stats.embeddingCount, stats.repoCount]);

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-foreground">
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-[var(--app-panel)] px-5 py-6 lg:flex lg:flex-col">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-background/70"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-base font-semibold">GitStarRecall</p>
              <p className="truncate text-xs text-muted-foreground">Local memory for GitHub stars</p>
            </div>
          </Link>

          <Button
            variant="outline"
            className="mt-5 flex w-full min-w-0 items-center justify-between gap-3 overflow-hidden rounded-md border-border bg-muted"
            onClick={() => setPaletteOpen(true)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Command className="h-4 w-4 shrink-0" />
              <span className="truncate">Command palette</span>
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{openPaletteShortcut}</span>
          </Button>

          <nav className="mt-6 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/app"}
                  title={item.to === "/app/settings" ? `Settings (${openSettingsShortcut})` : undefined}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200",
                      isActive
                        ? "border-l-2 border-primary bg-primary/8 pl-[10px] text-foreground"
                        : "border-l-2 border-transparent pl-[10px] text-muted-foreground hover:bg-muted hover:text-foreground",
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="mt-auto space-y-4">
            <div className="rounded-md border border-border bg-muted/50 p-4">
              <Sheet open={syncCenterOpen} onOpenChange={setSyncCenterOpen}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Workspace</span>
                  <SheetTrigger asChild>
                    <Button variant="secondary" size="sm" className="h-7 rounded-md px-2 text-xs">
                      {healthLabel}
                    </Button>
                  </SheetTrigger>
                </div>
                <SheetContent className="w-full border-border bg-[var(--app-panel)] sm:max-w-lg">
                  <SheetHeader>
                    <SheetTitle className="font-display text-xl">Sync Center</SheetTitle>
                  </SheetHeader>
                  <div className="mt-6 space-y-4 text-sm">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-md border border-border bg-muted/50 p-4">
                        <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Repos</p>
                        <p className="mt-2 text-lg font-semibold text-foreground">{stats.repoCount}</p>
                      </div>
                      <div className="rounded-md border border-border bg-muted/50 p-4">
                        <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Embeddings</p>
                        <p className="mt-2 text-lg font-semibold text-foreground">{stats.embeddingCount}</p>
                      </div>
                      <div className="rounded-md border border-border bg-muted/50 p-4">
                        <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Sessions</p>
                        <p className="mt-2 text-lg font-semibold text-foreground">{stats.sessionCount}</p>
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/50 p-4 text-muted-foreground">
                      <p className="font-medium text-foreground">Current status</p>
                      <p className="mt-2">
                        {stats.repoCount === 0
                          ? "Indexing has not started yet."
                          : stats.embeddingCount === 0
                            ? "Stars are present, but embeddings still need to be generated."
                            : "The local index is ready for Recall, Library, and Sessions."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Button className="rounded-md" onClick={() => navigate("/app/setup")}>
                        Open setup
                      </Button>
                      <Button variant="outline" className="rounded-md" onClick={() => navigate("/app/settings")}>
                        Open settings
                      </Button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="font-display text-lg font-semibold">{stats.repoCount}</p>
                  <p className="text-xs text-muted-foreground">Repos</p>
                </div>
                <div>
                  <p className="font-display text-lg font-semibold">{stats.embeddingCount}</p>
                  <p className="text-xs text-muted-foreground">Embeds</p>
                </div>
                <div>
                  <p className="font-display text-lg font-semibold">{stats.sessionCount}</p>
                  <p className="text-xs text-muted-foreground">Sessions</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggleButton showLabel className="flex-1" />
              <Button variant="ghost" size="sm" className="rounded-md" onClick={logout}>
                Logout
              </Button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-border bg-[var(--app-bg)]/95 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
              <Link to="/" className="min-w-0 transition-opacity hover:opacity-80">
                <p className="font-display text-xl font-semibold">{getTitle(location.pathname)}</p>
                <p className="truncate text-sm text-muted-foreground">{getDescription(location.pathname)}</p>
              </Link>
              <div className="flex items-center gap-2">
                <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="icon" className="rounded-md lg:hidden" aria-label="Open navigation">
                      <Menu className="h-4 w-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[88vw] border-border bg-[var(--app-panel)] sm:max-w-sm">
                    <SheetHeader>
                      <SheetTitle className="font-display text-xl">Workspace</SheetTitle>
                    </SheetHeader>
                    <div className="mt-6 space-y-5">
                      <div className="rounded-md border border-border bg-muted/50 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Status</p>
                        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <p className="font-display text-lg font-semibold">{stats.repoCount}</p>
                            <p className="text-xs text-muted-foreground">Repos</p>
                          </div>
                          <div>
                            <p className="font-display text-lg font-semibold">{stats.embeddingCount}</p>
                            <p className="text-xs text-muted-foreground">Embeds</p>
                          </div>
                          <div>
                            <p className="font-display text-lg font-semibold">{stats.sessionCount}</p>
                            <p className="text-xs text-muted-foreground">Sessions</p>
                          </div>
                        </div>
                      </div>
                      <nav className="space-y-1">
                        {NAV_ITEMS.map((item) => {
                          const Icon = item.icon;
                          return (
                            <NavLink
                              key={item.to}
                              to={item.to}
                              onClick={() => setMobileNavOpen(false)}
                              className={({ isActive }) =>
                                cn(
                                  "flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-all duration-200",
                                  isActive
                                    ? "border-l-2 border-primary bg-primary/8 pl-[10px] text-foreground"
                                    : "border-l-2 border-transparent pl-[10px] text-muted-foreground hover:bg-muted hover:text-foreground",
                                )
                              }
                            >
                              <Icon className="h-4 w-4" />
                              <span>{item.label}</span>
                            </NavLink>
                          );
                        })}
                      </nav>
                      <div className="grid gap-2">
                        <Button variant="outline" className="justify-start rounded-md" onClick={() => { setPaletteOpen(true); setMobileNavOpen(false); }}>
                          <Command className="mr-2 h-4 w-4" />
                          Command palette
                        </Button>
                        <ThemeToggleButton showLabel longLabel className="w-full justify-start" />
                        <Button variant="ghost" className="justify-start rounded-md" onClick={logout}>
                          <LogOut className="mr-2 h-4 w-4" />
                          Logout
                        </Button>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>
                <Badge variant="outline" className="hidden rounded-md px-3 py-1 text-xs md:inline-flex">
                  <Workflow className="mr-1.5 h-3.5 w-3.5" />
                  Local-first workspace
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-md"
                  onClick={() => setPaletteOpen(true)}
                  title={`Open command palette (${openPaletteShortcut})`}
                >
                  <Command className="mr-2 h-4 w-4" />
                  Search
                </Button>
                <ThemeToggleButton className="lg:hidden" />
              </div>
            </div>
          </header>

          <main className="min-h-0 flex-1 px-4 py-5 sm:px-6">
            <div className="mx-auto min-h-[calc(100vh-7rem)] max-w-[1280px]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
