import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const VARIANTS = [
  { name: "light", theme: "light", colorScheme: "light", reducedMotion: "no-preference" },
  { name: "dark", theme: "dark", colorScheme: "dark", reducedMotion: "no-preference" },
  { name: "reduced-motion", theme: "light", colorScheme: "light", reducedMotion: "reduce" },
] as const;

const STABLE_SCREENSHOT_CSS = `
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    animation-iteration-count: 1 !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
  }
`;

for (const viewport of VIEWPORTS) {
  for (const variant of VARIANTS) {
    test(`${viewport.name} landing baseline in ${variant.name} mode`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({
        colorScheme: variant.colorScheme,
        reducedMotion: variant.reducedMotion,
      });
      await page.addInitScript((theme) => {
        window.localStorage.setItem("gitstarrecall.theme", theme);
      }, variant.theme);

      await page.goto("/", { waitUntil: "networkidle" });
      await page.addStyleTag({ content: STABLE_SCREENSHOT_CSS });
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo(0, 0);
      });

      await expect(page).toHaveScreenshot(
        `landing-${viewport.width}x${viewport.height}-${variant.name}.png`,
        {
          animations: "disabled",
          fullPage: false,
        },
      );
    });
  }
}
