/**
 * Candidate M3 write path: one skill-evidence action as a single-connection
 * immediate transaction, in the shape of the accepted production
 * transactions (`debriefTransaction.ts`, `practiceSessionTransaction.ts`,
 * `cardReviewTransaction.ts`): `exec` for transaction control, `run` for data
 * statements, `query` for reads, all on one owned connection.
 *
 * DISPOSABLE PROTOTYPE. The production slice adds the native Rust twin
 * (`save_skill_evidence_action`) replaying the same fixtures.
 *
 * Contract summary (full text in the scope document):
 * - The request is decoded strictly (exact keys, typed, bounded) BEFORE the
 *   transaction; its canonical JSON (<= 16 KiB) is hashed.
 * - A known operation id with the same hash replays the stored result and
 *   writes nothing; a different hash is OPERATION_CONFLICT; an id whose
 *   subject was erased is ERASED (never resurrected).
 * - Every check needed for safety runs inside BEGIN IMMEDIATE before the first
 *   write. Any failure rolls back everything, including the receipt.
 * - Every change appends one history row; history rows are never rewritten.
 * - No action changes next_actions, journal_entries or any M2 table.
 */
import { canonicalJson, sha256Hex } from "@/logic/cardIdentity";
import type { SqlValue } from "@/data/db";
import type { Topic } from "@/domain/types";

import {
  LIMITS,
  SOURCE_FIELD_COLUMNS,
  SkillEvidenceError,
  type ActionName,
  type Attribution,
  type SkillEvidenceAction,
  type SkillEvidenceOutcome,
  type SkillEvidenceResult,
  type SourceField,
} from "./types";

export type Exec = (sql: string) => Promise<void> | void;
export type Run = (sql: string, params: SqlValue[]) => Promise<void> | void;
export type Query = (sql: string, params: SqlValue[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CUSTOM_ID = /^custom\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SKILL_ID = /^(builtin\.[a-z0-9_]{1,60}|custom\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_TAB_NEWLINE = /[\u0000-\u0008\u000B-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex
const ANY_CONTROL = /[\u0000-\u001F\u007F]/;
const TOPICS: ReadonlySet<string> = new Set([
  "weather", "navigation", "regulations", "communications", "aerodynamics", "aircraft_systems",
  "flight_planning", "airports", "performance", "emergency_procedures", "landings", "general",
]);
const ATTRIBUTIONS: ReadonlySet<string> = new Set(["self_report", "instructor_transcribed"]);
const SOURCE_FIELDS: ReadonlySet<string> = new Set(["instructor_feedback", "went_well", "was_difficult", "practiced", "none"]);
const STATUSES: ReadonlySet<string> = new Set(["learning", "practicing", "needs_review"]);

const KEYS: Record<ActionName, readonly string[]> = {
  create_custom_skill: ["action", "operationId", "skillId", "label", "description", "topic"],
  edit_custom_skill: ["action", "operationId", "skillId", "expectedRevision", "label", "description", "topic"],
  retire_skill: ["action", "operationId", "skillId", "expectedRevision"],
  restore_skill: ["action", "operationId", "skillId", "expectedRevision"],
  create_observation: [
    "action", "operationId", "observationId", "skillId", "journalId", "sourceField", "wording", "observedOn",
    "attribution", "instructorName",
  ],
  edit_observation: [
    "action", "operationId", "observationId", "expectedRevision", "wording", "observedOn", "attribution", "instructorName",
  ],
  link_action: ["action", "operationId", "observationId", "expectedRevision", "actionId"],
  unlink_action: ["action", "operationId", "observationId", "expectedRevision"],
  set_addressed: ["action", "operationId", "observationId", "expectedRevision", "addressed"],
  set_status: ["action", "operationId", "skillId", "expectedSequence", "status"],
  set_confidence: ["action", "operationId", "skillId", "expectedSequence", "confidence"],
  erase_observation: ["action", "operationId", "observationId", "confirm"],
};

function refuse(code: SkillEvidenceError["code"], message: string): never {
  throw new SkillEvidenceError(code, message);
}

const codePoints = (text: string) => Array.from(text).length;
const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

function boundedText(value: unknown, field: string, max: number, opts: { required: boolean; multiline: boolean }): string {
  if (typeof value !== "string" || LONE_SURROGATE.test(value)) refuse("INVALID_ARGUMENT", `${field} must be text.`);
  if ((opts.multiline ? CONTROL_EXCEPT_TAB_NEWLINE : ANY_CONTROL).test(value)) {
    refuse("INVALID_ARGUMENT", `${field} contains a control character.`);
  }
  if (opts.required && codePoints(value.trim()) < 1) refuse("INVALID_ARGUMENT", `${field} cannot be empty.`);
  if (codePoints(value) > max) refuse("LIMIT_EXCEEDED", `${field} is longer than ${max} characters.`);
  return value;
}

function revisionNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) refuse("INVALID_ARGUMENT", `${field} must be a whole number.`);
  return value;
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Strict decoding: exact keys, exact types, enforced bounds. Nothing is coerced. */
export function decodeSkillEvidenceAction(input: unknown): SkillEvidenceAction {
  if (input === null || typeof input !== "object" || Array.isArray(input)) refuse("INVALID_ARGUMENT", "A request must be an object.");
  const record = input as Record<string, unknown>;
  const name = record["action"];
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(KEYS, name)) refuse("INVALID_ARGUMENT", "Unknown action.");
  const expected = KEYS[name as ActionName];
  const keys = Object.keys(record);
  if (keys.length !== expected.length || !keys.every((k) => expected.includes(k))) {
    refuse("INVALID_ARGUMENT", `${name} takes exactly: ${expected.join(", ")}.`);
  }
  if (typeof record["operationId"] !== "string" || !UUID_V4.test(record["operationId"])) {
    refuse("INVALID_ARGUMENT", "operationId must be a UUID v4.");
  }
  const skillId = (key = "skillId") => {
    const v = record[key];
    if (typeof v !== "string" || !SKILL_ID.test(v)) refuse("INVALID_ARGUMENT", `${key} is not a skill id.`);
    return v;
  };
  const uuid = (key: string) => {
    const v = record[key];
    if (typeof v !== "string" || !UUID_V4.test(v)) refuse("INVALID_ARGUMENT", `${key} must be a UUID v4.`);
    return v;
  };
  const anyId = (key: string) => {
    const v = record[key];
    if (typeof v !== "string" || v.length < 1 || v.length > 64 || ANY_CONTROL.test(v)) refuse("INVALID_ARGUMENT", `${key} is not an id.`);
    return v;
  };
  const topic = () => {
    const v = record["topic"];
    if (typeof v !== "string" || !TOPICS.has(v)) refuse("INVALID_ARGUMENT", "topic is not a known topic.");
    return v as Topic;
  };
  const observationContent = () => {
    const attribution = record["attribution"];
    if (typeof attribution !== "string" || !ATTRIBUTIONS.has(attribution)) {
      refuse("INVALID_ARGUMENT", "attribution must be self_report or instructor_transcribed.");
    }
    const instructorName = boundedText(record["instructorName"], "instructorName", LIMITS.instructorNameCodePoints, {
      required: false,
      multiline: false,
    });
    if (attribution === "self_report" && instructorName !== "") {
      refuse("INVALID_ARGUMENT", "An instructor name belongs only to feedback you transcribed.");
    }
    const wording = boundedText(record["wording"], "wording", LIMITS.wordingCodePoints, { required: true, multiline: true });
    if (utf8Bytes(wording) > LIMITS.wordingBytes) refuse("LIMIT_EXCEEDED", `wording is larger than ${LIMITS.wordingBytes} bytes.`);
    if (!isCalendarDate(record["observedOn"])) refuse("INVALID_ARGUMENT", "observedOn must be a calendar date (YYYY-MM-DD).");
    return { wording, observedOn: record["observedOn"] as string, attribution: attribution as Attribution, instructorName };
  };
  const operationId = record["operationId"] as string;

  switch (name as ActionName) {
    case "create_custom_skill": {
      const id = record["skillId"];
      if (typeof id !== "string" || !CUSTOM_ID.test(id)) refuse("INVALID_ARGUMENT", "A custom skill id is custom.<uuid v4>.");
      return {
        action: "create_custom_skill",
        operationId,
        skillId: id,
        label: boundedText(record["label"], "label", LIMITS.skillLabelCodePoints, { required: true, multiline: false }),
        description: boundedText(record["description"], "description", LIMITS.skillDescriptionCodePoints, { required: false, multiline: true }),
        topic: topic(),
      };
    }
    case "edit_custom_skill":
      return {
        action: "edit_custom_skill",
        operationId,
        skillId: skillId(),
        expectedRevision: revisionNumber(record["expectedRevision"], "expectedRevision"),
        label: boundedText(record["label"], "label", LIMITS.skillLabelCodePoints, { required: true, multiline: false }),
        description: boundedText(record["description"], "description", LIMITS.skillDescriptionCodePoints, { required: false, multiline: true }),
        topic: topic(),
      };
    case "retire_skill":
    case "restore_skill":
      return {
        action: name as "retire_skill" | "restore_skill",
        operationId,
        skillId: skillId(),
        expectedRevision: revisionNumber(record["expectedRevision"], "expectedRevision"),
      };
    case "create_observation": {
      const sourceField = record["sourceField"];
      if (typeof sourceField !== "string" || !SOURCE_FIELDS.has(sourceField)) refuse("INVALID_ARGUMENT", "sourceField is not a debrief field.");
      return {
        action: "create_observation",
        operationId,
        observationId: uuid("observationId"),
        skillId: skillId(),
        journalId: anyId("journalId"),
        sourceField: sourceField as SourceField,
        ...observationContent(),
      };
    }
    case "edit_observation":
      return {
        action: "edit_observation",
        operationId,
        observationId: uuid("observationId"),
        expectedRevision: revisionNumber(record["expectedRevision"], "expectedRevision"),
        ...observationContent(),
      };
    case "link_action":
      return {
        action: "link_action",
        operationId,
        observationId: uuid("observationId"),
        expectedRevision: revisionNumber(record["expectedRevision"], "expectedRevision"),
        actionId: anyId("actionId"),
      };
    case "unlink_action":
      return {
        action: "unlink_action",
        operationId,
        observationId: uuid("observationId"),
        expectedRevision: revisionNumber(record["expectedRevision"], "expectedRevision"),
      };
    case "set_addressed":
      if (typeof record["addressed"] !== "boolean") refuse("INVALID_ARGUMENT", "addressed must be true or false.");
      return {
        action: "set_addressed",
        operationId,
        observationId: uuid("observationId"),
        expectedRevision: revisionNumber(record["expectedRevision"], "expectedRevision"),
        addressed: record["addressed"] as boolean,
      };
    case "set_status": {
      const status = record["status"];
      if (status !== null && (typeof status !== "string" || !STATUSES.has(status))) {
        refuse("INVALID_ARGUMENT", "status must be learning, practicing, needs_review or null.");
      }
      return {
        action: "set_status",
        operationId,
        skillId: skillId(),
        expectedSequence: revisionNumber(record["expectedSequence"], "expectedSequence"),
        status: status as "learning" | "practicing" | "needs_review" | null,
      };
    }
    case "set_confidence": {
      const confidence = record["confidence"];
      if (confidence !== null && (typeof confidence !== "number" || !Number.isInteger(confidence) || confidence < 1 || confidence > 5)) {
        refuse("INVALID_ARGUMENT", "confidence must be 1-5 or null.");
      }
      return {
        action: "set_confidence",
        operationId,
        skillId: skillId(),
        expectedSequence: revisionNumber(record["expectedSequence"], "expectedSequence"),
        confidence: confidence as number | null,
      };
    }
    case "erase_observation":
      if (record["confirm"] !== "erase") refuse("INVALID_ARGUMENT", "Erasing needs explicit confirmation.");
      return { action: "erase_observation", operationId, observationId: uuid("observationId"), confirm: "erase" };
  }
}

/** Normalized form used only to detect a duplicate active label. */
export function labelKey(label: string): string {
  return label.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

const clip = (text: string, max: number) => Array.from(text).slice(0, max).join("");

export interface TransactionOptions {
  now?: () => string;
}

/** Run one action. Callers own the connection (a ConnectionOwner in the TS drivers). */
export async function executeSkillEvidenceAction(
  exec: Exec,
  run: Run,
  query: Query,
  input: unknown,
  options: TransactionOptions = {},
): Promise<SkillEvidenceOutcome> {
  const action = decodeSkillEvidenceAction(input);
  const canonical = canonicalJson(action);
  if (utf8Bytes(canonical) > LIMITS.requestBytes) refuse("LIMIT_EXCEEDED", "That request is too large.");
  const requestHash = await sha256Hex(canonical);
  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  const one = async (sql: string, params: SqlValue[]) => (await query(sql, params))[0];

  await exec("BEGIN IMMEDIATE");
  try {
    // 0. Replay, conflict or erased.
    const receipt = await one(
      "SELECT request_hash, result_json, is_erased FROM skill_evidence_operations WHERE operation_id = ?",
      [action.operationId],
    );
    if (receipt) {
      if (receipt["request_hash"] !== requestHash) refuse("OPERATION_CONFLICT", "That request id was already used for a different change.");
      if (Number(receipt["is_erased"]) === 1) refuse("ERASED", "What that request changed has since been erased.");
      await exec("COMMIT");
      return { status: "replayed", result: JSON.parse(String(receipt["result_json"])) as SkillEvidenceResult };
    }

    const { result, subjectId } = await apply(run, one, query, action, timestamp);

    await run(
      `INSERT INTO skill_evidence_operations (operation_id, action, request_hash, subject_id, applied_at, result_json, is_erased)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [action.operationId, action.action, requestHash, subjectId, timestamp, JSON.stringify(result)],
    );
    await exec("COMMIT");
    return { status: "applied", result };
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {
      // The original error is the one worth reporting.
    }
    if (error instanceof SkillEvidenceError) throw error;
    throw Object.assign(new SkillEvidenceError("STORAGE_FAILURE", "The change could not be saved."), { cause: error });
  }
}

type One = (sql: string, params: SqlValue[]) => Promise<Record<string, unknown> | undefined>;

async function apply(
  run: Run,
  one: One,
  query: Query,
  action: SkillEvidenceAction,
  timestamp: string,
): Promise<{ result: SkillEvidenceResult; subjectId: string }> {
  switch (action.action) {
    case "create_custom_skill": {
      if (await one("SELECT 1 FROM skill_catalog_entries WHERE id = ?", [action.skillId])) {
        refuse("OPERATION_CONFLICT", "That skill id is already in use.");
      }
      const [{ n }] = (await query("SELECT COUNT(*) AS n FROM skill_catalog_entries WHERE origin = 'custom'", [])) as [{ n: number }];
      if (Number(n) >= LIMITS.customSkills) refuse("LIMIT_EXCEEDED", `You can keep up to ${LIMITS.customSkills} custom skills.`);
      await refuseDuplicateLabel(query, action.label, null);
      await run(
        `INSERT INTO skill_catalog_entries (id, origin, catalog_version, label, description, topic, status, revision, created_at, updated_at, retired_at)
         VALUES (?, 'custom', NULL, ?, ?, ?, 'active', 1, ?, ?, NULL)`,
        [action.skillId, action.label, action.description, action.topic, timestamp, timestamp],
      );
      await appendSkillRevision(run, action.skillId, 1, action.label, action.description, action.topic, "active", action.operationId, timestamp);
      return { result: { action: action.action, skillId: action.skillId, revision: 1 }, subjectId: action.skillId };
    }
    case "edit_custom_skill": {
      const skill = await requireSkill(one, action.skillId);
      if (skill["origin"] !== "custom") refuse("BUILTIN_READ_ONLY", "Built-in skill names come from the catalog and cannot be edited.");
      requireRevision(skill, action.expectedRevision);
      if (skill["status"] === "retired") refuse("SKILL_RETIRED", "Restore this skill before editing it.");
      if (skill["label"] === action.label && skill["description"] === action.description && skill["topic"] === action.topic) {
        refuse("INVALID_ARGUMENT", "Nothing changed.");
      }
      await refuseDuplicateLabel(query, action.label, action.skillId);
      const revision = Number(skill["revision"]) + 1;
      await run(
        "UPDATE skill_catalog_entries SET label = ?, description = ?, topic = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?",
        [action.label, action.description, action.topic, revision, timestamp, action.skillId, action.expectedRevision],
      );
      await appendSkillRevision(run, action.skillId, revision, action.label, action.description, action.topic, "active", action.operationId, timestamp);
      return { result: { action: action.action, skillId: action.skillId, revision }, subjectId: action.skillId };
    }
    case "retire_skill":
    case "restore_skill": {
      const skill = await requireSkill(one, action.skillId);
      requireRevision(skill, action.expectedRevision);
      const target = action.action === "retire_skill" ? "retired" : "active";
      if (skill["status"] === target) refuse("INVALID_ARGUMENT", target === "retired" ? "That skill is already retired." : "That skill is already active.");
      if (target === "active") await refuseDuplicateLabel(query, String(skill["label"]), action.skillId);
      const revision = Number(skill["revision"]) + 1;
      await run(
        "UPDATE skill_catalog_entries SET status = ?, retired_at = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?",
        [target, target === "retired" ? timestamp : null, revision, timestamp, action.skillId, action.expectedRevision],
      );
      await appendSkillRevision(
        run, action.skillId, revision, String(skill["label"]), String(skill["description"]), String(skill["topic"]) as Topic,
        target, action.operationId, timestamp, skill["origin"] === "builtin" ? Number(skill["catalog_version"]) : null,
      );
      return { result: { action: action.action, skillId: action.skillId, revision }, subjectId: action.skillId };
    }
    case "create_observation": {
      if (await one("SELECT 1 FROM skill_observations WHERE id = ?", [action.observationId])) {
        refuse("OPERATION_CONFLICT", "That observation id is already in use.");
      }
      if (await one("SELECT 1 FROM skill_evidence_operations WHERE subject_id = ? AND is_erased = 1", [action.observationId])) {
        refuse("ERASED", "That observation was erased and cannot be recreated under the same id.");
      }
      const skill = await requireSkill(one, action.skillId);
      if (skill["status"] === "retired") refuse("SKILL_RETIRED", "That skill is retired. Restore it to add new observations.");
      const journal = await one("SELECT id, date, title, instructor_feedback, went_well, was_difficult, practiced FROM journal_entries WHERE id = ?", [action.journalId]);
      if (!journal) refuse("SOURCE_MISSING", "That lesson debrief no longer exists.");
      const [{ n }] = (await query("SELECT COUNT(*) AS n FROM skill_observations WHERE journal_id = ?", [action.journalId])) as [{ n: number }];
      if (Number(n) >= LIMITS.observationsPerDebrief) refuse("LIMIT_EXCEEDED", `One debrief can hold up to ${LIMITS.observationsPerDebrief} observations.`);
      let sourceHash: string | null = null;
      if (action.sourceField !== "none") {
        const text = String(journal[SOURCE_FIELD_COLUMNS[action.sourceField]] ?? "");
        if (text.trim() === "") refuse("INVALID_ARGUMENT", "That part of the debrief is empty.");
        sourceHash = await sha256Hex(text);
      }
      await run(
        `INSERT INTO skill_observations (
           id, skill_id, skill_label_snapshot, journal_id, source_journal_id, source_journal_date, source_journal_title,
           source_field, source_text_sha256, attribution, instructor_name, wording, observed_on, revision,
           action_id, linked_action_id, linked_action_title, addressed_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL, NULL, ?, ?)`,
        [
          action.observationId, action.skillId, String(skill["label"]), action.journalId, action.journalId,
          String(journal["date"]), clip(String(journal["title"] ?? ""), LIMITS.sourceTitleCodePoints), action.sourceField,
          sourceHash, action.attribution, action.instructorName, action.wording, action.observedOn, timestamp, timestamp,
        ],
      );
      await appendObservationRevision(run, action.observationId, 1, "created", {
        wording: action.wording, observedOn: action.observedOn, attribution: action.attribution, instructorName: action.instructorName,
        linkedActionId: null, linkedActionTitle: null, addressedAt: null,
      }, action.operationId, timestamp);
      return { result: { action: action.action, observationId: action.observationId, revision: 1 }, subjectId: action.observationId };
    }
    case "edit_observation":
    case "link_action":
    case "unlink_action":
    case "set_addressed": {
      const row = await one("SELECT * FROM skill_observations WHERE id = ?", [action.observationId]);
      if (!row) refuse("NOT_FOUND", "That observation no longer exists.");
      requireRevision(row, action.expectedRevision);
      const next = {
        wording: String(row["wording"]),
        observedOn: String(row["observed_on"]),
        attribution: String(row["attribution"]) as Attribution,
        instructorName: String(row["instructor_name"]),
        actionId: row["action_id"] == null ? null : String(row["action_id"]),
        linkedActionId: row["linked_action_id"] == null ? null : String(row["linked_action_id"]),
        linkedActionTitle: row["linked_action_title"] == null ? null : String(row["linked_action_title"]),
        addressedAt: row["addressed_at"] == null ? null : String(row["addressed_at"]),
      };
      let kind: "edited" | "linked_action" | "unlinked_action" | "marked_addressed" | "cleared_addressed";
      if (action.action === "edit_observation") {
        if (
          next.wording === action.wording && next.observedOn === action.observedOn &&
          next.attribution === action.attribution && next.instructorName === action.instructorName
        ) refuse("INVALID_ARGUMENT", "Nothing changed.");
        Object.assign(next, { wording: action.wording, observedOn: action.observedOn, attribution: action.attribution, instructorName: action.instructorName });
        kind = "edited";
      } else if (action.action === "link_action") {
        const linked = await one("SELECT id, title FROM next_actions WHERE id = ?", [action.actionId]);
        if (!linked) refuse("NOT_FOUND", "That follow-up action no longer exists.");
        if (next.actionId === action.actionId) refuse("INVALID_ARGUMENT", "That action is already linked.");
        Object.assign(next, {
          actionId: action.actionId,
          linkedActionId: action.actionId,
          linkedActionTitle: clip(String(linked["title"] ?? ""), LIMITS.sourceTitleCodePoints),
        });
        kind = "linked_action";
      } else if (action.action === "unlink_action") {
        if (next.linkedActionId === null) refuse("INVALID_ARGUMENT", "No action is linked.");
        Object.assign(next, { actionId: null, linkedActionId: null, linkedActionTitle: null });
        kind = "unlinked_action";
      } else {
        if ((next.addressedAt !== null) === action.addressed) {
          refuse("INVALID_ARGUMENT", action.addressed ? "Already marked addressed." : "Not marked addressed.");
        }
        next.addressedAt = action.addressed ? timestamp : null;
        kind = action.addressed ? "marked_addressed" : "cleared_addressed";
      }
      const revision = Number(row["revision"]) + 1;
      await run(
        `UPDATE skill_observations SET wording = ?, observed_on = ?, attribution = ?, instructor_name = ?,
           action_id = ?, linked_action_id = ?, linked_action_title = ?, addressed_at = ?, revision = ?, updated_at = ?
         WHERE id = ? AND revision = ?`,
        [
          next.wording, next.observedOn, next.attribution, next.instructorName, next.actionId, next.linkedActionId,
          next.linkedActionTitle, next.addressedAt, revision, timestamp, action.observationId, action.expectedRevision,
        ],
      );
      await appendObservationRevision(run, action.observationId, revision, kind, next, action.operationId, timestamp);
      return { result: { action: action.action, observationId: action.observationId, revision }, subjectId: action.observationId };
    }
    case "set_status":
    case "set_confidence": {
      await requireSkill(one, action.skillId);
      const kind = action.action === "set_status" ? "status" : "confidence";
      const latest = await one(
        "SELECT sequence, status, confidence FROM skill_self_assessments WHERE skill_id = ? AND kind = ? ORDER BY sequence DESC LIMIT 1",
        [action.skillId, kind],
      );
      const current = latest ? Number(latest["sequence"]) : 0;
      if (current !== action.expectedSequence) refuse("STALE_REVISION", "This changed somewhere else. Reload to see the latest.");
      const value = action.action === "set_status" ? action.status : action.confidence;
      const currentValue = latest ? (kind === "status" ? latest["status"] : latest["confidence"]) ?? null : null;
      if ((currentValue === null ? null : kind === "status" ? String(currentValue) : Number(currentValue)) === value) {
        refuse("INVALID_ARGUMENT", "Nothing changed.");
      }
      const sequence = current + 1;
      await run(
        `INSERT INTO skill_self_assessments (id, skill_id, kind, status, confidence, sequence, operation_id, set_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          action.operationId, action.skillId, kind, kind === "status" ? (value as string | null) : null,
          kind === "confidence" ? (value as number | null) : null, sequence, action.operationId, timestamp,
        ],
      );
      return { result: { action: action.action, skillId: action.skillId, sequence }, subjectId: action.skillId };
    }
    case "erase_observation": {
      if (!(await one("SELECT 1 FROM skill_observations WHERE id = ?", [action.observationId]))) {
        refuse("NOT_FOUND", "That observation no longer exists.");
      }
      // Receipts for the subject become non-content tombstones, so an old
      // retry cannot bring the observation back.
      await run(
        "UPDATE skill_evidence_operations SET is_erased = 1, result_json = NULL WHERE subject_id = ? AND is_erased = 0",
        [action.observationId],
      );
      // The observation, then (by cascade, once it is gone) its history.
      await run("DELETE FROM skill_observations WHERE id = ?", [action.observationId]);
      return { result: { action: action.action, observationId: action.observationId, erased: true }, subjectId: action.observationId };
    }
  }
}

async function requireSkill(one: One, skillId: string): Promise<Record<string, unknown>> {
  const skill = await one("SELECT * FROM skill_catalog_entries WHERE id = ?", [skillId]);
  if (!skill) refuse("NOT_FOUND", "That skill does not exist.");
  return skill;
}

function requireRevision(row: Record<string, unknown>, expected: number): void {
  if (Number(row["revision"]) !== expected) refuse("STALE_REVISION", "This changed somewhere else. Reload to see the latest.");
}

async function refuseDuplicateLabel(query: Query, label: string, exceptId: string | null): Promise<void> {
  const key = labelKey(label);
  for (const row of await query("SELECT id, label FROM skill_catalog_entries WHERE status = 'active'", [])) {
    if (row["id"] !== exceptId && labelKey(String(row["label"])) === key) {
      refuse("DUPLICATE_LABEL", `A skill called "${String(row["label"])}" already exists.`);
    }
  }
}

async function appendSkillRevision(
  run: Run,
  skillId: string,
  revision: number,
  label: string,
  description: string,
  topic: Topic,
  status: "active" | "retired",
  operationId: string,
  timestamp: string,
  catalogVersion: number | null = null,
): Promise<void> {
  await run(
    `INSERT INTO skill_catalog_revisions (skill_id, revision, label, description, topic, status, catalog_version, changed_by, operation_id, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?, ?)`,
    [skillId, revision, label, description, topic, status, catalogVersion, operationId, timestamp],
  );
}

interface Snapshot {
  wording: string;
  observedOn: string;
  attribution: Attribution;
  instructorName: string;
  linkedActionId: string | null;
  linkedActionTitle: string | null;
  addressedAt: string | null;
}

async function appendObservationRevision(
  run: Run,
  observationId: string,
  revision: number,
  kind: string,
  s: Snapshot,
  operationId: string,
  timestamp: string,
): Promise<void> {
  await run(
    `INSERT INTO skill_observation_revisions (
       observation_id, revision, change_kind, wording, observed_on, attribution, instructor_name,
       linked_action_id, linked_action_title, addressed_at, operation_id, recorded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      observationId, revision, kind, s.wording, s.observedOn, s.attribution, s.instructorName, s.linkedActionId,
      s.linkedActionTitle, s.addressedAt, operationId, timestamp,
    ],
  );
}
