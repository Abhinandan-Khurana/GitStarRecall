import { Search, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface SearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  isSearching: boolean;
  onFetchStars: () => void;
  isFetching: boolean;
  fetchPhase: string | null;
  searchProgress: string | null;
}

export function SearchBar({
  query,
  onQueryChange,
  onSearch,
  isSearching,
  onFetchStars,
  isFetching,
  fetchPhase,
  searchProgress,
}: SearchBarProps) {
  return (
    <div className="space-y-3">
      {/* Search input row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Label htmlFor="search-stars" className="sr-only">
          Search your stars
        </Label>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="search-stars"
            className="h-10 rounded-lg border-border/50 bg-secondary/50 pl-9 text-sm transition-colors focus:border-primary/30 focus:bg-secondary/80"
            placeholder="Describe what you're looking for... e.g. vector database in browser"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={onSearch}
            disabled={isSearching}
            className="h-10 gap-1.5 rounded-lg px-5 transition-transform active:scale-[0.98]"
          >
            {isSearching ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Search className="h-3.5 w-3.5" />
                Search
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onFetchStars}
            disabled={isFetching}
            className="h-10 gap-1.5 rounded-lg border-border/50 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? (fetchPhase ?? "Syncing...") : "Sync Stars"}
          </Button>
        </div>
      </div>

      {searchProgress && (
        <p className="text-xs text-muted-foreground animate-fade-in">{searchProgress}</p>
      )}
    </div>
  );
}
