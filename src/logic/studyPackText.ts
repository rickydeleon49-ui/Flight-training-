/**
 * The plain sentences a student reads about a study pack (design section 7).
 * Counts, plus each skipped or left-out item by its title and reason; no file
 * names, no ids. Nothing here says "newer": a pack's age cannot be proved from
 * its contents.
 */
import type { StudyPackExportSummary, StudyPackNamedItem, StudyPackPreview, StudyPackResult } from "@/data/studyPack";

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
  return `${p.alreadyInLibrary} ${p.alreadyInLibrary === 1 ? "is" : "are"} already in your library.`;
}

/** Title shown when nothing in the pack would be (or was) added. */
export const ALREADY_TITLE = "Already in your library";

/** "Handbook — already in your library", one line per named item. */
export function namedItemLines(items: readonly StudyPackNamedItem[] | undefined): string[] {
  return (items ?? []).map((item) => `${item.title} — ${item.reason}`);
}

/** "Added 11 guides and 3 PDFs." from the guide and PDF counts only. */
export function addedLine(r: StudyPackResult): string {
  const parts = [
    r.addedGuides ? n(r.addedGuides, "guide", "guides") : null,
    r.addedDocuments ? n(r.addedDocuments, "PDF", "PDFs") : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0 && r.added > 0) return "Your study pack was added. Your own work wasn't changed.";
  if (parts.length === 0) return "Everything in this study pack was already in your library. Nothing was changed.";
  return `Added ${parts.join(" and ")}. Your own work wasn't changed.`;
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
  return [...lines, ...named];
}

/** After sharing: what went into the pack, so the sender can check it before sending. */
export function packSavedSentence(s: StudyPackExportSummary): string {
  const contents = packContentsLine({ ...s, alreadyInLibrary: 0, skippedItems: [], nothingNew: false });
  const left = s.cardsLeftOut > 0
    ? (s.cardsLeftOut === 1
      ? " 1 picture card was left out because its picture couldn't be shared."
      : ` ${s.cardsLeftOut} picture cards were left out because their pictures couldn't be shared.`)
    : "";
  return `Your study pack is saved${contents ? `: ${contents}` : ""}.${left}`;
}
