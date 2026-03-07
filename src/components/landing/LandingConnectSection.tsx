import type { FormEvent, RefObject } from "react";
import { Github, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  return (
    <section id="connect" ref={connectRef} className="px-4 pb-24 pt-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <div className="max-w-3xl">
          <Badge variant="outline" className="rounded-full border-white/25 bg-white/25 px-3 py-1">
            Authentication
          </Badge>
          <h2 className="mt-4 font-display text-3xl font-semibold text-foreground sm:text-4xl">Connect your stars</h2>
          <p className="mt-4 text-base leading-7 text-foreground/72">
            Start at the moment you are ready. The hero sells the product first; this section handles authentication, permissions, and the actual entry path into the workspace.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-4 rounded-[32px] border border-white/15 bg-white/45 p-7 shadow-[0_26px_90px_rgba(39,14,52,0.1)] backdrop-blur-2xl dark:bg-white/[0.05]">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-foreground/50">Permission note</p>
            <div className="rounded-[24px] border border-white/15 bg-white/45 p-5 dark:bg-white/[0.05]">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Read-only by design</p>
                  <p className="text-sm text-foreground/60">No write access is required for the product flow.</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-7 text-foreground/72">
                GitHub OAuth uses read-only access so GitStarRecall can read your public repositories. If you use a Personal Access Token, create one with read-only repository access so GitStarRecall can read your public repositories.
              </p>
            </div>

            <div className="rounded-[24px] border border-white/15 bg-white/35 p-5 dark:bg-white/[0.04]">
              <p className="text-sm font-medium text-foreground">Why OAuth stays first</p>
              <p className="mt-3 text-sm leading-7 text-foreground/70">
                OAuth is the cleanest guided path. PAT remains here for users who want manual control or do not want to use OAuth in the moment.
              </p>
            </div>

            <div className="rounded-[24px] border border-white/15 bg-white/35 p-5 dark:bg-white/[0.04]">
              <p className="text-sm font-medium text-foreground">What happens next</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-foreground/70">
                <li>Sign in or provide a PAT.</li>
                <li>Import starred repositories and build the local index.</li>
                <li>Move into Recall with explicit context and dedicated workspace views.</li>
              </ul>
            </div>
          </div>

          <div className="rounded-[32px] border border-white/15 bg-white/58 p-7 shadow-[0_30px_110px_rgba(43,16,55,0.13)] backdrop-blur-2xl dark:bg-black/22">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.3em] text-foreground/50">Get into the app</p>
                <h3 className="mt-2 font-display text-3xl font-semibold text-foreground">Choose your access path</h3>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-foreground/70">
                  OAuth and PAT both keep the experience read-only. Pick the path that matches how you want to connect today.
                </p>
              </div>
              <Badge className="rounded-full bg-white/70 text-foreground dark:bg-white/10">Auth</Badge>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <div className="rounded-[26px] border border-white/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.58),rgba(255,255,255,0.24))] p-5 dark:bg-white/[0.06]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                    <Github className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">GitHub OAuth</p>
                    <p className="text-xs text-foreground/55">Preferred path</p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-7 text-foreground/72">
                  Uses read-only access so GitStarRecall can read your public  repositories. No write path is needed for the landing-to-workspace flow.
                </p>
                <Button onClick={onPrimaryAction} className="mt-6 w-full rounded-full">
                  <Github className="mr-2 h-4 w-4" />
                  {primaryLabel}
                </Button>
              </div>

              <form onSubmit={onPatSubmit} className="rounded-[26px] border border-white/20 bg-white/42 p-5 dark:bg-white/[0.04]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Personal Access Token</p>
                    <p className="text-xs text-foreground/55">Manual fallback</p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-7 text-foreground/72">
                  Use a read-only repository token so GitStarRecall can read your public repositories. The token remains local to your session.
                </p>

                <div className="mt-5 space-y-2">
                  <Label htmlFor="landing-pat-token" className="text-xs uppercase tracking-[0.22em] text-foreground/50">
                    Personal Access Token
                  </Label>
                  <Input
                    id="landing-pat-token"
                    type="password"
                    value={patToken}
                    onChange={(event) => onPatTokenChange(event.target.value)}
                    placeholder="ghp_..."
                    className="h-12 rounded-2xl border-white/20 bg-white/65 px-4 dark:bg-white/[0.05]"
                  />
                </div>

                <div className="mt-5 rounded-2xl border border-dashed border-white/20 bg-white/35 p-4 text-sm leading-7 text-foreground/68 dark:bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    <LockKeyhole className="h-4 w-4 text-primary" />
                    <span className="font-medium text-foreground">Local session handling</span>
                  </div>
                  <p className="mt-2">
                    PAT login exists for control and fallback. OAuth remains the preferred path for a cleaner guided experience.
                  </p>
                </div>

                <Button type="submit" variant="outline" className="mt-5 w-full rounded-full border-white/25 bg-white/35 dark:bg-white/[0.04]">
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
              <Alert className="mt-5 border-white/20 bg-white/35 dark:bg-white/[0.04]">
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
