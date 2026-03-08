import { Plus, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Session {
  id: string;
  title: string;
  results: unknown[];
  updatedAt: number;
  query?: string;
}

interface SessionSidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onClearActive: () => void;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onClearActive,
}: SessionSidebarProps) {
  const formatRelativeTime = (timestamp: number) => {
    const deltaMs = Date.now() - timestamp;
    const deltaMinutes = Math.max(1, Math.round(deltaMs / (1000 * 60)));
    if (deltaMinutes < 60) {
      return `${deltaMinutes}m ago`;
    }
    const deltaHours = Math.round(deltaMinutes / 60);
    if (deltaHours < 24) {
      return `${deltaHours}h ago`;
    }
    const deltaDays = Math.round(deltaHours / 24);
    return `${deltaDays}d ago`;
  };

  return (
    <aside
      className="flex w-full shrink-0 flex-col rounded-xl border border-border/50 bg-card/50 md:w-56"
      aria-label="Chat sessions"
    >
      <div className="flex items-center justify-between border-b border-border/30 p-3">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Chats</span>
          {sessions.length > 0 && (
            <span className="ml-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {sessions.length}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={onClearActive}
        >
          <Plus className="h-3 w-3" />
          New
        </Button>
      </div>

      <ScrollArea className="flex-1 p-2">
        {sessions.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <MessageSquare className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              No chats yet. Run a search to start one.
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((session) => {
              const isActive = activeSessionId === session.id;
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                      isActive
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    }`}
                    onClick={() => onSelectSession(session.id)}
                    aria-current={isActive ? "true" : undefined}
                  >
                    {isActive && (
                      <div className="h-4 w-0.5 shrink-0 rounded-full bg-primary" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{session.title}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{session.results.length}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                        <span className="min-w-0 truncate">{session.query?.trim() || "No prompt saved"}</span>
                        <span className="shrink-0">{formatRelativeTime(session.updatedAt)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </aside>
  );
}
