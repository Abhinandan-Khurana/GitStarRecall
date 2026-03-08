import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/features/theme/useTheme";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ThemeToggleButtonProps = {
  /** Show "Light"/"Dark" (or "Light mode"/"Dark mode") next to the icon. Default: icon only (landing style). */
  showLabel?: boolean;
  /** Use "Light mode"/"Dark mode" when showLabel is true. */
  longLabel?: boolean;
  className?: string;
};

const glassClass =
  "rounded-full border-white/25 bg-white/10 backdrop-blur-md text-foreground hover:bg-white/20 hover:text-foreground active:bg-white/25 active:text-foreground dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 dark:active:bg-white/15";

export function ThemeToggleButton({
  showLabel = false,
  longLabel = false,
  className,
}: ThemeToggleButtonProps) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const label = longLabel
    ? resolvedTheme === "dark"
      ? "Light mode"
      : "Dark mode"
    : resolvedTheme === "dark"
      ? "Light"
      : "Dark";

  if (showLabel) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={cn(glassClass, "flex-1 px-4", className)}
        onClick={toggleTheme}
        aria-label={`Toggle theme, currently ${resolvedTheme}`}
      >
        {resolvedTheme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
        {label}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="icon"
      className={cn(glassClass, className)}
      onClick={toggleTheme}
      aria-label={`Toggle theme, currently ${resolvedTheme}`}
    >
      {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
