import { useEffect, useMemo, useState } from "react";
import { BookOpen, History, Home, Search, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useParallaxProgress } from "@/components/landing/useParallaxProgress";

type ShowcaseItemId = "home" | "recall" | "library" | "sessions" | "settings";

type ShowcaseItem = {
  id: ShowcaseItemId;
  title: string;
  body: string;
  accent: string;
  icon: typeof Home;
  previewTitle: string;
  previewBody: string;
  highlights: readonly [string, string];
};

/* Unified pink/magenta accent palette for cohesive value rail */
const SHOWCASE_ITEMS: ShowcaseItem[] = [
  {
    id: "home",
    title: "Home",
    body: "Check sync health, resume your last thread, and see whether the index is ready before you search.",
    accent: "from-[#ffe8f0] to-[#ffd6e8] dark:from-[#4a2a3e] dark:to-[#6b3956]",
    icon: Home,
    previewTitle: "Workspace Home",
    previewBody: "The workspace opens with health, last activity, and next actions already visible.",
    highlights: ["Sync health stays at a glance.", "Best when you want a fast re-entry point."],
  },
  {
    id: "recall",
    title: "Recall",
    body: "Search by memory, inspect the best match, and choose context before anything goes into chat.",
    accent: "from-[#ffdce9] to-[#f5d9ff] dark:from-[#3d2545] dark:to-[#5c3568]",
    icon: Search,
    previewTitle: "Recall Workspace",
    previewBody: "The strongest match stays readable so you can send an intentional prompt instead of a hidden bundle.",
    highlights: ["Matched context stays visible.", "Best when you remember the idea but not the repo name."],
  },
  {
    id: "library",
    title: "Library",
    body: "Browse repos, README content, and metadata like a curated archive instead of a flat list.",
    accent: "from-[#f5e1ff] to-[#ffdce9] dark:from-[#47345c] dark:to-[#5d3d5a]",
    icon: BookOpen,
    previewTitle: "Library View",
    previewBody: "Repository signals stay browseable even when you are not ready to start a new query.",
    highlights: ["README clues stay easy to scan.", "Best when you want to rediscover without guessing."],
  },
  {
    id: "sessions",
    title: "Sessions",
    body: "Reopen past searches and transcripts with readable context instead of rebuilding memory from scratch.",
    accent: "from-[#ffd6e8] to-[#efe2ff] dark:from-[#3e2a4a] dark:to-[#5c4272]",
    icon: History,
    previewTitle: "Session History",
    previewBody: "Past searches, transcripts, and resume actions stay organized in one place.",
    highlights: ["Readable transcripts stay attached.", "Best when you want to continue a prior thread."],
  },
  {
    id: "settings",
    title: "Settings",
    body: "Manage providers, sync controls, and local-first defaults without crowding the main recall flow.",
    accent: "from-[#ffe2cf] to-[#ffdce9] dark:from-[#4a3540] dark:to-[#6b3956]",
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

  useEffect(() => {
    if (reducedMotion) {
      return;
    }
    setActiveId(SHOWCASE_ITEMS[getScrollIndex(progress)].id);
  }, [progress, reducedMotion]);

  const activeItem = useMemo(
    () => SHOWCASE_ITEMS.find((item) => item.id === activeId) ?? SHOWCASE_ITEMS[0],
    [activeId],
  );
  const ActiveIcon = activeItem.icon;
  const previewOffset = reducedMotion ? 0 : (0.5 - progress) * 18;
  const previewAnimationStyle = reducedMotion ? undefined : { animationDelay: "80ms" };

  return (
    <section className="relative px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1500px] gap-8 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] xl:items-center">
        <div style={{ transform: `translateY(${previewOffset}px)` }}>
          <div
            className={`${reducedMotion ? "" : "opacity-0 animate-slide-up"} overflow-hidden rounded-[36px] border border-white/20 bg-white/55 shadow-[0_32px_110px_rgba(28,12,41,0.14)] backdrop-blur-2xl dark:bg-black/25`}
            style={previewAnimationStyle}
          >
            <div className={`rounded-[36px] bg-gradient-to-br ${activeItem.accent} p-[1px] transition duration-500`}>
              <div className="rounded-[35px] bg-[var(--app-panel)]/90 p-6 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.32em] text-foreground/55">What you get after login</p>
                    <h2 className="mt-3 font-display text-3xl font-semibold text-foreground">{activeItem.previewTitle}</h2>
                  </div>
                  <Badge className="rounded-full bg-white/70 text-foreground dark:bg-white/10 dark:text-foreground">
                    5 focused views
                  </Badge>
                </div>

                <div className="mt-6 rounded-[28px] border border-white/20 bg-white/45 p-5 dark:bg-white/5">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                      <ActiveIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-foreground/50">Current view</p>
                      <p className="mt-2 font-display text-2xl font-semibold text-foreground">{activeItem.title}</p>
                      <p className="mt-3 max-w-xl text-sm leading-6 text-foreground/75">{activeItem.previewBody}</p>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/20 bg-white/35 p-4 dark:bg-white/5">
                      <p className="text-xs uppercase tracking-[0.24em] text-foreground/50">Keeps visible</p>
                      <p className="mt-2 text-sm font-medium text-foreground">{activeItem.highlights[0]}</p>
                    </div>
                    <div className="rounded-2xl border border-white/20 bg-white/35 p-4 dark:bg-white/5">
                      <p className="text-xs uppercase tracking-[0.24em] text-foreground/50">Best for</p>
                      <p className="mt-2 text-sm font-medium text-foreground">{activeItem.highlights[1]}</p>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-2">
                    {SHOWCASE_ITEMS.map((item) => (
                      <span
                        key={item.id}
                        className={`rounded-full border px-3 py-1 text-xs transition duration-300 ${
                          item.id === activeId
                            ? "border-primary/35 bg-primary/12 text-foreground"
                            : "border-white/20 bg-white/30 text-foreground/72 dark:bg-white/[0.03]"
                        }`}
                      >
                        {item.title}
                      </span>
                    ))}
                  </div>
                </div>
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
                className={`${index === SHOWCASE_ITEMS.length - 1 ? "sm:col-span-2" : ""} ${
                  reducedMotion ? "" : "opacity-0 animate-slide-up"
                } group min-h-[10.5rem] rounded-[30px] border p-5 text-left transition duration-500 ${
                  isActive
                    ? "border-primary/30 bg-white/60 shadow-[0_28px_90px_rgba(37,12,45,0.12)] dark:bg-white/10"
                    : "border-white/15 bg-white/35 hover:-translate-y-1 hover:bg-white/50 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
                }`}
                style={reducedMotion ? undefined : { animationDelay: `${160 + index * 70}ms` }}
                onMouseEnter={() => setActiveId(item.id)}
                onFocus={() => setActiveId(item.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${isActive ? "bg-primary text-primary-foreground" : "bg-white/70 text-foreground dark:bg-white/10"}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <Badge
                    variant="outline"
                    className={`rounded-full ${
                      isActive
                        ? "border-primary/30 bg-primary/10 text-foreground"
                        : "border-white/25 bg-white/30 text-foreground/60 dark:bg-white/[0.03]"
                    }`}
                  >
                    {isActive ? "Live preview" : `Step ${index + 1}`}
                  </Badge>
                </div>

                <div className="mt-5">
                  <p className="text-xs font-medium uppercase tracking-[0.28em] text-foreground/50">Step {index + 1}</p>
                  <h3 className="mt-2 font-display text-2xl font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-3 max-w-[32rem] text-sm leading-6 text-foreground/72">{item.body}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
