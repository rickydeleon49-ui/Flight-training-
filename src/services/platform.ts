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

/**
 * `geminiKey`: may store a key on this device. `generate`: may send files to Gemini.
 */
export function deviceCan() {
  return {
    geminiKey: isTauri(),
    renderPdfPage: isTauri() && isMacOS(),
    sendToIphone: isTauri() && isMacOS() && IPHONE_SEND_ENABLED,
    getStudyMaterial: isTauri() && isIOS(),
    savePhoneWork: isTauri() && isIOS(),
    pictureFromPhoto: isTauri() && isIOS(),
    importFiles: !isIOS() || isTauri(),
    /** Splitting a PDF into parts needs the Mac for now. */
    splitFiles: !isIOS(),
    generate: !isIOS() || isTauri(),
    /** Reading a PDF's text on this device (study kit, offline text) needs the Mac until P-2. */
    pdfKit: !isIOS(),
    revealFiles: !isIOS(),
    editStudyMaterial: !isIOS(),
    sharePrint: !isIOS(),
  };
}
