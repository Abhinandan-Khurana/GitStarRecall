import type { FormEvent, RefObject } from "react";
import { Github, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
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
  reducedMotion: boolean;
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
    <section id="connect" ref={connectRef} className="px-4 pb-16 pt-14 sm:px-6 lg:px-8">
      <div ref={revealRef} className="mx-auto max-w-[1500px] space-y-6">
        <div className="max-w-3xl">
          <h2 className={`font-display text-3xl font-bold text-foreground sm:text-4xl reveal ${revealed ? "revealed" : ""}`}>Connect your stars</h2>
          <p className={`mt-4 text-base leading-7 text-muted-foreground reveal reveal-delay-1 ${revealed ? "revealed" : ""}`}>Choose OAuth for the fastest setup or use a PAT if you want manual control. Both paths stay public-repo read-only.</p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className={`space-y-4 rounded-2xl border border-border bg-card p-6 reveal reveal-delay-1 ${revealed ? "revealed" : ""}`}>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">Permission note</p>
            <div className="rounded-xl border border-border bg-muted/50 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Read-only by design</p>
                  <p className="text-sm text-muted-foreground">No write permission is used.</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">OAuth and PAT only need read-only access to read your starred public repositories.</p>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-5">
              <p className="text-sm font-medium text-foreground">What happens next</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                <li>Connect with OAuth or add a PAT.</li>
                <li>Import starred repositories and build the local index.</li>
                <li>Open Recall with visible context and dedicated workspace views.</li>
              </ul>
            </div>
          </div>

          <div className={`rounded-2xl border border-border bg-card p-6 shadow-sm reveal reveal-delay-2 ${revealed ? "revealed" : ""}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">Get into the app</p>
                <h3 className="mt-2 font-display text-2xl font-bold text-foreground">Choose your access path</h3>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">Both options stay read-only. Pick the one you want to use today.</p>
              </div>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <div className="rounded-xl border border-border bg-muted/40 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Github className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">GitHub OAuth</p>
                    <p className="text-xs text-muted-foreground">Preferred path</p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">Read starred public repositories with GitHub read-only access. No write scope is used.</p>
                <Button onClick={onPrimaryAction} className="mt-6 w-full rounded-full shadow-[0_8px_24px_hsl(var(--primary)/0.18)]">
                  <Github className="mr-2 h-4 w-4" />
                  {primaryLabel}
                </Button>
              </div>

              <form onSubmit={onPatSubmit} className="rounded-xl border border-border bg-muted/20 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Personal Access Token</p>
                    <p className="text-xs text-muted-foreground">Manual fallback</p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">Use a read-only token with repo access. The token stays local to this session.</p>

                <div className="mt-5 space-y-2">
                  <Label htmlFor="landing-pat-token" className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                    Personal Access Token
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

                <div className="mt-5 rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm leading-7 text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <LockKeyhole className="h-4 w-4 text-primary" />
                    <span className="font-medium text-foreground">Local session only</span>
                  </div>
                  <p className="mt-2">Use PAT when you want manual control. OAuth remains the fastest guided path.</p>
                </div>

                <Button type="submit" variant="outline" className="mt-5 w-full rounded-full">
                  Continue with PAT
                </Button>
              </form>
            </div>

            {authError ? (
              <Alert variant="destructive" className="mt-5">
                <AlertDescription>{authError}</AlertDescription>
              </Alert>
            ) : null}

            {isAuthenticated ? (
              <Alert className="mt-5 border-border bg-muted/30">
                <AlertDescription>
                  You are already authenticated. Use the same entry point above to jump directly into the app.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
