import type { ProviderSettingsSaveState } from "../lib/settings";

type ProviderSettingsStatusProps = {
  saveState: ProviderSettingsSaveState;
  message: string;
};

export function ProviderSettingsStatus({
  saveState,
  message,
}: Readonly<ProviderSettingsStatusProps>) {
  return (
    <p
      aria-live="polite"
      className={`text-xs ${saveState === "error" ? "text-destructive" : "text-muted-foreground"}`}
    >
      {message}
    </p>
  );
}
