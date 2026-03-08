import type { ReactNode } from "react";
import { MeshGradient } from "@paper-design/shaders-react";
import { useEffect, useState } from "react";

interface HeroSectionProps {
  title?: string;
  highlightText?: string;
  description?: string;
  buttonText?: string;
  onButtonClick?: () => void;
  colors?: string[];
  distortion?: number;
  swirl?: number;
  speed?: number;
  offsetX?: number;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  buttonClassName?: string;
  maxWidth?: string;
  veilOpacity?: string;
  fontFamily?: string;
  fontWeight?: number;
  reducedMotion?: boolean;
  renderContent?: boolean;
  children?: ReactNode;
}

export function HeroSection({
  title = "Find starred repos by intent, inspect the match, and keep context visible.",
  highlightText = "GitStarRecall",
  description = "A local-first memory layer for GitHub stars that stays readable, intentional, and fast.",
  buttonText = "Get started",
  onButtonClick,
  colors = ["#fff4f9", "#ffdce9", "#fde7cf", "#f9c6e9", "#f0d8ff", "#fff7ef"],
  distortion = 0.75,
  swirl = 0.52,
  speed = 0.35,
  offsetX = 0.04,
  className = "",
  titleClassName = "",
  descriptionClassName = "",
  buttonClassName = "",
  maxWidth = "max-w-7xl",
  veilOpacity = "bg-white/20 dark:bg-black/25",
  fontFamily = "var(--font-display)",
  fontWeight = 600,
  reducedMotion = false,
  renderContent = true,
  children,
}: HeroSectionProps) {
  const [dimensions, setDimensions] = useState({ width: 1920, height: 1080 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const update = () =>
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <section className={`relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background ${className}`}>
      <div className="pointer-events-none fixed inset-0 h-screen w-screen">
        {mounted ? (
          <>
            <MeshGradient
              width={dimensions.width}
              height={dimensions.height}
              colors={colors}
              distortion={reducedMotion ? 0.12 : distortion}
              swirl={reducedMotion ? 0.12 : swirl}
              grainMixer={0}
              grainOverlay={0}
              speed={reducedMotion ? 0.08 : speed}
              offsetX={offsetX}
            />
            <div className={`absolute inset-0 ${veilOpacity}`} />
          </>
        ) : null}
      </div>

      <div className={`relative z-10 mx-auto w-full px-6 ${maxWidth}`}>
        {renderContent ? (
          <div className="text-center">
            <p className="mb-5 text-sm font-medium uppercase tracking-[0.35em] text-primary/70">{highlightText}</p>
            <h1
              className={`mb-6 text-balance text-4xl font-semibold leading-[0.95] text-foreground sm:text-5xl md:text-6xl lg:text-7xl xl:text-[5.5rem] ${titleClassName}`}
              style={{ fontFamily, fontWeight }}
            >
              {title}
            </h1>
            <p className={`mx-auto mb-10 max-w-2xl text-pretty text-lg leading-relaxed text-foreground/75 sm:text-xl ${descriptionClassName}`}>
              {description}
            </p>
            {buttonText ? (
              <button
                type="button"
                onClick={onButtonClick}
                className={`rounded-full border border-border/70 bg-foreground px-6 py-4 text-sm font-medium text-background transition duration-300 hover:scale-[1.01] hover:bg-foreground/90 sm:px-8 ${buttonClassName}`}
              >
                {buttonText}
              </button>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}
