import { type GeminiJob } from "@/state/GeminiJobs";
import { MATERIAL_TABS, type MaterialTab } from "./materialTabs";

export const TARGET_CARD_COUNTS = [20, 40, 60] as const;
export type TargetCardCount = (typeof TARGET_CARD_COUNTS)[number];

export type MaterialTabChoice = { value: MaterialTab };
export const MATERIAL_TAB_CHOICES = MATERIAL_TABS.map((value) => ({ value }));
/** The section where a waiting draft of this kind is reviewed. */
export function draftAnchor(job: GeminiJob): string {
  if (job.kind === "flashcards") return "material-flashcards";
  if (job.kind === "practice-test") return "material-practice-test";
  return "material-study-guide";
}

/** Shown on Make my study kit only when a guide, cards or questions are already saved. */
export const KIT_REPLACE_NOTE = "This makes a new kit. When you save, it replaces your saved guide, flashcards or questions — your earlier versions stay in Previous versions.";
export const KIT_PAGES_NOTE = "The study kit reads up to 150 pages. Pick the pages you want — they become their own item in your library, then press Make my study kit there.";
export const materialTabLabel = (value: MaterialTab) => value === "study" ? "Study" : value === "notes" ? "Notes" : "More";
export const KIT_DRAFTS_WAITING = "Save or discard your study kit drafts first.";
export const EARLIER_DRAFTS_WAITING = "Save or discard the earlier drafts first, then make a study kit.";
