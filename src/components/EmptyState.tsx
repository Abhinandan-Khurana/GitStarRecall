import { Search, MessageSquare } from "lucide-react";

interface EmptyStateProps {
  type: "no-results" | "no-session" | "no-chats";
  message?: string;
}

export function EmptyState({ type, message }: EmptyStateProps) {
  const configs = {
    "no-results": {
      icon: Search,
      title: "No results found",
      description: message ?? "Try adjusting your filters or search with different terms.",
    },
    "no-session": {
      icon: Search,
      title: "Start a search",
      description: message ?? "Run a search above to create a session, then chat here.",
    },
    "no-chats": {
      icon: MessageSquare,
      title: "No chats yet",
      description: message ?? "Run a search to start your first conversation.",
    },
  };

  const config = configs[type];
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
        <Icon className="h-5 w-5 text-muted-foreground/60" />
      </div>
      <h3 className="mb-1 text-sm font-medium text-foreground">{config.title}</h3>
      <p className="max-w-xs text-xs text-muted-foreground">{config.description}</p>
    </div>
  );
}
