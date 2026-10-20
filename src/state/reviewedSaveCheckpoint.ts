/**
 * The reviewed regeneration save in flight, kept on this computer under its
 * Gemini journal job id (OFFLINE-03a).
 *
 * Saving a guide she reviewed is two writes: the study set, and the journal
 * acknowledgement that says Gemini's finished answer is no longer needed. The
 * study set can commit while the acknowledgement fails, and until the
 * acknowledgement succeeds the journal hands the same answer back after a
 * restart. Reviewing it again then merges her items a second time, under new
 * item ids, and records a second regeneration in Previous versions.
 *
 * So the exact operation is kept until the answer is acknowledged, not until
 * the study set is saved. The provider owns that lifecycle; a page only reads
 * the checkpoint to recognise a save that already happened.
 *
 * localStorage rather than the database on purpose: her set is already stored
 * safely in the database, so this only names the retry that is safe to send
 * again. A lost checkpoint can cost one extra history row; it can never lose
 * her wording.
 */
import type { NextStudySet, StoredSetRow } from "@/data/studySetTransaction";

/**
 * Her study set as she reviewed it: the set she had open and the merged set to
 * store. Its operation id makes a retry safe.
 */
export interface ReviewedRegeneration {
  operationId: string;
  expected: StoredSetRow;
  next: NextStudySet;
}

const PREFIX = "her-flight-deck.reviewed-regeneration.";

/** Storage can be unavailable or full; neither may break a save. */
function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Keep the exact operation, so a retry recognises a save that already committed. */
export function rememberReviewedSave(jobId: string | null, reviewed: ReviewedRegeneration): void {
  if (!jobId) return;
  try {
    store()?.setItem(PREFIX + jobId, JSON.stringify(reviewed));
  } catch {
    // Storage full or unavailable: the in-memory retry still covers this session.
  }
}

/**
 * Drop the checkpoint. Only a durable journal acknowledgement earns this: an
 * answer the journal still holds can come back after a restart, and the review
 * needs this operation to recognise the save rather than repeat it.
 */
export function forgetReviewedSave(jobId: string | null): void {
  if (!jobId) return;
  try {
    store()?.removeItem(PREFIX + jobId);
  } catch {
    // Nothing more to do; a stale entry is only used if its content is stored.
  }
}

/** The operation last sent for this journal job, while its answer is unacknowledged. */
export function reviewedSaveOf(jobId: string | null): ReviewedRegeneration | null {
  if (!jobId) return null;
  try {
    const raw = store()?.getItem(PREFIX + jobId);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ReviewedRegeneration>;
    // Shape only; the save itself validates the whole operation again.
    return typeof value.operationId === "string" && value.expected && value.next ? (value as ReviewedRegeneration) : null;
  } catch {
    return null;
  }
}
