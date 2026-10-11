/**
 * Exact decoding of a stored skill-evidence result
 * (`skill_evidence_operations.result_json`). Shared by the replay path
 * (`skillEvidenceTransaction.ts`), the reader's cursor fence and the restore
 * validator (`validateSkillEvidenceState`); the native twin is
 * `decode_result` in `src-tauri/src/skill_evidence.rs`.
 *
 * A result is accepted only when it has exactly the keys of its action, the
 * right value types and ranges, and names the receipt's own subject. Whether
 * the operation really owns the history row it names is checked by the
 * validator against the database; replay trusts nothing that has not passed
 * this decoder (M3-R5).
 */
import type { SkillEvidenceAction, SkillEvidenceActionName, SkillEvidenceResult } from "@/domain/types";

export const SKILL_ACTIONS: ReadonlySet<SkillEvidenceActionName> = new Set([
  "create_custom_skill",
  "edit_custom_skill",
  "retire_skill",
  "restore_skill",
]);
export const OBSERVATION_HISTORY_ACTIONS: ReadonlySet<SkillEvidenceActionName> = new Set([
  "create_observation",
  "edit_observation",
  "link_action",
  "unlink_action",
  "set_addressed",
]);
export const ASSESSMENT_ACTIONS: ReadonlySet<SkillEvidenceActionName> = new Set(["set_status", "set_confidence"]);

/** The exact result keys per action, sorted. */
export const RESULT_KEYS: Record<SkillEvidenceActionName, readonly string[]> = {
  create_custom_skill: ["action", "revision", "skillId"],
  edit_custom_skill: ["action", "revision", "skillId"],
  retire_skill: ["action", "revision", "skillId"],
  restore_skill: ["action", "revision", "skillId"],
  create_observation: ["action", "observationId", "revision"],
  edit_observation: ["action", "observationId", "revision"],
  link_action: ["action", "observationId", "revision"],
  unlink_action: ["action", "observationId", "revision"],
  set_addressed: ["action", "observationId", "revision"],
  set_status: ["action", "sequence", "skillId"],
  set_confidence: ["action", "sequence", "skillId"],
  erase_observation: ["action", "erased", "observationId"],
};

export class ResultShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultShapeError";
  }
}

const fail = (message: string): never => {
  throw new ResultShapeError(message);
};

/** The subject a request acts on: the skill for skill and assessment actions, otherwise the observation. */
export function subjectOf(action: SkillEvidenceAction): string {
  return "observationId" in action ? action.observationId : action.skillId;
}

/** A positive whole number within JavaScript's safe range (the native twin applies the same bounds). */
function positive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) fail(`${field} must be a positive whole number.`);
  return value as number;
}

/**
 * Decode one stored result for a receipt of `action` about `subjectId`.
 * `raw` is the parsed JSON. Throws ResultShapeError when anything differs.
 */
export function decodeSkillEvidenceResult(
  raw: unknown,
  expected: { action: SkillEvidenceActionName; subjectId: string },
): SkillEvidenceResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) fail("A result must be an object.");
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const wanted = RESULT_KEYS[expected.action];
  if (!wanted) fail("Unknown action.");
  if (keys.length !== wanted.length || keys.some((k, i) => k !== wanted[i])) {
    fail(`A ${expected.action} result has exactly: ${wanted.join(", ")}.`);
  }
  if (record["action"] !== expected.action) fail("The result belongs to a different action.");
  const action = expected.action;
  if (SKILL_ACTIONS.has(action)) {
    if (record["skillId"] !== expected.subjectId) fail("The result names a different skill.");
    const revision = positive(record["revision"], "revision");
    if (action === "create_custom_skill" ? revision !== 1 : revision < 2) fail("The result revision does not fit its action.");
    return { action: action as "create_custom_skill", skillId: expected.subjectId, revision };
  }
  if (OBSERVATION_HISTORY_ACTIONS.has(action)) {
    if (record["observationId"] !== expected.subjectId) fail("The result names a different observation.");
    const revision = positive(record["revision"], "revision");
    if (action === "create_observation" ? revision !== 1 : revision < 2) fail("The result revision does not fit its action.");
    return { action: action as "create_observation", observationId: expected.subjectId, revision };
  }
  if (ASSESSMENT_ACTIONS.has(action)) {
    if (record["skillId"] !== expected.subjectId) fail("The result names a different skill.");
    return { action: action as "set_status", skillId: expected.subjectId, sequence: positive(record["sequence"], "sequence") };
  }
  if (record["observationId"] !== expected.subjectId) fail("The result names a different observation.");
  if (record["erased"] !== true) fail("An erase result must say erased: true.");
  return { action: "erase_observation", observationId: expected.subjectId, erased: true };
}

/** Parse and decode stored result text. */
export function decodeStoredResult(
  text: unknown,
  expected: { action: SkillEvidenceActionName; subjectId: string },
): SkillEvidenceResult {
  if (typeof text !== "string") fail("The result is missing.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text as string);
  } catch {
    fail("The result is not readable.");
  }
  return decodeSkillEvidenceResult(parsed, expected);
}
