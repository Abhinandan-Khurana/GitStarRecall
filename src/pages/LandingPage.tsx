import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../auth/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Star,
  Shield,
  Database,
  Brain,
  Search,
  MessageSquare,
  Zap,
  Lock,
  Github,
  ArrowRight,
  Cpu,
  RefreshCw,
} from "lucide-react";

/**
 * Custom hook that adds the "revealed" class when the element scrolls into view.
 */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      el.classList.add("revealed");
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("revealed");
          observer.unobserve(el);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}

export default function LandingPage() {
  const { beginOAuthLogin } = useAuth();
  const [authError, setAuthError] = useState<string | null>(null);

  const trustRef = useReveal<HTMLDivElement>();
  const howRef = useReveal<HTMLDivElement>();
  const featuresRef = useReveal<HTMLDivElement>();
  const ctaRef = useReveal<HTMLDivElement>();

  const handleOAuthLogin = useCallback(async () => {
    try {
      await beginOAuthLogin();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : "Unable to start GitHub OAuth"
      );
    }
  }, [beginOAuthLogin]);

  return (
    <div className="relative">
      {/* Background orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="animate-float absolute -top-32 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute right-0 top-1/3 h-[300px] w-[400px] rounded-full bg-accent/3 blur-[100px]" style={{ animation: "float 4s ease-in-out 1s infinite" }} />
      </div>

      <article className="relative mx-auto max-w-5xl px-4 pb-20 pt-16 sm:px-6">
        {/* Hero */}
        <section className="mx-auto max-w-3xl text-center">
          <div className="stagger-children">
            <Badge variant="secondary" className="mb-6 gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
              <Star className="h-3 w-3 text-primary" />
              Local-first RAG for GitHub Stars
            </Badge>

            <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl">
              Find starred repos by{" "}
              <span className="text-gradient-animated">memory</span>,{" "}
              not by name
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Ask for tailored recommendations from your own stars based on your
              exact use case. Your data stays on-device, and external LLMs are
              opt-in only.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button
                size="lg"
                onClick={() => void handleOAuthLogin()}
                className="gap-2 rounded-full px-6 transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <Github className="h-4 w-4" />
                Connect GitHub
              </Button>
              <Button
                variant="outline"
                size="lg"
                asChild
                className="gap-2 rounded-full border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
              >
                <a href="https://github.com/Abhinandan-Khurana/GitStarRecall" target="_blank" rel="noopener noreferrer">
                  View Source
                  <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>

          {authError && (
            <Alert variant="destructive" className="mx-auto mt-6 max-w-md">
              <AlertDescription>{authError}</AlertDescription>
            </Alert>
          )}
        </section>

        {/* Trust signals bar */}
        <section ref={trustRef} className="reveal mt-16">
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-8">
            {[
              { icon: Shield, label: "Privacy-first" },
              { icon: Lock, label: "OAuth PKCE" },
              { icon: Database, label: "On-device storage" },
              { icon: Github, label: "Open source" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Icon className="h-4 w-4 text-primary/70" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </section>

        <Separator className="mx-auto my-16 max-w-xs opacity-30" />

        {/* How it works */}
        <section ref={howRef} className="reveal">
          <div className="mb-10 text-center">
            <h2 className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              How it works
            </h2>
          </div>

          <div className="relative mx-auto grid max-w-3xl gap-8 md:grid-cols-3 md:gap-6">
            {/* Connecting line (desktop) */}
            <div className="absolute left-0 right-0 top-10 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block" aria-hidden="true" />

            {[
              {
                step: 1,
                icon: RefreshCw,
                title: "Sync your stars",
                body: "Connect GitHub and incrementally sync your starred repos with checksums -- no full re-indexing needed.",
              },
              {
                step: 2,
                icon: Brain,
                title: "Build embeddings",
                body: "Generate semantic embeddings locally using ONNX models, stored in SQLite WASM with sqlite-vec.",
              },
              {
                step: 3,
                icon: Search,
                title: "Search by intent",
                body: "Describe what you need in natural language and get ranked matches from your personal star collection.",
              },
            ].map(({ step, icon: Icon, title, body }) => (
              <div key={step} className="relative flex flex-col items-center text-center">
                <div className="relative z-10 mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border/50 bg-card shadow-lg">
                  <Icon className="h-5 w-5 text-primary" />
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {step}
                  </span>
                </div>
                <h3 className="mb-2 font-display text-base font-semibold text-foreground">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <Separator className="mx-auto my-16 max-w-xs opacity-30" />

        {/* Feature grid (bento-style) */}
        <section ref={featuresRef} className="reveal">
          <div className="mb-10 text-center">
            <h2 className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Features
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Database,
                title: "SQLite WASM",
                body: "All data lives in your browser using SQLite WASM with sqlite-vec for vector similarity search.",
                accent: "primary",
              },
              {
                icon: Shield,
                title: "Security aligned",
                body: "OAuth PKCE flow, token isolation, and explicit consent before any data leaves your device.",
                accent: "accent",
              },
              {
                icon: MessageSquare,
                title: "Sessioned recall",
                body: "Each query becomes a session you can refine, revisit, and continue with full context.",
                accent: "primary",
              },
              {
                icon: Cpu,
                title: "Provider optionality",
                body: "Use Ollama, LM Studio, WebLLM, or remote providers -- only enabled when you choose.",
                accent: "accent",
              },
              {
                icon: Zap,
                title: "Incremental sync",
                body: "Checksum-based sync keeps 1000+ stars fresh without re-downloading everything.",
                accent: "primary",
              },
              {
                icon: Brain,
                title: "On-device embeddings",
                body: "ONNX Runtime generates embeddings entirely in-browser -- no API calls, no tracking.",
                accent: "accent",
              },
            ].map(({ icon: Icon, title, body, accent }) => (
              <Card
                key={title}
                className="glow-border group relative overflow-hidden border-border/50 bg-card/50 transition-all duration-300 hover:-translate-y-0.5 hover:bg-card/80 hover:shadow-lg"
              >
                <CardContent className="p-5">
                  <div
                    className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${accent === "accent" ? "bg-accent/10" : "bg-primary/10"}`}
                  >
                    <Icon
                      className={`h-4.5 w-4.5 ${accent === "accent" ? "text-accent" : "text-primary"}`}
                    />
                  </div>
                  <h3 className="mb-1.5 font-display text-sm font-semibold text-foreground">
                    {title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {body}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Separator className="mx-auto my-16 max-w-xs opacity-30" />

        {/* Bottom CTA */}
        <section ref={ctaRef} className="reveal">
          <Card className="relative overflow-hidden border-border/50 bg-card/60">
            {/* Accent glow */}
            <div className="pointer-events-none absolute -right-20 -top-20 h-40 w-40 rounded-full bg-primary/10 blur-[60px]" aria-hidden="true" />
            <CardContent className="relative flex flex-col items-center gap-4 p-8 text-center sm:p-12">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Star className="h-6 w-6 text-primary" />
              </div>
              <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
                Ready to recall your stars?
              </h2>
              <p className="max-w-md text-muted-foreground">
                Connect your GitHub account and start searching your starred
                repos with natural language -- all locally on your device.
              </p>
              <Button
                size="lg"
                onClick={() => void handleOAuthLogin()}
                className="mt-2 gap-2 rounded-full px-8 transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <Github className="h-4 w-4" />
                Get Started
              </Button>
            </CardContent>
          </Card>
        </section>
      </article>
    </div>
  );
}
