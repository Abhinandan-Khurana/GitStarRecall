import { fireEvent, render, screen } from "@testing-library/react";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

function BrokenPage(): never {
  throw new Error("page render failed");
}

describe("RouteErrorBoundary", () => {
  it("shows an accessible failure state and runs the reload recovery action", () => {
    const onReload = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <RouteErrorBoundary onReload={onReload}>
        <BrokenPage />
      </RouteErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Page failed to load");
    expect(alert).toHaveTextContent("reload to fetch the latest version");

    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});
