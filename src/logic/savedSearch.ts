/**
 * Saved study content in offline search (OFFLINE-02c; addendum
 * docs/OFFLINE_02C_SAVED_CONTENT_SEARCH_ADDENDUM_2026-10-19.md).
 *
 * Results open the actual item. A guide section or card is identified by its
 * index plus a digest of its own text, so a link from a search made before
 * she regenerated the guide never opens different text.
 */
import type { AppData } from "@/state/AppDataContext";
import type { SavedCoverage, SavedPassage } from "@/services/offlineContent";

/**
 * The item digest (§4): lowercase hex SHA-256 of each field as its UTF-8 byte
 * length in decimal, ":", then its bytes, concatenated. Same as the native
 * `item_digest`.
 */
export async function itemDigest(fields: string[]): Promise<string> {
  const encoder = new TextEncoder();
  const parts = fields.flatMap((field) => {
    const bytes = encoder.encode(field);
    return [encoder.encode(`${bytes.length}:`), bytes];
  });
  const total = parts.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    joined.set(p, at);
    at += p.length;
  }
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

const KIND_LABELS: Record<SavedPassage["kind"], string> = {
  summary: "Guide summary",
  guide: "Study guide",
  card: "Flashcard",
  practice: "Practice question",
  note: "Note",
  question: "Instructor question",
};

export function savedKindLabel(kind: SavedPassage["kind"]): string {
  return KIND_LABELS[kind];
}

/** Where a saved hit opens. `materialId` is the group's material, if any. */
export function savedDestination(passage: SavedPassage, materialId: string | null): string | null {
  const rev = passage.rev ? `&rev=${encodeURIComponent(passage.rev)}` : "";
  const id = encodeURIComponent(passage.recordId);
  switch (passage.kind) {
    case "summary":
      return materialId ? `/study/${encodeURIComponent(materialId)}?guide=summary${rev}` : null;
    case "guide":
      return materialId ? `/study/${encodeURIComponent(materialId)}?guide=${id}${rev}` : null;
    case "card":
      return materialId ? `/study/${encodeURIComponent(materialId)}?card=${id}${rev}` : null;
    case "practice":
      return materialId ? `/study/${encodeURIComponent(materialId)}?question=${id}` : null;
    case "note":
      return `/notes?note=${id}`;
    case "question":
      return `/questions?question=${id}`;
  }
}

export type SavedCheck = "ok" | "changed" | "gone";

/**
 * Confirm against the app's loaded data that a hit still points at what
 * matched (§4). Practice items aren't in the loaded data; their page checks.
 */
export async function checkSavedHit(data: Pick<AppData, "aiStudySets" | "notes" | "questions">, passage: SavedPassage, materialId: string | null): Promise<SavedCheck> {
  switch (passage.kind) {
    case "note":
      return data.notes.some((n) => n.id === passage.recordId) ? "ok" : "gone";
    case "question":
      return data.questions.some((q) => q.id === passage.recordId) ? "ok" : "gone";
    case "practice":
      return "ok";
    default: {
      const set = data.aiStudySets.find((s) => s.sourceMaterialId === materialId);
      if (!set) return "gone";
      const fields = savedFields(set, passage);
      if (!fields) return "changed";
      return (await itemDigest(fields)) === passage.rev ? "ok" : "changed";
    }
  }
}

/** The original fields of a guide or card item, or null if the index is gone. */
export function savedFields(set: { summary: string; sections: Array<{ heading: string; body: string }>; flashcards: Array<{ front: string; back: string }> }, passage: Pick<SavedPassage, "kind" | "recordId">): string[] | null {
  if (passage.kind === "summary") return [set.summary];
  const index = Number(passage.recordId);
  if (!Number.isInteger(index) || index < 0) return null;
  if (passage.kind === "guide") {
    const s = set.sections[index];
    return s ? [s.heading, s.body] : null;
  }
  if (passage.kind === "card") {
    const c = set.flashcards[index];
    return c ? [c.front, c.back] : null;
  }
  return null;
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What saved content was searched, or why it wasn't. */
export function savedCoverageSentence(state: string, c: SavedCoverage, found: number): string {
  if (state === "too_large") return "Your saved study content is too large to search offline in one go.";
  if (state === "unavailable") return "Your saved study content can't be searched just now. Try again in a moment.";
  const searched = [
    c.studySets > 0 ? count(c.studySets, "study guide", "study guides") : null,
    c.practiceVersions > 0 ? count(c.practiceVersions, "practice test", "practice tests") : null,
    c.notes > 0 ? count(c.notes, "note", "notes") : null,
    c.questions > 0 ? count(c.questions, "instructor question", "instructor questions") : null,
  ].filter(Boolean);
  const what = searched.length > 0 ? searched.join(", ") : "nothing saved yet";
  const lead = found === 0 ? `No matches in your saved study content (${what}).` : `Searched your saved study content (${what}).`;
  const tooLarge = c.tooLargeItems > 0 ? ` ${count(c.tooLargeItems, "item is", "items are")} too large to search.` : "";
  return lead + tooLarge;
}

export function savedProblem(check: Exclude<SavedCheck, "ok">): string {
  return check === "changed"
    ? "This study guide has changed since you searched. Search again to find it."
    : "That item isn't here any more.";
}
