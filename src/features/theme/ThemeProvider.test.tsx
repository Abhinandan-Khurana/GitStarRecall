import { act, render, screen } from "@testing-library/react";
import { ThemeProvider } from "./ThemeProvider";
import { useTheme } from "./useTheme";

function ThemeProbe() {
  const { mode, resolvedTheme, setMode } = useTheme();
  return (
    <>
      <output>{`${mode}:${resolvedTheme}`}</output>
      <button type="button" onClick={() => setMode("light")}>
        Light
      </button>
    </>
  );
}

describe("ThemeProvider browser API fallbacks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.theme;
  });

  it("renders a valid fallback theme when localStorage reads throw and matchMedia is absent", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.stubGlobal("matchMedia", undefined);

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByText("system:dark")).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("keeps theme updates usable when localStorage writes and matchMedia throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.stubGlobal("matchMedia", () => {
      throw new Error("unavailable");
    });

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    act(() => screen.getByRole("button", { name: "Light" }).click());

    expect(screen.getByText("light:light")).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
