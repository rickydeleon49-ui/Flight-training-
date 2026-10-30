/**
 * Plain wording for offline study readiness (OFFLINE-01 proposal §4.4).
 *
 * Exact counts, and a specific reason only when it is known: pages that are
 * images say so; anything else that couldn't be read gets neutral wording,
 * never a guess. A page that is an image is not called "scanned".
 */
import type { OfflineReadiness } from "@/services/offlineContent";

export type ReadinessTone = "neutral" | "complete" | "due";

export interface ReadinessWording {
  /** Short label for a badge. */
  label: string;
  /** One or two plain sentences for the material page. */
  detail: string;
  tone: ReadinessTone;
  /** Whether "Read this PDF's text" makes sense now. */
  canPrepare: boolean;
  /** Whether the state will change by itself soon (worth checking again). */
  settling: boolean;
}

/**
 * Native limit on input file size for text extraction (128 MiB).
 * Kept in sync with `MAX_INPUT_BYTES` in `src-tauri/src/extraction/worker.rs`.
 */
export const MAX_OFFLINE_INPUT_BYTES = 128 * 1024 * 1024;
export const MAX_INPUT_BYTES = MAX_OFFLINE_INPUT_BYTES;

const pages = (n: number) => `${n} page${n === 1 ? "" : "s"}`;

/** Friendly reasons for a whole-file refusal. Unknown codes stay generic. */
const REFUSALS: Record<string, string> = {
  encrypted: "It's password-protected, so its text can't be read.",
  malformed: "It doesn't look like a complete PDF.",
  input_too_large: "It's too large to read in one piece. Try splitting it into chapters first.",
  memory_limit: "It needs more memory than reading on this Mac allows. Try splitting it into chapters first.",
  total_text_limit: "It has more text than offline search can hold in one document. Try splitting it into chapters first.",
};

export function describeReadiness(r: OfflineReadiness): ReadinessWording {
  switch (r.state) {
    case "unsupported":
      return {
        label: "Not a PDF",
        detail: "Reading text works with PDFs for now.",
        tone: "neutral",
        canPrepare: false,
        settling: false,
      };
    case "missing":
      return {
        label: "File missing",
        detail: "This file isn't on this Mac right now, so it can't be read.",
        tone: "due",
        canPrepare: false,
        settling: false,
      };
    case "checking":
      return {
        label: "Checking…",
        detail: "Checking this file on your Mac…",
        tone: "neutral",
        canPrepare: false,
        settling: true,
      };
    case "notPrepared":
      return {
        label: "Not read yet",
        detail:
          "This PDF isn't ready to search on your Mac yet. Choose “Read it now” below once, then you can search its text without internet. Nothing is sent anywhere.",
        tone: "neutral",
        canPrepare: true,
        settling: false,
      };
    case "preparing":
      return {
        label: "Reading text…",
        detail: "Reading this file's text on your Mac…",
        tone: "neutral",
        canPrepare: false,
        settling: true,
      };
    case "searchable":
      return {
        label: "Text read",
        detail: `Text read on this Mac: all ${pages(r.pages)}.`,
        tone: "complete",
        canPrepare: false,
        settling: false,
      };
    case "partial": {
      const base = `Text read on ${r.searchable} of ${pages(r.pages)}.`;
      const reason =
        r.reason === "imagePages"
          ? ` ${pages(r.imagePages)} ${r.imagePages === 1 ? "is an image" : "are images"}; text recognition would be needed to search ${r.imagePages === 1 ? "it" : "them"}.`
          : " Some pages couldn't be read.";
      return {
        label: "Partly read",
        detail: base + reason,
        tone: "due",
        canPrepare: false,
        settling: false,
      };
    }
    case "couldNotProcess":
      return {
        label: "Could not read",
        detail: `This file couldn't be read on this Mac. ${REFUSALS[r.code] ?? "Something in it couldn't be read."}`,
        tone: "due",
        canPrepare: false,
        settling: false,
      };
  }
}
