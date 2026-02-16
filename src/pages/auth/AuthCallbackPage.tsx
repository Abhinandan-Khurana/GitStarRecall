import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";

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
    <section className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-6">
      <h2 className="font-display text-2xl text-white">GitHub OAuth Callback</h2>
      {error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : (
        <p className="text-sm text-mist/70">Finishing login and redirecting to usage page...</p>
      )}
    </section>
  );
}
