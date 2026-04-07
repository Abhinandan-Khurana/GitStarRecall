import type { ReactNode } from "react";

interface HeroSectionProps {
  title?: string;
  highlightText?: string;
  description?: string;
  buttonText?: string;
  onButtonClick?: () => void;
  colors?: string[];
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  buttonClassName?: string;
  maxWidth?: string;
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
  className = "",
  titleClassName = "",
  descriptionClassName = "",
  buttonClassName = "",
  maxWidth = "max-w-7xl",
  fontFamily = "var(--font-display)",
  fontWeight = 600,
  reducedMotion: _reducedMotion = false,
  renderContent = true,
  children,
}: HeroSectionProps) {
  return (
    <section className={`relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background ${className}`}>
      <div className="hero-bg pointer-events-none fixed inset-0 h-screen w-screen overflow-hidden" />

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
                className={`rounded-full border border-border/70 bg-foreground px-6 py-4 text-sm font-medium text-background transition duration-300 hover:bg-foreground/90 sm:px-8 ${buttonClassName}`}
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
