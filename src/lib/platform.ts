/**
 * Platform detection for user-facing guidance.
 *
 * Distinguishes macOS from Windows and other environments so instructions
 * refer to the correct system paths and file managers (e.g. Application Support
 * and Finder vs. AppData and File Explorer) without showing irrelevant steps.
 */
export function isMacOS(platformString?: string): boolean {
  const target =
    platformString !== undefined
      ? platformString
      : typeof navigator === "undefined"
        ? ""
        : `${navigator.platform || ""} ${navigator.userAgent || ""}`;

  if (/iphone|ipad|ipod|ios/i.test(target)) {
    return false;
  }
  return /macintel|macintosh|mac os x|macppc|mac68k/i.test(target) || (/(?:^|[^a-z])mac(?:[^a-z]|$)/i.test(target) && !/machine/i.test(target));
}

export function isWindowsOS(platformString?: string): boolean {
  const target =
    platformString !== undefined
      ? platformString
      : typeof navigator === "undefined"
        ? ""
        : `${navigator.platform || ""} ${navigator.userAgent || ""}`;

  return /win32|win64|windows|wince/i.test(target);
}

/** Short device name for live guidance; never use in saved provenance. */
export function deviceWord(): "Mac" | "PC" | "computer" {
  if (isWindowsOS()) return "PC";
  const touch = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints || 0;
  const darwin = typeof navigator !== "undefined" && /\bdarwin\b/i.test(navigator.userAgent || "");
  return (isMacOS() || darwin) && touch < 2 ? "Mac" : "computer";
}
