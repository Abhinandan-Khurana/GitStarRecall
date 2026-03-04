import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface SearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  isSearching: boolean;
  searchProgress: string | null;
}

export function SearchBar({
  query,
  onQueryChange,
  onSearch,
  isSearching,
  searchProgress,
}: SearchBarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Label htmlFor="search-stars" className="sr-only">
            Search your stars
          </Label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="search-stars"
            className="min-w-0 pl-9"
            placeholder="e.g. vector database in browser"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
          />
        </div>
        <Button
          onClick={onSearch}
          disabled={isSearching}
          className="sm:shrink-0 glow-mint-sm"
        >
          {isSearching ? "Searching..." : "Search"}
        </Button>
      </div>
      {searchProgress ? (
        <p className="animate-fade-in text-xs text-muted-foreground">{searchProgress}</p>
      ) : null}
    </div>
  );
}
