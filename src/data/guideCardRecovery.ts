/** CARDS-FIX-01: conservative detection of the released guide-save wipe.
 * Entries must belong to this material and be newest first. Any intervening
 * edit/delete/import/restore or damaged row ends the evidence chain.
 */
import { canonicalJson } from "@/logic/cardIdentity";
import { decodeStoredRow, nextOfStored, type NextStudySet, type StoredSetRow } from "./studySetTransaction";

export interface RecoveryHistoryRow { id: string; kind: string; reason: string; previous_json: string }

export function guideCardRecovery(current: StoredSetRow | null, history: readonly RecoveryHistoryRow[]): NextStudySet | null {
  if (!current) return null;
  try {
    const saved = nextOfStored(current);
    if (saved.flashcards.length || !saved.summary.trim() && !saved.sections.length) return null;
    let after = saved;
    for (const entry of history) {
      if (entry.kind !== "study_set" || entry.reason !== "regenerate") return null;
      const before = nextOfStored(decodeStoredRow(JSON.parse(entry.previous_json)));
      if (after.provider !== "gemini" || canonicalJson(after.retired) !== canonicalJson(before.retired)) return null;
      if (canonicalJson([after.summary, after.sections]) === canonicalJson([before.summary, before.sections])) return null;
      if (before.flashcards.length) return { ...saved, flashcards: before.flashcards };
      after = before;
    }
  } catch { /* Damaged or ambiguous history is never a recovery offer. */ }
  return null;
}
