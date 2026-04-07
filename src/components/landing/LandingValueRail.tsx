import { useEffect, useMemo, useState } from "react";
import { BookOpen, History, Home, Search, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useParallaxProgress } from "@/components/landing/useParallaxProgress";
import { useRevealOnScroll } from "@/hooks/useRevealOnScroll";

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
    body: "Check sync health, resume your last thread, and see whether the index is ready before you search.",
    icon: Home,
    previewTitle: "Workspace Home",
    previewBody: "The workspace opens with health, last activity, and next actions already visible.",
    highlights: ["Sync health stays at a glance.", "Best when you want a fast re-entry point."],
  },
  {
    id: "recall",
    title: "Recall",
    body: "Search by memory, inspect the best match, and choose context before anything goes into chat.",
    icon: Search,
    previewTitle: "Recall Workspace",
    previewBody: "The strongest match stays readable so you can send an intentional prompt instead of a hidden bundle.",
    highlights: ["Matched context stays visible.", "Best when you remember the idea but not the repo name."],
  },
  {
    id: "library",
    title: "Library",
    body: "Browse repos, README content, and metadata like a curated archive instead of a flat list.",
    icon: BookOpen,
    previewTitle: "Library View",
    previewBody: "Repository signals stay browseable even when you are not ready to start a new query.",
    highlights: ["README clues stay easy to scan.", "Best when you want to rediscover without guessing."],
  },
  {
    id: "sessions",
    title: "Sessions",
    body: "Reopen past searches and transcripts with readable context instead of rebuilding memory from scratch.",
    icon: History,
    previewTitle: "Session History",
    previewBody: "Past searches, transcripts, and resume actions stay organized in one place.",
    highlights: ["Readable transcripts stay attached.", "Best when you want to continue a prior thread."],
  },
  {
    id: "settings",
    title: "Settings",
    body: "Manage providers, sync controls, and local-first defaults without crowding the main recall flow.",
    icon: Settings,
    previewTitle: "Settings Surface",
    previewBody: "Connection, provider, and trust settings stay reachable without interrupting search.",
    highlights: ["Operational controls stay separate.", "Best when you need to tune the workspace, not the search."],
  },
] as const;

function getScrollIndex(progress: number) {
  const scaled = Math.round(progress * (SHOWCASE_ITEMS.length - 1));
  return Math.max(0, Math.min(SHOWCASE_ITEMS.length - 1, scaled));
}

export function LandingValueRail() {
  const [activeId, setActiveId] = useState<ShowcaseItemId>("home");
  const { progress, reducedMotion } = useParallaxProgress({ start: 0.16, end: 0.52 });
  const { ref: revealRef, revealed } = useRevealOnScroll<HTMLDivElement>();

  useEffect(() => {
    if (reducedMotion) return;
    setActiveId(SHOWCASE_ITEMS[getScrollIndex(progress)].id);
  }, [progress, reducedMotion]);

  const activeItem = useMemo(
    () => SHOWCASE_ITEMS.find((item) => item.id === activeId) ?? SHOWCASE_ITEMS[0],
    [activeId],
  );
  const ActiveIcon = activeItem.icon;
  const previewOffset = reducedMotion ? 0 : (0.5 - progress) * 14;

  return (
    <section ref={revealRef} className="relative px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1500px] gap-8 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] xl:items-center">
        <div style={reducedMotion ? undefined : { transform: `translateY(${previewOffset}px)` }}>
          <div className={`overflow-hidden rounded-2xl border border-border bg-card shadow-sm reveal ${revealed ? "revealed" : ""}`}>
            <div className="p-6 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.32em] text-muted-foreground">What you get after login</p>
                  <h2 className="mt-3 font-display text-3xl font-bold text-foreground">{activeItem.previewTitle}</h2>
                </div>
                <Badge variant="secondary" className="rounded-full">
                  5 focused views
                </Badge>
              </div>

              <div className="mt-6 rounded-xl border border-border bg-muted/40 p-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ActiveIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Current view</p>
                    <p className="mt-2 font-display text-2xl font-bold text-foreground">{activeItem.title}</p>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{activeItem.previewBody}</p>
                  </div>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-background p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Keeps visible</p>
                    <p className="mt-2 text-sm font-medium text-foreground">{activeItem.highlights[0]}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-background p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Best for</p>
                    <p className="mt-2 text-sm font-medium text-foreground">{activeItem.highlights[1]}</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-center gap-2">
                {SHOWCASE_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`h-2 rounded-full transition-all duration-300 ${
                      item.id === activeId
                        ? "w-6 bg-primary"
                        : "w-2 bg-border hover:bg-muted-foreground/30"
                    }`}
                    onClick={() => setActiveId(item.id)}
                    aria-label={item.title}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {SHOWCASE_ITEMS.map((item, index) => {
            const Icon = item.icon;
            const isActive = item.id === activeId;

            return (
              <button
                key={item.id}
                type="button"
                className={`${index === SHOWCASE_ITEMS.length - 1 ? "sm:col-span-2" : ""} reveal ${revealed ? "revealed" : ""} group min-h-[10rem] rounded-2xl border p-5 text-left transition-all duration-300 ${
                  isActive
                    ? "border-primary/30 bg-card shadow-sm"
                    : "border-border bg-card/60 hover:-translate-y-1 hover:shadow-sm"
                }`}
                style={{ transitionDelay: revealed ? `${120 + index * 60}ms` : undefined }}
                onMouseEnter={() => setActiveId(item.id)}
                onFocus={() => setActiveId(item.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <Badge
                    variant="outline"
                    className={`rounded-full ${
                      isActive ? "border-primary/30 bg-primary/10 text-foreground" : ""
                    }`}
                  >
                    {isActive ? "Live preview" : `Step ${index + 1}`}
                  </Badge>
                </div>

                <div className="mt-4">
                  <h3 className="font-display text-xl font-bold text-foreground">{item.title}</h3>
                  <p className="mt-2 max-w-[32rem] text-sm leading-6 text-muted-foreground">{item.body}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
