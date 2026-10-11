/**
 * Candidate M3 read path: bounded, keyset-paginated evidence history and a
 * per-skill summary. Read-only; never loaded through AppDataContext.
 *
 * Order: observed_on DESC, created_at DESC, id DESC. The cursor carries all
 * three, so equal dates and equal timestamps still page without gaps or
 * repeats, and rows added while paging never shift later pages.
 *
 * DISPOSABLE PROTOTYPE.
 */
import { sha256Hex } from "@/logic/cardIdentity";
import type { SqlValue } from "@/data/db";

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
  type ObservationRevision,
  type SkillListEntry,
  type SkillSummary,
  type SourceField,
} from "./types";

interface Cursor {
  o: string;
  c: string;
  i: string;
}

export function encodeCursor(cursor: Cursor): string {
  return JSON.stringify([cursor.o, cursor.c, cursor.i]);
}

export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SkillEvidenceError("INVALID_ARGUMENT", "That page link is not valid.");
  }
  if (
    !Array.isArray(parsed) || parsed.length !== 3 || !parsed.every((v) => typeof v === "string" && v.length <= 64) ||
    !isCalendarDate(parsed[0])
  ) {
    throw new SkillEvidenceError("INVALID_ARGUMENT", "That page link is not valid.");
  }
  return { o: parsed[0], c: parsed[1], i: parsed[2] };
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

/** The SQL a page runs, exported so tests can check the plan uses an index. */
export function pageQuery(input: EvidencePageInput): { sql: string; params: SqlValue[] } {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (input.skillId) {
    where.push("o.skill_id = ?");
    params.push(input.skillId);
  }
  if (input.journalId) {
    where.push("o.journal_id = ?");
    params.push(input.journalId);
  }
  if (input.attribution) {
    where.push("o.attribution = ?");
    params.push(input.attribution);
  }
  if (input.cursor) {
    const c = decodeCursor(input.cursor);
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

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (v == null ? null : String(v));

export async function readEvidencePage(query: Query, input: EvidencePageInput = {}): Promise<EvidencePage> {
  if (input.attribution && input.attribution !== "self_report" && input.attribution !== "instructor_transcribed") {
    throw new SkillEvidenceError("INVALID_ARGUMENT", "Unknown attribution filter.");
  }
  const limit = pageLimit(input.limit);
  const { sql, params } = pageQuery(input);
  const rows = await query(sql, params);
  const visible = rows.slice(0, limit);
  const items: EvidenceItem[] = [];
  for (const row of visible) items.push(await toItem(row));
  const last = visible.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last ? encodeCursor({ o: s(last["observed_on"]), c: s(last["created_at"]), i: s(last["id"]) }) : null,
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

export async function readObservationHistory(query: Query, observationId: string): Promise<ObservationRevision[]> {
  const rows = await query(
    `SELECT * FROM skill_observation_revisions WHERE observation_id = ? ORDER BY revision DESC LIMIT ?`,
    [observationId, LIMITS.revisionsMax],
  );
  return rows.map((row) => ({
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
  }));
}
