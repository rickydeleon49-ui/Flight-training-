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
