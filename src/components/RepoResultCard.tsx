import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import SafeMarkdown from "./SafeMarkdown";

interface RepoResultCardProps {
  chunkId: string;
  repoFullName: string;
  repoUrl: string;
  repoDescription: string | null;
  language: string | null;
  topics: string[];
  score: number;
  text: string;
}

export function RepoResultCard({
  repoFullName,
  repoUrl,
  repoDescription,
  language,
  topics,
  score,
  text,
}: RepoResultCardProps) {
  const safeScore = Number.isFinite(score) ? score : 0;
  const scoreBand = safeScore >= 0.6 ? "High" : safeScore >= 0.35 ? "Medium" : "Low";
  const scoreText = safeScore.toFixed(3);

  return (
    <div className="group rounded-lg border border-border/40 bg-card/40 p-3 transition-all duration-200 hover:border-border/70 hover:bg-card/70">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-sm font-semibold text-primary transition-colors hover:text-primary/80"
          >
            {repoFullName}
            <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge
            variant="secondary"
            className={`text-[10px] font-medium ${
              safeScore >= 0.6
                ? "bg-primary/15 text-primary"
                : safeScore >= 0.35
                  ? "bg-accent/15 text-accent"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {scoreBand} · {scoreText}
          </Badge>
        </div>
      </div>

      {repoDescription && (
        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{repoDescription}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {language && (
          <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px] font-normal">
            {language}
          </Badge>
        )}
        {topics.slice(0, 3).map((topic) => (
          <Badge key={topic} variant="outline" className="h-5 rounded-md px-1.5 text-[10px] font-normal text-muted-foreground">
            {topic}
          </Badge>
        ))}
        {topics.length > 3 && (
          <span className="text-[10px] text-muted-foreground">+{topics.length - 3}</span>
        )}
      </div>

      <div className="mt-2 rounded-md bg-background/50 p-2">
        <SafeMarkdown
          className="line-clamp-2 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground"
          content={text}
        />
      </div>
    </div>
  );
}
