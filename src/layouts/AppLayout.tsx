import { Link, useLocation } from "react-router-dom";
import type { PropsWithChildren } from "react";
import { useAuth } from "../auth/useAuth";

export default function AppLayout({ children }: PropsWithChildren) {
  const location = useLocation();
  const isLanding = location.pathname === "/";
  const { isAuthenticated, authMethod, beginOAuthLogin, logout } = useAuth();

  return (
    <div className="min-h-screen text-mist">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-ink/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            GitStarRecall
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/" className={isLanding ? "text-mint" : "text-mist/80"}>
              Landing
            </Link>
            <Link to="/app" className={!isLanding ? "text-mint" : "text-mist/80"}>
              Usage
            </Link>
            {isAuthenticated ? (
              <button
                onClick={logout}
                className="rounded-full border border-white/30 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white hover:bg-white/10"
              >
                Logout
              </button>
            ) : (
              <button
                onClick={() => {
                  void beginOAuthLogin().catch(() => {
                    // Surface detailed login errors in usage page auth card.
                  });
                }}
                className="rounded-full border border-mint/60 px-4 py-2 text-xs uppercase tracking-[0.2em] text-mint hover:bg-mint/10"
              >
                Connect GitHub
              </button>
            )}
          </nav>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-6 px-6 pb-16 pt-10 lg:grid-cols-[1fr_280px]">
        <main className="min-h-[70vh] rounded-2xl border border-white/10 bg-slate/60 p-6 shadow-[0_0_40px_rgba(15,23,42,0.45)]">
          {children}
        </main>
        <aside className="rounded-2xl border border-white/10 bg-steel/60 p-6 text-sm text-mist/80">
          <p className="text-xs uppercase tracking-[0.3em] text-mist/50">Status</p>
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-mint">Local-first mode</p>
              <p className="text-mist/60">All data stays in your browser.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-cyan">LLM usage</p>
              <p className="text-mist/60">Remote providers are off by default.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-mist">Session</p>
              <p className="text-mist/60">
                {isAuthenticated ? `Authenticated via ${authMethod}` : "No active session yet."}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
