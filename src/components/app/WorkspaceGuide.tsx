import { useMemo, useState } from "react";
import { BookOpen, History, Home, Search, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type ShowcaseItemId = "home" | "recall" | "library" | "sessions" | "settings";

type ShowcaseItem = {
  id: ShowcaseItemId;
  title: string;
  body: string;
  icon: typeof Home;
  previewTitle: string;
  previewBody: string;
  highlights: readonly [string, string];
};

const SHOWCASE_ITEMS: ShowcaseItem[] = [
  {
    id: "home",
    title: "Home",
    body: "Check sync health, resume your last thread, and see whether the index is ready.",
    icon: Home,
    previewTitle: "Workspace Home",
    previewBody: "Health, last activity, and next actions are visible at a glance.",
    highlights: ["Sync health stays at a glance.", "Best when you want a fast re-entry point."],
  },
  {
    id: "recall",
    title: "Recall",
    body: "Search by memory, inspect the best match, and choose context before chat.",
    icon: Search,
    previewTitle: "Recall Workspace",
    previewBody: "The strongest match stays readable so you can send an intentional prompt.",
    highlights: ["Matched context stays visible.", "Best when you remember the idea but not the name."],
  },
  {
    id: "library",
    title: "Library",
    body: "Browse repos, README content, and metadata like a curated archive.",
    icon: BookOpen,
    previewTitle: "Library View",
    previewBody: "Repository signals stay browseable even when you are not searching.",
    highlights: ["README clues stay easy to scan.", "Best when you want to rediscover without guessing."],
  },
  {
    id: "sessions",
    title: "Sessions",
    body: "Reopen past searches and transcripts with readable context.",
    icon: History,
    previewTitle: "Session History",
    previewBody: "Past searches, transcripts, and resume actions stay organized.",
    highlights: ["Readable transcripts stay attached.", "Best when you want to continue a prior thread."],
  },
  {
    id: "settings",
    title: "Settings",
    body: "Manage providers, sync controls, and local-first defaults.",
    icon: Settings,
    previewTitle: "Settings Surface",
    previewBody: "Connection and trust settings stay reachable without interrupting search.",
    highlights: ["Operational controls stay separate.", "Best when you need to tune the workspace."],
  },
];

export function WorkspaceGuide() {
  const [activeId, setActiveId] = useState<ShowcaseItemId>("home");

  const activeItem = useMemo(
    () => SHOWCASE_ITEMS.find((item) => item.id === activeId) ?? SHOWCASE_ITEMS[0],
    [activeId],
  );
  const ActiveIcon = activeItem.icon;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">Workspace views</p>
              <h3 className="mt-2 font-display text-xl font-bold text-foreground">{activeItem.previewTitle}</h3>
            </div>
            <Badge variant="secondary" className="rounded-full text-xs">
              5 views
            </Badge>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-background p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ActiveIcon className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium text-foreground">{activeItem.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{activeItem.previewBody}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Keeps visible</p>
                <p className="mt-1 text-xs font-medium text-foreground">{activeItem.highlights[0]}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Best for</p>
                <p className="mt-1 text-xs font-medium text-foreground">{activeItem.highlights[1]}</p>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-center gap-1.5">
            {SHOWCASE_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  item.id === activeId ? "w-5 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground/30"
                }`}
                onClick={() => setActiveId(item.id)}
                aria-label={item.title}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {SHOWCASE_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeId;

          return (
            <button
              key={item.id}
              type="button"
              className={`rounded-xl border p-4 text-left transition-all duration-200 ${
                isActive
                  ? "border-primary/30 bg-primary/5 shadow-sm"
                  : "border-border bg-muted/20 hover:bg-muted/40"
              }`}
              onMouseEnter={() => setActiveId(item.id)}
              onFocus={() => setActiveId(item.id)}
            >
              <div className="flex items-center gap-2.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span className="text-sm font-semibold text-foreground">{item.title}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.body}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
