import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getLocalDatabase } from "@/db/client";
import type { ChatMessageRecord, ChatSessionRecord } from "@/db/types";
import { useAuth } from "@/auth/useAuth";
import SafeMarkdown from "@/components/SafeMarkdown";

function formatSessionTitle(session: ChatSessionRecord) {
  return session.query.trim() || "Untitled session";
}

export default function SessionsPage() {
  const navigate = useNavigate();
  const { accessToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<ChatSessionRecord[]>([]);
  const [messages, setMessages] = useState<Record<string, ChatMessageRecord[]>>({});
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const database = await getLocalDatabase();
      const nextSessions = database.listChatSessions();
      const nextMessages = nextSessions.reduce<Record<string, ChatMessageRecord[]>>((acc, session) => {
        acc[session.id] = database.listChatMessages(session.id);
        return acc;
      }, {});

      if (!cancelled) {
        setSessions(nextSessions);
        setMessages(nextMessages);
        if (!searchParams.get("session") && nextSessions[0]) {
          setSearchParams((params) => {
            const next = new URLSearchParams(params);
            next.set("session", nextSessions[0].id);
            return next;
          });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [accessToken, searchParams, setSearchParams]);

  const filteredSessions = useMemo(
    () => sessions.filter((session) => {
      const normalizedQuery = query.toLowerCase();
      if (!normalizedQuery) {
        return true;
      }
      const titleMatch = formatSessionTitle(session).toLowerCase().includes(normalizedQuery);
      if (titleMatch) {
        return true;
      }
      const transcript = (messages[session.id] ?? []).map((message) => message.content).join(" ").toLowerCase();
      return transcript.includes(normalizedQuery);
    }),
    [messages, query, sessions],
  );
  const selectedSessionId = searchParams.get("session");
  const selectedSession = filteredSessions.find((session) => session.id === selectedSessionId) ?? sessions.find((session) => session.id === selectedSessionId) ?? null;
  const selectedMessages = selectedSession ? messages[selectedSession.id] ?? [] : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
      <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
        <CardHeader className="border-b border-border/60">
          <CardTitle className="font-display text-lg">Sessions</CardTitle>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter sessions"
            className="mt-2 h-11 rounded-md border-border/70 bg-background"
          />
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-16rem)]">
            <div className="divide-y divide-border/50">
              {filteredSessions.map((session) => {
                const selected = session.id === selectedSessionId;
                const sessionMessages = messages[session.id] ?? [];
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`w-full px-5 py-4 text-left transition-colors ${
                      selected ? "bg-primary/10" : "hover:bg-background/70"
                    }`}
                    onClick={() => {
                      setSearchParams((params) => {
                        const next = new URLSearchParams(params);
                        next.set("session", session.id);
                        return next;
                      });
                    }}
                  >
                    <p className="line-clamp-2 text-sm font-medium">{formatSessionTitle(session)}</p>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{sessionMessages.length} messages</span>
                      <span>{new Date(session.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </button>
                );
              })}
              {filteredSessions.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-muted-foreground">No sessions found.</div>
              ) : null}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-[var(--app-panel)] shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/60">
          <div>
            <CardTitle className="font-display text-lg">{selectedSession ? formatSessionTitle(selectedSession) : "No session selected"}</CardTitle>
            {selectedSession ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Updated {new Date(selectedSession.updatedAt).toLocaleString()}
              </p>
            ) : null}
          </div>
          {selectedSession ? (
            <Button
              variant="outline"
              className="rounded-md"
              onClick={() => navigate(`/app/recall?session=${encodeURIComponent(selectedSession.id)}`)}
            >
              Resume in Recall
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="pt-5">
          {selectedSession ? (
            <ScrollArea className="h-[calc(100vh-18rem)]">
              <div className="space-y-3 pr-4">
                {selectedMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[85%] rounded-md border px-4 py-3 text-sm ${
                      message.role === "user"
                        ? "ml-auto border-primary/20 bg-primary text-primary-foreground"
                        : "border-border/60 bg-background text-foreground"
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant={message.role === "user" ? "secondary" : "outline"} className="rounded-md text-[10px] uppercase">
                        {message.role}
                      </Badge>
                      <span className={`text-[11px] ${message.role === "user" ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                        {new Date(message.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <SafeMarkdown
                      className={message.role === "user"
                        ? "whitespace-pre-wrap break-words text-sm text-primary-foreground [&_pre]:overflow-x-auto"
                        : "whitespace-pre-wrap break-words text-sm text-foreground [&_pre]:overflow-x-auto [&_code]:break-all"
                      }
                      content={message.content}
                    />
                  </div>
                ))}
                {selectedMessages.length === 0 ? (
                  <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                    <MessageSquare className="h-8 w-8" />
                    <p className="text-sm">This session does not have stored messages yet.</p>
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
              Pick a session to inspect the transcript.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
