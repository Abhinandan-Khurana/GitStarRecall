import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowRight, Github, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggleButton } from "@/components/ui/ThemeToggleButton";
import { HeroSection } from "@/components/ui/hero-section-with-smooth-bg-shader";

type LandingHeroProps = {
  onScrollToConnect: () => void;
  onScrollToFlow: () => void;
  onOpenSource: () => void;
  /** When true, navbar CTA is "Open app" and goes to /app; otherwise "Get started" scrolls to connect */
  isAuthenticated: boolean;
  onNavCtaClick: () => void;
  reducedMotion: boolean;
  shaderColors: string[];
  heroOffsetY: number;
  chipOffsetY: number;
};

const PREVIEW_ITEMS = [
  "Read stars by memory",
  "Explicit context",
  "Local-first index",
  "Private repos supported",
] as const;

function HeroCard({
  title,
  children,
  className,
  style,
  isBackground,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  isBackground?: boolean;
}) {
  return (
    <div
      className={`rounded-[32px] border border-white/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.05))] p-5 shadow-[0_24px_80px_rgba(40,22,58,0.18)] backdrop-blur-xl transition-opacity duration-500 ${className ?? ""}`}
      style={{
        ...style,
        opacity: isBackground ? 0.65 : 1,
      }}
    >
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-foreground/60">{title}</p>
      {children}
    </div>
  );
}

export function LandingHero({
  onScrollToConnect,
  onScrollToFlow,
  onOpenSource,
  isAuthenticated,
  onNavCtaClick,
  reducedMotion,
  shaderColors,
  heroOffsetY,
  chipOffsetY,
}: LandingHeroProps) {
  const cardEnterClass = reducedMotion ? "" : "animate-float-entrance";
  const headlineEnterClass = reducedMotion ? "" : "animate-headline-entrance";
  const supportingEnterClass = reducedMotion ? "" : "animate-supporting-entrance";
  const buttonsEnterClass = reducedMotion ? "" : "animate-buttons-entrance";
  const hoverLiftClass = reducedMotion ? "" : "transition-transform duration-500 hover:-translate-y-2 hover:scale-[1.01]";
  const floatCardClassA = reducedMotion ? "" : "animate-float-card-a";
  const floatCardClassB = reducedMotion ? "" : "animate-float-card-b";
  const floatCardClassC = reducedMotion ? "" : "animate-float-card-c";

  return (
    <section className="relative min-h-screen overflow-hidden">
      <HeroSection reducedMotion={reducedMotion} colors={shaderColors} className="min-h-screen items-start justify-start" maxWidth="max-w-[1500px]" renderContent={false}>
        <div className="relative z-20 mx-auto flex min-h-screen w-full flex-col justify-center pb-12 pt-24 sm:pt-28 lg:pt-32">
          <div className="hidden xl:block">
            <div className="relative mx-auto min-h-[760px] max-w-[1500px]">
              {/* Left card - positioned to avoid center content */}
              <div className="absolute left-[1%] top-[8%] w-[13.5rem] z-10" style={reducedMotion ? undefined : { transform: `translateY(${chipOffsetY}px)` }}>
                <div className={`${cardEnterClass} ${floatCardClassA}`} style={reducedMotion ? undefined : { animationDelay: "400ms" }}>
                  <HeroCard title="Recall moment" isBackground className={hoverLiftClass}>
                    <p className="mt-4 text-[1.05rem] font-semibold leading-8 text-foreground">"TypeScript auth starter with clear boundaries"</p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/18 bg-white/10 px-3 py-1 text-xs text-foreground/75">Read stars by memory</span>
                      <span className="rounded-full border border-white/18 bg-white/10 px-3 py-1 text-xs text-foreground/75">Explicit context</span>
                    </div>
                  </HeroCard>
                </div>
              </div>

              {/* Center headline + supporting text - highest content z-index */}
              <div className="relative z-30 mx-auto flex max-w-3xl flex-col items-center pt-28 text-center">
                <p className={`text-sm font-medium uppercase tracking-[0.35em] text-primary/75 ${supportingEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "200ms" }}>
                  GitStarRecall
                </p>
                <h1 className={`mt-5 text-balance font-display text-[5.7rem] font-semibold leading-[0.9] text-foreground ${headlineEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "100ms" }}>
                  Find starred repos by memory, not by name.
                </h1>
                <p className={`mx-auto mt-7 max-w-3xl text-pretty text-[1.05rem] leading-9 text-foreground/72 ${supportingEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "250ms" }}>
                  Search GitHub stars the way memory actually works. Reconstruct context, preview the right repo, and move into the workspace with trust built in.
                </p>
              </div>

              {/* Right card - positioned to avoid center content */}
              <div className="absolute right-[1%] top-[12%] w-[18.5rem] z-10" style={reducedMotion ? undefined : { transform: `translateY(${heroOffsetY}px)` }}>
                <div className={`${cardEnterClass} ${floatCardClassB}`} style={reducedMotion ? undefined : { animationDelay: "500ms" }}>
                  <HeroCard title="Workspace preview" isBackground className={hoverLiftClass}>
                    <div className="absolute right-5 top-5">
                      <Github className="h-4 w-4 text-foreground/55" />
                    </div>
                    <div className="mt-4 grid gap-3">
                      {PREVIEW_ITEMS.map((item, index) => (
                        <div key={item} className={`rounded-2xl border border-white/15 px-4 py-3 ${index === 1 ? "bg-primary/14" : "bg-white/10"}`}>
                          <p className="text-sm font-medium text-foreground">{item}</p>
                        </div>
                      ))}
                    </div>
                  </HeroCard>
                </div>
              </div>

              {/* Bottom card - spans width but positions below center content */}
              <div className="absolute inset-x-0 bottom-0 z-20 grid items-end gap-4 px-6 pb-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,0.75fr)]">
                <div className={cardEnterClass} style={reducedMotion ? undefined : { animationDelay: "600ms" }}>
                  <HeroCard title="Read-only GitHub access" isBackground className={`${hoverLiftClass} min-h-[9.5rem]`}>
                    <div className="mt-4 flex max-w-xl items-start gap-4">
                      <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary">
                        <Lock className="h-5 w-5" />
                      </div>
                      <p className="text-sm leading-7 text-foreground/78">
                        GitHub OAuth uses read-only access so GitStarRecall can read your public repositories. Personal Access Tokens should use the same read-only repository scope for reading public repositories.
                      </p>
                    </div>
                  </HeroCard>
                </div>

                <div className={`flex flex-col items-end gap-3 ${buttonsEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "650ms" }}>
                  <Button size="lg" className="rounded-full px-6 shadow-[0_18px_50px_rgba(184,83,138,0.3)]" onClick={onScrollToConnect}>
                    Get started
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <Button size="lg" variant="outline" className="rounded-full border-white/25 bg-white/14 px-6 backdrop-blur-md" onClick={onScrollToFlow}>
                    See the workspace flow
                    <ArrowDown className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="xl:hidden">
            <div className="relative z-30 mx-auto max-w-4xl text-center">
              <p className={`text-sm font-medium uppercase tracking-[0.35em] text-primary/75 ${supportingEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "200ms" }}>GitStarRecall</p>
              <h1 className={`mt-5 text-balance font-display text-5xl font-semibold leading-[0.92] text-foreground sm:text-6xl lg:text-[5rem] ${headlineEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "100ms" }}>
                Find starred repos by memory, not by name.
              </h1>
              <p className={`mx-auto mt-6 max-w-3xl text-pretty text-lg leading-8 text-foreground/74 sm:text-xl ${supportingEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "250ms" }}>
                Remember the idea, not the repo name. Rebuild the match, inspect the README signal, and carry only the context you choose into chat.
              </p>
            </div>

            <div className={`mt-10 flex flex-wrap justify-center gap-3 ${buttonsEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "650ms" }}>
              <Button size="lg" className="rounded-full px-6 shadow-[0_18px_50px_rgba(184,83,138,0.3)]" onClick={onScrollToConnect}>
                Get started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" className="rounded-full border-white/25 bg-white/14 px-6 backdrop-blur-md" onClick={onScrollToFlow}>
                See the workspace flow
                <ArrowDown className="ml-2 h-4 w-4" />
              </Button>
            </div>

            <div className="relative z-10 mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,0.76fr)_minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div style={reducedMotion ? undefined : { transform: `translateY(${chipOffsetY}px)` }}>
                <div className={`h-full ${cardEnterClass} ${floatCardClassA}`} style={reducedMotion ? undefined : { animationDelay: "400ms" }}>
                  <HeroCard title="Recall moment" isBackground className={`${hoverLiftClass} h-full`}>
                    <p className="mt-4 text-xl font-semibold leading-8 text-foreground">"TypeScript auth starter with clean boundaries"</p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/18 bg-white/10 px-3 py-1 text-xs text-foreground/75">Read stars by memory</span>
                      <span className="rounded-full border border-white/18 bg-white/10 px-3 py-1 text-xs text-foreground/75">Explicit context</span>
                    </div>
                  </HeroCard>
                </div>
              </div>

              <div className="md:col-span-2 xl:col-span-1" style={reducedMotion ? undefined : { transform: `translateY(${heroOffsetY * 0.28}px)` }}>
                <div className={`h-full ${cardEnterClass} ${floatCardClassC}`} style={reducedMotion ? undefined : { animationDelay: "500ms" }}>
                  <HeroCard title="Read-only GitHub access" isBackground className={`${hoverLiftClass} h-full`}>
                    <div className="mt-4 flex items-start gap-4">
                      <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary">
                        <Lock className="h-5 w-5" />
                      </div>
                      <p className="text-base leading-7 text-foreground/78">
                        OAuth and PAT only need read-only repo access to import your starred public and private repositories. GitStarRecall never asks for write access.
                      </p>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2 text-xs text-foreground/72">
                      <span className="rounded-full border border-white/18 bg-white/12 px-3 py-1">OAuth</span>
                      <span className="rounded-full border border-white/18 bg-white/12 px-3 py-1">PAT</span>
                      <span className="rounded-full border border-white/18 bg-white/12 px-3 py-1">No write scope</span>
                    </div>
                  </HeroCard>
                </div>
              </div>

              <div className="md:col-span-2 xl:col-span-1" style={reducedMotion ? undefined : { transform: `translateY(${heroOffsetY}px)` }}>
                <div className={`h-full ${cardEnterClass} ${floatCardClassB}`} style={reducedMotion ? undefined : { animationDelay: "600ms" }}>
                  <HeroCard title="Workspace preview" isBackground className={`${hoverLiftClass} h-full`}>
                    <div className="absolute right-5 top-5">
                      <Github className="h-4 w-4 text-foreground/55" />
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      {PREVIEW_ITEMS.map((item, index) => (
                        <div key={item} className={`rounded-2xl border border-white/15 px-4 py-3 ${index === 1 ? "bg-primary/14" : "bg-white/10"}`}>
                          <p className="text-sm font-medium text-foreground">{item}</p>
                        </div>
                      ))}
                    </div>
                  </HeroCard>
                </div>
              </div>
            </div>
          </div>
        </div>
      </HeroSection>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-50 mx-auto max-w-[1500px] px-4 sm:px-6 lg:px-8">
        <div className="pointer-events-auto flex items-center justify-between border-b border-white/20 py-4 backdrop-blur-md">
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
            <Button
              size="sm"
              className="rounded-full border-white/25 bg-white/14 px-4 text-foreground shadow-[0_18px_50px_rgba(184,83,138,0.25)] backdrop-blur-md hover:bg-white/20 hover:text-foreground dark:bg-white/10 dark:hover:bg-white/15"
              onClick={onNavCtaClick}
            >
              {isAuthenticated ? "Open app" : "Get started"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="rounded-full border-white/25 bg-white/10 backdrop-blur-md" onClick={onOpenSource} aria-label="View source">
              <Github className="h-4 w-4" />
            </Button>
            <ThemeToggleButton />
          </div>
        </div>
      </div>
    </section>
  );
}
