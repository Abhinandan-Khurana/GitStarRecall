import { ArrowRight, DatabaseZap, Github, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useParallaxProgress } from "@/components/landing/useParallaxProgress";
import { useRevealOnScroll } from "@/hooks/useRevealOnScroll";

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
  const { ref: revealRef, revealed } = useRevealOnScroll<HTMLDivElement>();

  return (
    <section id="workflow" className="px-4 py-10 sm:px-6 lg:px-8">
      <div ref={revealRef} className="mx-auto max-w-[1500px] rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8 lg:p-10">
        <div className={`grid gap-6 border-b border-border pb-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:items-start reveal ${revealed ? "revealed" : ""}`}>
          <div>
            <Badge variant="secondary" className="rounded-full">
              Landing flow
            </Badge>
            <h2 className="mt-4 font-display text-3xl font-bold text-foreground sm:text-4xl">How the workspace flows</h2>
            <p className="mt-4 max-w-3xl text-base leading-8 text-muted-foreground">
              Connect once, build the local memory layer, then move into recall with visible context instead of reassembling the same repo trail from scratch.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-muted/40 p-5">
            <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">In three steps</p>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              GitHub connection, local indexing, and recall stay separated into a simple progression so the product feels predictable from the first screen.
            </p>
          </div>
        </div>

        <div className="relative mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
          {FLOW_STEPS.map((step, index) => {
            const Icon = step.icon;
            const translateY = reducedMotion ? 0 : (1 - progress) * (index + 1) * 8;

            return (
              <div key={step.title} className="contents">
                <div
                  className={`reveal ${revealed ? "revealed" : ""}`}
                  style={{
                    ...(reducedMotion ? {} : { transform: `translateY(${translateY}px)` }),
                    transitionDelay: revealed ? `${150 + index * 100}ms` : undefined,
                  }}
                >
                  <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-muted/30 p-6 transition duration-300 hover:-translate-y-1 hover:shadow-sm">
                    <span className="pointer-events-none absolute -right-2 -top-4 font-display text-[5rem] font-bold leading-none text-foreground/[0.04]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="relative flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">Step {index + 1}</p>
                        <h3 className="mt-1 font-display text-xl font-bold text-foreground">{step.title}</h3>
                      </div>
                    </div>
                    <p className="relative mt-5 text-sm leading-7 text-muted-foreground">{step.body}</p>
                  </div>
                </div>
                {index < FLOW_STEPS.length - 1 ? (
                  <div className="hidden items-center justify-center lg:flex">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted">
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
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
