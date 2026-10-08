/**
 * Library-wide card review readers (M2-4 / C2): the browser (sql.js) and
 * test (node:sqlite) implementation, and the twin of the native reader in
 * `src-tauri/src/card_library.rs`. Both produce identical results, cursors
 * included, held equal by `src-tauri/fixtures/card-library/cases.json`.
 *
 * Reads never write. Every input and cursor is validated before any SQL.
 * Raw saved card sets are read only after a byte preflight and a
 * conservative card-work reservation; a set over the absolute 8 MiB ceiling
 * is never transferred. Counters describe this one call only.
 */
import type {
  HistoryContentStatus,
  HistoryMaterialEnrichmentRecord,
  LibraryRecentReviewEntry,
  LibraryRecentReviewsInput,
  LibraryRecentReviewsResult,
  LibraryReviewDueInput,
  LibraryReviewDueResult,
  LibraryReviewMaterialEntry,
  LibraryReviewOversizeIssue,
  CardRating,
} from "@/domain/types";
import { cardVersion, parseSavedCards, type CardVersion } from "@/logic/cardIdentity";
import {
  ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES,
  CARD_WORK_RESERVATION,
  CardLibraryReadError,
  compareUrgency,
  decodeCursor,
  DEFAULT_BATCH_CARDS_BUDGET,
  DEFAULT_BATCH_RAW_BYTES_BUDGET,
  DEFAULT_DUE_PAGE_LIMIT,
  DEFAULT_HISTORY_PAGE_LIMIT,
  encodeCursor,
  evaluateDueCounts,
  getStudyInspectionTarget,
  matchesDueFilter,
  MAX_BATCH_CARDS_BUDGET,
  MAX_BATCH_RAW_BYTES_BUDGET,
  MAX_CANDIDATE_BATCH,
  MAX_DUE_PAGE_LIMIT,
  MAX_HISTORY_PAGE_LIMIT,
  MAX_HISTORY_TARGETS,
  MAX_ID_LENGTH,
  MAX_TOPIC_LENGTH,
  MIN_BATCH_RAW_BYTES_BUDGET,
  optionalBoundedText,
  parseBoundedInteger,
  refuseRead,
  utf8ByteLength,
  validateDueCursor,
  validateHistoryCursor,
  validateScheduleState,
  type DueStatusFilter,
  type ItemStateRow,
} from "@/logic/cardLibrary";
import { isIsoInstant } from "@/logic/cardScheduler";

import type { SqlValue } from "./db";

export type ReadQuery = (sql: string, params: SqlValue[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];

const num = (value: unknown): number => Number(value);
const text = (value: unknown): string => (typeof value === "string" ? value : String(value));
const optText = (value: unknown): string | null => (value === null || value === undefined ? null : text(value));
const optNum = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

/** Turn engine failures into the allowlisted storage refusal; keep validation refusals. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CardLibraryReadError) throw error;
    throw new CardLibraryReadError("STORAGE_ERROR", { cause: error });
  }
}

/* ------------------------------------------------------------------ */
/* Shared admission ledger                                             */
/* ------------------------------------------------------------------ */

/**
 * One call's raw-read work. Before every raw read the caller asks `admit`:
 * the first read always passes (the single-set lane, so a page can never
 * livelock); later reads must fit the remaining byte and card budgets. An
 * admitted read reserves 500 cards; a valid set reconciles the reservation
 * to its real count, a failed one stays charged.
 */
class AdmissionLedger {
  rawReads = 0;
  rawBytes = 0;
  attemptedCards = 0;
  evaluatedCards = 0;
  singleSetLaneUsed = false;

  constructor(
    readonly cardsBudget: number,
    readonly bytesBudget: number,
  ) {}

  admit(byteLen: number): boolean {
    if (this.rawReads > 0) {
      if (this.rawBytes + byteLen > this.bytesBudget) return false;
      if (this.attemptedCards + CARD_WORK_RESERVATION > this.cardsBudget) return false;
    } else if (byteLen > this.bytesBudget || this.cardsBudget < CARD_WORK_RESERVATION) {
      this.singleSetLaneUsed = true;
    }
    this.rawReads += 1;
    this.attemptedCards += CARD_WORK_RESERVATION;
    return true;
  }

  transferred(rawJson: string) {
    this.rawBytes += utf8ByteLength(rawJson);
  }

  reconcile(cardCount: number) {
    this.attemptedCards = this.attemptedCards - CARD_WORK_RESERVATION + cardCount;
    this.evaluatedCards += cardCount;
  }

  /** After a read: stop admitting further sets in this call. */
  get exhausted(): boolean {
    return this.singleSetLaneUsed || this.rawBytes >= this.bytesBudget || this.attemptedCards >= this.cardsBudget;
  }
}

async function readRawSet(query: ReadQuery, materialId: string): Promise<string | null> {
  const [row] = await query("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?", [materialId]);
  return row && typeof row.flashcards_json === "string" ? row.flashcards_json : null;
}

async function readStates(query: ReadQuery, versionIds: string[]): Promise<Map<string, Map<string, ItemStateRow>>> {
  const byVersion = new Map<string, Map<string, ItemStateRow>>();
  if (versionIds.length === 0) return byVersion;
  const rows = await query(
    `SELECT i.version_id, s.item_id, s.step, s.due_at, s.suspended, s.flag
     FROM card_items i JOIN card_review_state s ON s.item_id = i.id
     WHERE i.version_id IN (SELECT value FROM json_each(?))`,
    [JSON.stringify(versionIds)],
  );
  for (const row of rows) {
    const versionId = text(row.version_id);
    let states = byVersion.get(versionId);
    if (!states) {
      states = new Map();
      byVersion.set(versionId, states);
    }
    states.set(text(row.item_id), {
      step: num(row.step),
      dueAt: optText(row.due_at),
      suspended: num(row.suspended) === 1,
      flagged: row.flag !== null && row.flag !== undefined,
    });
  }
  return byVersion;
}

/* ------------------------------------------------------------------ */
/* Review due                                                          */
/* ------------------------------------------------------------------ */

interface Candidate {
  materialId: string;
  title: string;
  topic: string;
  priority: string;
  updatedAt: string;
}

const candidateFrom = (row: Record<string, unknown>): Candidate => ({
  materialId: text(row.material_id),
  title: text(row.title),
  topic: text(row.topic),
  priority: text(row.priority),
  updatedAt: text(row.updated_at),
});

function oversizeIssue(candidate: Candidate, rawBytes: number): LibraryReviewOversizeIssue {
  return {
    materialId: candidate.materialId,
    title: candidate.title,
    code: "PAYLOAD_TOO_LARGE",
    rawBytes,
    allowedBytes: ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES,
    inspectionTarget: getStudyInspectionTarget(candidate.materialId),
  };
}

function entryFrom(candidate: Candidate, version: CardVersion, states: Map<string, ItemStateRow> | undefined, nowUtc: string, boundary: string): LibraryReviewMaterialEntry {
  const counts = evaluateDueCounts(
    version.items.map((item) => item.itemId),
    states ?? new Map(),
    nowUtc,
    boundary,
  );
  return {
    materialId: candidate.materialId,
    title: candidate.title,
    topic: candidate.topic,
    priority: candidate.priority,
    updatedAt: candidate.updatedAt,
    cardCount: counts.cardCount,
    againCount: counts.againCount,
    dayCount: counts.dayCount,
    newCount: counts.newCount,
    totalDueCount: counts.totalDueCount,
    retainedCardCount: counts.retainedCardCount,
    earliestDueAt: counts.earliestDueAt,
  };
}

const CANDIDATE_COLUMNS = `m.id AS material_id, m.title, m.topic, m.priority, m.updated_at`;
const HAS_CARDS = `a.flashcards_json IS NOT NULL AND a.flashcards_json != '[]' AND a.flashcards_json != ''`;

export async function readLibraryReviewDue(query: ReadQuery, input: LibraryReviewDueInput): Promise<LibraryReviewDueResult> {
  // Validation before any SQL.
  if (!isIsoInstant(input?.nowUtc) || !isIsoInstant(input?.nextLocalMidnightUtc)) refuseRead("INVALID_TIME");
  const nowUtc = input.nowUtc;
  const boundary = input.nextLocalMidnightUtc;
  const filter = input.statusFilter ?? "all";
  if (filter !== "all" && filter !== "due_today" && filter !== "new_only") refuseRead("INVALID_FILTER");
  const statusFilter: DueStatusFilter = filter;
  const topic = optionalBoundedText(input.topic, MAX_TOPIC_LENGTH, "INVALID_INPUT");
  const candidateBatchBudget = parseBoundedInteger(input.candidateBatchBudget, MAX_CANDIDATE_BATCH, 1, MAX_CANDIDATE_BATCH);
  const limit = parseBoundedInteger(input.limit, DEFAULT_DUE_PAGE_LIMIT, 1, MAX_DUE_PAGE_LIMIT);
  const cardsBudget = parseBoundedInteger(input.maxBatchCardsBudget, DEFAULT_BATCH_CARDS_BUDGET, 1, MAX_BATCH_CARDS_BUDGET);
  const bytesBudget = parseBoundedInteger(
    input.maxBatchRawJsonBytesBudget,
    DEFAULT_BATCH_RAW_BYTES_BUDGET,
    MIN_BATCH_RAW_BYTES_BUDGET,
    MAX_BATCH_RAW_BYTES_BUDGET,
  );
  const ctx = { topic, statusFilter, nowUtc, nextLocalMidnightUtc: boundary };
  const cursor = validateDueCursor(decodeCursor(input.cursor), ctx);

  return guarded(async () => {
    const issues: LibraryReviewOversizeIssue[] = [];
    const ledger = new AdmissionLedger(cardsBudget, bytesBudget);
    let scannedCandidates = 0;

    const finish = (
      materials: LibraryReviewMaterialEntry[],
      nextCursor: string | null,
      evaluatedCandidates: number,
    ): LibraryReviewDueResult => ({
      materials,
      nextCursor,
      issues,
      summary: {
        scannedCandidates,
        evaluatedCandidates,
        attemptedCards: ledger.attemptedCards,
        evaluatedCards: ledger.evaluatedCards,
        rawReads: ledger.rawReads,
        rawBytesTransferred: ledger.rawBytes,
        actionableCount: materials.length,
        againCount: materials.reduce((sum, m) => sum + m.againCount, 0),
        dayCount: materials.reduce((sum, m) => sum + m.dayCount, 0),
        totalDueCount: materials.reduce((sum, m) => sum + m.totalDueCount, 0),
        newCount: materials.reduce((sum, m) => sum + m.newCount, 0),
        isComplete: nextCursor === null,
        isPageLocal: true,
        issues,
      },
    });

    // Continuation: revalidate the ranked candidates left over from the
    // previous batch against live data, in order, without re-ranking.
    if (cursor && cursor.remIds.length > 0) {
      const page: LibraryReviewMaterialEntry[] = [];
      let consumed = 0;
      let evaluated = 0;
      for (const id of cursor.remIds) {
        if (page.length >= limit) break;
        const [row] = await query(
          `SELECT ${CANDIDATE_COLUMNS}, LENGTH(CAST(a.flashcards_json AS BLOB)) AS byte_len
           FROM study_materials m JOIN ai_study_sets a ON a.source_material_id = m.id
           WHERE m.id = ? AND ${HAS_CARDS}`,
          [id],
        );
        // Deleted, emptied or moved out of the topic: discard.
        if (!row || (topic !== null && row.topic !== topic)) {
          consumed += 1;
          continue;
        }
        const candidate = candidateFrom(row);
        const byteLen = num(row.byte_len ?? 0);
        if (byteLen > ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES) {
          issues.push(oversizeIssue(candidate, byteLen));
          consumed += 1;
          scannedCandidates += 1;
          continue;
        }
        if (!ledger.admit(byteLen)) break;
        const raw = await readRawSet(query, id);
        scannedCandidates += 1;
        consumed += 1;
        if (raw !== null) {
          ledger.transferred(raw);
          const parsed = parseSavedCards(raw);
          if (parsed.status === "ok") {
            ledger.reconcile(parsed.cards.length);
            const version = await cardVersion(id, parsed.cards);
            const states = await readStates(query, [version.versionId]);
            const entry = entryFrom(candidate, version, states.get(version.versionId), nowUtc, boundary);
            evaluated += 1;
            if (matchesDueFilter(entry, statusFilter)) page.push(entry);
          }
        }
        if (ledger.exhausted) break;
      }
      const left = cursor.remIds.slice(consumed);
      const nextCursor =
        left.length === 0 && cursor.isExhausted
          ? null
          : encodeCursor({ v: 1, type: "due", remIds: left, lc: cursor.lc, lp: cursor.lp, lu: cursor.lu, isExhausted: cursor.isExhausted, ctx });
      return finish(page, nextCursor, evaluated);
    }

    // Keyset candidate discovery.
    let sql = `SELECT ${CANDIDATE_COLUMNS} FROM study_materials m
               JOIN ai_study_sets a ON a.source_material_id = m.id WHERE ${HAS_CARDS}`;
    const params: SqlValue[] = [];
    if (topic !== null) {
      sql += " AND m.topic = ?";
      params.push(topic);
    }
    if (cursor) {
      sql += ` AND ((CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END > ?)
                OR (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END = ? AND m.updated_at < ?)
                OR (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END = ? AND m.updated_at = ? AND m.id > ?))`;
      params.push(cursor.lp, cursor.lp, cursor.lu, cursor.lp, cursor.lu, cursor.lc);
    }
    sql += ` ORDER BY CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END ASC, m.updated_at DESC, m.id ASC LIMIT ?`;
    params.push(candidateBatchBudget + 1);
    const rows = await query(sql, params);
    const hasMoreInDb = rows.length > candidateBatchBudget;
    const batch = rows.slice(0, candidateBatchBudget).map(candidateFrom);
    if (batch.length === 0) return finish([], null, 0);

    const lengths = new Map(
      (
        await query(
          `SELECT source_material_id, LENGTH(CAST(flashcards_json AS BLOB)) AS byte_len
           FROM ai_study_sets WHERE source_material_id IN (SELECT value FROM json_each(?))`,
          [JSON.stringify(batch.map((c) => c.materialId))],
        )
      ).map((row) => [text(row.source_material_id), num(row.byte_len ?? 0)]),
    );

    const admitted: { candidate: Candidate; version: CardVersion }[] = [];
    let lastIndex = -1;
    for (let index = 0; index < batch.length; index++) {
      const candidate = batch[index]!;
      const byteLen = lengths.get(candidate.materialId) ?? 0;
      if (byteLen > ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES) {
        issues.push(oversizeIssue(candidate, byteLen));
        lastIndex = index;
        scannedCandidates += 1;
        continue;
      }
      if (!ledger.admit(byteLen)) break;
      const raw = await readRawSet(query, candidate.materialId);
      scannedCandidates += 1;
      lastIndex = index;
      if (raw !== null) {
        ledger.transferred(raw);
        const parsed = parseSavedCards(raw);
        if (parsed.status === "ok") {
          ledger.reconcile(parsed.cards.length);
          admitted.push({ candidate, version: await cardVersion(candidate.materialId, parsed.cards) });
        }
      }
      if (ledger.exhausted) break;
    }

    const states = await readStates(query, [...new Set(admitted.map((a) => a.version.versionId))]);
    const actionable = admitted
      .map(({ candidate, version }) => entryFrom(candidate, version, states.get(version.versionId), nowUtc, boundary))
      .filter((entry) => matchesDueFilter(entry, statusFilter))
      .sort(compareUrgency);
    const page = actionable.slice(0, limit);
    const remIds = actionable.slice(limit).map((entry) => entry.materialId);
    const last = batch[lastIndex >= 0 ? lastIndex : batch.length - 1]!;
    const isExhausted = !hasMoreInDb && lastIndex === batch.length - 1;
    const nextCursor =
      remIds.length === 0 && isExhausted
        ? null
        : encodeCursor({
            v: 1,
            type: "due",
            remIds,
            lc: last.materialId,
            lp: last.priority === "next_up" ? 0 : 1,
            lu: last.updatedAt,
            isExhausted,
            ctx,
          });
    return finish(page, nextCursor, admitted.length);
  });
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

type CurrentInfo =
  | { status: "ok"; versionId: string }
  | { status: "unavailable" | "malformed" | "valid_empty"; reason?: string }
  | { status: "pending"; reason: "oversize" | "budget_exceeded"; inspectionTarget?: string };

/** Resolve one material's current identity under the shared ledger. */
async function resolveCurrent(query: ReadQuery, ledger: AdmissionLedger, materialId: string, byteLen: number): Promise<CurrentInfo> {
  if (byteLen > ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES) {
    return { status: "pending", reason: "oversize", inspectionTarget: getStudyInspectionTarget(materialId) };
  }
  if (!ledger.admit(byteLen)) return { status: "pending", reason: "budget_exceeded" };
  const raw = await readRawSet(query, materialId);
  if (raw === null) return { status: "unavailable", reason: "unreadable_cards" };
  ledger.transferred(raw);
  if (raw.trim() === "[]") return { status: "valid_empty" };
  const parsed = parseSavedCards(raw);
  if (parsed.status === "ok") {
    ledger.reconcile(parsed.cards.length);
    return { status: "ok", versionId: (await cardVersion(materialId, parsed.cards)).versionId };
  }
  return parsed.status === "malformed" ? { status: "malformed" } : { status: "valid_empty" };
}

function enrichmentRecord(materialId: string, info: CurrentInfo): HistoryMaterialEnrichmentRecord {
  return {
    materialId,
    contentStatus: info.status === "ok" ? "current" : info.status,
    currentVersionId: info.status === "ok" ? info.versionId : null,
    reason: "reason" in info && info.reason ? info.reason : null,
    inspectionTarget: info.status === "pending" && info.inspectionTarget ? info.inspectionTarget : null,
  };
}

export async function readLibraryRecentReviews(
  query: ReadQuery,
  input: LibraryRecentReviewsInput,
): Promise<LibraryRecentReviewsResult> {
  const options = input ?? {};
  const enrichmentOnly = options.enrichmentOnly === true || options.limit === 0;
  const limit = enrichmentOnly ? 0 : parseBoundedInteger(options.limit, DEFAULT_HISTORY_PAGE_LIMIT, 1, MAX_HISTORY_PAGE_LIMIT);
  const cardsBudget = parseBoundedInteger(options.maxBatchCardsBudget, DEFAULT_BATCH_CARDS_BUDGET, 1, MAX_BATCH_CARDS_BUDGET);
  const bytesBudget = parseBoundedInteger(
    options.maxBatchRawJsonBytesBudget,
    DEFAULT_BATCH_RAW_BYTES_BUDGET,
    MIN_BATCH_RAW_BYTES_BUDGET,
    MAX_BATCH_RAW_BYTES_BUDGET,
  );
  const materialId = optionalBoundedText(options.materialId, MAX_ID_LENGTH, "INVALID_INPUT");
  const topic = optionalBoundedText(options.topic, MAX_TOPIC_LENGTH, "INVALID_INPUT");
  let targets: string[] = [];
  if (options.enrichMaterialIds !== undefined && options.enrichMaterialIds !== null) {
    if (!Array.isArray(options.enrichMaterialIds)) refuseRead("INVALID_TARGET");
    for (const id of options.enrichMaterialIds) {
      if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LENGTH) refuseRead("INVALID_TARGET");
    }
    targets = [...new Set(options.enrichMaterialIds)];
    if (targets.length > MAX_HISTORY_TARGETS) refuseRead("INVALID_TARGET");
  }
  const ctx = { materialId, topic };
  const cursor = validateHistoryCursor(decodeCursor(options.cursor), ctx);

  return guarded(async () => {
    let pageRows: Record<string, unknown>[] = [];
    let next: string | null = null;
    if (!enrichmentOnly) {
      let sql = `SELECT e.id, e.item_id, e.rating, e.reviewed_at, e.scheduler_version, e.prior_state_json, e.next_state_json,
                        i.ordinal, i.front, i.back, i.source_page, v.id AS version_id, v.content_hash,
                        v.source_material_id AS material_id, m.title AS material_title, m.topic AS topic
                 FROM card_review_events e
                 JOIN card_items i ON i.id = e.item_id
                 JOIN card_versions v ON v.id = i.version_id
                 JOIN study_materials m ON m.id = v.source_material_id
                 WHERE 1 = 1`;
      const params: SqlValue[] = [];
      if (materialId !== null) {
        sql += " AND m.id = ?";
        params.push(materialId);
      }
      if (topic !== null) {
        sql += " AND m.topic = ?";
        params.push(topic);
      }
      if (cursor) {
        sql += " AND (e.reviewed_at < ? OR (e.reviewed_at = ? AND e.id < ?))";
        params.push(cursor.t, cursor.t, cursor.id);
      }
      sql += " ORDER BY e.reviewed_at DESC, e.id DESC LIMIT ?";
      params.push(limit + 1);
      const rows = await query(sql, params);
      pageRows = rows.slice(0, limit);
      const last = pageRows.at(-1);
      if (rows.length > limit && last) {
        next = encodeCursor({ v: 1, type: "history", t: text(last.reviewed_at), id: text(last.id), ctx });
      }
    }

    const ledger = new AdmissionLedger(cardsBudget, bytesBudget);
    const current = new Map<string, CurrentInfo>();
    const enrichment: HistoryMaterialEnrichmentRecord[] = [];

    // Explicit targets, owned by the active filter, independent of the page.
    for (const target of targets) {
      let info: CurrentInfo;
      if (materialId !== null && target !== materialId) {
        info = { status: "unavailable", reason: "filter_mismatch" };
      } else {
        const [row] = await query(
          `SELECT m.topic, LENGTH(CAST(a.flashcards_json AS BLOB)) AS byte_len
           FROM study_materials m LEFT JOIN ai_study_sets a ON a.source_material_id = m.id WHERE m.id = ?`,
          [target],
        );
        if (!row) info = { status: "unavailable", reason: "not_found" };
        else if (topic !== null && row.topic !== topic) info = { status: "unavailable", reason: "filter_mismatch" };
        else if (row.byte_len === null || row.byte_len === undefined) info = { status: "unavailable", reason: "no_study_set" };
        else info = await resolveCurrent(query, ledger, target, num(row.byte_len));
      }
      current.set(target, info);
      enrichment.push(enrichmentRecord(target, info));
    }

    // Page materials not already resolved as targets: one preflight, then the shared ledger.
    const pageMaterials = [...new Set(pageRows.map((row) => text(row.material_id)))].filter((id) => !current.has(id));
    if (pageMaterials.length > 0) {
      const lengths = new Map(
        (
          await query(
            `SELECT source_material_id, LENGTH(CAST(flashcards_json AS BLOB)) AS byte_len
             FROM ai_study_sets WHERE source_material_id IN (SELECT value FROM json_each(?))`,
            [JSON.stringify(pageMaterials)],
          )
        ).map((row) => [text(row.source_material_id), row.byte_len]),
      );
      for (const id of pageMaterials) {
        const byteLen = lengths.get(id);
        current.set(
          id,
          byteLen === null || byteLen === undefined ? { status: "unavailable" } : await resolveCurrent(query, ledger, id, num(byteLen)),
        );
      }
    }

    const rows: LibraryRecentReviewEntry[] = pageRows.map((row) => {
      const info = current.get(text(row.material_id));
      const versionId = text(row.version_id);
      let contentStatus: HistoryContentStatus;
      let isEarlierVersion: boolean | null;
      if (!info || info.status === "unavailable") {
        contentStatus = "unavailable";
        isEarlierVersion = true;
      } else if (info.status === "pending") {
        contentStatus = "pending";
        isEarlierVersion = null;
      } else if (info.status === "ok") {
        isEarlierVersion = info.versionId !== versionId;
        contentStatus = isEarlierVersion ? "earlier" : "current";
      } else {
        contentStatus = info.status;
        isEarlierVersion = true;
      }
      const schedulerVersion = text(row.scheduler_version);
      const priorRaw = optText(row.prior_state_json);
      const nextRaw = optText(row.next_state_json);
      const prior = validateScheduleState(priorRaw, schedulerVersion);
      const nextState = validateScheduleState(nextRaw, schedulerVersion);
      return {
        id: text(row.id),
        itemId: text(row.item_id),
        materialId: text(row.material_id),
        materialTitle: text(row.material_title),
        topic: text(row.topic),
        versionId,
        contentHash: text(row.content_hash),
        ordinal: num(row.ordinal),
        front: text(row.front),
        back: text(row.back),
        sourcePage: optNum(row.source_page),
        rating: text(row.rating) as CardRating,
        reviewedAt: text(row.reviewed_at),
        schedulerVersion,
        priorStateRaw: priorRaw,
        nextStateRaw: nextRaw,
        priorState: prior.parsed,
        nextState: nextState.parsed,
        priorSchedule: prior.schedule,
        nextSchedule: nextState.schedule,
        step: nextState.schedule?.step ?? null,
        dueAt: nextState.schedule?.dueAt ?? null,
        intervalDays: nextState.schedule?.intervalDays ?? null,
        intervalMinutes: nextState.schedule?.intervalMinutes ?? null,
        intervalLabel: nextState.schedule?.intervalLabel ?? null,
        isEarlierVersion,
        contentStatus,
        currentVersionId: info?.status === "ok" ? info.versionId : null,
        blockedReason: info && "reason" in info && info.reason ? info.reason : null,
        inspectionTarget: info?.status === "pending" && info.inspectionTarget ? info.inspectionTarget : null,
      };
    });

    const pendingMaterialIds = [...current.entries()]
      .filter(([, info]) => info.status === "pending" && info.reason !== "oversize")
      .map(([id]) => id);
    return {
      rows,
      next,
      pendingMaterialIds,
      enrichment: targets.length > 0 ? enrichment : null,
      summary: {
        eventsReturned: rows.length,
        rawReads: ledger.rawReads,
        rawBytesTransferred: ledger.rawBytes,
        attemptedCards: ledger.attemptedCards,
        evaluatedCards: ledger.evaluatedCards,
        maxBatchCardsBudget: cardsBudget,
        maxBatchRawJsonBytesBudget: bytesBudget,
        isPageLocal: true,
      },
    };
  });
}
