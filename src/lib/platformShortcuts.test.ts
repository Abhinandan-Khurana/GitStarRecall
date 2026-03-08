import { describe, expect, it } from "vitest";
import {
  detectShortcutPlatform,
  formatPrimaryModifierShortcut,
  getPrimaryModifierLabel,
} from "./platformShortcuts";

describe("platformShortcuts", () => {
  it("detects macOS from navigator platform hints", () => {
    expect(
      detectShortcutPlatform({
        userAgentData: { platform: "macOS" },
      }),
    ).toBe("mac");
  });

  it("detects Windows and Linux from fallback platform strings", () => {
    expect(
      detectShortcutPlatform({
        platform: "Win32",
      }),
    ).toBe("windows");
    expect(
      detectShortcutPlatform({
        platform: "Linux x86_64",
      }),
    ).toBe("linux");
  });

  it("formats the primary modifier for the active platform", () => {
    expect(getPrimaryModifierLabel("mac")).toBe("Cmd");
    expect(getPrimaryModifierLabel("windows")).toBe("Ctrl");
    expect(formatPrimaryModifierShortcut("K", "mac")).toBe("Cmd+K");
    expect(formatPrimaryModifierShortcut(",", "linux")).toBe("Ctrl+,");
  });
});
