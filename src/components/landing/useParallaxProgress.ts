import { useEffect, useState } from "react";

type ParallaxProgressOptions = {
  start?: number;
  end?: number;
};

type ParallaxProgressResult = {
  progress: number;
  reducedMotion: boolean;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function useParallaxProgress(options: ParallaxProgressOptions = {}): ParallaxProgressResult {
  const { start = 0, end = 1 } = options;
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handlePreferenceChange = () => {
      setReducedMotion(mediaQuery.matches);
    };
    handlePreferenceChange();
    mediaQuery.addEventListener("change", handlePreferenceChange);

    let frameId = 0;

    const update = () => {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const normalized = clamp(window.scrollY / maxScroll);
      const ranged = clamp((normalized - start) / Math.max(0.001, end - start));
      setProgress(ranged);
      frameId = 0;
    };

    const requestUpdate = () => {
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      mediaQuery.removeEventListener("change", handlePreferenceChange);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [end, start]);

  return {
    progress,
    reducedMotion,
  };
}
