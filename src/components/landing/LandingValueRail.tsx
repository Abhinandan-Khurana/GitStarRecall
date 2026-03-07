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
};

const SHOWCASE_ITEMS: ShowcaseItem[] = [
  {
    id: "home",
    title: "Home",
    body: "See workspace health, resume your latest thread, and know whether the index is ready without searching first.",
    accent: "from-[#ffddd9] to-[#ffc1df] dark:from-[#6b3956] dark:to-[#a25772]",
    icon: Home,
    previewTitle: "Workspace Home",
    previewBody: "Status, latest session, and next actions stay visible before you even search.",
  },
  {
    id: "recall",
    title: "Recall",
    body: "Search by memory, inspect the strongest matches, and keep context explicit before sending anything to chat.",
    accent: "from-[#ffe6c0] to-[#ffd6ef] dark:from-[#5d3b31] dark:to-[#8b4f79]",
    icon: Search,
    previewTitle: "Recall Workspace",
    previewBody: "Visible context selection turns search results into an intentional prompt, not a hidden bundle.",
  },
  {
    id: "library",
    title: "Library",
    body: "Browse indexed repos, descriptions, and README content like a curated archive instead of a flat list.",
    accent: "from-[#f5e1ff] to-[#ffd6d8] dark:from-[#47345c] dark:to-[#744152]",
    icon: BookOpen,
    previewTitle: "Library View",
    previewBody: "Metadata, README signals, and next-step actions make rediscovery feel lightweight.",
  },
  {
    id: "sessions",
    title: "Sessions",
    body: "Return to prior searches and transcripts with readable context instead of rebuilding memory from scratch.",
    accent: "from-[#d7f0ff] to-[#efe2ff] dark:from-[#22485a] dark:to-[#5c4272]",
    icon: History,
    previewTitle: "Session History",
    previewBody: "Readable transcripts and resume actions keep the recall loop continuous.",
  },
  {
    id: "settings",
    title: "Settings",
    body: "Provider defaults, sync controls, and local-first trust settings stay available without cluttering Recall.",
    accent: "from-[#fff0d0] to-[#ffd9b8] dark:from-[#5e4730] dark:to-[#7e5940]",
    icon: Settings,
    previewTitle: "Settings Surface",
    previewBody: "Operational controls move out of the main search path but stay easy to reach.",
  },
] as const;

function getScrollIndex(progress: number) {
  const scaled = Math.round(progress * (SHOWCASE_ITEMS.length - 1));
  return Math.max(0, Math.min(SHOWCASE_ITEMS.length - 1, scaled));
}

export function LandingValueRail() {
  const [activeId, setActiveId] = useState<ShowcaseItemId>("home");
  const { progress, reducedMotion } = useParallaxProgress({ start: 0.16, end: 0.56 });

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

  return (
    <section className="relative px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1500px] gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="lg:sticky lg:top-20 lg:h-[38rem]">
          <div className="overflow-hidden rounded-[36px] border border-white/20 bg-white/55 p-6 shadow-[0_32px_110px_rgba(28,12,41,0.14)] backdrop-blur-2xl dark:bg-black/25">
            <div className={`rounded-[28px] bg-gradient-to-br ${activeItem.accent} p-[1px] transition duration-500`}>
              <div className="rounded-[27px] bg-[var(--app-panel)]/90 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.32em] text-foreground/55">What you get after login</p>
                    <h2 className="mt-3 font-display text-3xl font-semibold text-foreground">{activeItem.previewTitle}</h2>
                  </div>
                  <Badge className="rounded-full bg-white/70 text-foreground dark:bg-white/10 dark:text-foreground">
                    Product flow
                  </Badge>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-4 rounded-[24px] border border-white/20 bg-white/45 p-5 dark:bg-white/5">
                    <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                        <ActiveIcon className="h-5 w-5" />
                    </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-foreground/50">Active surface</p>
                        <p className="font-display text-xl font-semibold text-foreground">{activeItem.title}</p>
                      </div>
                    </div>
                    <p className="text-sm leading-6 text-foreground/75">{activeItem.previewBody}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/20 bg-white/35 p-4 dark:bg-white/5">
                        <p className="text-xs uppercase tracking-[0.24em] text-foreground/50">Primary action</p>
                        <p className="mt-2 text-sm font-medium text-foreground">
                          {activeItem.id === "recall" ? "Search by memory" : activeItem.id === "home" ? "Resume work" : "Open dedicated view"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/20 bg-white/35 p-4 dark:bg-white/5">
                        <p className="text-xs uppercase tracking-[0.24em] text-foreground/50">Design intent</p>
                        <p className="mt-2 text-sm font-medium text-foreground">Less clutter, stronger orientation, faster re-entry.</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-[24px] border border-white/20 bg-white/40 p-5 dark:bg-white/5">
                    {SHOWCASE_ITEMS.map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-2xl border px-4 py-4 transition duration-300 ${
                          item.id === activeId
                            ? "border-primary/40 bg-primary/10 shadow-[0_18px_60px_rgba(55,20,78,0.14)]"
                            : "border-white/15 bg-white/30 dark:bg-white/0"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/70 text-foreground dark:bg-white/10">
                            <item.icon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{item.title}</p>
                            <p className="text-xs text-foreground/60">{item.id === activeId ? "Active scene" : "Upcoming"}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {SHOWCASE_ITEMS.map((item, index) => {
            const Icon = item.icon;
            const isActive = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                className={`group block w-full rounded-[30px] border p-7 text-left transition duration-500 ${
                  isActive
                    ? "border-primary/30 bg-white/60 shadow-[0_28px_90px_rgba(37,12,45,0.12)] dark:bg-white/10"
                    : "border-white/15 bg-white/35 hover:bg-white/50 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
                }`}
                onMouseEnter={() => setActiveId(item.id)}
                onFocus={() => setActiveId(item.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.3em] text-foreground/50">Step {index + 1}</p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${isActive ? "bg-primary text-primary-foreground" : "bg-white/70 text-foreground dark:bg-white/10"}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="font-display text-2xl font-semibold text-foreground">{item.title}</h3>
                    </div>
                    <p className="mt-5 max-w-xl text-base leading-7 text-foreground/72">{item.body}</p>
                  </div>
                  <Badge variant="outline" className={`rounded-full ${isActive ? "border-primary/30 bg-primary/10" : "border-white/25 bg-white/30"}`}>
                    {isActive ? "In focus" : "Hover to preview"}
                  </Badge>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
