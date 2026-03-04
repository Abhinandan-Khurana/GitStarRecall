import { Link, useLocation } from "react-router-dom";
import type { PropsWithChildren } from "react";
import { useAuth } from "../auth/useAuth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Star, LogOut, User } from "lucide-react";

export default function AppLayout({ children }: PropsWithChildren) {
  const location = useLocation();
  const isLanding = location.pathname === "/";
  const { isAuthenticated, authMethod, beginOAuthLogin, logout } = useAuth();

  return (
    <div className="relative min-h-screen text-foreground">
      {/* Subtle background mesh */}
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, hsla(160, 64%, 51%, 0.06), transparent), radial-gradient(ellipse 60% 40% at 80% 50%, hsla(187, 85%, 53%, 0.03), transparent), hsl(var(--background))",
        }}
      />

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="group flex items-center gap-2 font-display text-lg font-semibold tracking-tight transition-colors hover:text-primary"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
              <Star className="h-3.5 w-3.5" />
            </span>
            <span>GitStarRecall</span>
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              to="/"
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isLanding
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Home
            </Link>
            <Link
              to="/app"
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                !isLanding
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              App
            </Link>

            <div className="ml-1 h-5 w-px bg-border/60" aria-hidden="true" />

            {isAuthenticated ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="ml-1 rounded-full ring-offset-background transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                    <Avatar className="h-8 w-8 border border-border">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                        <User className="h-3.5 w-3.5" />
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-medium text-foreground">Account</p>
                    <p className="text-xs text-muted-foreground">
                      {authMethod === "oauth" ? "GitHub OAuth" : "Personal Access Token"}
                    </p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={logout}
                    className="cursor-pointer text-destructive focus:text-destructive"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                size="sm"
                onClick={() => void beginOAuthLogin().catch(() => {})}
                className="ml-1 rounded-full glow-mint-sm"
              >
                Connect GitHub
              </Button>
            )}
          </nav>
        </div>
      </header>

      {/* Main content */}
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6">
        <main
          className={`animate-fade-in min-h-[70vh] rounded-2xl border border-border/50 bg-card/60 shadow-xl backdrop-blur-sm ${
            isLanding ? "p-8 md:p-10" : "p-5 md:p-8"
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
