import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, BookText, FileText, Shield, Sparkles } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { LandingConnectSection } from "@/components/landing/LandingConnectSection";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingParallaxScene } from "@/components/landing/LandingParallaxScene";
import { LandingWorkspaceFlow } from "@/components/landing/LandingWorkspaceFlow";
import { Button } from "@/components/ui/button";
import { useParallaxProgress } from "@/components/landing/useParallaxProgress";

const REPO_URL = "https://github.com/Abhinandan-Khurana/GitStarRecall";

export default function LandingPage() {
  const navigate = useNavigate();
  const connectRef = useRef<HTMLElement | null>(null);
  const { beginOAuthLogin, loginWithPat, isAuthenticated } = useAuth();
  const [authError, setAuthError] = useState<string | null>(null);
  const [patToken, setPatToken] = useState("");
  const { progress, reducedMotion } = useParallaxProgress({ start: 0, end: 0.24 });
  const scrolled = progress > 0.1;

  const handleOAuthLogin = useCallback(async () => {
    try {
      await beginOAuthLogin();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Unable to start GitHub OAuth");
    }
  }, [beginOAuthLogin]);

  const handlePatSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      try {
        await loginWithPat(patToken);
        navigate("/app");
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : "PAT login failed");
      }
    },
    [loginWithPat, navigate, patToken],
  );

  const scrollToConnect = useCallback(() => {
    connectRef.current?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [reducedMotion]);

  const openSource = useCallback(() => {
    window.open(REPO_URL, "_blank", "noreferrer");
  }, []);

  return (
    <LandingParallaxScene className="min-h-screen">
      <LandingHero
        onScrollToConnect={scrollToConnect}
        onOAuthLogin={() => void handleOAuthLogin()}
        onOpenSource={openSource}
        isAuthenticated={isAuthenticated}
        onNavCtaClick={isAuthenticated ? () => navigate("/app") : () => void handleOAuthLogin()}
        reducedMotion={reducedMotion}
        heroOffsetY={reducedMotion ? 0 : progress * 40}
        chipOffsetY={reducedMotion ? 0 : progress * -28}
        scrolled={scrolled}
      />

      <LandingConnectSection
        connectRef={connectRef}
        isAuthenticated={isAuthenticated}
        primaryLabel={isAuthenticated ? "Open app" : "Continue with GitHub"}
        onPrimaryAction={isAuthenticated ? () => navigate("/app") : () => void handleOAuthLogin()}
        patToken={patToken}
        onPatTokenChange={setPatToken}
        onPatSubmit={handlePatSubmit}
        authError={authError}
      />

      <LandingWorkspaceFlow />

      <footer className="px-4 pb-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[1500px]">
          <div className="mb-6 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          <div className="flex flex-col gap-6 rounded-2xl border border-border bg-card/60 px-6 py-5 text-sm text-muted-foreground">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Sparkles className="h-4 w-4" />
                </div>
                <p className="max-w-xl leading-6">
                  Built for rediscovery: search by intent, inspect the match, and move into a local-first workspace without hiding context.
                </p>
              </div>
              <Button variant="outline" className="shrink-0 rounded-full" onClick={openSource}>
                View source
                <ArrowUpRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
              <a href={`${REPO_URL}/blob/main/docs/Usage.md`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-foreground">
                <BookText className="h-3.5 w-3.5" />
                Usage Docs
              </a>
              <a href={`${REPO_URL}/blob/main/docs/changelogs.md`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-foreground">
                <FileText className="h-3.5 w-3.5" />
                Changelog
              </a>
              <a href={`${REPO_URL}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-foreground">
                <Shield className="h-3.5 w-3.5" />
                Security
              </a>
              <span className="ml-auto text-muted-foreground/60">MIT License</span>
            </div>
          </div>
        </div>
      </footer>
    </LandingParallaxScene>
  );
}
