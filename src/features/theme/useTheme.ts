import { useContext } from "react";
import { ThemeContext, type ThemeContextValue } from "@/features/theme/ThemeContext";

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return value;
}
