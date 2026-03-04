import type { SearchResult } from "../db/types";
import { Badge } from "@/components/ui/badge";
import SafeMarkdown from "./SafeMarkdown";
import { Star, ExternalLink } from "lucide-react";

interface ResultCardProps {
  result: SearchResult;
}

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "bg-blue-400",
  JavaScript: "bg-yellow-400",
  Python: "bg-green-400",
  Rust: "bg-orange-400",
  Go: "bg-cyan-400",
  Java: "bg-red-400",
  "C++": "bg-pink-400",
  C: "bg-slate-400",
  Ruby: "bg-red-500",
  Swift: "bg-orange-500",
  Kotlin: "bg-purple-400",
  Shell: "bg-emerald-400",
};

function getScoreColor(score: number): string {
  if (score >= 0.7) return "bg-primary/20 text-primary border-primary/30";
  if (score >= 0.4) return "bg-accent/20 text-accent border-accent/30";
  return "bg-muted text-muted-foreground border-border";
}

export function ResultCard({ result }: ResultCardProps) {
  const scorePct = Math.round(result.score * 100);
  const ownerAndName = result.repoFullName.split("/");
  const owner = ownerAndName[0] ?? "";
  const name = ownerAndName[1] ?? result.repoFullName;
  const langColor = result.language ? LANGUAGE_COLORS[result.language] ?? "bg-muted-foreground" : null;

  return (
    <div className="group rounded-lg border border-border/50 bg-card/40 p-3.5 transition-all duration-200 hover:border-border hover:bg-card/70">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <a
            href={result.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-sm font-semibold text-primary transition-colors hover:text-primary/80"
          >
            <span className="text-muted-foreground">{owner}/</span>
            {name}
            <ExternalLink className="ml-0.5 h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
          </a>
        </div>
        <Badge
          variant="outline"
          className={`shrink-0 font-mono text-xs tabular-nums ${getScoreColor(result.score)}`}
        >
          {scorePct}%
        </Badge>
      </div>

      {result.repoDescription ? (
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {result.repoDescription}
        </p>
      ) : null}

      <div className="mt-2.5 rounded-md bg-muted/30 p-2">
        <SafeMarkdown
          className="line-clamp-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground"
          content={result.text}
        />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {result.language ? (
          <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
            <span className={`inline-block h-2 w-2 rounded-full ${langColor}`} />
            {result.language}
          </Badge>
        ) : null}
        {result.topics.slice(0, 3).map((topic) => (
          <Badge key={topic} variant="outline" className="text-xs font-normal text-muted-foreground">
            {topic}
          </Badge>
        ))}
        {result.topics.length > 3 ? (
          <span className="text-xs text-muted-foreground">+{result.topics.length - 3}</span>
        ) : null}
      </div>
    </div>
  );
}
