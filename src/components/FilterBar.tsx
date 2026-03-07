import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface FilterBarProps {
  sessionMode: "new" | "continue";
  onSessionModeChange: (mode: "new" | "continue") => void;
  activeSessionId: string | null;
  languageFilter: string;
  onLanguageChange: (value: string) => void;
  topicFilter: string;
  onTopicChange: (value: string) => void;
  updatedWithinDaysFilter: string;
  onUpdatedWithinDaysChange: (value: string) => void;
  availableLanguages: string[];
  availableTopics: string[];
  filteredCount: number;
  totalCount: number;
  onResetFilters: () => void;
}

export function FilterBar({
  sessionMode,
  onSessionModeChange,
  activeSessionId,
  languageFilter,
  onLanguageChange,
  topicFilter,
  onTopicChange,
  updatedWithinDaysFilter,
  onUpdatedWithinDaysChange,
  availableLanguages,
  availableTopics,
  filteredCount,
  totalCount,
  onResetFilters,
}: FilterBarProps) {
  const activeFilters = [
    languageFilter !== "all" ? `Language: ${languageFilter}` : null,
    topicFilter !== "all" ? `Topic: ${topicFilter}` : null,
    updatedWithinDaysFilter !== "all" ? `Updated: ${updatedWithinDaysFilter}d` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <RadioGroup
            value={sessionMode}
            onValueChange={(value: string) => onSessionModeChange(value as "new" | "continue")}
            className="flex items-center gap-3"
          >
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="new" id="session-new" className="h-3.5 w-3.5" />
              <Label htmlFor="session-new" className="cursor-pointer text-xs font-normal text-muted-foreground">
                New session
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="continue" id="session-continue" disabled={!activeSessionId} className="h-3.5 w-3.5" />
              <Label htmlFor="session-continue" className="cursor-pointer text-xs font-normal text-muted-foreground">
                Continue
              </Label>
            </div>
          </RadioGroup>
        </div>
        <Badge variant="secondary" className="text-[11px] font-normal">
          {filteredCount} of {totalCount} results
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={languageFilter} onValueChange={onLanguageChange}>
          <SelectTrigger
            aria-label="Filter by language"
            className="h-8 w-auto min-w-[120px] rounded-lg border-border/50 bg-secondary/30 text-xs"
          >
            <SelectValue placeholder="All languages" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All languages</SelectItem>
            {availableLanguages.map((lang) => (
              <SelectItem key={lang} value={lang}>{lang}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={topicFilter} onValueChange={onTopicChange}>
          <SelectTrigger
            aria-label="Filter by topic"
            className="h-8 w-auto min-w-[120px] rounded-lg border-border/50 bg-secondary/30 text-xs"
          >
            <SelectValue placeholder="All topics" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All topics</SelectItem>
            {availableTopics.map((topic) => (
              <SelectItem key={topic} value={topic}>{topic}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={updatedWithinDaysFilter} onValueChange={onUpdatedWithinDaysChange}>
          <SelectTrigger
            aria-label="Filter by last updated"
            className="h-8 w-auto min-w-[100px] rounded-lg border-border/50 bg-secondary/30 text-xs"
          >
            <SelectValue placeholder="Any date" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any date</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>

        <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-xs" onClick={onResetFilters}>
          Reset filters
        </Button>
      </div>

      {activeFilters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map((filter) => (
            <Badge key={filter} variant="outline" className="rounded-md text-[11px] font-normal">
              {filter}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
