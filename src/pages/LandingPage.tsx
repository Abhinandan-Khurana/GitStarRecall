import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { ArrowUpRight, Github, Heart, Sparkles, Star } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { LandingConnectSection } from "@/components/landing/LandingConnectSection";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingParallaxScene } from "@/components/landing/LandingParallaxScene";
import { LandingWorkspaceFlow } from "@/components/landing/LandingWorkspaceFlow";
import { useParallaxProgress } from "@/components/landing/useParallaxProgress";

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
      {children}
    </a>
  );
}

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

      <footer className="relative z-10 px-5 pb-10 pt-4 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-[1500px]">
          <div className="mb-8 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
                <span className="font-display text-base font-semibold text-foreground">GitStarRecall</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Search by intent, inspect the match, and move into a local-first workspace without hiding context.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
                >
                  <Github className="h-3.5 w-3.5" />
                  Source
                  <ArrowUpRight className="h-3 w-3 opacity-50" />
                </a>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <Star className="h-3.5 w-3.5" />
                  Star on GitHub
                </a>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-12 gap-y-6 text-sm sm:gap-x-16">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">Resources</p>
                <nav className="mt-3 flex flex-col gap-2">
                  <FooterLink href={`${REPO_URL}/blob/main/docs/Usage.md`}>Usage Guide</FooterLink>
                  <FooterLink href={`${REPO_URL}/blob/main/docs/changelogs.md`}>Changelogs</FooterLink>
                  <FooterLink href={`${REPO_URL}/tree/main/docs`}>All Docs</FooterLink>
                </nav>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">Trust &amp; Security</p>
                <nav className="mt-3 flex flex-col gap-2">
                  <FooterLink href={`${REPO_URL}/blob/main/SECURITY.md`}>Security Policy</FooterLink>
                  <FooterLink href={`${REPO_URL}/blob/main/docs/security-review-stride.md`}>STRIDE Review</FooterLink>
                  <FooterLink href={`${REPO_URL}/blob/main/CODE_OF_CONDUCT.md`}>Code of Conduct</FooterLink>
                </nav>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col items-center gap-4 border-t border-border pt-6">
            <div className="flex flex-wrap justify-center gap-2">
              <a href="https://deepwiki.com/Abhinandan-Khurana/GitStarRecall" target="_blank" rel="noreferrer">
                <img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki" className="h-5" />
              </a>
              <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-334155" className="h-5" />
              <a href={`${REPO_URL}/blob/main/docs/security-review-stride.md`} target="_blank" rel="noreferrer">
                <img alt="STRIDE Reviewed" src="https://img.shields.io/badge/security-STRIDE_Reviewed-059669" className="h-5" />
              </a>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground/50">
              <span>MIT License</span>
              <span className="h-3 w-px bg-border" />
              <a
                href="https://github.com/Abhinandan-Khurana"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 transition-colors hover:text-muted-foreground"
              >
                Made with <Heart className="h-3 w-3 text-primary/70" /> by Abhinandan-Khurana
              </a>
            </div>
          </div>
        </div>
      </footer>
    </LandingParallaxScene>
  );
}
