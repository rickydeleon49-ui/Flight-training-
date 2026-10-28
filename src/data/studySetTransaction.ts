/**
 * Study sets she makes or edits herself (OFFLINE-03a): one atomic save that
 * keeps the whole previous set in `study_set_history` before anything
 * overwrites it. Native twin: `src-tauri/src/study_sets.rs`; the two accept
 * and refuse the same operations, with the same codes and messages.
 *
 * The operation names the set it expects to replace, column for column, so
 * a change made elsewhere since she opened it is refused rather than lost.
 * Its id becomes the history row's id, so a retry after an uncertain answer
 * is recognised instead of applied twice.
 */
import { decodeBookmarkCardSource, writeBookmarkCardSource, carryCardSources, type BookmarkCardSource } from "./studyPageSources";
import { decodePdfKitSources, validatePdfKitContent, writePdfKitSources, type PdfKitSources } from "./pdfKitSources";
import { sha256Hex } from "@/logic/cardIdentity";
import type { SqlValue } from "./db";
import { StudySetSaveError } from "./persistenceErrors";
import { canonicalJson, trimmedCodePoints } from "@/logic/cardIdentity";

export const STUDY_SET_LIMITS = Object.freeze({
  retired: 2_000,
  retirementTerms: 64,
  title: 500,
  summary: 20_000,
  sections: 100,
  heading: 200,
  body: 20_000,
  cards: 500,
  front: 1_000,
  back: 2_000,
  sourceNotes: 20_000,
  model: 200,
  sourcePage: 1_000,
});

/** The stored columns of one set, in the order history keeps them. */
export const SET_COLUMNS = [
  "title",
  "summary",
  "sections_json",
  "flashcards_json",
  "source_notes",
  "provider",
  "model",
  "generated_at",
  "updated_at",
  "summary_origin",
  "retired_json",
] as const;

export type StoredSetRow = { readonly [K in (typeof SET_COLUMNS)[number]]: K extends "summary_origin" ? string | null : string };

export type StudySetSaveReason = "create" | "edit" | "correct" | "delete" | "regenerate" | "restore" | "remove";
export type ItemOriginValue = "user" | "instructor";

export interface StoredSection {
  heading: string;
  body: string;
  itemId?: string;
  origin?: ItemOriginValue;
  replaces?: string;
}

export interface StoredCard {
  front: string;
  back: string;
  sourcePage: number | null;
  itemId?: string;
  origin?: ItemOriginValue;
  replaces?: string;
}

export interface StoredRetirement {
  kind: "summary" | "section" | "card";
  itemId: string;
  reason: "deleted" | "corrected";
  textKey: string;
  terms: string[];
}

/** A set ready to store: every column but the two timestamps. */
export interface NextStudySet {
  title: string;
  summary: string;
  summaryOrigin: ItemOriginValue | null;
  sections: StoredSection[];
  flashcards: StoredCard[];
  sourceNotes: string;
  provider: "gemini" | "import" | "manual";
  model: string;
  retired: StoredRetirement[];
}

export interface StudySetSaveOperation {
  pageSource?: BookmarkCardSource;
  pdfKitSources?: PdfKitSources;
  operationId: string;
  materialId: string;
  reason: StudySetSaveReason;
  /** The set she has open, exactly as stored; null when there is none. */
  expected: StoredSetRow | null;
  /** The set to store; null removes it. */
  next: NextStudySet | null;
}

export interface StudySetSaveResult {
  status: "saved" | "already_saved";
}

type Json = unknown;
type Query = (sql: string, params: SqlValue[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];

const invalid = (): never => {
  throw new StudySetSaveError("INVALID_ARGUMENT");
};
const isRecord = (value: Json): value is Record<string, Json> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const has = (map: Record<string, Json>, key: string) => Object.prototype.hasOwnProperty.call(map, key);

const UUID_V4_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HEX_64 = /^[0-9a-f]{64}$/;

/** Code points, the measure the native twin counts with `chars()`. */
const codePoints = (text: string) => Array.from(text).length;

function exactKeys(map: Record<string, Json>, required: readonly string[], optional: readonly string[] = []): void {
  if (required.some((key) => !has(map, key)) || Object.keys(map).some((key) => !required.includes(key) && !optional.includes(key))) {
    invalid();
  }
}

/** Text whose trimmed length is `min..max` code points (`trimmedCodePoints`). */
function bounded(value: Json, min: number, max: number): string {
  if (typeof value !== "string") return invalid();
  const length = trimmedCodePoints(value);
  if (length < min || length > max) invalid();
  return value;
}

function plain(value: Json, max: number): string {
  if (typeof value !== "string" || codePoints(value) > max) return invalid();
  return value;
}

function originOf(map: Record<string, Json>): ItemOriginValue | undefined {
  if (!has(map, "origin")) return undefined;
  const origin = map.origin;
  if (origin !== "user" && origin !== "instructor") return invalid();
  return origin;
}

/** An optional stable id, an optional origin, and `replaces` only beside an origin. */
function identity(map: Record<string, Json>, ids: Set<string>): Pick<StoredCard, "itemId" | "origin" | "replaces"> {
  const out: Pick<StoredCard, "itemId" | "origin" | "replaces"> = {};
  if (has(map, "itemId")) {
    const id = map.itemId;
    if (typeof id !== "string" || !ITEM_ID.test(id) || id === "summary" || ids.has(id)) invalid();
    ids.add(id as string);
    out.itemId = id as string;
  }
  const origin = originOf(map);
  if (has(map, "replaces")) {
    const id = map.replaces;
    if (typeof id !== "string" || !ITEM_ID.test(id) || origin === undefined) invalid();
    out.replaces = id as string;
  }
  if (origin) out.origin = origin;
  return out;
}

function validateSections(value: Json, ids: Set<string>): StoredSection[] {
  if (!Array.isArray(value) || value.length > STUDY_SET_LIMITS.sections) return invalid();
  return value.map((section) => {
    if (!isRecord(section)) return invalid();
    exactKeys(section, ["heading", "body"], ["itemId", "origin", "replaces"]);
    return {
      heading: bounded(section.heading, 1, STUDY_SET_LIMITS.heading),
      body: bounded(section.body, 1, STUDY_SET_LIMITS.body),
      ...identity(section, ids),
    };
  });
}

function validateCards(value: Json, ids: Set<string>): StoredCard[] {
  if (!Array.isArray(value) || value.length > STUDY_SET_LIMITS.cards) return invalid();
  return value.map((card) => {
    if (!isRecord(card)) return invalid();
    exactKeys(card, ["front", "back", "sourcePage"], ["itemId", "origin", "replaces"]);
    const page = card.sourcePage;
    if (page !== null && !(typeof page === "number" && Number.isInteger(page) && page >= 1 && page <= STUDY_SET_LIMITS.sourcePage)) {
      invalid();
    }
    return {
      front: bounded(card.front, 1, STUDY_SET_LIMITS.front),
      back: bounded(card.back, 1, STUDY_SET_LIMITS.back),
      sourcePage: page as number | null,
      ...identity(card, ids),
    };
  });
}

/** Unicode scalar order, never locale order. */
function scalarLess(a: string, b: string): boolean {
  const left = Array.from(a), right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const delta = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (delta) return delta < 0;
  }
  return left.length < right.length;
}

/**
 * The structure of a retirement list (native `validate_retired`): at most
 * 2,000 distinct entries, each naming an item, a reason, a 64-hex text key
 * and at most 64 terms in strictly increasing scalar order. The authoring
 * core checks each term's normalization before it uses a list.
 */
export function validateRetiredList(value: Json): StoredRetirement[] {
  if (!Array.isArray(value)) return invalid();
  if (value.length > STUDY_SET_LIMITS.retired) throw new StudySetSaveError("RETIREMENT_LIMIT");
  const keys = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry)) return invalid();
    exactKeys(entry, ["kind", "itemId", "reason", "textKey", "terms"]);
    const { kind, itemId, reason, textKey, terms } = entry;
    if (
      (kind !== "summary" && kind !== "section" && kind !== "card") ||
      typeof itemId !== "string" || !ITEM_ID.test(itemId) ||
      (kind === "summary") !== (itemId === "summary") ||
      (reason !== "deleted" && reason !== "corrected") ||
      typeof textKey !== "string" || !HEX_64.test(textKey) ||
      !Array.isArray(terms) || terms.length > STUDY_SET_LIMITS.retirementTerms
    ) {
      return invalid();
    }
    let previous: string | null = null;
    for (const term of terms) {
      if (typeof term !== "string" || !term || codePoints(term) > STUDY_SET_LIMITS.body || (previous !== null && !scalarLess(previous, term))) {
        invalid();
      }
      previous = term as string;
    }
    const key = JSON.stringify([kind, itemId, reason, textKey]);
    if (keys.has(key)) invalid();
    keys.add(key);
    return { kind, itemId, reason, textKey, terms: [...(terms as string[])] };
  });
}

export function validateNextSet(value: Json): NextStudySet {
  if (!isRecord(value)) return invalid();
  exactKeys(value, ["title", "summary", "summaryOrigin", "sections", "flashcards", "sourceNotes", "provider", "model", "retired"]);
  const summaryOrigin = value.summaryOrigin;
  if (summaryOrigin !== null && summaryOrigin !== "user" && summaryOrigin !== "instructor") invalid();
  const provider = value.provider;
  if (provider !== "gemini" && provider !== "import" && provider !== "manual") invalid();
  const ids = new Set<string>();
  return {
    title: plain(value.title, STUDY_SET_LIMITS.title),
    summary: bounded(value.summary, 0, STUDY_SET_LIMITS.summary),
    summaryOrigin: summaryOrigin as ItemOriginValue | null,
    sections: validateSections(value.sections, ids),
    flashcards: validateCards(value.flashcards, ids),
    sourceNotes: plain(value.sourceNotes, STUDY_SET_LIMITS.sourceNotes),
    provider: provider as NextStudySet["provider"],
    model: plain(value.model, STUDY_SET_LIMITS.model),
    retired: validateRetiredList(value.retired),
  };
}

export function decodeStoredRow(value: Json): StoredSetRow {
  if (!isRecord(value)) return invalid();
  exactKeys(value, SET_COLUMNS);
  for (const column of SET_COLUMNS) {
    const cell = value[column];
    if (typeof cell !== "string" && !(cell === null && column === "summary_origin")) invalid();
  }
  return Object.fromEntries(SET_COLUMNS.map((column) => [column, value[column]])) as StoredSetRow;
}

const REASONS: readonly StudySetSaveReason[] = ["create", "edit", "correct", "delete", "regenerate", "restore", "remove"];

export function decodeStudySetOperation(value: Json): StudySetSaveOperation {
  if (!isRecord(value)) return invalid();
  exactKeys(value, ["operationId", "materialId", "reason", "expected", "next"], ["pdfKitSources", "pageSource"]);
  const { operationId, materialId, reason } = value;
  if (typeof operationId !== "string" || !UUID_V4_LOWER.test(operationId)) invalid();
  if (typeof materialId !== "string" || !materialId || new TextEncoder().encode(materialId).length > 200) invalid();
  if (!REASONS.includes(reason as StudySetSaveReason)) invalid();
  const expected = value.expected === null ? null : decodeStoredRow(value.expected);
  const next = value.next === null ? null : validateNextSet(value.next);
  // Creating replaces nothing; removing leaves nothing; everything else
  // replaces a set she has open with another.
  const consistent =
    reason === "create" ? expected === null && next !== null : reason === "remove" ? expected !== null && next === null : expected !== null && next !== null;
  if (!consistent) invalid();
  let pdfKitSources;
  if (has(value, "pdfKitSources")) {
    if (!next) invalid();
    try { pdfKitSources = decodePdfKitSources(value.pdfKitSources, materialId as string); } catch { invalid(); }
  }
  let pageSource;
  if (has(value, "pageSource")) {
    if (!next || pdfKitSources) invalid();
    try { pageSource = decodeBookmarkCardSource(value.pageSource, materialId as string, next!); } catch { invalid(); }
  }
  return { ...(pageSource ? { pageSource } : {}), operationId: operationId as string, materialId: materialId as string, reason: reason as StudySetSaveReason, expected, next, ...(pdfKitSources ? { pdfKitSources } : {}) };
}

const HISTORY_REASON: Readonly<Record<StudySetSaveReason, string>> = {
  create: "edit",
  edit: "edit",
  correct: "correct",
  delete: "delete",
  remove: "delete",
  regenerate: "regenerate",
  restore: "restore",
};

async function readRow(query: Query, materialId: string): Promise<StoredSetRow | null> {
  const [row] = await query(
    `SELECT ${SET_COLUMNS.join(", ")} FROM ai_study_sets WHERE source_material_id = ?`,
    [materialId],
  );
  if (!row) return null;
  return Object.fromEntries(
    SET_COLUMNS.map((column) => [column, row[column] === null || row[column] === undefined ? null : String(row[column])]),
  ) as StoredSetRow;
}

function parsed(text: string | null): string {
  try {
    return canonicalJson(JSON.parse(text ?? "null"));
  } catch {
    return "null";
  }
}

/** Whether the stored row already holds this content (timestamps aside). */
export function holds(row: StoredSetRow, next: NextStudySet): boolean {
  return (
    row.title === next.title &&
    row.summary === next.summary &&
    row.summary_origin === next.summaryOrigin &&
    row.source_notes === next.sourceNotes &&
    row.provider === next.provider &&
    row.model === next.model &&
    parsed(row.sections_json) === canonicalJson(next.sections) &&
    parsed(row.flashcards_json) === canonicalJson(next.flashcards) &&
    parsed(row.retired_json) === canonicalJson(next.retired)
  );
}

const sameRow = (a: StoredSetRow | null, b: StoredSetRow | null) =>
  a === null || b === null ? a === b : SET_COLUMNS.every((column) => a[column] === b[column]);

/** The whole previous row, as history keeps it. */
export const historyJson = (row: StoredSetRow) => JSON.stringify(Object.fromEntries(SET_COLUMNS.map((c) => [c, row[c]])));

/**
 * Validate, then save in one immediate transaction. Statement failures roll
 * back and surface as `STORAGE_ERROR`, never as an engine message.
 */
export async function executeStudySetSave(
  exec: (sql: string) => Promise<void> | void,
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  input: unknown,
  now: string = new Date().toISOString(),
): Promise<StudySetSaveResult> {
  const operation = decodeStudySetOperation(input);
  if (operation.pdfKitSources) {
    try { await validatePdfKitContent(operation.pdfKitSources, operation.next as unknown as Record<string, unknown>); } catch { invalid(); }
  }
  try {
    await exec("BEGIN IMMEDIATE");
  } catch (cause) {
    throw new StudySetSaveError("STORAGE_ERROR", { cause });
  }
  try {
    const result = await apply(run, query, operation, now);
    await exec("COMMIT");
    return result;
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {
      // The transaction is already gone; nothing was committed.
    }
    if (error instanceof StudySetSaveError) throw error;
    throw new StudySetSaveError("STORAGE_ERROR", { cause: error });
  }
}

async function apply(
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  operation: StudySetSaveOperation,
  now: string,
): Promise<StudySetSaveResult> {
  if ((await query("SELECT 1 AS found FROM study_materials WHERE id = ?", [operation.materialId])).length === 0) {
    throw new StudySetSaveError("NOT_FOUND");
  }
  const payloadJson = canonicalJson(operation);
  const payloadHash = await sha256Hex(payloadJson);
  const receiptTable = await query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'study_set_save_operations'", []);
  if (receiptTable.length) {
    const [receipt] = await query("SELECT material_id, payload_json, payload_hash FROM study_set_save_operations WHERE operation_id = ?", [operation.operationId]);
    if (receipt) {
      if (receipt.material_id !== operation.materialId || receipt.payload_json !== payloadJson || receipt.payload_hash !== payloadHash) throw new StudySetSaveError("CONFLICT");
      return { status: "already_saved" };
    }
  }
  if (operation.pdfKitSources) {
    if (!receiptTable.length) throw new StudySetSaveError("STORAGE_ERROR");
    try { await writePdfKitSources(run, query, operation.pdfKitSources); } catch (e) {
      if (e instanceof Error && e.message === "SOURCE_CHANGED") throw new StudySetSaveError("SOURCE_CHANGED");
      throw e;
    }
  }
  const current = await readRow(query, operation.materialId);
  const [recorded] = await query("SELECT material_id FROM study_set_history WHERE id = ?", [operation.operationId]);

  // A retry of a save that already happened.
  const already =
    current && operation.next
      ? holds(current, operation.next) && (recorded !== undefined || operation.reason === "create")
      : !current && !operation.next && recorded !== undefined;
  if (already && !operation.pdfKitSources && !operation.pageSource) {
    if (recorded && recorded.material_id !== operation.materialId) throw new StudySetSaveError("STALE_CONTENT");
    return { status: "already_saved" };
  }
  if (recorded !== undefined || !sameRow(current, operation.expected)) throw new StudySetSaveError("STALE_CONTENT");

  if (current) {
    await run(
      `INSERT INTO study_set_history (id, material_id, kind, reason, previous_json, provider, created_at)
       VALUES (?, ?, 'study_set', ?, ?, ?, ?)`,
      [operation.operationId, operation.materialId, HISTORY_REASON[operation.reason], historyJson(current), current.provider, now],
    );
  }
  const next = operation.next;
  if (!next) {
    await run("DELETE FROM ai_study_sets WHERE source_material_id = ?", [operation.materialId]);
  } else {
    const renews = operation.reason === "create" || operation.reason === "regenerate";
    const generatedAt = current && !renews ? current.generated_at : now;
    await run(
      `INSERT INTO ai_study_sets
         (source_material_id, title, summary, sections_json, flashcards_json, source_notes,
          provider, model, generated_at, updated_at, summary_origin, retired_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_material_id) DO UPDATE SET
         title = excluded.title, summary = excluded.summary,
         sections_json = excluded.sections_json, flashcards_json = excluded.flashcards_json,
         source_notes = excluded.source_notes, provider = excluded.provider,
         model = excluded.model, generated_at = excluded.generated_at,
         updated_at = excluded.updated_at, summary_origin = excluded.summary_origin,
         retired_json = excluded.retired_json`,
      [
        operation.materialId, next.title, next.summary, JSON.stringify(next.sections), JSON.stringify(next.flashcards),
        next.sourceNotes, next.provider, next.model, generatedAt, now, next.summaryOrigin, JSON.stringify(next.retired),
      ],
    );
  }
  if (operation.pageSource) {
    try { await writeBookmarkCardSource(run, query, operation.pageSource, next!, now); }
    catch (e) { if (e instanceof Error && e.message === "SOURCE_CHANGED") throw new StudySetSaveError("SOURCE_CHANGED"); throw e; }
  }
  if (next) await carryCardSources(run, query, operation.materialId, current ? JSON.parse(current.flashcards_json) : [], next.flashcards);
  if (operation.pdfKitSources || operation.pageSource) await run("INSERT INTO study_set_save_operations (operation_id, material_id, payload_json, payload_hash) VALUES (?, ?, ?, ?)", [operation.operationId, operation.materialId, payloadJson, payloadHash]);
  const { invalidateHomeworkCardRuns } = await import("./homeworkCards");
  await invalidateHomeworkCardRuns(run,query,operation.materialId,now,true);
  return { status: "saved" };
}

/**
 * Stored study-set provenance a restored database must keep consistent
 * (native `verify_stored_sets`). Returns the first problem, or null.
 */
export async function storedSetProblem(query: Query): Promise<string | null> {
  for (const row of await query("SELECT source_material_id, retired_json FROM ai_study_sets", [])) {
    try {
      validateRetiredList(JSON.parse(String(row.retired_json)));
    } catch {
      return `The study set for ${String(row.source_material_id)} has a damaged deletion and correction history.`;
    }
  }
  for (const row of await query("SELECT id, kind, previous_json FROM study_set_history", [])) {
    if (row.kind !== "study_set") continue;
    try {
      decodeStoredRow(JSON.parse(String(row.previous_json)));
    } catch {
      return `Study set history entry ${String(row.id)} is damaged.`;
    }
  }
  return null;
}
