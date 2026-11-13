/**
 * The plain sentences a student reads about a study pack (design section 7).
 * Counts, plus each skipped or left-out item by its title and reason; no file
 * names, no ids. Nothing here says "newer": a pack's age cannot be proved from
 * its contents.
 */
import type { StudyPackExportSummary, StudyPackProgress, StudyPackNamedItem, StudyPackPreview, StudyPackResult } from "@/data/studyPack";

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "14 guides · 280 cards · 140 practice questions · 31 videos · 14 PDFs"; zero parts dropped. */
export function packContentsLine(p: StudyPackPreview): string {
  return [
    p.guides ? n(p.guides, "guide", "guides") : null,
    p.cards ? n(p.cards, "card", "cards") : null,
    p.questions ? n(p.questions, "practice question", "practice questions") : null,
    p.videos ? n(p.videos, "video", "videos") : null,
    p.documents ? n(p.documents, "PDF", "PDFs") : null,
  ].filter((part): part is string => part !== null).join(" · ");
}

export function packAlreadyHaveLine(p: StudyPackPreview): string | null {
  if (p.alreadyInLibrary <= 0) return null;
  return `${n(p.alreadyInLibrary, "item", "items")} (guides, PDFs and practice sets) ${p.alreadyInLibrary === 1 ? "is" : "are"} already in your library.`;
}

/** Title shown when nothing in the pack would be (or was) added. */
export const ALREADY_TITLE = "Already in your library";

/** "Handbook — already in your library", one line per named item. */
export function namedItemLines(items: readonly StudyPackNamedItem[] | undefined): string[] {
  return (items ?? []).map((item) => `${item.title} — ${item.reason}`);
}

/** Shown while a big pack is being read or added. */
export const WAIT_LINE = "Large packs can take several minutes. Keep the app open.";

/** Shown while a study pack is being saved (no step counts are reported for saving). */
export const SAVING_LINE = "Saving study pack… this can take a few minutes for a big library. Keep the app open.";

/** Shown while adding, before the first step is reported. */
export const ADDING_LINE = "Adding study pack… this can take a few minutes.";

/** "Copying PDFs… 3 of 14" while a pack is being added. */
export function progressLine(p: StudyPackProgress | null): string | null {
  if (!p) return null;
  const count = p.total > 0 && p.stage !== "saving" ? ` ${Math.min(p.done + 1, p.total)} of ${p.total}` : "";
  switch (p.stage) {
    case "copying": return `Copying PDFs…${count}`;
    case "adding": return "Adding PDFs to your library…";
    case "checking": return `Checking PDFs…${count}`;
    case "saving": return "Adding guides, flashcards and questions…";
    default: return null;
  }
}

/** "Added 11 guides, 3 PDFs, 200 flashcards and 30 practice questions."; zero parts dropped. */
export function addedLine(r: StudyPackResult): string {
  const parts = [
    r.addedGuides ? n(r.addedGuides, "guide", "guides") : null,
    r.addedDocuments ? n(r.addedDocuments, "PDF", "PDFs") : null,
    r.addedCards ? n(r.addedCards, "flashcard", "flashcards") : null,
    r.addedQuestions ? n(r.addedQuestions, "practice question", "practice questions") : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0 && r.added > 0) return "Your study pack was added. Your own work wasn't changed.";
  if (parts.length === 0) return "Everything in this study pack was already in your library. Nothing was changed.";
  const listed = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `Added ${listed}. Your own work wasn't changed.`;
}

/** The summary shown after adding: the "Added" line, then only the lines that apply. */
export function resultLines(r: StudyPackResult): string[] {
  const lines = [addedLine(r)];
  if (r.newVersions > 0) {
    lines.push(
      r.newVersions === 1
        ? "1 is another version of something you have, added next to yours with a label."
        : `${r.newVersions} are other versions of things you have, added next to yours with a label.`,
    );
  }
  if (r.readded > 0) {
    lines.push(r.readded === 1 ? "1 you had removed was added back." : `${r.readded} you had removed were added back.`);
  }
  const named = namedItemLines(r.skippedItems);
  // Named items already say which cards were left out and why.
  const cardsLeftOut = named.length > 0 ? 0 : r.cardsLeftOut;
  const removed = Math.min(r.cardsLeftOutRemoved, cardsLeftOut);
  const other = cardsLeftOut - removed;
  if (removed > 0) {
    lines.push(
      removed === 1
        ? "1 picture card was left out because you removed its picture."
        : `${removed} picture cards were left out because you removed their picture.`,
    );
  }
  if (other > 0) {
    lines.push(
      other === 1
        ? "1 picture card was left out because its picture couldn't be used."
        : `${other} picture cards were left out because their picture couldn't be used.`,
    );
  }
  return [...lines, ...namedItemLines(r.labelledItems), ...named];
}

/** After sharing: what went into the pack, so the sender can check it before sending. */
export function packSavedSentence(s: StudyPackExportSummary): string {
  const contents = packContentsLine({ ...s, alreadyInLibrary: 0, skippedItems: [], labelledItems: [], nothingNew: false });
  const left = s.cardsLeftOut > 0
    ? (s.cardsLeftOut === 1
      ? " 1 picture card was left out because its picture couldn't be shared."
      : ` ${s.cardsLeftOut} picture cards were left out because their pictures couldn't be shared.`)
    : "";
  return `Your study pack is saved${contents ? `: ${contents}` : ""}.${left}`;
}
