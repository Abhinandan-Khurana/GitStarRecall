import type { FormEvent, RefObject } from "react";
import { Github, KeyRound, Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRevealOnScroll } from "@/hooks/useRevealOnScroll";

type LandingConnectSectionProps = {
  connectRef: RefObject<HTMLElement | null>;
  isAuthenticated: boolean;
  primaryLabel: string;
  onPrimaryAction: () => void;
  patToken: string;
  onPatTokenChange: (value: string) => void;
  onPatSubmit: (event: FormEvent<HTMLFormElement>) => void;
  authError: string | null;
};

export function LandingConnectSection({
  connectRef,
  isAuthenticated,
  primaryLabel,
  onPrimaryAction,
  patToken,
  onPatTokenChange,
  onPatSubmit,
  authError,
}: LandingConnectSectionProps) {
  const { ref: revealRef, revealed } = useRevealOnScroll<HTMLDivElement>();

  return (
    <section id="connect" ref={connectRef} className="relative z-10 px-4 pb-12 pt-10 sm:px-6 lg:px-8">
      <div ref={revealRef} className="mx-auto max-w-3xl">
        <div className={`text-center reveal ${revealed ? "revealed" : ""}`}>
          <h2 className="font-display text-3xl font-bold text-foreground sm:text-4xl">Connect your stars</h2>
          <p className="mt-3 text-base leading-7 text-muted-foreground">OAuth is the fastest path. Use a PAT if you prefer manual control.</p>
        </div>

        <div className={`mt-8 grid gap-4 sm:grid-cols-2 reveal reveal-delay-1 ${revealed ? "revealed" : ""}`}>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Github className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium text-foreground">GitHub OAuth</p>
                <p className="text-xs text-muted-foreground">Preferred</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">One-click access to your starred public repositories.</p>
            <Button onClick={onPrimaryAction} className="mt-5 w-full rounded-full shadow-[0_8px_24px_hsl(var(--primary)/0.18)]">
              <Github className="mr-2 h-4 w-4" />
              {primaryLabel}
            </Button>
          </div>

          <form onSubmit={onPatSubmit} className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <KeyRound className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium text-foreground">Personal Access Token</p>
                <p className="text-xs text-muted-foreground">Manual fallback</p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <Label htmlFor="landing-pat-token" className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                Token
              </Label>
              <Input
                id="landing-pat-token"
                type="password"
                value={patToken}
                onChange={(event) => onPatTokenChange(event.target.value)}
                placeholder="ghp_..."
                className="h-11 rounded-xl border-border bg-background px-4"
              />
            </div>

            <Button type="submit" variant="outline" className="mt-4 w-full rounded-full">
              Continue with PAT
            </Button>
          </form>
        </div>

        <div className={`mt-5 flex items-center justify-center gap-2 text-sm text-muted-foreground reveal reveal-delay-2 ${revealed ? "revealed" : ""}`}>
          <Lock className="h-3.5 w-3.5" />
          <span>Read-only access only. No write scope is used.</span>
        </div>

        {authError ? (
          <Alert variant="destructive" className="mt-5">
            <AlertDescription>{authError}</AlertDescription>
          </Alert>
        ) : null}

        {isAuthenticated ? (
          <Alert className="mt-5 border-border bg-muted/30">
            <AlertDescription>
              Already authenticated. Use the button above to jump into the app.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </section>
  );
}
