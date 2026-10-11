/**
 * Candidate M3 read path: bounded, keyset-paginated evidence history, a
 * per-skill summary and bounded observation-revision pages. Read-only; never
 * loaded through AppDataContext.
 *
 * Evidence order: observed_on DESC, created_at DESC, id DESC. The cursor
 * carries all three, so equal dates and equal timestamps still page without
 * gaps or repeats. observed_on is editable, so a cursor is also bound to:
 * - its normalized filters (reusing it for another list is INVALID_ARGUMENT);
 * - a change fence: the highest receipt rowid when its page was read.
 * Before the next page, every edit committed after the fence is checked. If
 * one moved an observation in this list across the cursor (a seen row below
 * it, which would repeat, or an unseen row above it, which would be skipped),
 * the page is refused with STALE_CURSOR and the caller restarts from the
 * newest. Rows recorded or erased between pages never shift the next page;
 * a newly recorded row newer than the cursor appears on the next first page.
 *
 * Revision history is append-only, so its descending keyset by revision is
 * stable: newer revisions never move older pages.
 *
 * DISPOSABLE PROTOTYPE.
 */
import { sha256Hex } from "@/logic/cardIdentity";
import type { SqlValue } from "@/data/db";

import { decodeStoredResult } from "./skillEvidenceResult";
import { isCalendarDate, type Query } from "./skillEvidenceTransaction";
import {
  LIMITS,
  SOURCE_FIELD_COLUMNS,
  SkillEvidenceError,
  type ActionLinkState,
  type Attribution,
  type EvidenceItem,
  type EvidencePage,
  type EvidencePageInput,
  type ObservationHistoryInput,
  type ObservationHistoryPage,
  type ObservationRevision,
  type SkillListEntry,
  type SkillSummary,
  type SourceField,
} from "./types";

const CURSOR_VERSION = 2;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// eslint-disable-next-line no-control-regex
const ANY_CONTROL = /[\u0000-\u001F\u007F]/;

/** The filters a cursor is bound to, normalized: absent and empty are null. */
export interface PageFilters {
  skillId: string | null;
  journalId: string | null;
  attribution: Attribution | null;
}

export function normalizeFilters(input: EvidencePageInput): PageFilters {
  return { skillId: input.skillId || null, journalId: input.journalId || null, attribution: input.attribution || null };
}

interface Cursor {
  filters: PageFilters;
  /** Sort key of the last row shown. */
  o: string;
  c: string;
  i: string;
  /** Highest receipt rowid when that page was read. */
  fence: number;
}

export function encodeCursor(cursor: Cursor): string {
  const f = cursor.filters;
  return JSON.stringify([CURSOR_VERSION, f.skillId, f.journalId, f.attribution, cursor.o, cursor.c, cursor.i, cursor.fence]);
}

const invalidCursor = (): never => {
  throw new SkillEvidenceError("INVALID_ARGUMENT", "That page link is not valid.");
};

const shortText = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 64 && !ANY_CONTROL.test(v);
const filterValue = (v: unknown): v is string | null => v === null || shortText(v);

export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalidCursor();
  }
  if (!Array.isArray(parsed) || parsed.length !== 8 || parsed[0] !== CURSOR_VERSION) invalidCursor();
  const [, skillId, journalId, attribution, o, c, i, fence] = parsed as unknown[];
  if (!filterValue(skillId) || !filterValue(journalId)) invalidCursor();
  if (attribution !== null && attribution !== "self_report" && attribution !== "instructor_transcribed") invalidCursor();
  if (!isCalendarDate(o) || !shortText(c) || !shortText(i)) invalidCursor();
  if (typeof fence !== "number" || !Number.isSafeInteger(fence) || fence < 0) invalidCursor();
  return {
    filters: { skillId: skillId as string | null, journalId: journalId as string | null, attribution: attribution as Attribution | null },
    o: o as string,
    c: c as string,
    i: i as string,
    fence: fence as number,
  };
}

function pageLimit(limit: number | undefined): number {
  if (limit === undefined) return LIMITS.pageDefault;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.pageMax) {
    throw new SkillEvidenceError("LIMIT_EXCEEDED", `A page holds 1-${LIMITS.pageMax} observations.`);
  }
  return limit;
}

const PAGE_SELECT = `
  SELECT o.*, s.label AS skill_label, s.status AS skill_status,
         j.id AS live_journal_id, j.title AS live_journal_title, j.date AS live_journal_date,
         j.instructor_feedback AS live_instructor_feedback, j.went_well AS live_went_well,
         j.was_difficult AS live_was_difficult, j.practiced AS live_practiced,
         a.id AS live_action_id, a.title AS live_action_title, a.status AS live_action_status
    FROM skill_observations o
    JOIN skill_catalog_entries s ON s.id = o.skill_id
    LEFT JOIN journal_entries j ON j.id = o.journal_id
    LEFT JOIN next_actions a ON a.id = o.action_id`;

function sameFilters(a: PageFilters, b: PageFilters): boolean {
  return a.skillId === b.skillId && a.journalId === b.journalId && a.attribution === b.attribution;
}

/** The SQL a page runs, exported so tests can check the plan uses an index. */
export function pageQuery(input: EvidencePageInput): { sql: string; params: SqlValue[] } {
  const filters = normalizeFilters(input);
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (filters.skillId) {
    where.push("o.skill_id = ?");
    params.push(filters.skillId);
  }
  if (filters.journalId) {
    where.push("o.journal_id = ?");
    params.push(filters.journalId);
  }
  if (filters.attribution) {
    where.push("o.attribution = ?");
    params.push(filters.attribution);
  }
  if (input.cursor) {
    const c = decodeCursor(input.cursor);
    if (!sameFilters(c.filters, filters)) {
      throw new SkillEvidenceError("INVALID_ARGUMENT", "That page link belongs to a different list.");
    }
    where.push("(o.observed_on, o.created_at, o.id) < (?, ?, ?)");
    params.push(c.o, c.c, c.i);
  }
  const limit = pageLimit(input.limit);
  params.push(limit + 1);
  return {
    sql: `${PAGE_SELECT}
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY o.observed_on DESC, o.created_at DESC, o.id DESC
    LIMIT ?`,
    params,
  };
}

/** The current change fence: receipts are never deleted, so their rowid only grows. */
export const FENCE_SQL = "SELECT COALESCE(MAX(rowid), 0) AS fence FROM skill_evidence_operations";
/** Edits committed after a fence, oldest first (a rowid range search on the receipts table). */
export const EDITS_AFTER_FENCE_SQL = `SELECT subject_id, result_json FROM skill_evidence_operations
  WHERE rowid > ? AND action = 'edit_observation' AND is_erased = 0 ORDER BY rowid`;

const before = (key: [string, string, string], cursor: Cursor) =>
  key[0] < cursor.o || (key[0] === cursor.o && (key[1] < cursor.c || (key[1] === cursor.c && key[2] < cursor.i)));

/**
 * Refuse a cursor whose list changed underneath it. Each edit after the fence
 * puts its observation on one side of the cursor before and after: "seen"
 * (at or above it), "unseen" (below it) or "out" (not matching the filters).
 * An edit that lands a still-matching observation on a different side is
 * refused, because it could repeat a row already shown or skip one never
 * shown (a row re-entering the filter may have been shown earlier, so that
 * counts too). Leaving the filters, wording-only edits, edits in other lists,
 * new rows and erasures are harmless.
 */
async function assertCursorFresh(query: Query, cursor: Cursor): Promise<void> {
  const [head] = await query(FENCE_SQL, []);
  if (cursor.fence > Number(head?.["fence"] ?? 0)) invalidCursor();
  const f = cursor.filters;
  for (const edit of await query(EDITS_AFTER_FENCE_SQL, [cursor.fence])) {
    const observationId = s(edit["subject_id"]);
    let revision: number;
    try {
      const result = decodeStoredResult(edit["result_json"], { action: "edit_observation", subjectId: observationId });
      revision = (result as { revision: number }).revision;
    } catch {
      throw new SkillEvidenceError("STALE_CURSOR", "The list changed while you were reading it. Start again from the newest.");
    }
    const [obs] = await query("SELECT skill_id, source_journal_id, created_at FROM skill_observations WHERE id = ?", [observationId]);
    if (!obs) continue; // gone: an erased row cannot repeat or be skipped
    if (f.skillId && obs["skill_id"] !== f.skillId) continue;
    if (f.journalId && obs["source_journal_id"] !== f.journalId) continue;
    const pair = await query(
      "SELECT revision, observed_on, attribution FROM skill_observation_revisions WHERE observation_id = ? AND revision IN (?, ?) ORDER BY revision",
      [observationId, revision - 1, revision],
    );
    if (pair.length !== 2) throw new SkillEvidenceError("STALE_CURSOR", "The list changed while you were reading it. Start again from the newest.");
    const [old, now] = pair as [Record<string, unknown>, Record<string, unknown>];
    const side = (row: Record<string, unknown>) =>
      f.attribution && row["attribution"] !== f.attribution
        ? "out"
        : before([s(row["observed_on"]), s(obs["created_at"]), observationId], cursor) ? "unseen" : "seen";
    const after = side(now);
    if (after !== "out" && after !== side(old)) {
      throw new SkillEvidenceError("STALE_CURSOR", "The list changed while you were reading it. Start again from the newest.");
    }
  }
}

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (v == null ? null : String(v));

export async function readEvidencePage(query: Query, input: EvidencePageInput = {}): Promise<EvidencePage> {
  if (input.attribution && input.attribution !== "self_report" && input.attribution !== "instructor_transcribed") {
    throw new SkillEvidenceError("INVALID_ARGUMENT", "Unknown attribution filter.");
  }
  const limit = pageLimit(input.limit);
  const { sql, params } = pageQuery(input);
  if (input.cursor) await assertCursorFresh(query, decodeCursor(input.cursor));
  // Read the fence with the page, on the same serialized connection.
  const [head] = await query(FENCE_SQL, []);
  const rows = await query(sql, params);
  const visible = rows.slice(0, limit);
  const items: EvidenceItem[] = [];
  for (const row of visible) items.push(await toItem(row));
  const last = visible.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({
            filters: normalizeFilters(input),
            o: s(last["observed_on"]),
            c: s(last["created_at"]),
            i: s(last["id"]),
            fence: Number(head?.["fence"] ?? 0),
          })
        : null,
  };
}

async function toItem(row: Record<string, unknown>): Promise<EvidenceItem> {
  const field = s(row["source_field"]) as SourceField;
  let source: EvidenceItem["source"];
  if (row["live_journal_id"] != null) {
    let textChanged: boolean | null = null;
    if (field !== "none") {
      const live = s(row[`live_${SOURCE_FIELD_COLUMNS[field]}`]);
      textChanged = (await sha256Hex(live)) !== row["source_text_sha256"];
    }
    source = {
      kind: "present",
      journalId: s(row["live_journal_id"]),
      currentTitle: s(row["live_journal_title"]),
      currentDate: s(row["live_journal_date"]),
      renamed: s(row["live_journal_title"]) !== s(row["source_journal_title"]),
      textChanged,
    };
  } else {
    source = { kind: "deleted", sourceJournalId: s(row["source_journal_id"]) };
  }
  let action: ActionLinkState = { kind: "none" };
  if (row["live_action_id"] != null) {
    action = {
      kind: "linked",
      actionId: s(row["live_action_id"]),
      title: s(row["live_action_title"]),
      actionStatus: s(row["live_action_status"]) as "open" | "completed" | "dismissed",
    };
  } else if (row["linked_action_id"] != null) {
    action = { kind: "deleted", formerActionId: s(row["linked_action_id"]), formerTitle: s(row["linked_action_title"]) };
  }
  return {
    id: s(row["id"]),
    skillId: s(row["skill_id"]),
    skillLabel: s(row["skill_label"]),
    skillLabelAtRecording: s(row["skill_label_snapshot"]),
    skillRetired: row["skill_status"] === "retired",
    wording: s(row["wording"]),
    observedOn: s(row["observed_on"]),
    attribution: s(row["attribution"]) as Attribution,
    instructorName: s(row["instructor_name"]),
    revision: Number(row["revision"]),
    source,
    sourceSnapshot: { title: s(row["source_journal_title"]), date: s(row["source_journal_date"]), field },
    action,
    addressedAt: n(row["addressed_at"]),
    createdAt: s(row["created_at"]),
    updatedAt: s(row["updated_at"]),
  };
}

/** Thresholds for "limited" evidence. Shown as words, never as a score. */
export const EVIDENCE_THRESHOLD = { observations: 3, debriefs: 2 } as const;

export async function readSkillSummary(query: Query, skillId: string): Promise<SkillSummary | null> {
  const [skill] = await query("SELECT * FROM skill_catalog_entries WHERE id = ?", [skillId]);
  if (!skill) return null;
  const latest = async (kind: "status" | "confidence") =>
    (
      await query(
        "SELECT sequence, status, confidence FROM skill_self_assessments WHERE skill_id = ? AND kind = ? ORDER BY sequence DESC LIMIT 1",
        [skillId, kind],
      )
    )[0];
  const status = await latest("status");
  const confidence = await latest("confidence");
  const [counts] = await query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(attribution = 'self_report'), 0) AS self_count,
            COALESCE(SUM(attribution = 'instructor_transcribed'), 0) AS instructor_count,
            COUNT(DISTINCT source_journal_id) AS debriefs,
            MAX(observed_on) AS last_observed
       FROM skill_observations WHERE skill_id = ?`,
    [skillId],
  );
  const total = Number(counts?.["total"] ?? 0);
  const debriefs = Number(counts?.["debriefs"] ?? 0);
  return {
    skillId,
    label: s(skill["label"]),
    origin: s(skill["origin"]) as "builtin" | "custom",
    retired: skill["status"] === "retired",
    revision: Number(skill["revision"]),
    status: (status?.["status"] ?? null) as SkillSummary["status"],
    statusSequence: status ? Number(status["sequence"]) : 0,
    confidence: confidence?.["confidence"] == null ? null : Number(confidence["confidence"]),
    confidenceSequence: confidence ? Number(confidence["sequence"]) : 0,
    observationCount: total,
    selfReportCount: Number(counts?.["self_count"] ?? 0),
    instructorTranscribedCount: Number(counts?.["instructor_count"] ?? 0),
    distinctDebriefs: debriefs,
    lastObservedOn: n(counts?.["last_observed"]),
    evidence:
      total === 0
        ? "none"
        : total < EVIDENCE_THRESHOLD.observations || debriefs < EVIDENCE_THRESHOLD.debriefs
          ? "limited"
          : "recorded",
  };
}

export async function listSkills(query: Query, options: { includeRetired?: boolean } = {}): Promise<SkillListEntry[]> {
  const rows = await query(
    `SELECT id, label, origin, topic, status, revision FROM skill_catalog_entries
      ${options.includeRetired ? "" : "WHERE status = 'active'"}
      ORDER BY origin = 'custom', label COLLATE NOCASE, id`,
    [],
  );
  return rows.map((row) => ({
    id: s(row["id"]),
    label: s(row["label"]),
    origin: s(row["origin"]) as "builtin" | "custom",
    topic: s(row["topic"]) as SkillListEntry["topic"],
    retired: row["status"] === "retired",
    revision: Number(row["revision"]),
  }));
}

const HISTORY_CURSOR_TAG = "history";

export function encodeHistoryCursor(observationId: string, beforeRevision: number): string {
  return JSON.stringify([HISTORY_CURSOR_TAG, observationId, beforeRevision]);
}

function decodeHistoryCursor(raw: string, observationId: string, currentRevision: number): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalidCursor();
  }
  if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== HISTORY_CURSOR_TAG) invalidCursor();
  const [, id, beforeRevision] = parsed as unknown[];
  if (id !== observationId) throw new SkillEvidenceError("INVALID_ARGUMENT", "That history link belongs to a different observation.");
  if (typeof beforeRevision !== "number" || !Number.isSafeInteger(beforeRevision) || beforeRevision < 2 || beforeRevision > currentRevision) {
    invalidCursor();
  }
  return beforeRevision as number;
}

function historyLimit(limit: number | undefined): number {
  if (limit === undefined) return LIMITS.revisionPageDefault;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.revisionPageMax) {
    throw new SkillEvidenceError("LIMIT_EXCEEDED", `A history page holds 1-${LIMITS.revisionPageMax} versions.`);
  }
  return limit;
}

/**
 * One bounded page of an observation's history, newest first. Every stored
 * revision is reachable: follow nextCursor until it is null (revision 1 is
 * then on the last page). An erased observation is ERASED, an unknown one
 * NOT_FOUND, so "absent" is never confused with "erased".
 */
export async function readObservationHistory(query: Query, input: ObservationHistoryInput): Promise<ObservationHistoryPage> {
  if (typeof input?.observationId !== "string" || !UUID_V4.test(input.observationId)) {
    throw new SkillEvidenceError("INVALID_ARGUMENT", "observationId must be a UUID v4.");
  }
  const limit = historyLimit(input.limit);
  const [obs] = await query("SELECT revision FROM skill_observations WHERE id = ?", [input.observationId]);
  if (!obs) {
    const [tombstone] = await query("SELECT 1 AS erased FROM skill_evidence_operations WHERE subject_id = ? AND is_erased = 1 LIMIT 1", [input.observationId]);
    if (tombstone) throw new SkillEvidenceError("ERASED", "That observation was erased.");
    throw new SkillEvidenceError("NOT_FOUND", "That observation does not exist.");
  }
  const currentRevision = Number(obs["revision"]);
  const upTo = input.cursor ? decodeHistoryCursor(input.cursor, input.observationId, currentRevision) - 1 : currentRevision;
  const rows = await query(
    `SELECT * FROM skill_observation_revisions WHERE observation_id = ? AND revision <= ? ORDER BY revision DESC LIMIT ?`,
    [input.observationId, upTo, limit + 1],
  );
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    observationId: input.observationId,
    currentRevision,
    items: visible.map((row) => ({
      revision: Number(row["revision"]),
      changeKind: s(row["change_kind"]) as ObservationRevision["changeKind"],
      wording: s(row["wording"]),
      observedOn: s(row["observed_on"]),
      attribution: s(row["attribution"]) as Attribution,
      instructorName: s(row["instructor_name"]),
      linkedActionId: n(row["linked_action_id"]),
      linkedActionTitle: n(row["linked_action_title"]),
      addressedAt: n(row["addressed_at"]),
      recordedAt: s(row["recorded_at"]),
    })),
    nextCursor: rows.length > limit && last ? encodeHistoryCursor(input.observationId, Number(last["revision"])) : null,
  };
}
