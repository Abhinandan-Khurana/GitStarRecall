import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Github, KeyRound, ChevronDown } from "lucide-react";
import { useState } from "react";

interface LoginCardProps {
  sessions: { length: number };
  historyLoadState: string;
  error: string | null;
  oauthRedirectUri: string;
  onOAuthLogin: () => void;
  onPatLogin: (token: string) => void;
  onRetryHistory: () => void;
}

export function LoginCard({
  sessions,
  historyLoadState,
  error,
  oauthRedirectUri,
  onOAuthLogin,
  onPatLogin,
  onRetryHistory,
}: LoginCardProps) {
  const [patToken, setPatToken] = useState("");
  const [patOpen, setPatOpen] = useState(false);

  const handlePatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onPatLogin(patToken);
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-8 animate-scale-in">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <Github className="h-7 w-7 text-primary" />
        </div>
        <h2 className="font-display text-xl font-semibold text-foreground">
          Connect your GitHub
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Sign in with GitHub to search and recall your starred repositories with natural language.
        </p>
      </div>

      {sessions.length > 0 ? (
        <Badge variant="secondary" className="mx-auto gap-1.5 text-xs">
          {sessions.length} saved session{sessions.length === 1 ? "" : "s"} available
        </Badge>
      ) : null}

      {historyLoadState === "error" ? (
        <div className="flex items-center justify-center gap-2 text-xs">
          <p className="text-destructive">Local history could not be loaded.</p>
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onRetryHistory}>
            Retry
          </Button>
        </div>
      ) : null}

      <Button
        size="lg"
        onClick={onOAuthLogin}
        className="w-full rounded-full glow-mint transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
      >
        <Github className="mr-2 h-4 w-4" />
        Login with GitHub OAuth
      </Button>

      <Collapsible open={patOpen} onOpenChange={setPatOpen}>
        <CollapsibleTrigger asChild>
          <button className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <KeyRound className="h-3 w-3" />
            Use Personal Access Token instead
            <ChevronDown className={`h-3 w-3 transition-transform ${patOpen ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <form onSubmit={handlePatSubmit} className="mt-3 flex flex-col gap-3 rounded-lg border border-border/50 bg-card/40 p-4">
            <Label htmlFor="patToken" className="text-xs text-muted-foreground">
              Personal Access Token
            </Label>
            <Input
              id="patToken"
              type="password"
              value={patToken}
              onChange={(e) => setPatToken(e.target.value)}
              placeholder="ghp_..."
            />
            <Button type="submit" variant="secondary" size="sm">
              Connect with PAT
            </Button>
          </form>
        </CollapsibleContent>
      </Collapsible>

      <p className="text-center text-xs text-muted-foreground">
        OAuth redirect URI:{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{oauthRedirectUri}</code>
      </p>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
