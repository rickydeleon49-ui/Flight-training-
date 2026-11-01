/**
 * What this device can do. The Mac app and a future iPhone app share one
 * codebase; this is the single place that decides which features show.
 */
import { isTauri } from "@/data";
import { isMacOS as looksLikeMac } from "@/lib/platform";

/** Flipped on when the iPhone app can open what the Mac sends. */
export const IPHONE_SEND_ENABLED = false;

const userAgent = (): string => (typeof navigator === "undefined" ? "" : navigator.userAgent || "");

export function isIOS(): boolean {
  const ua = userAgent();
  const touch = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints || 0;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && touch > 1);
}

/** A real Mac: the shared check in src/lib/platform.ts, minus iPads that report as Macs. */
export function isMacOS(): boolean {
  return looksLikeMac() && !isIOS();
}

export function deviceCan() {
  return {
    sendToIphone: isTauri() && isMacOS() && IPHONE_SEND_ENABLED,
    getStudyMaterial: isTauri() && isIOS(),
    importFiles: !isIOS(),
    generate: !isIOS(),
    revealFiles: !isIOS(),
  };
}
