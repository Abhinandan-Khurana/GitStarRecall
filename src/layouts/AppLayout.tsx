import { Link, useLocation } from "react-router-dom";
import type { PropsWithChildren } from "react";
import { useAuth } from "../auth/useAuth";
import { Button } from "@/components/ui/button";
import { Star, Home, Sparkles, Github } from "lucide-react";

export default function AppLayout({ children }: PropsWithChildren) {
  const location = useLocation();
  const isLanding = location.pathname === "/";
  const { isAuthenticated, beginOAuthLogin, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="group flex shrink-0 items-center gap-2 font-display text-lg font-semibold tracking-tight"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 transition-colors group-hover:bg-primary/20">
              <Star className="h-4 w-4 text-primary" />
            </div>
            <span className="transition-colors group-hover:text-primary">
              GitStarRecall
            </span>
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2">
            <Link to="/">
              <Button
                variant={isLanding ? "secondary" : "ghost"}
                size="sm"
                className="gap-1.5 rounded-lg text-xs font-medium"
              >
                <Home className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Home</span>
              </Button>
            </Link>
            <Link to="/app">
              <Button
                variant={!isLanding ? "secondary" : "ghost"}
                size="sm"
                className="gap-1.5 rounded-lg text-xs font-medium"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">App</span>
              </Button>
            </Link>

            <div className="mx-1 h-5 w-px bg-border/50" />

            {isAuthenticated ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Logout
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void beginOAuthLogin().catch(() => {})}
                className="gap-1.5 rounded-lg text-xs font-medium"
              >
                <Github className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Connect GitHub</span>
                <span className="sm:hidden">Connect</span>
              </Button>
            )}
          </nav>
        </div>
        {/* Subtle glow line */}
        <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </header>

      {/* Main content */}
      <div className="flex-1">
        {isLanding ? (
          <div className="animate-fade-in">{children}</div>
        ) : (
          <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
            <main className="animate-fade-in min-h-[70vh] rounded-2xl border border-border/50 bg-card/50 p-4 shadow-2xl shadow-black/20 backdrop-blur-sm sm:p-6 md:p-8">
              {children}
            </main>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-border/30 py-6">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 text-xs text-muted-foreground sm:px-6">
          <span>GitStarRecall -- Privacy-first GitHub star search</span>
          <a
            href="https://github.com/Abhinandan-Khurana/GitStarRecall"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <Github className="h-3.5 w-3.5" />
            Source
          </a>
        </div>
      </footer>
    </div>
  );
}
