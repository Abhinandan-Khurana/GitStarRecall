import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Brain, Github, KeyRound, Lock, MessageSquare, Search, Shield, Workflow } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const WORKFLOW_STEPS = [
  {
    title: "Connect GitHub",
    body: "Use OAuth or a personal token to link your starred repos.",
    icon: Github,
  },
  {
    title: "Build the index",
    body: "Import stars, fetch READMEs, and generate embeddings locally.",
    icon: Workflow,
  },
  {
    title: "Recall by memory",
    body: "Search by what you remember, inspect the match, then send explicit context to chat.",
    icon: Search,
  },
] as const;

const VALUE_POINTS = [
  {
    title: "Local-first trust",
    body: "Your repo index, embeddings, and session history stay on-device unless you explicitly opt into a remote provider.",
    icon: Shield,
  },
  {
    title: "Context you can see",
    body: "The rebuild exposes selected context before chat sends anything to a model.",
    icon: MessageSquare,
  },
  {
    title: "Built for recall",
    body: "The app is organized around finding and understanding saved repos, not around setup panels.",
    icon: Brain,
  },
] as const;

export default function LandingPage() {
  const navigate = useNavigate();
  const { beginOAuthLogin, loginWithPat, isAuthenticated } = useAuth();
  const [authError, setAuthError] = useState<string | null>(null);
  const [patToken, setPatToken] = useState("");

  const handleOAuthLogin = useCallback(async () => {
    try {
      await beginOAuthLogin();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Unable to start GitHub OAuth");
    }
  }, [beginOAuthLogin]);

  const handlePatSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      try {
        loginWithPat(patToken);
        navigate("/app");
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : "PAT login failed");
      }
    },
    [loginWithPat, navigate, patToken],
  );

  const primaryAction = useMemo(
    () =>
      isAuthenticated
        ? {
            label: "Open app",
            onClick: () => navigate("/app"),
          }
        : {
            label: "Connect GitHub",
            onClick: () => void handleOAuthLogin(),
          },
    [handleOAuthLogin, isAuthenticated, navigate],
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <header className="flex items-center justify-between border-b border-border/60 pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Github className="h-5 w-5" />
          </div>
          <div>
            <p className="font-display text-lg font-semibold">GitStarRecall</p>
            <p className="text-sm text-muted-foreground">Local memory for GitHub stars</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="rounded-md" asChild>
            <a href="https://github.com/Abhinandan-Khurana/GitStarRecall" target="_blank" rel="noreferrer">
              View source
            </a>
          </Button>
          <Button onClick={primaryAction.onClick} className="rounded-md">
            {primaryAction.label}
          </Button>
        </div>
      </header>

      <main className="grid flex-1 gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(520px,0.95fr)]">
        <section className="flex flex-col justify-center">
          <Badge variant="outline" className="w-fit rounded-md px-3 py-1">
            <Lock className="mr-2 h-3.5 w-3.5" />
            Privacy-first developer workflow
          </Badge>
          <h1 className="mt-6 max-w-2xl font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Find starred repos by intent, inspect the match, and keep context visible.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
            GitStarRecall turns your GitHub stars into a local workspace for rediscovery. Search by memory, review the match, and continue the thread with explicit chat context.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" onClick={primaryAction.onClick} className="rounded-md px-6">
              {primaryAction.label}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" className="rounded-md px-6" asChild>
              <a href="#workflow">See the workflow</a>
            </Button>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {VALUE_POINTS.map((item) => {
              const Icon = item.icon;
              return (
                <Card key={item.title} className="border-border/60 bg-[var(--app-panel)] shadow-none">
                  <CardHeader className="pb-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <CardTitle className="pt-3 font-display text-base">{item.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-6 text-muted-foreground">{item.body}</CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
            <CardHeader className="border-b border-border/60 pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="font-display text-lg">Connect your stars</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">OAuth is the primary path. PAT remains available when you need a manual fallback.</p>
                </div>
                <Badge variant="secondary" className="rounded-md">Auth</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-5">
              <Button onClick={primaryAction.onClick} className="w-full rounded-md" size="lg">
                <Github className="mr-2 h-4 w-4" />
                {primaryAction.label}
              </Button>
              <div className="rounded-md border border-border/60 bg-background/70 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <KeyRound className="h-4 w-4 text-primary" />
                  Personal Access Token
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Use a PAT if you do not want to go through OAuth right now. The token stays in memory for the current session.
                </p>
                <form onSubmit={handlePatSubmit} className="mt-4 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="landing-pat-token" className="text-xs font-medium text-muted-foreground">
                      Personal Access Token
                    </Label>
                    <Input
                      id="landing-pat-token"
                      type="password"
                      value={patToken}
                      onChange={(event) => setPatToken(event.target.value)}
                      placeholder="ghp_..."
                      className="h-11 rounded-md border-border/70 bg-background"
                    />
                  </div>
                  <Button type="submit" variant="outline" className="w-full rounded-md">
                    Continue with PAT
                  </Button>
                </form>
              </div>
              {authError ? (
                <Alert variant="destructive">
                  <AlertDescription>{authError}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card className="w-full border-border/60 bg-[var(--app-panel)] shadow-none">
            <CardHeader className="border-b border-border/60 pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="font-display text-lg">What you get after login</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">A focused local workspace instead of a single overloaded page.</p>
                </div>
                <Badge variant="secondary" className="rounded-md">Product flow</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-border/60 bg-background/70 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Home</p>
                  <p className="mt-2 text-sm text-muted-foreground">See workspace health, choose setup, jump into Recall, or resume prior work.</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/70 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Recall</p>
                  <p className="mt-2 text-sm text-muted-foreground">Search by memory, inspect the match, and keep chat context explicit before sending.</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/70 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Library</p>
                  <p className="mt-2 text-sm text-muted-foreground">Browse indexed repos by metadata, topics, and README content without a query.</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/70 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Sessions</p>
                  <p className="mt-2 text-sm text-muted-foreground">Reopen prior searches and message threads instead of rebuilding context from scratch.</p>
                </div>
              </div>

              <div className="rounded-md border border-border/60 bg-background/70 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Why this is easier to use</p>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <li>Search, setup, browsing, history, and settings are separated into stable views.</li>
                  <li>Operational controls no longer crowd the main search workflow.</li>
                  <li>Local-first behavior and provider consent remain visible instead of being hidden behind tiny controls.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      <section id="workflow" className="border-t border-border/60 pt-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-display text-2xl font-semibold">How the workspace flows</p>
            <p className="mt-2 text-sm text-muted-foreground">The rebuilt UX keeps setup guided, recall search-first, and sessions easy to resume.</p>
          </div>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {WORKFLOW_STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <Card key={step.title} className="border-border/60 bg-[var(--app-panel)] shadow-none">
                <CardHeader className="pb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <CardTitle className="pt-3 font-display text-base">{step.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-6 text-muted-foreground">{step.body}</CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
