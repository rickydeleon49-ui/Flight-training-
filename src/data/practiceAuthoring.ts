/**
 * Practice-question authoring (OFFLINE-03b round 1).
 *
 * One exact-key contract — `PracticeSnapshot` — describes a material's
 * current test for reading, for the expected-state concurrency check, and as
 * the `previous_json` of every `study_set_history (kind='practice')` row.
 * A save carries `PracticeNext`: desired content and editor metadata only.
 * The server assigns fresh version/item ids, the next version number and the
 * timestamps; caller-supplied server state is never trusted. The version
 * number only ever climbs — surviving rows and preserved snapshots alike
 * carry the evidence, however far pruning went — and one logical identity
 * stays owned by the living material that ever held it.
 *
 * Every committed operation leaves a durable receipt in
 * `practice_save_operations` binding the material, the action and the exact
 * canonical payload bytes plus their SHA-256 digest. An exact retry returns
 * the stored result as `already_saved` — even after later operations changed
 * the current state — without a second version, history row or item ids.
 * A reused id with any other payload refuses as `CONFLICT`; presence alone
 * is never accepted.
 *
 * Retirement protection (identity, replaces, deleted/corrected records) is
 * enforced here and natively, not only in a UI: an instructor correction can
 * never be relabelled or dropped, every removed or rewritten wording must be
 * recorded, records are only ever retained or grown, and the 2,000-entry
 * bound refuses the whole save before the transaction begins.
 *
 * Editor metadata never enters the canonical question hash: `origin` joins
 * it only when present (the `cardIdentity.ts` rule), so every legacy
 * five-field hash stays byte-identical.
 */
import type {
  PracticeAuthoringQuestion,
  PracticeNext,
  PracticeRetirementRecord,
  PracticeSaveOperation,
  PracticeSaveReason,
  PracticeSaveResult,
  PracticeSnapshot,
  StudyItemOrigin,
} from "@/domain/types";

import type { SqlValue } from "./db";
import { decodePdfKitSources, validatePdfKitContent, writePdfKitSources } from "./pdfKitSources";
import { PracticeAuthoringError, type PracticeAuthoringErrorCode } from "./persistenceErrors";
import {
  canonicalJson,
  codePointLength,
  computeCanonicalHash,
  isUuidV4,
  type Query,
} from "./practiceSessionTransaction";
import { normalizedStudyText, retirementTerms } from "@/logic/studyAuthoring";
import { sha256Hex } from "@/logic/cardIdentity";

const MAX_PRACTICE_QUESTIONS = 200;
const MAX_QUESTION_CHARS = 10_000;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;
const MAX_OPTION_CHARS = 1_000;
const MAX_EXPLANATION_CHARS = 5_000;
const MIN_SOURCE_PAGE = 1;
const MAX_SOURCE_PAGE = 1_000;
const MAX_RETIRED_ITEMS = 2_000;
const MAX_RETIREMENT_TERMS = 64;
const MAX_TITLE_CHARS = 500;
const MAX_MODEL_CHARS = 200;

const HEX_64 = /^[0-9a-f]{64}$/;
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const PROVIDERS = ["gemini", "import", "manual"] as const;
const REASONS = ["create", "edit", "correct", "regenerate", "restore", "remove"] as const;
/** Operation reason → stored history reason. Creating replaces nothing. */
const HISTORY_REASON: Readonly<Record<PracticeSaveReason, "edit" | "delete" | "correct" | "regenerate" | "restore">> = {
  create: "edit",
  edit: "edit",
  correct: "correct",
  regenerate: "regenerate",
  restore: "restore",
  remove: "delete",
};

function refuse(code: PracticeAuthoringErrorCode, options?: { cause?: unknown }): never {
  throw new PracticeAuthoringError(code, options);
}

type Json = unknown;
const isRecord = (value: Json): value is Record<string, Json> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const has = (map: Record<string, Json>, key: string) => Object.prototype.hasOwnProperty.call(map, key);

function exactKeys(map: Record<string, Json>, required: readonly string[], optional: readonly string[] = []): void {
  if (required.some((key) => !has(map, key)) || Object.keys(map).some((key) => !required.includes(key) && !optional.includes(key))) {
    refuse("INVALID_ARGUMENT");
  }
}

function boundedText(value: Json, max: number): string {
  if (typeof value !== "string" || codePointLength(value) > max) refuse("INVALID_ARGUMENT");
  return value;
}

function nonEmptyText(value: Json, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) refuse("INVALID_ARGUMENT");
  return value;
}

function originOf(value: Json): StudyItemOrigin | undefined {
  if (value !== "user" && value !== "instructor") refuse("INVALID_ARGUMENT");
  return value;
}

/**
 * The retirement fingerprint inputs of one question: its wording, every
 * option, the answer position and the explanation — so correcting any part
 * of a question produces a new key that regeneration matching must hold
 * back. Shared, deterministic, and never part of the content hash.
 */
export function practiceRetirementFields(question: Pick<PracticeAuthoringQuestion, "question" | "options" | "correctIndex" | "explanation">): readonly string[] {
  return Object.freeze([question.question, ...question.options, `answer:${question.correctIndex}`, question.explanation]);
}

export async function practiceRetirementRecord(
  question: Pick<PracticeAuthoringQuestion, "question" | "options" | "correctIndex" | "explanation" | "identity">,
  reason: PracticeRetirementRecord["reason"],
): Promise<PracticeRetirementRecord> {
  const fields = practiceRetirementFields(question);
  return Object.freeze({
    kind: "question" as const,
    itemId: question.identity,
    reason,
    textKey: await sha256Hex(JSON.stringify(fields.map(normalizedStudyText))),
    terms: retirementTerms(fields),
  });
}

/** The canonical-hash projection: five content fields, plus `origin` only when present. */
export function canonicalHashableQuestions(questions: readonly PracticeAuthoringQuestion[]): readonly Record<string, unknown>[] {
  return questions.map(({ question, options, correctIndex, explanation, sourcePage, origin }) =>
    origin ? { question, options, correctIndex, explanation, sourcePage, origin } : { question, options, correctIndex, explanation, sourcePage },
  );
}

export async function practiceContentHash(questions: readonly PracticeAuthoringQuestion[]): Promise<string> {
  return computeCanonicalHash(canonicalHashableQuestions(questions));
}

function decodeQuestion(value: Json): PracticeAuthoringQuestion {
  if (!isRecord(value)) refuse("INVALID_ARGUMENT");
  exactKeys(value, ["question", "options", "correctIndex", "explanation", "sourcePage", "identity"], ["origin", "replaces"]);
  if (typeof value.question !== "string") refuse("INVALID_ARGUMENT");
  const questionLength = codePointLength(value.question);
  if (questionLength === 0 || questionLength > MAX_QUESTION_CHARS) refuse("INVALID_ARGUMENT");
  if (!Array.isArray(value.options) || value.options.length < MIN_OPTIONS || value.options.length > MAX_OPTIONS) refuse("INVALID_ARGUMENT");
  for (const option of value.options) {
    if (typeof option !== "string") refuse("INVALID_ARGUMENT");
    const length = codePointLength(option);
    if (length === 0 || length > MAX_OPTION_CHARS) refuse("INVALID_ARGUMENT");
  }
  const correctIndex = value.correctIndex;
  if (typeof correctIndex !== "number" || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= value.options.length) {
    refuse("INVALID_ARGUMENT");
  }
  if (typeof value.explanation !== "string" || codePointLength(value.explanation) > MAX_EXPLANATION_CHARS) refuse("INVALID_ARGUMENT");
  const sourcePage = value.sourcePage;
  if (sourcePage !== null && !(typeof sourcePage === "number" && Number.isInteger(sourcePage) && sourcePage >= MIN_SOURCE_PAGE && sourcePage <= MAX_SOURCE_PAGE)) {
    refuse("INVALID_ARGUMENT");
  }
  const identity = value.identity;
  if (typeof identity !== "string" || !isUuidV4(identity)) refuse("INVALID_ARGUMENT");
  const out: PracticeAuthoringQuestion = {
    question: value.question,
    options: value.options as string[],
    correctIndex,
    explanation: value.explanation,
    sourcePage: sourcePage as number | null,
    identity,
  };
  if (has(value, "origin")) out.origin = originOf(value.origin);
  if (has(value, "replaces")) {
    if (out.origin === undefined || typeof value.replaces !== "string" || !isUuidV4(value.replaces)) refuse("INVALID_ARGUMENT");
    out.replaces = value.replaces;
  }
  return out;
}

function decodeRetirement(value: Json, keys: Set<string>): PracticeRetirementRecord {
  if (!isRecord(value)) refuse("INVALID_ARGUMENT");
  exactKeys(value, ["kind", "itemId", "reason", "textKey", "terms"]);
  const { kind, itemId, reason, textKey, terms } = value;
  if (
    kind !== "question" ||
    typeof itemId !== "string" || !ITEM_ID.test(itemId) ||
    (reason !== "deleted" && reason !== "corrected") ||
    typeof textKey !== "string" || !HEX_64.test(textKey) ||
    !Array.isArray(terms) || terms.length > MAX_RETIREMENT_TERMS
  ) refuse("INVALID_ARGUMENT");
  let previous: string | null = null;
  for (const term of terms) {
    if (typeof term !== "string" || term.length === 0 || codePointLength(term) > MAX_QUESTION_CHARS) refuse("INVALID_ARGUMENT");
    if (previous !== null && !(previous < term)) refuse("INVALID_ARGUMENT");
    previous = term;
  }
  const key = JSON.stringify([kind, itemId, reason, textKey]);
  if (keys.has(key)) refuse("INVALID_ARGUMENT");
  keys.add(key);
  return Object.freeze({ kind: "question", itemId, reason, textKey, terms: Object.freeze([...(terms as string[])]) });
}

function decodeRetirements(value: Json): PracticeRetirementRecord[] {
  if (!Array.isArray(value)) refuse("INVALID_ARGUMENT");
  if (value.length > MAX_RETIRED_ITEMS) refuse("RETIREMENT_LIMIT");
  const keys = new Set<string>();
  return value.map((entry) => decodeRetirement(entry, keys));
}

function decodeQuestions(value: Json): PracticeAuthoringQuestion[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PRACTICE_QUESTIONS) refuse("INVALID_ARGUMENT");
  const ids = new Set<string>();
  return value.map((entry) => {
    const question = decodeQuestion(entry);
    if (ids.has(question.identity)) refuse("INVALID_ARGUMENT");
    ids.add(question.identity);
    return question;
  });
}

/** The shared exact-key snapshot: what is stored, expected and kept in history. */
export function decodePracticeSnapshot(value: Json): PracticeSnapshot {
  if (!isRecord(value)) refuse("INVALID_ARGUMENT");
  exactKeys(value, ["schemaVersion", "versionId", "versionNumber", "title", "provider", "model", "savedAt", "questions", "retired"]);
  if (value.schemaVersion !== 1) refuse("INVALID_ARGUMENT");
  if (typeof value.versionId !== "string" || !isUuidV4(value.versionId)) refuse("INVALID_ARGUMENT");
  const versionNumber = value.versionNumber;
  if (typeof versionNumber !== "number" || !Number.isInteger(versionNumber) || versionNumber < 1) refuse("INVALID_ARGUMENT");
  if (!PROVIDERS.includes(value.provider as (typeof PROVIDERS)[number])) refuse("INVALID_ARGUMENT");
  return {
    schemaVersion: 1,
    versionId: value.versionId,
    versionNumber,
    title: boundedText(value.title, MAX_TITLE_CHARS),
    provider: value.provider as PracticeSnapshot["provider"],
    model: boundedText(value.model, MAX_MODEL_CHARS),
    savedAt: nonEmptyText(value.savedAt, 64),
    questions: decodeQuestions(value.questions),
    retired: decodeRetirements(value.retired),
  };
}

/** The desired content of one save: content and editor metadata, no server state. */
export function decodePracticeNext(value: Json): PracticeNext {
  if (!isRecord(value)) refuse("INVALID_ARGUMENT");
  exactKeys(value, ["title", "provider", "model", "questions", "retired"]);
  if (!PROVIDERS.includes(value.provider as (typeof PROVIDERS)[number])) refuse("INVALID_ARGUMENT");
  return {
    title: boundedText(value.title, MAX_TITLE_CHARS),
    provider: value.provider as PracticeNext["provider"],
    model: boundedText(value.model, MAX_MODEL_CHARS),
    questions: decodeQuestions(value.questions),
    retired: decodeRetirements(value.retired),
  };
}

export function decodePracticeOperation(value: Json): PracticeSaveOperation {
  if (!isRecord(value)) refuse("INVALID_ARGUMENT");
  exactKeys(value, ["operationId", "sourceMaterialId", "reason", "expected", "next"], ["pdfKitSources"]);
  const { operationId, sourceMaterialId, reason } = value;
  if (typeof operationId !== "string" || !isUuidV4(operationId)) refuse("INVALID_ARGUMENT");
  if (typeof sourceMaterialId !== "string" || sourceMaterialId.length === 0 || sourceMaterialId.length > 200) refuse("INVALID_ARGUMENT");
  if (!REASONS.includes(reason as PracticeSaveReason)) refuse("INVALID_ARGUMENT");
  const expected = value.expected === null ? null : decodePracticeSnapshot(value.expected);
  const next = value.next === null ? null : decodePracticeNext(value.next);
  // A restore may expect no current test: the previous one was removed, so
  // there was nothing current to match — but it always carries the content
  // being brought back. Every other reason keeps its exact pairing.
  const consistent =
    reason === "create" ? expected === null && next !== null && next.retired.length === 0
      : reason === "remove" ? next === null
        : reason === "restore" ? next !== null
          : expected !== null && next !== null;
  if (!consistent) refuse("INVALID_ARGUMENT");
  let pdfKitSources;
  if (has(value, "pdfKitSources")) {
    if (!next) refuse("INVALID_ARGUMENT");
    try { pdfKitSources = decodePdfKitSources(value.pdfKitSources, sourceMaterialId); } catch { refuse("INVALID_ARGUMENT"); }
  }
  return { operationId, sourceMaterialId, reason: reason as PracticeSaveReason, expected, next, ...(pdfKitSources ? { pdfKitSources } : {}) };
}

/** One retirement record, compared byte-identically (terms included). */
const entryJson = (entry: PracticeRetirementRecord): string =>
  JSON.stringify([entry.kind, entry.itemId, entry.reason, entry.textKey, [...entry.terms]]);

/**
 * Append retirement records, deduplicating exact repeats and refusing the
 * whole growth beyond the 2,000-entry bound. Records are only ever retained
 * or added; nothing is evicted or altered.
 */
export function appendPracticeRetirements(
  existing: readonly PracticeRetirementRecord[],
  incoming: readonly PracticeRetirementRecord[],
): PracticeRetirementRecord[] {
  const seen = new Set<string>();
  const out: PracticeRetirementRecord[] = [];
  for (const entry of [...existing, ...incoming]) {
    const key = entryJson(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  if (out.length > MAX_RETIRED_ITEMS) refuse("RETIREMENT_LIMIT");
  return out;
}

function sameTerms(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((term, index) => term === b[index]);
}

/**
 * The provenance transitions one save may express. An instructor correction
 * is sticky: once recorded it can never be relabelled or dropped. Generated
 * or imported content may become hers (`user`) or an instructor correction,
 * and her own question may later become an instructor correction — promotion
 * only, never a downgrade or a silent drop.
 */
export function allowsOriginTransition(
  before: StudyItemOrigin | undefined,
  after: StudyItemOrigin | undefined,
): boolean {
  if (before === undefined) return true;
  if (before === "user") return after === "user" || after === "instructor";
  return after === "instructor";
}

/**
 * The protection rules provable from the two snapshots alone (the retirement
 * bound was already checked in the decoder, before any transaction):
 * - every prior record is retained byte-identically — terms included — and
 *   records only ever grow;
 * - a question an edit/correct removes retires its exact earlier wording
 *   (`corrected` when a replacement lineage names it, `deleted` otherwise);
 *   a regeneration may only drop her own questions (origin-bearing) when
 *   their exact wording is retired the same way;
 * - an identity whose wording an edit/correct changes must carry the exact
 *   computed `corrected` record for the earlier wording — an older record
 *   for the same identity never stands in for it;
 * - stored origins follow `allowsOriginTransition`, so an instructor
 *   correction can never be relabelled, dropped or laundered through a
 *   replacement lineage;
 * - a `replaces` target an edit/correct/create names must be resolvable
 *   from the snapshots, and an instructor lineage continues only as an
 *   instructor correction. Targets that live solely in preserved history
 *   (restore, regeneration keep-mine) are resolved authoritatively by
 *   `enforceStoredLineage` inside the transaction.
 */
export async function validateProtection(
  expected: PracticeSnapshot,
  next: PracticeNext,
  reason: PracticeSaveReason,
): Promise<void> {
  const nextByIdentity = new Map(next.questions.map((question) => [question.identity, question]));
  const expectedByIdentity = new Map(expected.questions.map((question) => [question.identity, question]));
  const retiredIds = new Set(expected.retired.map((entry) => entry.itemId));
  const nextEntries = new Set(next.retired.map(entryJson));

  const hasExactRecord = async (
    before: PracticeAuthoringQuestion,
    recordReason: PracticeRetirementRecord["reason"],
  ): Promise<boolean> => {
    const computed = await practiceRetirementRecord(before, recordReason);
    return nextEntries.has(entryJson(computed));
  };

  for (const entry of expected.retired) {
    if (!nextEntries.has(entryJson(entry))) refuse("INVALID_ARGUMENT");
  }

  for (const before of expected.questions) {
    const after = nextByIdentity.get(before.identity);
    if (!after) {
      const needsRecord =
        reason === "edit" || reason === "correct" || (reason === "regenerate" && before.origin !== undefined);
      if (needsRecord) {
        const replaced = next.questions.some((question) => question.replaces === before.identity);
        if (!(await hasExactRecord(before, replaced ? "corrected" : "deleted"))) refuse("INVALID_ARGUMENT");
      }
      continue;
    }
    if (!allowsOriginTransition(before.origin, after.origin)) refuse("INVALID_ARGUMENT");
    if (reason === "edit" || reason === "correct") {
      const [oldRecord, newRecord] = await Promise.all([
        practiceRetirementRecord(before, "corrected"),
        practiceRetirementRecord(after, "corrected"),
      ]);
      if (oldRecord.textKey !== newRecord.textKey || !sameTerms(oldRecord.terms, newRecord.terms)) {
        // Her wording changed, so the exact earlier wording must be retired.
        if (!(await hasExactRecord(before, "corrected"))) refuse("INVALID_ARGUMENT");
      }
    }
  }

  const originInSnapshot = (identity: string): { known: boolean; origin?: StudyItemOrigin } => {
    const inExpected = expectedByIdentity.get(identity);
    if (inExpected) return { known: true, origin: inExpected.origin };
    const inNext = nextByIdentity.get(identity);
    if (inNext) return { known: true, origin: inNext.origin };
    if (retiredIds.has(identity)) return { known: true };
    return { known: false };
  };
  for (const question of next.questions) {
    let target = question.replaces;
    const seen = new Set<string>([question.identity]);
    while (target !== undefined) {
      if (seen.has(target)) refuse("INVALID_ARGUMENT");
      seen.add(target);
      const found = originInSnapshot(target);
      if (!found.known) {
        if (reason === "edit" || reason === "correct" || reason === "create") refuse("INVALID_ARGUMENT");
        break;
      }
      if (found.origin !== undefined) {
        if (!allowsOriginTransition(found.origin, question.origin)) refuse("INVALID_ARGUMENT");
        break;
      }
      target = nextByIdentity.get(target)?.replaces;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Snapshot assembly from stored rows (shared by the transaction and   */
/* the repository readers).                                            */
/* ------------------------------------------------------------------ */

export interface SnapshotSourceRows {
  version: Record<string, unknown>;
  items: Record<string, unknown>[];
  retiredJson: string | null;
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function parseOptions(raw: string): string[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((option) => typeof option !== "string")) throw new Error("damaged options");
  return parsed as string[];
}

/** Builds the exact snapshot a material's active version currently holds. */
export function buildSnapshotFromRows(rows: SnapshotSourceRows): PracticeSnapshot {
  const questions: PracticeAuthoringQuestion[] = rows.items.map((item) => {
    const identity = nullableText(item, "logical_id") ?? String(item["id"]);
    const origin = nullableText(item, "origin");
    const replaces = nullableText(item, "replaces_id");
    const sourcePage = item["source_page"];
    return {
      question: String(item["question_text"]),
      options: parseOptions(String(item["options_json"])),
      correctIndex: Number(item["correct_index"]),
      explanation: String(item["explanation"] ?? ""),
      sourcePage: sourcePage === null || sourcePage === undefined ? null : Number(sourcePage),
      identity,
      ...(origin === "user" || origin === "instructor" ? { origin: origin as StudyItemOrigin } : {}),
      ...(origin && replaces ? { replaces } : {}),
    };
  });
  let retired: PracticeRetirementRecord[] = [];
  try {
    retired = decodeRetirements(JSON.parse(rows.retiredJson ?? "[]"));
  } catch {
    retired = [];
  }
  return {
    schemaVersion: 1,
    versionId: String(rows.version["id"]),
    versionNumber: Number(rows.version["version_number"]),
    title: String(rows.version["title"]),
    provider: String(rows.version["provider"]) as PracticeSnapshot["provider"],
    model: String(rows.version["model"] ?? ""),
    savedAt: String(rows.version["created_at"]),
    questions,
    retired,
  };
}

const SNAPSHOT_SELECT = `
  SELECT v.id, v.version_number, v.title, v.provider, v.model, v.created_at,
         i.id AS item_id_row, i.ordinal, i.question_text, i.options_json, i.correct_index,
         i.explanation, i.source_page, i.logical_id, i.replaces_id, o.origin
    FROM practice_test_versions v
    JOIN practice_test_items i ON i.version_id = v.id
    LEFT JOIN practice_item_origins o ON o.item_id = i.id
   WHERE v.source_material_id = ? AND v.is_active = 1
   ORDER BY i.ordinal ASC`;

/** The material's current test exactly as stored, or null when there is none. */
export async function readCurrentSnapshot(query: Query, materialId: string): Promise<PracticeSnapshot | null> {
  const rows = await query(SNAPSHOT_SELECT, [materialId]);
  if (rows.length === 0) return null;
  const version = rows[0]!;
  const items = rows.map((row) => ({
    id: String(row["item_id_row"]),
    question_text: row["question_text"],
    options_json: row["options_json"],
    correct_index: row["correct_index"],
    explanation: row["explanation"],
    source_page: row["source_page"],
    logical_id: row["logical_id"],
    replaces_id: row["replaces_id"],
    origin: row["origin"],
  }));
  const [mirror] = await query("SELECT retired_json FROM practice_tests WHERE source_material_id = ?", [materialId]);
  return buildSnapshotFromRows({
    version: {
      id: version["id"],
      version_number: version["version_number"],
      title: version["title"],
      provider: version["provider"],
      model: version["model"],
      created_at: version["created_at"],
    },
    items,
    retiredJson: mirror ? nullableText(mirror, "retired_json") : null,
  });
}

/* ------------------------------------------------------------------ */
/* The transaction                                                     */
/* ------------------------------------------------------------------ */

const sameSnapshot = (a: PracticeSnapshot | null, b: PracticeSnapshot | null): boolean =>
  canonicalJson(a) === canonicalJson(b);

/**
 * The authoritative lineage check inside the transaction. Identities and
 * replacement targets are resolved against the material's whole preserved
 * authoring history — every previous snapshot is kept verbatim in
 * `study_set_history` — so pruned or detached originals still protect their
 * provenance, a re-added identity can never come back relabelled, and no
 * replacement can claim a lineage this material never held.
 */
async function enforceStoredLineage(
  query: Query,
  materialId: string,
  expected: PracticeSnapshot | null,
  next: PracticeNext,
): Promise<void> {
  const rows = await query(
    `SELECT previous_json FROM study_set_history
      WHERE material_id = ? AND kind = 'practice'
      ORDER BY created_at DESC, id DESC`,
    [materialId],
  );
  // Provenance is monotone across every preserved snapshot: instructor
  // dominates user, user dominates no record. Wall-clock ties and random
  // row ids can therefore never pick a weaker label over a stronger one.
  const strongest = (
    a: StudyItemOrigin | undefined,
    b: StudyItemOrigin | undefined,
  ): StudyItemOrigin | undefined =>
    a === "instructor" || b === "instructor"
      ? "instructor"
      : a === "user" || b === "user"
        ? "user"
        : undefined;
  const historyOrigin = new Map<string, StudyItemOrigin | undefined>();
  for (const row of rows) {
    let snapshot: PracticeSnapshot | null = null;
    try {
      snapshot = decodePracticeSnapshot(JSON.parse(String(row["previous_json"])));
    } catch {
      snapshot = null; // a damaged envelope is refused at startup by the schema-17 validator
    }
    if (!snapshot) continue;
    for (const question of snapshot.questions) {
      historyOrigin.set(question.identity, strongest(historyOrigin.get(question.identity), question.origin));
    }
  }
  const expectedByIdentity = new Map((expected?.questions ?? []).map((question) => [question.identity, question]));
  const nextByIdentity = new Map(next.questions.map((question) => [question.identity, question]));
  const retiredIds = new Set((expected?.retired ?? []).map((entry) => entry.itemId));
  const originOf = (identity: string): { known: boolean; origin?: StudyItemOrigin } => {
    const inExpected = expectedByIdentity.get(identity);
    if (inExpected) return { known: true, origin: inExpected.origin };
    if (historyOrigin.has(identity)) return { known: true, origin: historyOrigin.get(identity) };
    const inNext = nextByIdentity.get(identity);
    if (inNext) return { known: true, origin: inNext.origin };
    if (retiredIds.has(identity)) return { known: true };
    return { known: false };
  };
  for (const question of next.questions) {
    let target = question.replaces;
    const seen = new Set<string>([question.identity]);
    while (target !== undefined) {
      if (seen.has(target)) refuse("INVALID_ARGUMENT");
      seen.add(target);
      const found = originOf(target);
      if (!found.known) refuse("INVALID_ARGUMENT");
      if (found.origin !== undefined) {
        if (!allowsOriginTransition(found.origin, question.origin)) refuse("INVALID_ARGUMENT");
        break;
      }
      target = nextByIdentity.get(target)?.replaces;
    }
    // A re-added identity (restore, recreate) follows the accepted monotone
    // transition rule over its strongest recorded provenance: historical
    // user content may legitimately be promoted to an instructor
    // correction, but recorded instructor wording can never come back
    // relabelled as anything else — whatever the row order.
    if (!expectedByIdentity.has(question.identity) && historyOrigin.has(question.identity)) {
      if (!allowsOriginTransition(historyOrigin.get(question.identity), question.origin)) refuse("INVALID_ARGUMENT");
    }
  }
}

/**
 * Every identity one save claims: the incoming logical identities plus the
 * replacement targets they name. Both are UUID v4 text, at most two per
 * question, so one placeholder list and one `LIKE` prefilter cover a save.
 */
function claimedIdentities(next: PracticeNext): string[] {
  const claims = new Set<string>();
  for (const question of next.questions) {
    claims.add(question.identity);
    if (question.replaces !== undefined) claims.add(question.replaces);
  }
  return [...claims];
}

/** Quoted-token patterns, so a claim only ever matches its own JSON string value. */
const tokenPatterns = (claims: readonly string[]): string[] => claims.map((identity) => `%"${identity}"%`);

/**
 * Server-owned version numbers never go backwards. Established pruning deletes
 * inactive and unreferenced versions, so the next number is the highest one
 * this material ever owned: over every surviving row it owns — including rows
 * detached from the material link but kept in its history group — and over the
 * numbers recorded in its preserved authoring snapshots. This only reads; no
 * old version or history row is ever rewritten to manufacture a number.
 */
async function nextVersionNumber(query: Query, materialId: string): Promise<number> {
  const [surviving] = await query(
    `SELECT COALESCE(MAX(version_number), 0) AS highest FROM practice_test_versions
      WHERE source_material_id = ? OR history_key = ?`,
    [materialId, materialId],
  );
  let highest = Number(surviving?.["highest"] ?? 0);
  const preserved = await query(
    "SELECT previous_json FROM study_set_history WHERE material_id = ? AND kind = 'practice'",
    [materialId],
  );
  for (const row of preserved) {
    // A damaged envelope is refused at startup by the schema-17 validator.
    const snapshot = snapshotFromHistoryRow(row);
    if (snapshot && snapshot.versionNumber > highest) highest = snapshot.versionNumber;
  }
  return highest + 1;
}

/**
 * A logical identity belongs to exactly one material that still lives, and
 * that ownership outlives every form of established pruning. It is resolved
 * across the whole durable record a living material keeps: current and
 * inactive version rows (a pre-03b item identifies itself by its own immutable
 * id), rows detached from the material link but held in its history group, its
 * preserved authoring snapshots, and its retirement ledger — none of which
 * removing the current test erases. Deleting that material cascades this
 * evidence away with it, so ownership is never invented globally: once the
 * original material and its records are genuinely gone, another material may
 * claim the identity.
 */
async function enforceForeignOwnership(query: Query, materialId: string, next: PracticeNext): Promise<void> {
  const claims = claimedIdentities(next);
  if (claims.length === 0) return;
  const placeholders = claims.map(() => "?").join(", ");
  const patterns = tokenPatterns(claims);
  const claimSet = new Set(claims);
  const owner = "COALESCE(v.source_material_id, v.history_key)";
  const held = await query(
    `SELECT 1 FROM practice_test_items i
       JOIN practice_test_versions v ON v.id = i.version_id
      WHERE COALESCE(i.logical_id, i.id) IN (${placeholders})
        AND ${owner} != ?
        AND EXISTS (SELECT 1 FROM study_materials m WHERE m.id = ${owner})
      LIMIT 1`,
    [...claims, materialId],
  );
  if (held.length > 0) refuse("INVALID_ARGUMENT");

  const preserved = await query(
    `SELECT previous_json FROM study_set_history
      WHERE kind = 'practice' AND material_id != ?
        AND EXISTS (SELECT 1 FROM study_materials m WHERE m.id = study_set_history.material_id)
        AND (${claims.map(() => "previous_json LIKE ?").join(" OR ")})`,
    [materialId, ...patterns],
  );
  for (const row of preserved) {
    const snapshot = snapshotFromHistoryRow(row); // damaged envelopes prove nothing
    if (!snapshot) continue;
    const named = snapshot.questions.some(
      (question) =>
        claimSet.has(question.identity) || (question.replaces !== undefined && claimSet.has(question.replaces)),
    );
    if (named || snapshot.retired.some((entry) => claimSet.has(entry.itemId))) refuse("INVALID_ARGUMENT");
  }

  const ledgers = await query(
    `SELECT retired_json FROM practice_tests
      WHERE source_material_id != ?
        AND EXISTS (SELECT 1 FROM study_materials m WHERE m.id = practice_tests.source_material_id)
        AND (${claims.map(() => "retired_json LIKE ?").join(" OR ")})`,
    [materialId, ...patterns],
  );
  for (const row of ledgers) {
    let retired: PracticeRetirementRecord[];
    try {
      retired = decodePracticeRetirements(JSON.parse(String(row["retired_json"])));
    } catch {
      continue; // a damaged ledger is refused at startup by the schema-17 validator
    }
    if (retired.some((entry) => claimSet.has(entry.itemId))) refuse("INVALID_ARGUMENT");
  }
}

async function applyOperation(
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  operation: PracticeSaveOperation,
  payloadJson: string,
  payloadHash: string,
  now: string,
): Promise<PracticeSaveResult> {
  const material = await query("SELECT title FROM study_materials WHERE id = ?", [operation.sourceMaterialId]);
  if (material.length === 0) refuse("NOT_FOUND");

  const [receipt] = await query(
    "SELECT material_id, action, payload_json, payload_hash, result_json FROM practice_save_operations WHERE operation_id = ?",
    [operation.operationId],
  );
  if (receipt) {
    if (
      String(receipt["material_id"]) !== operation.sourceMaterialId ||
      String(receipt["action"]) !== operation.reason ||
      String(receipt["payload_json"]) !== payloadJson ||
      String(receipt["payload_hash"]) !== payloadHash
    ) refuse("CONFLICT");
    let stored: { status?: unknown } = {};
    try {
      stored = JSON.parse(String(receipt["result_json"]));
    } catch {
      refuse("CONFLICT");
    }
    if (stored.status !== "saved") refuse("CONFLICT");
    return { status: "already_saved" };
  }

  if (operation.pdfKitSources) {
    try { await writePdfKitSources(run, query, operation.pdfKitSources); } catch (error) {
      if (error instanceof Error && error.message === "SOURCE_CHANGED") refuse("SOURCE_CHANGED");
      throw error;
    }
  }
  const current = await readCurrentSnapshot(query, operation.sourceMaterialId);
  if (!sameSnapshot(current, operation.expected)) refuse("STALE_CONTENT");
  if (operation.next) {
    await enforceStoredLineage(query, operation.sourceMaterialId, operation.expected, operation.next);
  }
  // Restoring an absent current test needs no history row for that absent
  // state — there was nothing current to preserve — but the preserved
  // snapshots still hold this material's whole retirement ledger, and every
  // record they hold must travel with the restore. Deleted and corrected
  // wording outlives the mirror row it was written for; the union is compared
  // as exact records (`entryJson`), and `next.retired` may add more, bounded
  // by the existing 2,000-entry limit in the decoder.
  if (operation.reason === "restore" && !current && operation.next) {
    const preserved = await query(
      "SELECT previous_json FROM study_set_history WHERE material_id = ? AND kind = 'practice'",
      [operation.sourceMaterialId],
    );
    const required = new Set<string>();
    for (const row of preserved) {
      const snapshot = snapshotFromHistoryRow(row); // a damaged envelope proves nothing
      if (!snapshot) continue;
      for (const entry of snapshot.retired) required.add(entryJson(entry));
    }
    const offered = new Set(operation.next.retired.map(entryJson));
    for (const key of required) {
      if (!offered.has(key)) refuse("INVALID_ARGUMENT");
    }
  }

  const [inProgress] = await query(
    "SELECT COUNT(*) AS n FROM practice_attempts WHERE source_material_id = ? AND status = 'in_progress'",
    [operation.sourceMaterialId],
  );
  const hasInProgress = Number(inProgress?.["n"] ?? 0) > 0;

  if (operation.reason === "remove") {
    if (current) {
      await run(
        `INSERT INTO study_set_history (id, material_id, kind, reason, previous_json, provider, created_at)
         VALUES (?, ?, 'practice', 'delete', ?, ?, ?)`,
        [crypto.randomUUID(), operation.sourceMaterialId, canonicalJson(current), current.provider, now],
      );
    }
    await run("UPDATE practice_test_versions SET is_active = 0 WHERE source_material_id = ? AND is_active = 1", [operation.sourceMaterialId]);
    await run(
      `UPDATE practice_session_operations SET is_erased = 1, result_json = 'null'
       WHERE attempt_id IN (SELECT id FROM practice_attempts WHERE source_material_id = ? AND status IN ('in_progress', 'abandoned'))`,
      [operation.sourceMaterialId],
    );
    await run("DELETE FROM practice_attempts WHERE source_material_id = ? AND status IN ('in_progress', 'abandoned')", [operation.sourceMaterialId]);
    await run(
      `DELETE FROM practice_test_versions
        WHERE source_material_id = ?
          AND id NOT IN (SELECT DISTINCT version_id FROM practice_attempts WHERE status = 'completed')`,
      [operation.sourceMaterialId],
    );
    await run("DELETE FROM practice_tests WHERE source_material_id = ?", [operation.sourceMaterialId]);
    await run(
      `INSERT INTO practice_save_operations (operation_id, material_id, action, payload_json, payload_hash, result_json, applied_at)
       VALUES (?, ?, 'remove', ?, ?, ?, ?)`,
      [operation.operationId, operation.sourceMaterialId, payloadJson, payloadHash, JSON.stringify({ status: "saved" }), now],
    );
    return { status: "saved" };
  }

  const next = operation.next!;
  if (operation.reason !== "regenerate" && hasInProgress) refuse("ATTEMPT_ACTIVE");

  // A logical identity belongs to exactly one material that still lives.
  await enforceForeignOwnership(query, operation.sourceMaterialId, next);

  const versionId = crypto.randomUUID();
  const nextVer = await nextVersionNumber(query, operation.sourceMaterialId);
  const contentHash = await practiceContentHash(next.questions);

  await run(
    `INSERT INTO practice_save_operations (operation_id, material_id, action, payload_json, payload_hash, result_json, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [operation.operationId, operation.sourceMaterialId, operation.reason, payloadJson, payloadHash, JSON.stringify({ status: "saved", versionId }), now],
  );
  if (current) {
    await run(
      `INSERT INTO study_set_history (id, material_id, kind, reason, previous_json, provider, created_at)
       VALUES (?, ?, 'practice', ?, ?, ?, ?)`,
      [crypto.randomUUID(), operation.sourceMaterialId, HISTORY_REASON[operation.reason], canonicalJson(current), current.provider, now],
    );
  }
  if (operation.reason === "regenerate" && hasInProgress) {
    // The approved plain-provider behavior: replacing the test deliberately
    // abandons the attempt that was in progress against the old version.
    await run(
      "UPDATE practice_attempts SET status = 'abandoned', completed_at = ?, revision = revision + 1 WHERE source_material_id = ? AND status = 'in_progress'",
      [now, operation.sourceMaterialId],
    );
  }
  // Every replacement deactivates the version it replaces; the partial
  // unique index allows exactly one active version per material.
  await run("UPDATE practice_test_versions SET is_active = 0 WHERE source_material_id = ? AND is_active = 1", [operation.sourceMaterialId]);
  await run(
    `INSERT INTO practice_test_versions (
       id, source_material_id, history_key, source_material_title,
       version_number, provider, model, title, content_hash, created_at, is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      versionId,
      operation.sourceMaterialId,
      operation.sourceMaterialId,
      String(material[0]?.["title"] ?? next.title),
      nextVer,
      next.provider,
      next.model,
      next.title,
      contentHash,
      now,
    ],
  );
  for (let index = 0; index < next.questions.length; index++) {
    const question = next.questions[index]!;
    const itemId = crypto.randomUUID();
    await run(
      `INSERT INTO practice_test_items (
         id, version_id, ordinal, question_text, options_json,
         correct_index, explanation, source_page, logical_id, replaces_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemId,
        versionId,
        index,
        question.question,
        JSON.stringify(question.options),
        question.correctIndex,
        question.explanation,
        question.sourcePage,
        question.identity,
        question.replaces ?? null,
      ],
    );
    if (question.origin) {
      await run("INSERT INTO practice_item_origins (item_id, origin) VALUES (?, ?)", [itemId, question.origin]);
    }
  }
  const [mirrorRow] = await query("SELECT generated_at FROM practice_tests WHERE source_material_id = ?", [operation.sourceMaterialId]);
  const renews = operation.reason === "create" || operation.reason === "regenerate";
  const generatedAt = !renews && mirrorRow ? String(mirrorRow["generated_at"]) : now;
  const legacyQuestions = next.questions.map(({ question, options, correctIndex, explanation, sourcePage }) => ({
    question,
    options,
    correctIndex,
    explanation,
    sourcePage,
  }));
  await run(
    `INSERT INTO practice_tests (
       source_material_id, title, questions_json, provider, model, generated_at, updated_at, legacy_migrated_at, legacy_error, retired_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(source_material_id) DO UPDATE SET
       title = excluded.title,
       questions_json = excluded.questions_json,
       provider = excluded.provider,
       model = excluded.model,
       generated_at = excluded.generated_at,
       updated_at = excluded.updated_at,
       legacy_migrated_at = excluded.legacy_migrated_at,
       legacy_error = NULL,
       retired_json = excluded.retired_json`,
    [operation.sourceMaterialId, next.title, JSON.stringify(legacyQuestions), next.provider, next.model, generatedAt, now, now, JSON.stringify(next.retired)],
  );
  return { status: "saved" };
}

/**
 * Validate, then save in one immediate transaction. Any statement failure
 * rolls the whole operation back — receipt, history, version, items, origins,
 * mirror and attempt changes alike — and surfaces as `STORAGE_ERROR`.
 */
export async function executePracticeAuthoring(
  exec: (sql: string) => Promise<void> | void,
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  input: Json,
  now: string = new Date().toISOString(),
): Promise<PracticeSaveResult> {
  const operation = decodePracticeOperation(input);
  if (operation.expected && operation.next) {
    await validateProtection(operation.expected, operation.next, operation.reason);
  }
  if (operation.pdfKitSources) {
    try { await validatePdfKitContent(operation.pdfKitSources, operation.next as unknown as Record<string, unknown>); } catch { refuse("INVALID_ARGUMENT"); }
  }
  const payloadJson = canonicalJson(operation);
  const payloadHash = await computeCanonicalHash(operation);
  try {
    await exec("BEGIN IMMEDIATE");
  } catch (cause) {
    refuse("STORAGE_ERROR", { cause });
  }
  try {
    const result = await applyOperation(run, query, operation, payloadJson, payloadHash, now);
    await exec("COMMIT");
    return result;
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {
      // The transaction is already gone; nothing was committed.
    }
    if (error instanceof PracticeAuthoringError) throw error;
    refuse("STORAGE_ERROR", { cause: error });
  }
}

/** Strict validation of a stored retirement list (used by the schema-17 twin). */
export function decodePracticeRetirements(value: Json): PracticeRetirementRecord[] {
  return decodeRetirements(value);
}

/** A stored history row for a material, or null when that entry is damaged. */
export function snapshotFromHistoryRow(row: Record<string, unknown>): PracticeSnapshot | null {
  try {
    return decodePracticeSnapshot(JSON.parse(String(row["previous_json"])));
  } catch {
    return null;
  }
}
