/**
 * OFFLINE-03a: between a saved study set and the authoring core. Reads a set
 * into stable items, turns an edited state back into the set to store, and
 * merges a regenerated set with her own items. Nothing here writes.
 */
import type { AiStudySet, StudySetProvider } from "@/domain/types";
import type { NextStudySet } from "@/data/studySetTransaction";
import {
  appendRetirements,
  assignItemIds,
  previewRegeneration,
  type AuthoringState,
  type DraftItem,
  type PreviewItem,
  type StudyItem,
} from "./studyAuthoring";

/** The parts of a set the authoring core does not edit. */
export interface SetFrame {
  title: string;
  sourceNotes: string;
  provider: StudySetProvider;
  model: string;
}

export const frameOf = (set: AiStudySet): SetFrame => ({
  title: set.title,
  sourceNotes: set.sourceNotes,
  provider: set.provider,
  model: set.model,
});

/**
 * A saved set as stable items: the summary is always the material-scoped
 * item `summary`; legacy sections and cards receive ids here, the first time
 * the set is edited. Refuses (invalid_content) rather than drop anything it
 * cannot represent.
 */
export function authoringStateOf(set: Pick<AiStudySet, "summary" | "summaryOrigin" | "sections" | "flashcards" | "retired">): AuthoringState {
  const drafts: DraftItem[] = [
    { kind: "summary", itemId: "summary", fields: [set.summary], ...(set.summaryOrigin ? { origin: set.summaryOrigin } : {}) },
    ...set.sections.map((section): DraftItem => ({
      kind: "section",
      fields: [section.heading, section.body],
      ...(section.itemId !== undefined ? { itemId: section.itemId } : {}),
      ...(section.origin !== undefined ? { origin: section.origin } : {}),
      ...(section.replaces !== undefined ? { replaces: section.replaces } : {}),
    })),
    ...set.flashcards.map((card): DraftItem => ({
      kind: "card",
      fields: [card.front, card.back],
      sourcePage: card.sourcePage,
      ...(card.itemId !== undefined ? { itemId: card.itemId } : {}),
      ...(card.origin !== undefined ? { origin: card.origin } : {}),
      ...(card.replaces !== undefined ? { replaces: card.replaces } : {}),
    })),
  ];
  return Object.freeze({ items: assignItemIds(drafts), retired: appendRetirements(set.retired ?? [], []) });
}

/** The set to store for an authoring state. A deleted summary stores as empty. */
export function nextSetOf(frame: SetFrame, state: AuthoringState): NextStudySet {
  const summary = state.items.find((item) => item.kind === "summary");
  const identity = (item: StudyItem) => ({
    itemId: item.itemId,
    ...(item.origin ? { origin: item.origin } : {}),
    ...(item.replaces !== undefined ? { replaces: item.replaces } : {}),
  });
  return {
    title: frame.title,
    summary: summary?.fields[0] ?? "",
    summaryOrigin: summary?.origin ?? null,
    sections: state.items
      .filter((item) => item.kind === "section")
      .map((item) => ({ heading: item.fields[0]!, body: item.fields[1]!, ...identity(item) })),
    flashcards: state.items
      .filter((item) => item.kind === "card")
      .map((item) => ({ front: item.fields[0]!, back: item.fields[1]!, sourcePage: item.sourcePage ?? null, ...identity(item) })),
    sourceNotes: frame.sourceNotes,
    provider: frame.provider,
    model: frame.model,
    retired: state.retired.map((entry) => ({ ...entry, terms: [...entry.terms] })),
  };
}

/** A new, empty set she will write herself. */
export function emptyManualSet(title: string): { frame: SetFrame; state: AuthoringState } {
  return {
    frame: { title, sourceNotes: "", provider: "manual", model: "" },
    state: authoringStateOf({ summary: "", summaryOrigin: null, sections: [], flashcards: [], retired: [] }),
  };
}

/**
 * Whether regenerating this set needs her review first: it holds her own
 * items, records something she retired, or is entirely hers.
 */
export function needsRegenerationReview(set: Pick<AiStudySet, "provider" | "summaryOrigin" | "sections" | "flashcards" | "retired"> | undefined): boolean {
  if (!set) return false;
  return (
    set.provider === "manual" ||
    Boolean(set.summaryOrigin) ||
    (set.retired?.length ?? 0) > 0 ||
    set.sections.some((section) => section.origin !== undefined) ||
    set.flashcards.some((card) => card.origin !== undefined)
  );
}

/** Generated or imported content offered to replace part of a set. */
export interface GeneratedContent {
  summary: string;
  sections: readonly { heading: string; body: string }[];
  flashcards: readonly { front: string; back: string; sourcePage: number | null }[];
}

/** The candidates of a regenerated set, classified against what she retired. */
export async function regenerationPreview(current: AuthoringState, generated: GeneratedContent): Promise<readonly PreviewItem[]> {
  const candidates = assignItemIds([
    ...(generated.summary.trim() ? [{ kind: "summary" as const, itemId: "summary", fields: [generated.summary] }] : []),
    ...generated.sections.map((section) => ({ kind: "section" as const, fields: [section.heading, section.body] })),
    ...generated.flashcards.map((card) => ({ kind: "card" as const, fields: [card.front, card.back], sourcePage: card.sourcePage })),
  ]);
  return previewRegeneration(candidates, current.retired);
}

export type RegenerationMode = "keep" | "replace";

/**
 * Merge resolved candidates into a set. "keep" (the default) keeps every
 * item she wrote or corrected after the new ones of its kind, and keeps her
 * summary when `keepMySummary`; "replace" keeps only the new items. Either
 * way her earlier set is in history, and her retirement list carries over.
 */
export function mergeRegeneration(
  current: AuthoringState,
  resolved: readonly StudyItem[],
  mode: RegenerationMode,
  keepMySummary: boolean,
): AuthoringState {
  const mine = (item: StudyItem) => item.origin !== undefined;
  const currentSummary = current.items.find((item) => item.kind === "summary");
  const newSummary = resolved.find((item) => item.kind === "summary");
  let summary: StudyItem | undefined;
  if (mode === "keep" && currentSummary && mine(currentSummary) && keepMySummary) summary = currentSummary;
  else if (newSummary) summary = newSummary;
  else if (mode === "keep" && currentSummary) summary = currentSummary;
  const ofKind = (kind: StudyItem["kind"]) => [
    ...resolved.filter((item) => item.kind === kind),
    ...(mode === "keep" ? current.items.filter((item) => item.kind === kind && mine(item)) : []),
  ];
  const drafts: DraftItem[] = [
    summary ?? { kind: "summary", itemId: "summary", fields: [""] },
    ...ofKind("section"),
    ...ofKind("card"),
  ];
  return Object.freeze({ items: assignItemIds(drafts), retired: current.retired });
}

/** Who wrote an item, in her words; null for generated or imported items. */
export function itemAuthorLabel(origin: unknown): string | null {
  if (origin === undefined || origin === null) return null;
  if (origin === "user") return "Written by you";
  if (origin === "instructor") return "Instructor correction";
  return "Author unknown";
}
