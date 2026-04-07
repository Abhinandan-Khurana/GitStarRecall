import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, Github, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggleButton } from "@/components/ui/ThemeToggleButton";
import { HeroSection } from "@/components/ui/hero-section-with-smooth-bg-shader";

type LandingHeroProps = {
  onScrollToConnect: () => void;
  onOAuthLogin: () => void;
  onOpenSource: () => void;
  isAuthenticated: boolean;
  onNavCtaClick: () => void;
  reducedMotion: boolean;
  heroOffsetY: number;
  chipOffsetY: number;
  scrolled: boolean;
};

const PREVIEW_ITEMS = [
  "Read stars by memory",
  "Explicit context",
  "Local-first index",
  "Public repos only",
] as const;

function HeroCard({
  title,
  children,
  className,
  style,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`relative rounded-2xl border border-border bg-card p-5 shadow-sm transition-shadow duration-300 hover:shadow-md ${className ?? ""}`}
      style={style}
    >
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

export function LandingHero({
  onScrollToConnect,
  onOAuthLogin,
  onOpenSource,
  isAuthenticated,
  onNavCtaClick,
  reducedMotion,
  heroOffsetY,
  chipOffsetY,
  scrolled,
}: LandingHeroProps) {
  const cardEnterClass = reducedMotion ? "" : "animate-float-entrance";
  const headlineEnterClass = reducedMotion ? "" : "animate-headline-entrance";
  const supportingEnterClass = reducedMotion ? "" : "animate-supporting-entrance";
  const buttonsEnterClass = reducedMotion ? "" : "animate-buttons-entrance";
  const hoverLiftClass = reducedMotion ? "" : "transition-transform duration-500 hover:-translate-y-1";
  const floatCardClassA = reducedMotion ? "" : "animate-float-card-a";
  const floatCardClassB = reducedMotion ? "" : "animate-float-card-b";

  return (
    <section className="relative min-h-screen overflow-hidden">
      <HeroSection reducedMotion={reducedMotion} className="min-h-screen items-start justify-start" maxWidth="max-w-[1500px]" renderContent={false}>
        <div className="relative z-20 mx-auto flex min-h-screen w-full flex-col justify-center pb-12 pt-24 sm:pt-28 lg:pt-32">
          {/* ---------- XL Desktop ---------- */}
          <div className="hidden xl:block">
            <div className="relative mx-auto min-h-[680px] max-w-[1500px]">
              <div className="absolute left-[2%] top-[14%] w-[16rem] z-10" style={reducedMotion ? undefined : { transform: `translateY(${chipOffsetY}px)` }}>
                <div className={floatCardClassA} style={reducedMotion ? undefined : { animationDelay: "1200ms" }}>
                  <div className={cardEnterClass} style={reducedMotion ? undefined : { animationDelay: "400ms" }}>
                    <HeroCard title="Recall moment" className={hoverLiftClass}>
                      <p className="mt-4 text-[1.05rem] font-semibold leading-8 text-foreground">&ldquo;TypeScript auth starter with clear boundaries&rdquo;</p>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">Read stars by memory</span>
                        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">Explicit context</span>
                      </div>
                    </HeroCard>
                  </div>
                </div>
              </div>

              <div className="relative z-30 mx-auto flex max-w-3xl flex-col items-center pt-20 text-center">
                <p className={`text-sm font-medium uppercase tracking-[0.35em] text-primary ${supportingEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "200ms" }}>
                  GitStarRecall
                </p>
                <h1 className={`mt-5 text-balance font-display text-[5.7rem] font-bold leading-[0.9] text-foreground ${headlineEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "100ms" }}>
                  Find starred repos by memory, not by name.
                </h1>
                <p className={`mx-auto mt-7 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground ${supportingEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "300ms" }}>
                  Search GitHub stars the way memory actually works. Reconstruct context, preview the right repo, and move into the workspace with trust built in.
                </p>
                <div className={`mt-3 flex items-center gap-2 text-sm text-muted-foreground/70 ${supportingEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "400ms" }}>
                  <Lock className="h-3.5 w-3.5" />
                  <span>Read-only access. No write scope.</span>
                </div>
              </div>

              <div className="absolute right-[1%] top-[12%] w-[20rem] z-10" style={reducedMotion ? undefined : { transform: `translateY(${heroOffsetY}px)` }}>
                <div className={floatCardClassB} style={reducedMotion ? undefined : { animationDelay: "1400ms" }}>
                  <div className={cardEnterClass} style={reducedMotion ? undefined : { animationDelay: "600ms" }}>
                    <HeroCard title="Workspace preview" className={hoverLiftClass}>
                      <div className="absolute right-5 top-5">
                        <Github className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="mt-4 grid gap-3">
                        {PREVIEW_ITEMS.map((item, index) => (
                          <div key={item} className={`rounded-xl border border-border px-4 py-3 ${index === 1 ? "bg-primary/10 border-primary/20" : "bg-muted"}`}>
                            <p className="text-sm font-medium text-foreground">{item}</p>
                          </div>
                        ))}
                      </div>
                    </HeroCard>
                  </div>
                </div>
              </div>

              <div className="absolute inset-x-0 bottom-0 z-20 flex items-end justify-center gap-3 px-6 pb-8">
                <div className={`flex items-center gap-3 ${buttonsEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "900ms" }}>
                  {isAuthenticated ? (
                    <Button size="lg" className="rounded-full px-8 shadow-[0_12px_32px_hsl(var(--primary)/0.2)]" onClick={onNavCtaClick}>
                      Open app
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  ) : (
                    <>
                      <Button size="lg" className="rounded-full px-8 shadow-[0_12px_32px_hsl(var(--primary)/0.2)]" onClick={onOAuthLogin}>
                        <Github className="mr-2 h-4 w-4" />
                        Continue with GitHub
                      </Button>
                      <Button size="lg" variant="outline" className="rounded-full px-6" onClick={onScrollToConnect}>
                        Use a PAT instead
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ---------- Tablet / Mobile ---------- */}
          <div className="xl:hidden">
            <div className="relative z-30 mx-auto max-w-4xl text-center">
              <p className={`text-sm font-medium uppercase tracking-[0.35em] text-primary ${supportingEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "200ms" }}>GitStarRecall</p>
              <h1 className={`mt-5 text-balance font-display text-5xl font-bold leading-[0.92] text-foreground sm:text-6xl lg:text-[5rem] ${headlineEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "100ms" }}>
                Find starred repos by memory, not by name.
              </h1>
              <p className={`mx-auto mt-6 max-w-3xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl ${supportingEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "300ms" }}>
                Remember the idea, not the repo name. Rebuild the match, inspect the README signal, and carry only the context you choose into chat.
              </p>
              <div className={`mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground/70 ${supportingEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "400ms" }}>
                <Lock className="h-3.5 w-3.5" />
                <span>Read-only access. No write scope.</span>
              </div>
            </div>

            <div className={`mt-10 flex flex-wrap justify-center gap-3 ${buttonsEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "700ms" }}>
              {isAuthenticated ? (
                <Button size="lg" className="rounded-full px-8 shadow-[0_12px_32px_hsl(var(--primary)/0.2)]" onClick={onNavCtaClick}>
                  Open app
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <>
                  <Button size="lg" className="rounded-full px-8 shadow-[0_12px_32px_hsl(var(--primary)/0.2)]" onClick={onOAuthLogin}>
                    <Github className="mr-2 h-4 w-4" />
                    Continue with GitHub
                  </Button>
                  <Button size="lg" variant="outline" className="rounded-full px-6" onClick={onScrollToConnect}>
                    Use a PAT instead
                  </Button>
                </>
              )}
            </div>

            <div className="relative z-10 mt-12 grid gap-4 sm:grid-cols-2">
              <div style={reducedMotion ? undefined : { transform: `translateY(${chipOffsetY}px)` }}>
                <div className={`h-full ${floatCardClassA}`} style={reducedMotion ? undefined : { animationDelay: "1200ms" }}>
                  <div className={`h-full ${cardEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "400ms" }}>
                    <HeroCard title="Recall moment" className={`${hoverLiftClass} h-full`}>
                      <p className="mt-4 text-xl font-semibold leading-8 text-foreground">&ldquo;TypeScript auth starter with clean boundaries&rdquo;</p>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">Read stars by memory</span>
                        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">Explicit context</span>
                      </div>
                    </HeroCard>
                  </div>
                </div>
              </div>

              <div style={reducedMotion ? undefined : { transform: `translateY(${heroOffsetY}px)` }}>
                <div className={`h-full ${floatCardClassB}`} style={reducedMotion ? undefined : { animationDelay: "1600ms" }}>
                  <div className={`h-full ${cardEnterClass}`} style={reducedMotion ? undefined : { animationDelay: "800ms" }}>
                    <HeroCard title="Workspace preview" className={`${hoverLiftClass} h-full`}>
                      <div className="absolute right-5 top-5">
                        <Github className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="mt-4 grid gap-3">
                        {PREVIEW_ITEMS.map((item, index) => (
                          <div key={item} className={`rounded-xl border border-border px-4 py-3 ${index === 1 ? "bg-primary/10 border-primary/20" : "bg-muted"}`}>
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
        </div>
      </HeroSection>

      {/* ---------- Fixed Navbar ---------- */}
      <div className={`pointer-events-none fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-border bg-background/90 shadow-sm backdrop-blur-xl"
          : "border-b border-transparent backdrop-blur-md"
      }`}>
        <div className="pointer-events-auto mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3 text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="font-display text-lg font-semibold text-foreground">GitStarRecall</p>
              <p className="text-xs text-muted-foreground">Local memory for GitHub stars</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="rounded-full px-4"
              onClick={isAuthenticated ? onNavCtaClick : onOAuthLogin}
            >
              {isAuthenticated ? "Open app" : "Get started"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="rounded-full" onClick={onOpenSource} aria-label="View source">
              <Github className="h-4 w-4" />
            </Button>
            <ThemeToggleButton />
          </div>
        </div>
      </div>
    </section>
  );
}
