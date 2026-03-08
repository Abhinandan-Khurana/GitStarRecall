export type ShortcutPlatform = "mac" | "windows" | "linux" | "other";

type NavigatorLike = {
  platform?: string;
  userAgent?: string;
  userAgentData?: {
    platform?: string;
  };
};

export function detectShortcutPlatform(navigatorLike?: NavigatorLike): ShortcutPlatform {
  const platformValue = navigatorLike?.userAgentData?.platform ?? navigatorLike?.platform ?? "";
  const userAgentValue = navigatorLike?.userAgent ?? "";
  const normalized = `${platformValue} ${userAgentValue}`.toLowerCase();

  if (normalized.includes("mac")) {
    return "mac";
  }
  if (normalized.includes("win")) {
    return "windows";
  }
  if (normalized.includes("linux") || normalized.includes("x11")) {
    return "linux";
  }
  return "other";
}

export function detectClientShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === "undefined") {
    return "other";
  }
  return detectShortcutPlatform(navigator);
}

export function getPrimaryModifierLabel(platform: ShortcutPlatform): string {
  return platform === "mac" ? "Cmd" : "Ctrl";
}

export function formatPrimaryModifierShortcut(
  key: string,
  platform: ShortcutPlatform = detectClientShortcutPlatform(),
): string {
  return `${getPrimaryModifierLabel(platform)}+${key}`;
}
