import { useEffect, useLayoutEffect, useMemo, useState, type PropsWithChildren } from "react";
import { ThemeContext, type ThemeContextValue } from "@/features/theme/ThemeContext";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "gitstarrecall.theme";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }

  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

function loadThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }

  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return "system";
  }
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }

  return "system";
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") {
    return getSystemTheme();
  }

  return mode;
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setMode] = useState<ThemeMode>(() => loadThemeMode());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(loadThemeMode()),
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (typeof window.matchMedia !== "function") {
      return;
    }

    let media: MediaQueryList;
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const handleChange = () => {
      if (mode === "system") {
        setResolvedTheme(resolveTheme("system"));
      }
    };

    media.addEventListener?.("change", handleChange);
    return () => {
      media.removeEventListener?.("change", handleChange);
    };
  }, [mode]);

  useEffect(() => {
    setResolvedTheme(resolveTheme(mode));
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        // Storage can be unavailable in private or restricted browser contexts.
      }
    }
  }, [mode]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolvedTheme,
      setMode,
      toggleTheme: () => {
        setMode((current) => {
          const next = resolveTheme(current) === "dark" ? "light" : "dark";
          return next;
        });
      },
    }),
    [mode, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
