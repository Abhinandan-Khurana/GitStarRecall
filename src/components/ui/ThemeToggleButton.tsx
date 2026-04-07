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

const toggleClass =
  "rounded-full border-border text-foreground hover:bg-muted hover:text-foreground active:bg-muted";

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
        className={cn(toggleClass, "flex-1 px-4", className)}
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
      className={cn(toggleClass, className)}
      onClick={toggleTheme}
      aria-label={`Toggle theme, currently ${resolvedTheme}`}
    >
      {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
