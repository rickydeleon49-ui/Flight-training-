/**
 * Small, dependency-free pieces of the skill-evidence contract that eager code needs
 * (error class, limits, label key). Kept apart from skillEvidenceTransaction.ts so that
 * large module can load on first write.
 */
import type { SkillEvidenceErrorCode, SkillSourceField } from "@/domain/types";

export const SKILL_EVIDENCE_LIMITS = {
  /** Observation wording: trimmed 1..2000 code points, at most 8000 UTF-8 bytes. */
  wordingCodePoints: 2000,
  wordingBytes: 8000,
  skillLabelCodePoints: 80,
  skillDescriptionCodePoints: 500,
  instructorNameCodePoints: 120,
  /** Snapshot of the debrief/action titles kept with an observation. */
  sourceTitleCodePoints: 200,
  /** Custom skills a library may hold (retired ones count). */
  customSkills: 200,
  /** Canonical JSON of one request, the bound on what an operation receipt hashes. */
  requestBytes: 16_384,
  /** Evidence page size: default 20, at most 50. */
  pageDefault: 20,
  pageMax: 50,
  /**
   * Observation history page size: default 20, at most 100 per page. This is
   * a page bound, not a lifetime visibility limit: every stored revision is
   * reachable by following the history cursor.
   */
  revisionPageDefault: 20,
  revisionPageMax: 100,
  /** Observations recorded against one debrief. */
  observationsPerDebrief: 50,
} as const;

/** A refusal with one of the contract's codes. The message is written for the student. */
export class SkillEvidenceError extends Error {
  constructor(
    readonly code: SkillEvidenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SkillEvidenceError";
  }
}

export const SOURCE_FIELD_COLUMNS: Record<Exclude<SkillSourceField, "none">, string> = {
  instructor_feedback: "instructor_feedback",
  went_well: "went_well",
  was_difficult: "was_difficult",
  practiced: "practiced",
};

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Normalized form used only to detect a duplicate active label. */
export function labelKey(label: string): string {
  return label.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

