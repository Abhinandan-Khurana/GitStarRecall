import type { SearchResult } from "../db/types";
import { ResultCard } from "./ResultCard";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Filter, RotateCw } from "lucide-react";

interface ResultsPanelProps {
  title: string;
  results: SearchResult[];
  filteredResults: SearchResult[];
  totalResults: number;
  sessionMode: "new" | "continue";
  onSessionModeChange: (mode: "new" | "continue") => void;
  activeSessionId: string | null;
  languageFilter: string;
  topicFilter: string;
  updatedWithinDaysFilter: string;
  onLanguageFilterChange: (value: string) => void;
  onTopicFilterChange: (value: string) => void;
  onUpdatedWithinDaysFilterChange: (value: string) => void;
  availableLanguages: string[];
  availableTopics: string[];
  onRehydrateSession: () => void;
}

export function ResultsPanel({
  title,
  results,
  filteredResults,
  totalResults,
  sessionMode,
  onSessionModeChange,
  activeSessionId,
  languageFilter,
  topicFilter,
  updatedWithinDaysFilter,
  onLanguageFilterChange,
  onTopicFilterChange,
  onUpdatedWithinDaysFilterChange,
  availableLanguages,
  availableTopics,
  onRehydrateSession,
}: ResultsPanelProps) {
  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/40 p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">
            This session has no results in memory. Run the same search again to repopulate.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRehydrateSession}
            className="gap-1.5"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Re-run search
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/50 bg-card/40 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <Badge variant="secondary" className="tabular-nums">
            {filteredResults.length} / {totalResults}
          </Badge>
        </div>
        <RadioGroup
          value={sessionMode}
          onValueChange={(v: string) => onSessionModeChange(v as "new" | "continue")}
          className="flex items-center gap-3 text-xs"
        >
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="new" id="session-new" />
            <Label htmlFor="session-new" className="cursor-pointer text-xs font-normal">New</Label>
          </div>
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="continue" id="session-continue" disabled={!activeSessionId} />
            <Label htmlFor="session-continue" className="cursor-pointer text-xs font-normal">Continue</Label>
          </div>
        </RadioGroup>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <Select value={languageFilter} onValueChange={onLanguageFilterChange}>
          <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs" aria-label="Filter by language">
            <SelectValue placeholder="All languages" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All languages</SelectItem>
            {availableLanguages.map((lang) => (
              <SelectItem key={lang} value={lang}>{lang}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={topicFilter} onValueChange={onTopicFilterChange}>
          <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs" aria-label="Filter by topic">
            <SelectValue placeholder="All topics" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All topics</SelectItem>
            {availableTopics.map((topic) => (
              <SelectItem key={topic} value={topic}>{topic}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={updatedWithinDaysFilter} onValueChange={onUpdatedWithinDaysFilterChange}>
          <SelectTrigger className="h-8 w-auto min-w-[100px] text-xs" aria-label="Filter by last updated">
            <SelectValue placeholder="Any date" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any date</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* Results list */}
      <ScrollArea className="max-h-[min(60vh,28rem)]">
        <div className="flex flex-col gap-2 pr-2">
          {filteredResults.map((result, i) => (
            <div
              key={result.chunkId}
              className="animate-fade-in-up"
              style={{ animationDelay: `${Math.min(i * 30, 300)}ms`, opacity: 0 }}
            >
              <ResultCard result={result} />
            </div>
          ))}
          {filteredResults.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No results match current filters.
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
