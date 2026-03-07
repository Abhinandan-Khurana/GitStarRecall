import { ArrowRight, DatabaseZap, Github, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useParallaxProgress } from "@/components/landing/useParallaxProgress";

const FLOW_STEPS = [
  {
    title: "Connect GitHub",
    body: "Read your starred repositories with explicit read-only permissions, whether you use OAuth or a PAT.",
    icon: Github,
  },
  {
    title: "Build the local index",
    body: "Fetch READMEs and embeddings so your starred repos become searchable by intent, not just by name.",
    icon: DatabaseZap,
  },
  {
    title: "Recall by memory",
    body: "Search by the fragment you remember, inspect the match, and carry only the context you choose into chat.",
    icon: Search,
  },
] as const;

export function LandingWorkspaceFlow() {
  const { progress, reducedMotion } = useParallaxProgress({ start: 0.54, end: 0.84 });

  return (
    <section id="workflow" className="px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] rounded-[36px] border border-white/15 bg-white/40 p-8 shadow-[0_26px_90px_rgba(37,14,49,0.1)] backdrop-blur-2xl dark:bg-white/[0.04]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge variant="outline" className="rounded-full border-white/25 bg-white/30 px-3 py-1">
              Landing flow
            </Badge>
            <h2 className="mt-4 font-display text-3xl font-semibold text-foreground sm:text-4xl">How the workspace flows</h2>
            <p className="mt-3 max-w-2xl text-base leading-7 text-foreground/70">
              The landing walkthrough shows what the product feels like after login. This block keeps the actual journey readable in three steps.
            </p>
          </div>
          <p className="max-w-sm text-sm leading-6 text-foreground/60">
            Connect once, build your local memory layer, then search and resume with visible context instead of hidden automation.
          </p>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          {FLOW_STEPS.map((step, index) => {
            const Icon = step.icon;
            const translateY = reducedMotion ? 0 : (1 - progress) * (index + 1) * 18;
            return (
              <div key={step.title} className="contents">
                <div
                  className="rounded-[28px] border border-white/15 bg-white/55 p-6 dark:bg-white/[0.05]"
                  style={{ transform: `translateY(${translateY}px)` }}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="mt-5 text-xs font-medium uppercase tracking-[0.3em] text-foreground/50">Step {index + 1}</p>
                  <h3 className="mt-2 font-display text-2xl font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-4 text-sm leading-7 text-foreground/72">{step.body}</p>
                </div>
                {index < FLOW_STEPS.length - 1 ? (
                  <div className="hidden items-center justify-center lg:flex">
                    <ArrowRight className="h-6 w-6 text-foreground/35" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
