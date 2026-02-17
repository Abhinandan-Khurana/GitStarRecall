// SPDX-License-Identifier: Apache-2.0
import { Link, useLocation } from "react-router-dom";
import type { PropsWithChildren } from "react";
import { useAuth } from "../auth/useAuth";
import { Button } from "@/components/ui/button";

export default function AppLayout({ children }: PropsWithChildren) {
  const location = useLocation();
  const isLanding = location.pathname === "/";
  const { isAuthenticated, beginOAuthLogin, logout } = useAuth();

  return (
    <div className="min-h-screen text-mist">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-ink/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:pr-8">
          <Link to="/" className="shrink-0 font-display text-lg font-semibold tracking-tight">
            GitStarRecall
          </Link>
          <nav className="flex min-w-0 shrink flex-wrap items-center justify-end gap-2 text-sm sm:gap-4">
            <Link to="/" className={isLanding ? "text-mint" : "text-mist/80 hover:text-mist"}>
              Landing
            </Link>
            <Link to="/app" className={!isLanding ? "text-mint" : "text-mist/80 hover:text-mist"}>
              Usage
            </Link>
            {isAuthenticated ? (
              <Button variant="outline" size="sm" onClick={logout} className="rounded-full uppercase tracking-widest">
                Logout
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void beginOAuthLogin().catch(() => {})}
                className="rounded-full uppercase tracking-widest"
              >
                Connect GitHub
              </Button>
            )}
          </nav>
        </div>
      </header>

      {isLanding ? (
        <div className="mx-auto w-full max-w-4xl px-6 pb-16 pt-10">
          <main className="min-h-[70vh] rounded-2xl border border-white/10 bg-slate/60 p-8 shadow-[0_0_40px_rgba(15,23,42,0.45)] md:p-10">
            {children}
          </main>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-5xl px-6 pb-16 pt-10">
          <main className="min-h-[70vh] rounded-2xl border border-white/10 bg-slate/60 p-6 shadow-[0_0_40px_rgba(15,23,42,0.45)] md:p-8">
            {children}
          </main>
        </div>
      )}
    </div>
  );
}
