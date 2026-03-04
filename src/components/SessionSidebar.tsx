import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MessageSquare } from "lucide-react";

interface SessionItem {
  id: string;
  title: string;
  resultCount: number;
}

interface SessionSidebarProps {
  sessions: SessionItem[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onClearActive: () => void;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onClearActive,
}: SessionSidebarProps) {
  return (
    <aside
      className="flex w-full shrink-0 flex-col rounded-xl border border-border/50 bg-card/40 md:w-56"
      aria-label="Chat sessions"
    >
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          Chats
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={onClearActive}
        >
          <Plus className="h-3 w-3" />
          New
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <ul className="flex flex-col gap-0.5 p-1.5">
          {sessions.length === 0 ? (
            <li className="px-2 py-4 text-center text-xs text-muted-foreground">
              No chats yet. Run a search to start one.
            </li>
          ) : (
            sessions.map((session) => (
              <li key={session.id}>
                <button
                  onClick={() => onSelectSession(session.id)}
                  aria-current={activeSessionId === session.id ? "true" : undefined}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                    activeSessionId === session.id
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <span className="min-w-0 truncate font-medium">{session.title}</span>
                  <Badge variant="secondary" className="ml-2 shrink-0 text-xs tabular-nums">
                    {session.resultCount}
                  </Badge>
                </button>
              </li>
            ))
          )}
        </ul>
      </ScrollArea>
    </aside>
  );
}
