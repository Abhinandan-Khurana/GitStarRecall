import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { LandingConnectSection } from "@/components/landing/LandingConnectSection";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingParallaxScene } from "@/components/landing/LandingParallaxScene";
import { LandingValueRail } from "@/components/landing/LandingValueRail";
import { LandingWorkspaceFlow } from "@/components/landing/LandingWorkspaceFlow";
import { Button } from "@/components/ui/button";
import { useParallaxProgress } from "@/components/landing/useParallaxProgress";
import { useTheme } from "@/features/theme/useTheme";

export default function LandingPage() {
  const navigate = useNavigate();
  const connectRef = useRef<HTMLElement | null>(null);
  const workflowRef = useRef<HTMLDivElement | null>(null);
  const { resolvedTheme } = useTheme();
  const { beginOAuthLogin, loginWithPat, isAuthenticated } = useAuth();
  const [authError, setAuthError] = useState<string | null>(null);
  const [patToken, setPatToken] = useState("");
  const { progress, reducedMotion } = useParallaxProgress({ start: 0, end: 0.24 });

  const handleOAuthLogin = useCallback(async () => {
    try {
      await beginOAuthLogin();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Unable to start GitHub OAuth");
    }
  }, [beginOAuthLogin]);

  const handlePatSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      try {
        loginWithPat(patToken);
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

  const scrollToFlow = useCallback(() => {
    workflowRef.current?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [reducedMotion]);

  const openSource = useCallback(() => {
    window.open("https://github.com/Abhinandan-Khurana/GitStarRecall", "_blank", "noreferrer");
  }, []);

  const heroShaderColors = useMemo(
    () =>
      resolvedTheme === "dark"
        ? ["#140d1d", "#2b1536", "#4d1d45", "#73415a", "#2c203a", "#0f0a13"]
        : ["#fff7f9", "#ffe8f0", "#ffe8dc", "#f5d9ff", "#ffe2cf", "#fffaf2"],
    [resolvedTheme],
  );

  return (
    <LandingParallaxScene className="min-h-screen">
      <LandingHero
        onScrollToConnect={scrollToConnect}
        onScrollToFlow={scrollToFlow}
        onOpenSource={openSource}
        isAuthenticated={isAuthenticated}
        onNavCtaClick={isAuthenticated ? () => navigate("/app") : scrollToConnect}
        reducedMotion={reducedMotion}
        shaderColors={heroShaderColors}
        heroOffsetY={reducedMotion ? 0 : progress * 70}
        chipOffsetY={reducedMotion ? 0 : progress * -48}
      />

      <LandingValueRail />

      <div ref={workflowRef}>
        <LandingWorkspaceFlow />
      </div>

      <LandingConnectSection
        connectRef={connectRef}
        isAuthenticated={isAuthenticated}
        primaryLabel={isAuthenticated ? "Open app" : "Continue with GitHub"}
        onPrimaryAction={isAuthenticated ? () => navigate("/app") : () => void handleOAuthLogin()}
        patToken={patToken}
        onPatTokenChange={setPatToken}
        onPatSubmit={handlePatSubmit}
        authError={authError}
        reducedMotion={reducedMotion}
      />

      <footer className="px-4 pb-14 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 rounded-[30px] border border-white/15 bg-white/30 px-6 py-6 text-sm text-foreground/68 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between dark:bg-white/[0.04]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <p className="max-w-xl leading-6">
              Built for rediscovery: search by intent, inspect the match, and move into a local-first workspace without hiding context.
            </p>
          </div>
          <Button variant="outline" className="rounded-full border-white/20 bg-white/30 dark:bg-white/[0.04]" onClick={openSource}>
            View source
            <ArrowUpRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </footer>
    </LandingParallaxScene>
  );
}
