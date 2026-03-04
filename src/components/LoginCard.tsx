import { Github, KeyRound, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface LoginCardProps {
  onOAuthLogin: () => void;
  patToken: string;
  onPatChange: (value: string) => void;
  onPatSubmit: (e: React.FormEvent) => void;
  oauthRedirectUri: string;
  error: string | null;
  sessionCount: number;
  historyLoadState: string;
  onRetryHistory: () => void;
}

export function LoginCard({
  onOAuthLogin,
  patToken,
  onPatChange,
  onPatSubmit,
  oauthRedirectUri,
  error,
  sessionCount,
  historyLoadState,
  onRetryHistory,
}: LoginCardProps) {
  return (
    <div className="mx-auto max-w-md animate-scale-in">
      <Card className="border-border/50 bg-card/60">
        <CardContent className="p-6 space-y-5">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              Connect to GitHub
            </h2>
            <p className="text-sm text-muted-foreground">
              Authenticate to sync and search your starred repositories.
              Your token stays in memory only.
            </p>
          </div>

          {sessionCount > 0 && (
            <p className="rounded-lg bg-secondary/30 px-3 py-2 text-center text-xs text-muted-foreground">
              {sessionCount} local chat session{sessionCount === 1 ? "" : "s"} available. Login to continue.
            </p>
          )}

          {historyLoadState === "error" && (
            <div className="flex items-center justify-center gap-2 text-xs">
              <p className="text-destructive">Local history could not be loaded.</p>
              <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={onRetryHistory}>
                Retry
              </Button>
            </div>
          )}

          {/* OAuth */}
          <Button onClick={onOAuthLogin} className="w-full gap-2 rounded-lg" size="lg">
            <Github className="h-4 w-4" />
            Login with GitHub
          </Button>

          <p className="text-center text-[11px] text-muted-foreground">
            Redirect URI: <code className="rounded bg-muted px-1 py-0.5">{oauthRedirectUri}</code>
          </p>

          {/* PAT fallback */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs text-muted-foreground">
                <KeyRound className="h-3 w-3" />
                Use Personal Access Token instead
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <form onSubmit={onPatSubmit} className="mt-2 space-y-3 animate-fade-in">
                <div className="space-y-1.5">
                  <Label htmlFor="patToken" className="text-xs">Personal Access Token</Label>
                  <Input
                    id="patToken"
                    type="password"
                    value={patToken}
                    onChange={(e) => onPatChange(e.target.value)}
                    placeholder="ghp_..."
                    className="h-9 rounded-lg border-border/50 bg-secondary/30 text-sm"
                  />
                </div>
                <Button type="submit" variant="secondary" size="sm" className="w-full">
                  Use PAT
                </Button>
              </form>
            </CollapsibleContent>
          </Collapsible>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
