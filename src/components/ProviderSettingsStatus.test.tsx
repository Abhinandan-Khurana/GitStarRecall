import { render, screen } from "@testing-library/react";
import { ProviderSettingsStatus } from "./ProviderSettingsStatus";

describe("ProviderSettingsStatus", () => {
  test("announces save errors with destructive styling", () => {
    render(<ProviderSettingsStatus saveState="error" message="Provider settings not saved" />);

    const status = screen.getByText("Provider settings not saved");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveClass("text-destructive");
  });

  test("announces non-error save state without destructive styling", () => {
    render(<ProviderSettingsStatus saveState="saved" message="Provider settings saved." />);

    const status = screen.getByText("Provider settings saved.");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveClass("text-muted-foreground");
    expect(status).not.toHaveClass("text-destructive");
  });
});
