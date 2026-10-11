/**
 * Skills and feedback evidence (M3): the words the app uses, and the one
 * threshold behind them. Pure, so the wording boundaries of M3-D2, D3, D8
 * and D9 are tested in one place.
 *
 * Evidence is described in words, never as a score. Nothing here derives a
 * status: status is only ever what she set (M3-D2).
 */
import type {
  EvidenceItem,
  ObservationChangeKind,
  SkillAttribution,
  SkillSourceField,
  SkillStatusLabel,
  SkillSummary,
} from "@/domain/types";

/** Fewer than 3 observations, or fewer than 2 lessons, is "limited" (M3-D9). */
export const EVIDENCE_THRESHOLD = { observations: 3, debriefs: 2 } as const;

export type EvidenceLevel = SkillSummary["evidence"];

export function evidenceLevel(observations: number, debriefs: number): EvidenceLevel {
  if (observations === 0) return "none";
  if (observations < EVIDENCE_THRESHOLD.observations || debriefs < EVIDENCE_THRESHOLD.debriefs) return "limited";
  return "recorded";
}

/** The evidence sentence on the skill page and in the skills list (M3-D9). */
export function evidenceSentence(summary: Pick<SkillSummary, "evidence" | "observationCount" | "distinctDebriefs">): string {
  if (summary.evidence === "none") return "No observations yet.";
  if (summary.evidence === "limited") return "Only a few observations so far: not enough to show a pattern.";
  return `${summary.observationCount} observations from ${summary.distinctDebriefs} lessons.`;
}

/** Carried on every skill page (M3-D9). */
export const SKILL_DISCLAIMER = "This is your own record. It isn't an instructor sign-off or a proficiency rating.";

/** Shown wherever a linked follow-up is done (M3-D8). */
export const COMPLETION_IS_NOT_ADDRESSED = "Finishing it doesn't mean this was resolved in flight.";

export const STATUS_WORDS: Record<SkillStatusLabel, string> = {
  learning: "Learning",
  practicing: "Practicing",
  needs_review: "Needs review",
};

export function statusText(status: SkillStatusLabel | null): string {
  return status ? STATUS_WORDS[status] : "Not set";
}

export function confidenceText(confidence: number | null): string {
  return confidence ? `${confidence} of 5` : "Not rated";
}

/** The two attribution choices in the form (M3-D3). */
export const ATTRIBUTION_CHOICES: Record<SkillAttribution, string> = {
  instructor_transcribed: "My instructor (I'm writing down what they said)",
  self_report: "Me (my own observation)",
};

export const SOURCE_FIELD_WORDS: Record<SkillSourceField, string> = {
  none: "Not from a particular part",
  instructor_feedback: "Instructor feedback",
  went_well: "What went well",
  was_difficult: "What was difficult",
  practiced: "What you practiced",
};

export const CHANGE_WORDS: Record<ObservationChangeKind, string> = {
  created: "Recorded",
  edited: "Edited",
  linked_action: "Follow-up linked",
  unlinked_action: "Follow-up unlinked",
  marked_addressed: "Marked addressed",
  cleared_addressed: "Addressed mark removed",
};

export function attributionText(item: Pick<EvidenceItem, "attribution" | "instructorName">): string {
  if (item.attribution === "self_report") return "Your note";
  return item.instructorName
    ? `Instructor feedback, as you wrote it down (${item.instructorName})`
    : "Instructor feedback, as you wrote it down";
}

export function sourceText(item: Pick<EvidenceItem, "source" | "sourceSnapshot">): string {
  if (item.source.kind === "deleted") {
    return `From a debrief that was deleted: “${item.sourceSnapshot.title || "Lesson debrief"}”, ${item.sourceSnapshot.date}`;
  }
  const parts = [`From “${item.source.currentTitle || "Lesson debrief"}”, ${item.source.currentDate}`];
  if (item.source.renamed) parts.push(`(called “${item.sourceSnapshot.title || "Lesson debrief"}” when you recorded this)`);
  if (item.source.textChanged) parts.push("· The debrief has been edited since you recorded this.");
  return parts.join(" ");
}

export function actionText(item: Pick<EvidenceItem, "action">): string | null {
  if (item.action.kind === "none") return null;
  if (item.action.kind === "deleted") return `Follow-up “${item.action.formerTitle}” was deleted.`;
  if (item.action.actionStatus === "completed") {
    return `Follow-up “${item.action.title}” is done. ${COMPLETION_IS_NOT_ADDRESSED}`;
  }
  return `Follow-up: “${item.action.title}” (${item.action.actionStatus === "open" ? "still to do" : "dismissed"})`;
}

/** The plain message for a write refusal, by code. Never engine text. */
export function refusalText(code: string, fallback?: string): string {
  switch (code) {
    case "STALE_REVISION":
      return "This changed somewhere else. Reload to see the latest, then try again.";
    case "DUPLICATE_LABEL":
      return "You already have an active skill with that name.";
    case "BUILTIN_READ_ONLY":
      return "Built-in skill names come from the app and can't be changed.";
    case "SKILL_RETIRED":
      return "That skill is retired. Restore it to add new observations.";
    case "SOURCE_MISSING":
      return "That lesson debrief no longer exists.";
    case "LIMIT_EXCEEDED":
      return fallback ?? "That's more than this can hold.";
    case "ERASED":
      return "That observation was erased.";
    case "NOT_FOUND":
      return "That's no longer here. Reload to see the latest.";
    case "OPERATION_CONFLICT":
      return "This save clashed with an earlier one, so nothing was saved.";
    case "INVALID_ARGUMENT":
      return fallback ?? "Something in that wasn't quite right, so nothing was saved.";
    default:
      // STORAGE_FAILURE and anything unexpected: the answer was lost, so the
      // change may or may not have landed. Never claim either.
      return "We couldn't confirm that change. Refresh to see what's saved, then try again if you need to.";
  }
}
