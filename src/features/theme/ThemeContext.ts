import { createContext } from "react";
import type { ResolvedTheme, ThemeMode } from "@/features/theme/ThemeProvider";

export type ThemeContextValue = {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);
