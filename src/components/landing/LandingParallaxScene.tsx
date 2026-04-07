import type { PropsWithChildren } from "react";

type LandingParallaxSceneProps = PropsWithChildren<{
  className?: string;
}>;

export function LandingParallaxScene({ children, className }: LandingParallaxSceneProps) {
  return (
    <div className={`relative isolate overflow-hidden ${className ?? ""}`}>
      {children}
    </div>
  );
}
