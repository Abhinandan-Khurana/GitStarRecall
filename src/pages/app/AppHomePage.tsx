import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, History, Search, Settings, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocalDatabase } from "@/db/client";
import { useAuth } from "@/auth/useAuth";

type WorkspaceSummary = {
  repoCount: number;
  embeddingCount: number;
  sessionCount: number;
  latestSessionId: string | null;
  latestSessionLabel: string | null;
  lastSessionUpdatedAt: number | null;
};

export default function AppHomePage() {
  const navigate = useNavigate();
  const { accessToken } = useAuth();
  const [summary, setSummary] = useState<WorkspaceSummary>({
    repoCount: 0,
    embeddingCount: 0,
    sessionCount: 0,
    latestSessionId: null,
    latestSessionLabel: null,
    lastSessionUpdatedAt: null,
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const database = await getLocalDatabase();
      if (cancelled) {
        return;
      }
      const sessions = database.listChatSessions();
      const latestSession = sessions[0] ?? null;

      setSummary({
        repoCount: database.getRepoCount(),
        embeddingCount: database.getEmbeddingCount(),
        sessionCount: sessions.length,
        latestSessionId: latestSession?.id ?? null,
        latestSessionLabel: latestSession?.query || null,
        lastSessionUpdatedAt: latestSession?.updatedAt ?? null,
      });
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const state = useMemo(() => {
    if (summary.repoCount === 0) {
      return {
        label: "Setup required",
        cta: "Start setup",
        path: "/app/setup",
      };
    }

    if (summary.embeddingCount === 0) {
      return {
        label: "Index incomplete",
        cta: "Finish setup",
        path: "/app/setup",
      };
    }

    return {
      label: "Workspace ready",
      cta: "Open Recall",
      path: "/app/recall",
    };
  }, [summary.embeddingCount, summary.repoCount]);

  return (
    <div className="space-y-5">
      <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="font-display text-2xl">Workspace</CardTitle>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Use this page as the launch surface for setup, recall, browsing, history, and settings.
              </p>
            </div>
            <Badge variant="secondary" className="rounded-md px-3 py-1">
              {state.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border/60 bg-background/70 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Repos</p>
              <p className="mt-2 font-display text-2xl font-semibold text-foreground">{summary.repoCount}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/70 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Embeddings</p>
              <p className="mt-2 font-display text-2xl font-semibold text-foreground">{summary.embeddingCount}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/70 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Sessions</p>
              <p className="mt-2 font-display text-2xl font-semibold text-foreground">{summary.sessionCount}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button className="rounded-md" onClick={() => navigate(state.path)}>
              {state.cta}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            {summary.latestSessionId ? (
              <Button variant="outline" className="rounded-md" onClick={() => navigate(`/app/recall?session=${encodeURIComponent(summary.latestSessionId!)}`)}>
                Resume latest session
              </Button>
            ) : null}
            <Button variant="outline" className="rounded-md" onClick={() => navigate("/app/library")}>
              Open Library
            </Button>
            <Button variant="outline" className="rounded-md" onClick={() => navigate("/app/sessions")}>
              Open Sessions
            </Button>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-border/60 bg-background/70 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Workspace health</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {summary.repoCount === 0
                  ? "GitHub stars have not been imported yet."
                  : summary.embeddingCount === 0
                    ? "Stars are present, but embeddings still need to finish."
                    : "Search and chat context are ready for use."}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/70 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Continue where you left off</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {summary.latestSessionId && summary.lastSessionUpdatedAt
                  ? `${summary.latestSessionLabel ?? "Untitled session"} updated ${new Date(summary.lastSessionUpdatedAt).toLocaleString()}`
                  : "No prior Recall thread yet. Start from Setup or Recall."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {[
          {
            title: "Setup",
            body: "Connect GitHub, sync stars, and build the local index.",
            icon: Workflow,
            path: "/app/setup",
          },
          {
            title: "Recall",
            body: "Search by memory, review matches, and continue with explicit context.",
            icon: Search,
            path: "/app/recall",
          },
          {
            title: "Library",
            body: "Browse your indexed stars as a local catalog.",
            icon: BookOpen,
            path: "/app/library",
          },
          {
            title: "Sessions",
            body: "Resume prior recall and chat threads.",
            icon: History,
            path: "/app/sessions",
          },
          {
            title: "Settings",
            body: "Manage providers, sync controls, privacy, and local data.",
            icon: Settings,
            path: "/app/settings",
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.title} className="flex h-full flex-col border-border/60 bg-[var(--app-panel)] shadow-none">
              <CardHeader className="pb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <CardTitle className="pt-3 font-display text-base">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
                <Button variant="outline" className="w-full rounded-md" onClick={() => navigate(item.path)}>
                  Open {item.title}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
