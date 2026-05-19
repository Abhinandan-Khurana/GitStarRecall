import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Database, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { getLocalDatabase } from "@/db/client";
import type { RepoRecord } from "@/db/types";
import { useAuth } from "@/auth/useAuth";
import { getReadmeDisplayExcerpt, summarizeReadmeDisplayHealth } from "@/readme/displayExcerpt";

function matchesRepo(repo: RepoRecord, query: string) {
  if (!query) return true;
  const haystack = `${repo.fullName} ${repo.description ?? ""} ${repo.language ?? ""} ${repo.topics.join(" ")} ${repo.readmeText ?? ""}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export default function LibraryPage() {
  const navigate = useNavigate();
  const { accessToken } = useAuth();
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [query, setQuery] = useState("");
  const [savedView, setSavedView] = useState("all");
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const database = await getLocalDatabase();
      const nextRepos = database.listRepos().sort((a, b) => b.lastSyncedAt - a.lastSyncedAt);
      if (!cancelled) {
        setRepos(nextRepos);
        const repoParam = searchParams.get("repo");
        const selectedFromParam = repoParam ? Number(repoParam) : null;
        setSelectedRepoId(selectedFromParam && nextRepos.some((repo) => repo.id === selectedFromParam) ? selectedFromParam : nextRepos[0]?.id ?? null);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [accessToken, searchParams]);

  useEffect(() => {
    if (!import.meta.env.DEV || repos.length === 0) {
      return;
    }

    const summary = summarizeReadmeDisplayHealth(repos);
    if (summary["empty-display"] > 0 || summary.missing > 0) {
      console.debug("[library-readme-preview] display health", summary);
    }
  }, [repos]);

  const filteredRepos = useMemo(() => {
    return repos.filter((repo) => {
      if (!matchesRepo(repo, query)) {
        return false;
      }

      if (savedView === "typescript") {
        return repo.language?.toLowerCase() === "typescript";
      }
      if (savedView === "ai") {
        return repo.topics.some((topic) => topic.toLowerCase().includes("ai") || topic.toLowerCase().includes("ml"));
      }
      if (savedView === "recent") {
        return Date.now() - new Date(repo.updatedAt).getTime() < 1000 * 60 * 60 * 24 * 90;
      }

      return true;
    });
  }, [query, repos, savedView]);
  const selectedRepo = filteredRepos.find((repo) => repo.id === selectedRepoId) ?? repos.find((repo) => repo.id === selectedRepoId) ?? null;
  const selectedReadmeExcerpt = useMemo(
    () => getReadmeDisplayExcerpt(selectedRepo?.readmeText),
    [selectedRepo?.readmeText],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
        <CardHeader className="gap-3 border-b border-border/60 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="font-display text-lg">Indexed repos</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Browse your local library by metadata, language, and recency.</p>
            </div>
            <Badge variant="secondary" className="rounded-md">
              {filteredRepos.length} repos
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "all", label: "All repos" },
              { id: "recent", label: "Recently updated" },
              { id: "typescript", label: "TypeScript" },
              { id: "ai", label: "AI / ML" },
            ].map((view) => (
              <Button
                key={view.id}
                type="button"
                variant={savedView === view.id ? "secondary" : "outline"}
                className="h-8 rounded-md"
                onClick={() => setSavedView(view.id)}
              >
                {view.label}
              </Button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by repo, topic, language, description, or README text"
              className="h-11 rounded-md border-border/70 bg-background pl-10"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-16rem)]">
            <div className="divide-y divide-border/50">
              {filteredRepos.map((repo) => {
                const selected = repo.id === selectedRepoId;
                return (
                  <button
                    key={repo.id}
                    type="button"
                    className={`w-full px-5 py-4 text-left transition-colors ${
                      selected ? "bg-primary/10" : "hover:bg-background/70"
                    }`}
                    onClick={() => {
                      setSelectedRepoId(repo.id);
                      setSearchParams((params) => {
                        const next = new URLSearchParams(params);
                        next.set("repo", String(repo.id));
                        return next;
                      });
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-semibold">{repo.fullName}</p>
                        {repo.description ? (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{repo.description}</p>
                        ) : null}
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>{repo.stars} stars</p>
                        <p>{repo.forks} forks</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {repo.language ? <Badge variant="outline" className="rounded-md">{repo.language}</Badge> : null}
                      {repo.topics.slice(0, 4).map((topic) => (
                        <Badge key={topic} variant="outline" className="rounded-md">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  </button>
                );
              })}
              {filteredRepos.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                  No repos match this filter yet.
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
        <CardHeader className="border-b border-border/60">
          <CardTitle className="font-display text-lg">Repo preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          {selectedRepo ? (
            <>
              <div>
                <p className="font-mono text-base font-semibold">{selectedRepo.fullName}</p>
                {selectedRepo.description ? <p className="mt-2 text-sm text-muted-foreground">{selectedRepo.description}</p> : null}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border border-border/60 bg-background/70 p-3">
                  <p className="text-xs text-muted-foreground">Language</p>
                  <p className="mt-1 font-medium">{selectedRepo.language ?? "Unknown"}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/70 p-3">
                  <p className="text-xs text-muted-foreground">Updated</p>
                  <p className="mt-1 font-medium">{new Date(selectedRepo.updatedAt).toLocaleDateString()}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/70 p-3">
                  <p className="text-xs text-muted-foreground">Stars</p>
                  <p className="mt-1 font-medium">{selectedRepo.stars}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/70 p-3">
                  <p className="text-xs text-muted-foreground">Forks</p>
                  <p className="mt-1 font-medium">{selectedRepo.forks}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Topics</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedRepo.topics.length === 0 ? (
                    <span className="text-sm text-muted-foreground">No topics</span>
                  ) : (
                    selectedRepo.topics.map((topic) => (
                      <Badge key={topic} variant="outline" className="rounded-md">
                        {topic}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">README excerpt</p>
                <div className="mt-2 rounded-md border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                  {selectedReadmeExcerpt.kind === "ready" ? (
                    <p className="max-h-72 overflow-auto whitespace-pre-wrap break-words">
                      {selectedReadmeExcerpt.text}
                    </p>
                  ) : selectedReadmeExcerpt.kind === "empty-display" ? (
                    "README indexed, but no displayable preview text was found."
                  ) : (
                    "README content has not been indexed yet."
                  )}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full rounded-md"
                  onClick={() => navigate(`/app/recall?query=${encodeURIComponent(selectedRepo.fullName)}`)}
                >
                  Search in Recall
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button asChild className="w-full rounded-md">
                  <a href={selectedRepo.htmlUrl} target="_blank" rel="noreferrer">
                    Open on GitHub
                    <ArrowUpRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="w-full rounded-md text-muted-foreground"
                onClick={() => setQuery(selectedRepo.fullName)}
              >
                Filter library to this repo
              </Button>
            </>
          ) : (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <Database className="h-8 w-8" />
              <p className="text-sm">Index a few repos to start browsing your local library.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
