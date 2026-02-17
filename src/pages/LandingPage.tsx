import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

const HERO_STAGGER_MS = 80;

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
    <article className="space-y-16">
      {/* Hero */}
      <section className="space-y-6">
        <p
          className="animate-fade-in-up text-xs uppercase tracking-[0.4em] text-mist/60"
          style={{ animationDelay: "0ms", opacity: 0 }}
        >
          Local-first RAG for GitHub stars
        </p>
        <h1
          className="font-display animate-fade-in-up text-4xl font-semibold leading-tight text-white md:text-5xl"
          style={{ animationDelay: `${HERO_STAGGER_MS}ms`, opacity: 0 }}
        >
          GitStarRecall helps you find starred repos by memory, not by name.
        </h1>
        <p
          className="animate-fade-in-up text-lg text-mist/80"
          style={{ animationDelay: `${HERO_STAGGER_MS * 2}ms`, opacity: 0 }}
        >
          Ask for tailored recommendations from your own stars based on your exact use case.
          Your data stays local, and external LLMs are opt-in only.
        </p>
        <div className="flex flex-wrap gap-4">
          <Button
            size="lg"
            onClick={() => void handleOAuthLogin()}
            className="animate-fade-in-up rounded-full px-6 hover:scale-[1.02]"
            style={{ animationDelay: `${HERO_STAGGER_MS * 3}ms`, opacity: 0 }}
          >
            Connect GitHub
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="animate-fade-in-up rounded-full border-white/20 text-muted-foreground hover:border-white/30 hover:text-foreground"
            style={{ animationDelay: `${HERO_STAGGER_MS * 4}ms`, opacity: 0 }}
          >
            Watch Demo
          </Button>
        </div>
        {authError ? (
          <Alert variant="destructive">
            <AlertDescription>{authError}</AlertDescription>
          </Alert>
        ) : null}
      </section>

      {/* Privacy & security */}
      <section className="grid gap-3 md:grid-cols-2">
        <Card className="transition-shadow hover:shadow-lg">
          <CardContent className="p-4">
            <p className="font-semibold text-primary">Privacy-first storage</p>
            <p className="mt-1 text-sm text-muted-foreground">SQLite WASM + sqlite-vec keeps everything on-device.</p>
          </CardContent>
        </Card>
        <Card className="transition-shadow hover:shadow-lg">
          <CardContent className="p-4">
            <p className="font-semibold text-accent">Security-aligned</p>
            <p className="mt-1 text-sm text-muted-foreground">OAuth PKCE, token isolation, and explicit LLM consent.</p>
          </CardContent>
        </Card>
      </section>

      {/* Demo placeholder */}
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm uppercase tracking-wider text-muted-foreground">Demo</p>
          <p className="mt-2 text-muted-foreground">Coming soon.</p>
        </CardContent>
      </Card>

      {/* How it works / Features */}
      <section className="space-y-6">
        <h2 className="font-display text-sm uppercase tracking-[0.3em] text-muted-foreground">
          How it works
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { title: "Sync and checksum", body: "Incremental sync keeps 1k+ stars fresh without full re-indexing." },
            { title: "Sessioned recall", body: "Each query becomes a session, so you can refine and revisit ideas." },
            { title: "Provider optionality", body: "Ollama, LM Studio, or remote LLMs only when you enable them." },
          ].map((card) => (
            <Card key={card.title} className="transition-colors hover:bg-card/80">
              <CardContent className="p-5">
                <p className="font-semibold">{card.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{card.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </article>
  );
}
