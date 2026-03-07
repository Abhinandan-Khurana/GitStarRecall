import { ArrowDown, ArrowRight, Github, Lock, Moon, Sparkles, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HeroSection } from "@/components/ui/hero-section-with-smooth-bg-shader";
import { useTheme } from "@/features/theme/useTheme";

type LandingHeroProps = {
  onScrollToConnect: () => void;
  onScrollToFlow: () => void;
  onOpenSource: () => void;
  reducedMotion: boolean;
  shaderColors: string[];
  heroOffsetY: number;
  chipOffsetY: number;
};

const FLOATING_CHIPS = [
  "Read stars by memory",
  "Explicit context",
  "Local-first index",
  "Private repos supported",
] as const;

export function LandingHero({
  onScrollToConnect,
  onScrollToFlow,
  onOpenSource,
  reducedMotion,
  shaderColors,
  heroOffsetY,
  chipOffsetY,
}: LandingHeroProps) {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <section className="relative min-h-screen overflow-hidden">
      <HeroSection
        reducedMotion={reducedMotion}
        colors={shaderColors}
        className="min-h-screen"
        maxWidth="max-w-[1500px]"
        title="Find starred repos by intent, inspect the match, and keep context visible."
        highlightText="GitStarRecall"
        description="Search GitHub stars the way memory actually works. Reconstruct context, preview the right repo, and move into the workspace with trust built in."
        buttonText=""
        titleClassName="mx-auto max-w-5xl"
        descriptionClassName="max-w-3xl text-foreground/70"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 mx-auto max-w-[1500px] px-4 sm:px-6 lg:px-8">
        <div className="pointer-events-auto flex items-center justify-between border-b border-white/20 py-6 backdrop-blur-md">
          <button type="button" className="flex items-center gap-3 text-left" onClick={onScrollToFlow}>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/12 text-primary shadow-[0_18px_60px_rgba(22,12,35,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="font-display text-lg font-semibold text-foreground">GitStarRecall</p>
              <p className="text-sm text-foreground/65">Local memory for GitHub stars</p>
            </div>
          </button>

          <div className="flex items-center gap-2">
            <Button variant="outline" className="rounded-full border-white/25 bg-white/10 backdrop-blur-md" onClick={onOpenSource}>
              View source
            </Button>
            <Button variant="outline" size="icon" className="rounded-full border-white/25 bg-white/10 backdrop-blur-md" onClick={toggleTheme}>
              {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        <div
          className="absolute left-[7%] top-[24%] hidden w-56 rounded-[28px] border border-white/20 bg-white/10 p-4 shadow-[0_24px_80px_rgba(40,22,58,0.22)] backdrop-blur-xl lg:block"
          style={{ transform: `translateY(${chipOffsetY}px)` }}
        >
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-foreground/60">Recall moment</p>
          <p className="mt-3 text-sm font-medium text-foreground">“TypeScript auth starter with clear boundaries”</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {FLOATING_CHIPS.slice(0, 2).map((chip) => (
              <span key={chip} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-foreground/75">
                {chip}
              </span>
            ))}
          </div>
        </div>

        <div
          className="absolute right-[6%] top-[28%] hidden w-72 rounded-[32px] border border-white/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.05))] p-5 shadow-[0_28px_90px_rgba(46,18,65,0.25)] backdrop-blur-xl xl:block"
          style={{ transform: `translateY(${heroOffsetY}px)` }}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-foreground/60">Workspace preview</p>
            <Github className="h-4 w-4 text-foreground/55" />
          </div>
          <div className="mt-4 space-y-3">
            {FLOATING_CHIPS.map((chip, index) => (
              <div key={chip} className={`rounded-2xl border border-white/15 px-4 py-3 ${index === 1 ? "bg-primary/15" : "bg-white/10"}`}>
                <p className="text-sm font-medium text-foreground">{chip}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="relative z-20 mx-auto -mt-40 max-w-[1500px] px-4 pb-16 sm:px-6 lg:px-8">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="rounded-[28px] border border-white/20 bg-white/55 p-6 shadow-[0_20px_70px_rgba(35,12,45,0.12)] backdrop-blur-xl dark:bg-black/20">
            <Badge variant="outline" className="rounded-full border-white/30 bg-white/30 px-3 py-1">
              <Lock className="mr-2 h-3.5 w-3.5" />
              Read-only GitHub access
            </Badge>
            <p className="mt-4 text-sm leading-6 text-foreground/75">
              GitHub OAuth uses read-only access so GitStarRecall can read your public  repositories. Personal Access Tokens should use the same read-only repository scope for reading public repositories.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Button size="lg" className="rounded-full px-6" onClick={onScrollToConnect}>
              Get started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" className="rounded-full border-white/25 bg-white/30 px-6 backdrop-blur-md" onClick={onScrollToFlow}>
              See the workspace flow
              <ArrowDown className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
