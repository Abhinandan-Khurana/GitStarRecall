import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCw,
  MessageSquare,
  Settings2,
  Shield,
  Lock,
  ArrowRight,
  Github,
  Star,
  Search,
  Cpu,
} from "lucide-react";

const HERO_STAGGER_MS = 90;

export default function LandingPage() {
  const { beginOAuthLogin } = useAuth();
  const [authError, setAuthError] = useState<string | null>(null);

  const handleOAuthLogin = async () => {
    try {
      await beginOAuthLogin();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Unable to start GitHub OAuth");
    }
  };

  return (
    <article className="flex flex-col gap-20">
      {/* Hero */}
      <section className="flex flex-col items-center gap-6 pt-4 text-center">
        <Badge
          variant="secondary"
          className="animate-fade-in-up gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
          style={{ animationDelay: "0ms", opacity: 0 }}
        >
          <Cpu className="h-3 w-3 text-primary" />
          Powered by local RAG
        </Badge>

        <h1
          className="font-display animate-fade-in-up max-w-2xl text-balance text-4xl font-bold leading-tight md:text-5xl"
          style={{ animationDelay: `${HERO_STAGGER_MS}ms`, opacity: 0 }}
        >
          Find starred repos by{" "}
          <span className="text-gradient-primary">memory</span>, not by name
        </h1>

        <p
          className="animate-fade-in-up max-w-lg text-pretty text-lg leading-relaxed text-muted-foreground"
          style={{ animationDelay: `${HERO_STAGGER_MS * 2}ms`, opacity: 0 }}
        >
          Ask for tailored recommendations from your own GitHub stars based on your exact use case.
          Your data stays local, and external LLMs are opt-in only.
        </p>

        <div
          className="animate-fade-in-up flex flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: `${HERO_STAGGER_MS * 3}ms`, opacity: 0 }}
        >
          <Button
            size="lg"
            onClick={() => void handleOAuthLogin()}
            className="rounded-full px-6 glow-mint transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          >
            <Github className="mr-2 h-4 w-4" />
            Connect GitHub
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full border-border px-6 text-muted-foreground transition-all duration-200 hover:border-primary/30 hover:text-foreground"
            asChild
          >
            <a href="https://github.com/Abhinandan-Khurana/GitStarRecall" target="_blank" rel="noopener noreferrer">
              View on GitHub
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </div>

        {authError ? (
          <Alert variant="destructive" className="max-w-md">
            <AlertDescription>{authError}</AlertDescription>
          </Alert>
        ) : null}
      </section>

      {/* How it works */}
      <section className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-sm uppercase tracking-[0.3em] text-muted-foreground">
            How it works
          </h2>
          <Separator className="flex-1" />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: RefreshCw,
              title: "Sync and checksum",
              body: "Incremental sync keeps 1k+ stars fresh without full re-indexing.",
              accent: "text-primary",
              bg: "bg-primary/5 group-hover:bg-primary/10",
            },
            {
              icon: MessageSquare,
              title: "Sessioned recall",
              body: "Each query becomes a session, so you can refine and revisit ideas.",
              accent: "text-accent",
              bg: "bg-accent/5 group-hover:bg-accent/10",
            },
            {
              icon: Settings2,
              title: "Provider optionality",
              body: "Ollama, LM Studio, or remote LLMs only when you enable them.",
              accent: "text-muted-foreground",
              bg: "bg-muted/50 group-hover:bg-muted/80",
            },
          ].map((card) => (
            <Card
              key={card.title}
              className="group border-border/50 bg-card/40 transition-all duration-200 hover:border-border hover:bg-card/70"
            >
              <CardContent className="flex flex-col gap-3 p-5">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${card.bg}`}
                >
                  <card.icon className={`h-4 w-4 ${card.accent}`} />
                </span>
                <p className="font-semibold text-foreground">{card.title}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{card.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Privacy & Security */}
      <section className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-sm uppercase tracking-[0.3em] text-muted-foreground">
            Privacy & Security
          </h2>
          <Separator className="flex-1" />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="group border-border/50 bg-card/40 transition-all duration-200 hover:border-primary/30 hover:bg-card/70">
            <CardContent className="flex items-start gap-4 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/5 transition-colors group-hover:bg-primary/10">
                <Shield className="h-5 w-5 text-primary" />
              </span>
              <div>
                <p className="font-semibold text-foreground">Privacy-first storage</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  SQLite WASM + sqlite-vec keeps everything on-device. No data leaves your browser.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="group border-border/50 bg-card/40 transition-all duration-200 hover:border-accent/30 hover:bg-card/70">
            <CardContent className="flex items-start gap-4 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/5 transition-colors group-hover:bg-accent/10">
                <Lock className="h-5 w-5 text-accent" />
              </span>
              <div>
                <p className="font-semibold text-foreground">Security-aligned</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  OAuth PKCE, token isolation, and explicit LLM consent. Zero-trust by design.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Stats / Highlights */}
      <section className="flex flex-col gap-6">
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: Star, value: "1000+", label: "Stars synced" },
            { icon: Search, value: "RAG", label: "Semantic search" },
            { icon: Cpu, value: "Local", label: "On-device AI" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center gap-2 rounded-xl border border-border/30 bg-card/20 py-6 text-center"
            >
              <stat.icon className="h-5 w-5 text-muted-foreground" />
              <p className="font-display text-2xl font-bold text-foreground">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="flex flex-col items-center gap-4 rounded-xl border border-border/30 bg-card/20 px-6 py-10 text-center">
        <h2 className="font-display text-xl font-semibold text-foreground">
          Ready to recall your stars?
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Connect your GitHub account to start searching your starred repositories with natural language.
        </p>
        <Button
          size="lg"
          onClick={() => void handleOAuthLogin()}
          className="mt-2 rounded-full px-8 glow-mint transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
        >
          <Github className="mr-2 h-4 w-4" />
          Get Started
        </Button>
      </section>
    </article>
  );
}
