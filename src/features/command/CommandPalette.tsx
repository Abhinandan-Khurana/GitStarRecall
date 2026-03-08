import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { getLocalDatabase } from "@/db/client";
import type { ChatSessionRecord, RepoRecord } from "@/db/types";
import { useTheme } from "@/features/theme/useTheme";
import { detectClientShortcutPlatform, formatPrimaryModifierShortcut } from "@/lib/platformShortcuts";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ActionItem = {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
};

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { toggleTheme } = useTheme();
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [sessions, setSessions] = useState<ChatSessionRecord[]>([]);
  const [query, setQuery] = useState("");
  const shortcutPlatform = useMemo(() => detectClientShortcutPlatform(), []);
  const openSettingsShortcut = useMemo(
    () => formatPrimaryModifierShortcut(",", shortcutPlatform),
    [shortcutPlatform],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      const database = await getLocalDatabase();
      const nextRepos = database.listRepos().slice(0, 12);
      const nextSessions = database.listChatSessions().slice(0, 12);
      if (!cancelled) {
        setRepos(nextRepos);
        setSessions(nextSessions);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [open, location.pathname]);

  const actions = useMemo<ActionItem[]>(
    () => [
      {
        id: "go-recall",
        label: "Go to Recall",
        shortcut: "G R",
        run: () => navigate("/app/recall"),
      },
      {
        id: "go-library",
        label: "Go to Library",
        shortcut: "G L",
        run: () => navigate("/app/library"),
      },
      {
        id: "go-sessions",
        label: "Go to Sessions",
        shortcut: "G S",
        run: () => navigate("/app/sessions"),
      },
      {
        id: "go-settings",
        label: "Go to Settings",
        shortcut: openSettingsShortcut,
        run: () => navigate("/app/settings"),
      },
      {
        id: "go-setup",
        label: "Open Setup",
        run: () => navigate("/app/setup"),
      },
      {
        id: "toggle-theme",
        label: "Toggle Theme",
        shortcut: "T",
        run: () => toggleTheme(),
      },
    ],
    [navigate, openSettingsShortcut, toggleTheme],
  );

  const trimmedQuery = query.trim();
  const mode = trimmedQuery[0] ?? "";
  const searchBody = mode ? trimmedQuery.slice(1).trim().toLowerCase() : trimmedQuery.toLowerCase();

  const filteredActions = actions.filter((action) => {
    if (mode === "@" || mode === "#") {
      return false;
    }
    return action.label.toLowerCase().includes(searchBody);
  });

  const filteredSessions = sessions.filter((session) =>
    formatSessionQuery(session).toLowerCase().includes(searchBody),
  );
  const filteredRepos = repos.filter((repo) => {
    const text = `${repo.fullName} ${repo.language ?? ""} ${repo.topics.join(" ")}`.toLowerCase();
    return text.includes(searchBody);
  });

  const handleSelect = (run: () => void) => {
    onOpenChange(false);
    setQuery("");
    run();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search routes, sessions, and repos..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {mode === "/" && searchBody ? (
          <>
            <CommandGroup heading="Recall">
              <CommandItem onSelect={() => handleSelect(() => navigate(`/app/recall?q=${encodeURIComponent(searchBody)}`))}>
                <span>Open Recall with "{searchBody}"</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        ) : null}
        {mode !== "@" && mode !== "#" ? (
          <CommandGroup heading="Navigation">
            {filteredActions.map((action) => (
              <CommandItem key={action.id} onSelect={() => handleSelect(action.run)}>
                <span className="min-w-0 truncate">{action.label}</span>
                {action.shortcut ? <CommandShortcut>{action.shortcut}</CommandShortcut> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {mode !== "#" ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Sessions">
              {filteredSessions.length === 0 ? (
                <CommandItem disabled>No sessions yet</CommandItem>
              ) : (
                filteredSessions.map((session) => (
                  <CommandItem
                    key={session.id}
                    onSelect={() => handleSelect(() => navigate(`/app/sessions?session=${encodeURIComponent(session.id)}`))}
                  >
                    <span className="truncate">{formatSessionQuery(session)}</span>
                  </CommandItem>
                ))
              )}
            </CommandGroup>
          </>
        ) : null}
        {mode !== "@" ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Repos">
              {filteredRepos.length === 0 ? (
                <CommandItem disabled>No repos indexed yet</CommandItem>
              ) : (
                filteredRepos.map((repo) => (
                  <CommandItem
                    key={repo.id}
                    onSelect={() =>
                      handleSelect(() => navigate(`/app/library?repo=${encodeURIComponent(String(repo.id))}`))
                    }
                  >
                    <span className="truncate">{repo.fullName}</span>
                  </CommandItem>
                ))
              )}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

function formatSessionQuery(session: ChatSessionRecord) {
  return session.query || "Untitled session";
}
