/**
 * M3 skills and feedback evidence: the candidate write and read contract.
 *
 * DISPOSABLE PROTOTYPE. Lives in the evidence pack, imports production code
 * read-only, and is not referenced by any production module. See
 * docs/M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md for the contract these types
 * encode.
 */
import type { Topic } from "@/domain/types";

/* ------------------------------ limits ------------------------------ */

export const LIMITS = {
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
  /** History page size: default 20, at most 50. */
  pageDefault: 20,
  pageMax: 50,
  /** Revisions returned with one observation's history. */
  revisionsMax: 100,
  /** Observations recorded against one debrief. */
  observationsPerDebrief: 50,
} as const;

/* ------------------------------ values ------------------------------ */

export type Attribution = "self_report" | "instructor_transcribed";
export type SourceField = "instructor_feedback" | "went_well" | "was_difficult" | "practiced" | "none";
export type SkillStatusLabel = "learning" | "practicing" | "needs_review";
export type SkillOrigin = "builtin" | "custom";

export const SOURCE_FIELD_COLUMNS: Record<Exclude<SourceField, "none">, string> = {
  instructor_feedback: "instructor_feedback",
  went_well: "went_well",
  was_difficult: "was_difficult",
  practiced: "practiced",
};

/* ----------------------------- actions ------------------------------ */

interface Base {
  /** UUID v4 minted once per deliberate request and kept for its retries. */
  operationId: string;
}

export type SkillEvidenceAction =
  | (Base & { action: "create_custom_skill"; skillId: string; label: string; description: string; topic: Topic })
  | (Base & { action: "edit_custom_skill"; skillId: string; expectedRevision: number; label: string; description: string; topic: Topic })
  | (Base & { action: "retire_skill" | "restore_skill"; skillId: string; expectedRevision: number })
  | (Base & {
      action: "create_observation";
      observationId: string;
      skillId: string;
      journalId: string;
      sourceField: SourceField;
      wording: string;
      observedOn: string;
      attribution: Attribution;
      instructorName: string;
    })
  | (Base & {
      action: "edit_observation";
      observationId: string;
      expectedRevision: number;
      wording: string;
      observedOn: string;
      attribution: Attribution;
      instructorName: string;
    })
  | (Base & { action: "link_action"; observationId: string; expectedRevision: number; actionId: string })
  | (Base & { action: "unlink_action"; observationId: string; expectedRevision: number })
  | (Base & { action: "set_addressed"; observationId: string; expectedRevision: number; addressed: boolean })
  | (Base & { action: "set_status"; skillId: string; expectedSequence: number; status: SkillStatusLabel | null })
  | (Base & { action: "set_confidence"; skillId: string; expectedSequence: number; confidence: number | null })
  | (Base & { action: "erase_observation"; observationId: string; confirm: "erase" });

export type ActionName = SkillEvidenceAction["action"];

export type SkillEvidenceResult =
  | { action: "create_custom_skill" | "edit_custom_skill" | "retire_skill" | "restore_skill"; skillId: string; revision: number }
  | {
      action: "create_observation" | "edit_observation" | "link_action" | "unlink_action" | "set_addressed";
      observationId: string;
      revision: number;
    }
  | { action: "set_status" | "set_confidence"; skillId: string; sequence: number }
  | { action: "erase_observation"; observationId: string; erased: true };

/** What a write call returns: `replayed` means the same request had already committed. */
export interface SkillEvidenceOutcome {
  status: "applied" | "replayed";
  result: SkillEvidenceResult;
}

export type SkillEvidenceErrorCode =
  | "INVALID_ARGUMENT"
  | "LIMIT_EXCEEDED"
  | "NOT_FOUND"
  | "SOURCE_MISSING"
  | "SKILL_RETIRED"
  | "BUILTIN_READ_ONLY"
  | "DUPLICATE_LABEL"
  | "STALE_REVISION"
  | "OPERATION_CONFLICT"
  | "ERASED"
  | "STORAGE_FAILURE";

export class SkillEvidenceError extends Error {
  constructor(
    readonly code: SkillEvidenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SkillEvidenceError";
  }
}

/* ------------------------------- reads ------------------------------ */

export interface EvidencePageInput {
  skillId?: string | null;
  journalId?: string | null;
  attribution?: Attribution | null;
  /** Opaque cursor from the previous page, or null for the first page. */
  cursor?: string | null;
  limit?: number;
}

export type SourceState =
  /** The debrief still exists; `renamed`/`textChanged` describe drift since recording. */
  | { kind: "present"; journalId: string; currentTitle: string; currentDate: string; renamed: boolean; textChanged: boolean | null }
  /** The debrief was deleted; the snapshot is all that remains. */
  | { kind: "deleted"; sourceJournalId: string };

export type ActionLinkState =
  | { kind: "none" }
  | { kind: "linked"; actionId: string; title: string; actionStatus: "open" | "completed" | "dismissed" }
  | { kind: "deleted"; formerActionId: string; formerTitle: string };

export interface EvidenceItem {
  id: string;
  skillId: string;
  skillLabel: string;
  skillLabelAtRecording: string;
  skillRetired: boolean;
  wording: string;
  observedOn: string;
  attribution: Attribution;
  instructorName: string;
  revision: number;
  source: SourceState;
  sourceSnapshot: { title: string; date: string; field: SourceField };
  action: ActionLinkState;
  addressedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvidencePage {
  items: EvidenceItem[];
  nextCursor: string | null;
}

export interface SkillSummary {
  skillId: string;
  label: string;
  origin: SkillOrigin;
  retired: boolean;
  revision: number;
  /** The learner's own label, or null when never set or cleared. Evidence never sets it. */
  status: SkillStatusLabel | null;
  statusSequence: number;
  /** The learner's own 1-5 rating, separate from status. */
  confidence: number | null;
  confidenceSequence: number;
  observationCount: number;
  selfReportCount: number;
  instructorTranscribedCount: number;
  distinctDebriefs: number;
  lastObservedOn: string | null;
  /** "none": no observations; "limited": fewer than 3 or from one debrief; "recorded": otherwise. */
  evidence: "none" | "limited" | "recorded";
}

export interface ObservationRevision {
  revision: number;
  changeKind: "created" | "edited" | "linked_action" | "unlinked_action" | "marked_addressed" | "cleared_addressed";
  wording: string;
  observedOn: string;
  attribution: Attribution;
  instructorName: string;
  linkedActionId: string | null;
  linkedActionTitle: string | null;
  addressedAt: string | null;
  recordedAt: string;
}

export interface SkillListEntry {
  id: string;
  label: string;
  origin: SkillOrigin;
  topic: Topic;
  retired: boolean;
  revision: number;
}
