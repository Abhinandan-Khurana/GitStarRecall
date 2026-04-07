import { ArrowRight, DatabaseZap, Github, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useParallaxProgress } from "@/components/landing/useParallaxProgress";

const FLOW_STEPS = [
  {
    title: "Connect GitHub",
    body: "Read your starred public repositories with explicit read-only permissions, whether you use OAuth or a PAT.",
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
    <section id="workflow" className="px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] rounded-[36px] border border-white/15 bg-white/40 p-6 shadow-[0_26px_90px_rgba(37,14,49,0.1)] backdrop-blur-2xl dark:bg-white/[0.04] sm:p-8 lg:p-10">
        <div className="grid gap-6 border-b border-white/12 pb-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:items-start">
          <div>
            <Badge variant="outline" className="rounded-full border-white/25 bg-white/30 px-3 py-1">
              Landing flow
            </Badge>
            <h2 className="mt-4 font-display text-3xl font-semibold text-foreground sm:text-4xl">How the workspace flows</h2>
            <p className="mt-4 max-w-3xl text-base leading-8 text-foreground/70">
              Connect once, build the local memory layer, then move into recall with visible context instead of reassembling the same repo trail from scratch.
            </p>
          </div>

          <div className="rounded-[24px] border border-white/12 bg-white/28 p-5 dark:bg-white/[0.03]">
            <p className="text-xs font-medium uppercase tracking-[0.28em] text-foreground/50">In three steps</p>
            <p className="mt-3 text-sm leading-7 text-foreground/68">
              GitHub connection, local indexing, and recall stay separated into a simple progression so the product feels predictable from the first screen.
            </p>
          </div>
        </div>

        <div className="relative mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
          {FLOW_STEPS.map((step, index) => {
            const Icon = step.icon;
            const translateY = reducedMotion ? 0 : (1 - progress) * (index + 1) * 12;

            return (
              <div key={step.title} className="contents">
                <div style={reducedMotion ? undefined : { transform: `translateY(${translateY}px)` }}>
                  <div className="flex h-full flex-col rounded-[28px] border border-white/15 bg-white/52 p-6 transition duration-500 hover:-translate-y-1 hover:bg-white/68 dark:bg-white/[0.05] dark:hover:bg-white/[0.07]">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.3em] text-foreground/50">Step {index + 1}</p>
                        <h3 className="mt-2 font-display text-2xl font-semibold text-foreground">{step.title}</h3>
                      </div>
                    </div>
                    <p className="mt-6 text-base leading-8 text-foreground/74">{step.body}</p>
                  </div>
                </div>
                {index < FLOW_STEPS.length - 1 ? (
                  <div className="hidden items-center justify-center lg:flex">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/12 bg-white/18 dark:bg-white/[0.04]">
                      <ArrowRight className="h-5 w-5 text-foreground/40" />
                    </div>
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
