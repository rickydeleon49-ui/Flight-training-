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
  /** Whether "Prepare for offline study" makes sense now. */
  canPrepare: boolean;
  /** Whether the state will change by itself soon (worth checking again). */
  settling: boolean;
}

const pages = (n: number) => `${n} page${n === 1 ? "" : "s"}`;

/** Friendly reasons for a whole-file refusal. Unknown codes stay generic. */
const REFUSALS: Record<string, string> = {
  encrypted: "It's password-protected, so its text can't be read.",
  malformed: "It doesn't look like a complete PDF.",
  input_too_large: "It's too large to prepare in one piece. Try splitting it into chapters first.",
  memory_limit: "It needs more memory than offline preparation allows. Try splitting it into chapters first.",
  total_text_limit: "It has more text than offline search can hold in one document. Try splitting it into chapters first.",
};

export function describeReadiness(r: OfflineReadiness): ReadinessWording {
  switch (r.state) {
    case "unsupported":
      return {
        label: "Not a PDF",
        detail: "Offline search preparation works with PDFs for now.",
        tone: "neutral",
        canPrepare: false,
        settling: false,
      };
    case "missing":
      return {
        label: "File missing",
        detail: "This file isn't on this Mac right now, so it can't be prepared.",
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
        label: "Not prepared",
        detail: "Not ready for offline search yet. Preparing reads the text on your Mac; nothing is sent anywhere.",
        tone: "neutral",
        canPrepare: true,
        settling: false,
      };
    case "preparing":
      return {
        label: "Preparing search",
        detail: "Preparing this file for offline search on your Mac…",
        tone: "neutral",
        canPrepare: false,
        settling: true,
      };
    case "searchable":
      return {
        label: "Searchable",
        detail: `Ready for offline search: all ${pages(r.pages)}.`,
        tone: "complete",
        canPrepare: false,
        settling: false,
      };
    case "partial": {
      const base = `Ready for offline search on ${r.searchable} of ${pages(r.pages)}.`;
      const reason =
        r.reason === "imagePages"
          ? ` ${pages(r.imagePages)} ${r.imagePages === 1 ? "is an image" : "are images"}; text recognition would be needed to search ${r.imagePages === 1 ? "it" : "them"}.`
          : " Some pages couldn't be read.";
      return {
        label: "Partly searchable",
        detail: base + reason,
        tone: "due",
        canPrepare: false,
        settling: false,
      };
    }
    case "couldNotProcess":
      return {
        label: "Could not prepare",
        detail: `This file couldn't be prepared for offline search. ${REFUSALS[r.code] ?? "Something in it couldn't be read."}`,
        tone: "due",
        canPrepare: false,
        settling: false,
      };
  }
}
