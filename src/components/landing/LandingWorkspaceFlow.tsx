import { ArrowRight, DatabaseZap, Github, Search } from "lucide-react";
import { useRevealOnScroll } from "@/hooks/useRevealOnScroll";

const FLOW_STEPS = [
  {
    title: "Connect GitHub",
    body: "Read-only access to your starred public repositories via OAuth or PAT.",
    icon: Github,
  },
  {
    title: "Build the local index",
    body: "Fetch READMEs and generate embeddings so stars become searchable by intent.",
    icon: DatabaseZap,
  },
  {
    title: "Recall by memory",
    body: "Search by the fragment you remember, inspect the match, and carry context into chat.",
    icon: Search,
  },
] as const;

export function LandingWorkspaceFlow() {
  const { ref: revealRef, revealed } = useRevealOnScroll<HTMLDivElement>();

  return (
    <section className="px-4 py-10 sm:px-6 lg:px-8">
      <div ref={revealRef} className="mx-auto max-w-[1500px]">
        <h2 className={`text-center font-display text-3xl font-bold text-foreground sm:text-4xl reveal ${revealed ? "revealed" : ""}`}>
          How it works
        </h2>
        <p className={`mx-auto mt-3 max-w-2xl text-center text-base leading-7 text-muted-foreground reveal reveal-delay-1 ${revealed ? "revealed" : ""}`}>
          Three steps from connection to recall, all running locally in your browser.
        </p>

        <div className={`mt-10 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch reveal reveal-delay-1 ${revealed ? "revealed" : ""}`}>
          {FLOW_STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.title} className="contents">
                <div
                  style={{ transitionDelay: revealed ? `${150 + index * 100}ms` : undefined }}
                >
                  <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition duration-300 hover:-translate-y-1 hover:shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">Step {index + 1}</p>
                        <h3 className="mt-1 font-display text-xl font-bold text-foreground">{step.title}</h3>
                      </div>
                    </div>
                    <p className="mt-4 text-sm leading-7 text-muted-foreground">{step.body}</p>
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
