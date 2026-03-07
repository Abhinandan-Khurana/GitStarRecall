import type { PropsWithChildren } from "react";

type LandingParallaxSceneProps = PropsWithChildren<{
  className?: string;
}>;

export function LandingParallaxScene({ children, className }: LandingParallaxSceneProps) {
  return (
    <div className={`relative isolate overflow-hidden ${className ?? ""}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.28),transparent_65%)] dark:bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_65%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.42))] dark:bg-[linear-gradient(180deg,transparent,rgba(8,6,12,0.6))]" />
      {children}
    </div>
  );
}
