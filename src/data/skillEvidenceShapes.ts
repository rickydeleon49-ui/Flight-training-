/**
 * Strict adapters for the desktop skill-evidence commands (M3), in the
 * manner of `splitLineageShapes.ts` and the card-review adapters: a native
 * answer is accepted only when it is exactly one allowlisted refusal with its
 * fixed message, or a result of exactly the expected shape for the request
 * sent. Anything else becomes STORAGE_FAILURE: the outcome is unknown, so
 * the controller resolves it before sending anything new, and raw engine or
 * transport text is never shown.
 */
import type {
  EvidenceItem,
  EvidencePage,
  EvidencePageInput,
  ObservationHistoryInput,
  ObservationHistoryPage,
  ObservationRevision,
  SkillEvidenceAction,
  SkillEvidenceErrorCode,
  SkillEvidenceOutcome,
  SkillListEntry,
  SkillSummary,
} from "@/domain/types";

import { ResultShapeError, decodeSkillEvidenceResult, subjectOf } from "./skillEvidenceResult";
import { SkillEvidenceError } from "./skillEvidenceTransaction";

/** The native refusals and their fixed messages (`SkillEvidenceErrorCode::message` in skill_evidence.rs). */
export const SKILL_EVIDENCE_ERROR_MESSAGES: Record<SkillEvidenceErrorCode, string> = {
  INVALID_ARGUMENT: "That request is not valid.",
  LIMIT_EXCEEDED: "That is more than this can hold.",
  NOT_FOUND: "That is no longer here.",
  SOURCE_MISSING: "That lesson debrief no longer exists.",
  SKILL_RETIRED: "That skill is retired. Restore it to add new observations.",
  BUILTIN_READ_ONLY: "Built-in skill names come from the catalog and cannot be edited.",
  DUPLICATE_LABEL: "An active skill already has that name.",
  STALE_REVISION: "This changed somewhere else. Reload to see the latest.",
  OPERATION_CONFLICT: "That request id was already used for a different change.",
  ERASED: "That observation was erased.",
  STALE_CURSOR: "The list changed while you were reading it. Start again from the newest.",
  STORAGE_FAILURE: "The change could not be saved.",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isNullableText = (value: unknown): value is string | null => value === null || typeof value === "string";
const isPositive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isAttribution = (value: unknown) => value === "self_report" || value === "instructor_transcribed";
const isOrigin = (value: unknown) => value === "builtin" || value === "custom";
const TOPICS = new Set([
  "weather", "navigation", "regulations", "communications", "aerodynamics", "aircraft_systems",
  "flight_planning", "airports", "performance", "emergency_procedures", "landings", "general",
]);
const SOURCE_FIELDS = new Set(["instructor_feedback", "went_well", "was_difficult", "practiced", "none"]);
const CHANGE_KINDS = new Set(["created", "edited", "linked_action", "unlinked_action", "marked_addressed", "cleared_addressed"]);

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/** A write answer: applied or replayed, with the exact result of THIS request. */
export function isSkillEvidenceOutcomeFor(action: SkillEvidenceAction, value: unknown): value is SkillEvidenceOutcome {
  if (!isRecord(value) || !hasExactly(value, ["status", "result"])) return false;
  if (value.status !== "applied" && value.status !== "replayed") return false;
  try {
    decodeSkillEvidenceResult(value.result, { action: action.action, subjectId: subjectOf(action) });
    return true;
  } catch (error) {
    if (error instanceof ResultShapeError) return false;
    throw error;
  }
}

const ITEM_KEYS = [
  "id", "skillId", "skillLabel", "skillLabelAtRecording", "skillRetired", "wording", "observedOn", "attribution",
  "instructorName", "revision", "source", "sourceSnapshot", "action", "addressedAt", "createdAt", "updatedAt",
] as const;

function isSource(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "deleted") return hasExactly(value, ["kind", "sourceJournalId"]) && isText(value.sourceJournalId);
  return (
    value.kind === "present" &&
    hasExactly(value, ["kind", "journalId", "currentTitle", "currentDate", "renamed", "textChanged"]) &&
    isText(value.journalId) &&
    isText(value.currentTitle) &&
    isText(value.currentDate) &&
    typeof value.renamed === "boolean" &&
    (value.textChanged === null || typeof value.textChanged === "boolean")
  );
}

function isActionLink(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "none") return hasExactly(value, ["kind"]);
  if (value.kind === "deleted") {
    return hasExactly(value, ["kind", "formerActionId", "formerTitle"]) && isText(value.formerActionId) && isText(value.formerTitle);
  }
  return (
    value.kind === "linked" &&
    hasExactly(value, ["kind", "actionId", "title", "actionStatus"]) &&
    isText(value.actionId) &&
    isText(value.title) &&
    (value.actionStatus === "open" || value.actionStatus === "completed" || value.actionStatus === "dismissed")
  );
}

export function isEvidenceItem(value: unknown): value is EvidenceItem {
  return (
    isRecord(value) &&
    hasExactly(value, ITEM_KEYS) &&
    isText(value.id) &&
    isText(value.skillId) &&
    isText(value.skillLabel) &&
    isText(value.skillLabelAtRecording) &&
    typeof value.skillRetired === "boolean" &&
    isText(value.wording) &&
    isDate(value.observedOn) &&
    isAttribution(value.attribution) &&
    isText(value.instructorName) &&
    isPositive(value.revision) &&
    isSource(value.source) &&
    isRecord(value.sourceSnapshot) &&
    hasExactly(value.sourceSnapshot, ["title", "date", "field"]) &&
    isText(value.sourceSnapshot.title) &&
    isText(value.sourceSnapshot.date) &&
    SOURCE_FIELDS.has(value.sourceSnapshot.field as string) &&
    isActionLink(value.action) &&
    isNullableText(value.addressedAt) &&
    isText(value.createdAt) &&
    isText(value.updatedAt)
  );
}

export function isEvidencePage(value: unknown): value is EvidencePage {
  return (
    isRecord(value) &&
    hasExactly(value, ["items", "nextCursor"]) &&
    Array.isArray(value.items) &&
    value.items.length <= 50 &&
    value.items.every(isEvidenceItem) &&
    isNullableText(value.nextCursor)
  );
}

const SUMMARY_KEYS = [
  "skillId", "label", "origin", "retired", "revision", "status", "statusSequence", "confidence", "confidenceSequence",
  "observationCount", "selfReportCount", "instructorTranscribedCount", "distinctDebriefs", "lastObservedOn", "evidence",
] as const;

export function isSkillSummaryFor(skillId: string, value: unknown): value is SkillSummary | null {
  if (value === null) return true;
  return (
    isRecord(value) &&
    hasExactly(value, SUMMARY_KEYS) &&
    value.skillId === skillId &&
    isText(value.label) &&
    isOrigin(value.origin) &&
    typeof value.retired === "boolean" &&
    isPositive(value.revision) &&
    (value.status === null || value.status === "learning" || value.status === "practicing" || value.status === "needs_review") &&
    isCount(value.statusSequence) &&
    (value.confidence === null || (isPositive(value.confidence) && value.confidence <= 5)) &&
    isCount(value.confidenceSequence) &&
    isCount(value.observationCount) &&
    isCount(value.selfReportCount) &&
    isCount(value.instructorTranscribedCount) &&
    isCount(value.distinctDebriefs) &&
    (value.lastObservedOn === null || isDate(value.lastObservedOn)) &&
    (value.evidence === "none" || value.evidence === "limited" || value.evidence === "recorded")
  );
}

export function isSkillListEntry(value: unknown): value is SkillListEntry {
  return (
    isRecord(value) &&
    hasExactly(value, ["id", "label", "description", "origin", "topic", "retired", "revision"]) &&
    isText(value.id) &&
    isText(value.label) &&
    isText(value.description) &&
    isOrigin(value.origin) &&
    TOPICS.has(value.topic as string) &&
    typeof value.retired === "boolean" &&
    isPositive(value.revision)
  );
}

export function isSkillList(value: unknown): value is SkillListEntry[] {
  return Array.isArray(value) && value.length <= 1_000 && value.every(isSkillListEntry);
}

function isRevision(value: unknown): value is ObservationRevision {
  return (
    isRecord(value) &&
    hasExactly(value, [
      "revision", "changeKind", "wording", "observedOn", "attribution", "instructorName", "linkedActionId",
      "linkedActionTitle", "addressedAt", "recordedAt",
    ]) &&
    isPositive(value.revision) &&
    CHANGE_KINDS.has(value.changeKind as string) &&
    isText(value.wording) &&
    isDate(value.observedOn) &&
    isAttribution(value.attribution) &&
    isText(value.instructorName) &&
    isNullableText(value.linkedActionId) &&
    isNullableText(value.linkedActionTitle) &&
    isNullableText(value.addressedAt) &&
    isText(value.recordedAt)
  );
}

export function isObservationHistoryPageFor(observationId: string, value: unknown): value is ObservationHistoryPage {
  return (
    isRecord(value) &&
    hasExactly(value, ["observationId", "currentRevision", "items", "nextCursor"]) &&
    value.observationId === observationId &&
    isPositive(value.currentRevision) &&
    Array.isArray(value.items) &&
    value.items.length <= 100 &&
    value.items.every(isRevision) &&
    isNullableText(value.nextCursor)
  );
}

const CODES = Object.keys(SKILL_EVIDENCE_ERROR_MESSAGES) as SkillEvidenceErrorCode[];

/** Turn a native rejection into its refusal, or STORAGE_FAILURE (unknown) for anything else. */
export function nativeRefusal(rejection: unknown): SkillEvidenceError {
  const { code, message } = (rejection ?? {}) as { code?: unknown; message?: unknown };
  if (typeof code === "string" && (CODES as string[]).includes(code)) {
    const known = code as SkillEvidenceErrorCode;
    if (message === SKILL_EVIDENCE_ERROR_MESSAGES[known]) return new SkillEvidenceError(known, SKILL_EVIDENCE_ERROR_MESSAGES[known]);
  }
  return Object.assign(new SkillEvidenceError("STORAGE_FAILURE", "The app couldn't confirm that."), { cause: rejection });
}

type Call = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

async function callChecked<T>(call: Call, command: string, args: Record<string, unknown>, isShape: (value: unknown) => value is T): Promise<T> {
  let value: unknown;
  try {
    value = await call(command, args);
  } catch (rejection) {
    throw nativeRefusal(rejection);
  }
  if (!isShape(value)) throw new SkillEvidenceError("STORAGE_FAILURE", "The app couldn't confirm that.");
  return value;
}

export function invokeSkillEvidenceAction(action: SkillEvidenceAction, call: Call): Promise<SkillEvidenceOutcome> {
  return callChecked(call, "save_skill_evidence_action", { operation: action }, (v): v is SkillEvidenceOutcome =>
    isSkillEvidenceOutcomeFor(action, v),
  );
}

export function invokeReadSkillEvidencePage(input: EvidencePageInput, call: Call): Promise<EvidencePage> {
  return callChecked(call, "read_skill_evidence_page", { input }, isEvidencePage);
}

export function invokeReadSkillSummary(skillId: string, call: Call): Promise<SkillSummary | null> {
  return callChecked(call, "read_skill_summary", { input: { skillId } }, (v): v is SkillSummary | null => isSkillSummaryFor(skillId, v));
}

export function invokeListSkills(options: { includeRetired?: boolean }, call: Call): Promise<SkillListEntry[]> {
  return callChecked(call, "list_skills", { input: { includeRetired: options.includeRetired === true } }, isSkillList);
}

export function invokeReadObservationHistory(input: ObservationHistoryInput, call: Call): Promise<ObservationHistoryPage> {
  return callChecked(call, "read_observation_history", { input }, (v): v is ObservationHistoryPage =>
    isObservationHistoryPageFor(input.observationId, v),
  );
}
