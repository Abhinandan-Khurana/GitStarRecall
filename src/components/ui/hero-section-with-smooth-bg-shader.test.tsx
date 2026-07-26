import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HeroSection } from "@/components/ui/hero-section-with-smooth-bg-shader";

describe("HeroSection", () => {
  it("renders the supplied call to action and invokes it once when selected", async () => {
    const user = userEvent.setup();
    const onButtonClick = vi.fn();

    const { rerender } = render(
      <HeroSection
        title="Recall the right repository"
        buttonText="Connect GitHub"
        onButtonClick={onButtonClick}
      />,
    );

    expect(screen.getByRole("heading", { name: "Recall the right repository" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Connect GitHub" }));

    expect(onButtonClick).toHaveBeenCalledOnce();

    rerender(<HeroSection title="No action required" buttonText="" />);

    expect(screen.getByRole("heading", { name: "No action required" })).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(
      <HeroSection renderContent={false}>
        <p>Custom hero content</p>
      </HeroSection>,
    );

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("Custom hero content")).toBeVisible();
  });
});
