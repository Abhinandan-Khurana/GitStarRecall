import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Github, Loader2, ShieldAlert } from "lucide-react";

const CALLBACK_STEPS = [
  "Validating GitHub response",
  "Creating local session",
  "Redirecting to workspace",
] as const;

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { handleOAuthCallback } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState("Validating GitHub response");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const params = new URLSearchParams(window.location.search);

      try {
        setStage("Validating GitHub response");
        await handleOAuthCallback({
          code: params.get("code") ?? undefined,
          state: params.get("state") ?? undefined,
          error: params.get("error") ?? undefined,
        });
        if (!cancelled) {
          setStage("Creating local session");
        }

        if (!cancelled) {
          setStage("Redirecting to workspace");
          navigate("/app", { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "OAuth callback failed");
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [handleOAuthCallback, navigate]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Card className="mx-auto w-full max-w-md border-border/60 bg-[var(--app-panel)] shadow-none">
        <CardContent className="flex flex-col gap-5 p-8">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
              {error ? <ShieldAlert className="h-6 w-6 text-destructive" /> : <Github className="h-6 w-6 text-primary" />}
            </div>
            <div>
              <p className="font-display text-lg font-semibold text-foreground">GitHub callback</p>
              <p className="text-sm text-muted-foreground">Finishing authentication and preparing the workspace.</p>
            </div>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-md border border-border/60 bg-background/70 px-4 py-3 text-sm text-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>{stage}</span>
              </div>
              <div className="space-y-2 rounded-md border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                {CALLBACK_STEPS.map((step, index) => {
                  const currentIndex = CALLBACK_STEPS.indexOf(stage as (typeof CALLBACK_STEPS)[number]);
                  const isDone = index < currentIndex;
                  const isActive = index === currentIndex;
                  return (
                    <div key={step} className="flex items-center gap-3">
                      {isDone ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      ) : isActive ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <div className="h-4 w-4 rounded-full border border-border/70" />
                      )}
                      <span className={isDone || isActive ? "text-foreground" : undefined}>{step}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {error ? (
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="rounded-md" onClick={() => navigate("/", { replace: true })}>
                Return home
              </Button>
              <Button className="rounded-md" onClick={() => window.location.reload()}>
                Retry callback
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
