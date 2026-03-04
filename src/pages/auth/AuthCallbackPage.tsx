import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Github } from "lucide-react";

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { handleOAuthCallback } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const params = new URLSearchParams(window.location.search);

      try {
        await handleOAuthCallback({
          code: params.get("code") ?? undefined,
          state: params.get("state") ?? undefined,
          error: params.get("error") ?? undefined,
        });

        if (!cancelled) {
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
      <Card className="mx-auto w-full max-w-sm animate-scale-in border-border/50 bg-card/60">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Github className="h-6 w-6 text-primary" />
          </div>
          <h2 className="font-display text-lg font-semibold text-foreground">
            GitHub OAuth
          </h2>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Finishing login and redirecting...
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
