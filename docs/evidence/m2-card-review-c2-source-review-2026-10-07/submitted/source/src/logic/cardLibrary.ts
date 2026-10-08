/**
 * Library-wide card review rules (M2-4 / C2, approved C2-D1–D9).
 *
 * Pure helpers shared by the browser/test reader (`src/data/cardLibraryReader.ts`)
 * and mirrored by the native reader (`src-tauri/src/card_library.rs`):
 * resource limits, the Study inspection route, strict cursors, schedule
 * validation and due/new evaluation of a derived current version.
 *
 * Due/new evaluation follows the C1 queue exactly: suspended or flagged
 * cards are neither due nor new; a never-rated card is new; an Again card is
 * due at its exact instant; a day card is due before the exclusive next
 * local midnight. Ratings only schedule reviews — they are never scores.
 */
import { canonicalJson } from "./cardIdentity";
import { AGAIN_DELAY_MINUTES, isIsoInstant, LADDER_DAYS, SCHEDULER_VERSION } from "./cardScheduler";

/* ------------------------------------------------------------------ */
/* Limits (C2-D9)                                                      */
/* ------------------------------------------------------------------ */

export const MAX_CANDIDATE_BATCH = 250;
export const DEFAULT_DUE_PAGE_LIMIT = 50;
export const MAX_DUE_PAGE_LIMIT = 250;
export const DEFAULT_HISTORY_PAGE_LIMIT = 20;
export const MAX_HISTORY_PAGE_LIMIT = 100;
export const DEFAULT_BATCH_CARDS_BUDGET = 2_500;
export const MAX_BATCH_CARDS_BUDGET = 100_000;
export const DEFAULT_BATCH_RAW_BYTES_BUDGET = 2 * 1024 * 1024;
export const MIN_BATCH_RAW_BYTES_BUDGET = 1024;
export const MAX_BATCH_RAW_BYTES_BUDGET = 64 * 1024 * 1024;
/** Absolute ceiling for one saved card set; larger sets are never transferred. */
export const ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES = 8 * 1024 * 1024;
/** Conservative card-work reservation taken before every raw read. */
export const CARD_WORK_RESERVATION = 500;
export const MAX_HISTORY_TARGETS = 250;
export const MAX_CURSOR_LENGTH = 32_768;
export const MAX_ID_LENGTH = 64;
export const MAX_TOPIC_LENGTH = 256;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type CardLibraryErrorCode =
  | "INVALID_TIME"
  | "INVALID_FILTER"
  | "INVALID_INPUT"
  | "INVALID_CURSOR"
  | "STALE_CURSOR"
  | "INVALID_TARGET"
  | "NOT_READY"
  | "STORAGE_ERROR"
  | "IPC_TRANSPORT_ERROR";

/** Fixed messages; the native allowlist uses the first eight word for word. */
export const CARD_LIBRARY_ERROR_MESSAGES: Readonly<Record<CardLibraryErrorCode, string>> = Object.freeze({
  INVALID_TIME: "The review clock for this request is invalid.",
  INVALID_FILTER: "That review filter isn't supported.",
  INVALID_INPUT: "The review request is invalid.",
  INVALID_CURSOR: "That page position is invalid.",
  STALE_CURSOR: "The filters or clock changed since this page was loaded.",
  INVALID_TARGET: "The cards to check are invalid.",
  NOT_READY: "Card reviews are not ready yet.",
  STORAGE_ERROR: "Card reviews couldn't be read just now.",
  IPC_TRANSPORT_ERROR: "Desktop communication failure while reading card reviews.",
});

export class CardLibraryReadError extends Error {
  readonly code: CardLibraryErrorCode;
  constructor(code: CardLibraryErrorCode, options?: { cause?: unknown }) {
    super(CARD_LIBRARY_ERROR_MESSAGES[code], options);
    this.name = "CardLibraryReadError";
    this.code = code;
  }
}

export function refuseRead(code: CardLibraryErrorCode): never {
  throw new CardLibraryReadError(code);
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/** The registered Study route for a material, encoded (`a/b` → `/study/a%2Fb`). */
export function getStudyInspectionTarget(materialId: string): string {
  return `/study/${encodeURIComponent(materialId)}`;
}

/**
 * A bounded integer option: absent or unusable values take the default;
 * usable values are floored and clamped (the accepted proof's rule).
 */
export function parseBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

export function optionalBoundedText(value: unknown, max: number, code: CardLibraryErrorCode): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > max) refuseRead(code);
  return value;
}

/* ------------------------------------------------------------------ */
/* Cursors: base64 of canonical JSON, identical in every reader        */
/* ------------------------------------------------------------------ */

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function encodeCursor(payload: Record<string, unknown>): string {
  const encoded = bytesToBase64(new TextEncoder().encode(canonicalJson(payload)));
  if (encoded.length > MAX_CURSOR_LENGTH) refuseRead("INVALID_CURSOR");
  return encoded;
}

/** Strict base64 → UTF-8 → JSON object; anything else is INVALID_CURSOR. */
export function decodeCursor(cursor: unknown): Record<string, unknown> | null {
  if (cursor === undefined || cursor === null) return null;
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH || !BASE64.test(cursor)) {
    refuseRead("INVALID_CURSOR");
  }
  let parsed: unknown;
  try {
    const binary = atob(cursor);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    // Only canonical base64 (no stray trailing bits), as the native decoder requires.
    if (bytesToBase64(bytes) !== cursor) throw new Error("non-canonical base64");
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    refuseRead("INVALID_CURSOR");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) refuseRead("INVALID_CURSOR");
  return parsed as Record<string, unknown>;
}

function exactKeys(object: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(object);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(object, key));
}

const isBoundedId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;

export type DueStatusFilter = "all" | "due_today" | "new_only";

export interface DueCursorContext {
  topic: string | null;
  statusFilter: DueStatusFilter;
  nowUtc: string;
  nextLocalMidnightUtc: string;
}

export interface DueCursor {
  v: 1;
  type: "due";
  remIds: string[];
  /** Keyset boundary: last scanned candidate's id, priority rank and updated_at. */
  lc: string;
  lp: 0 | 1;
  lu: string;
  isExhausted: boolean;
  ctx: DueCursorContext;
}

/**
 * Complete, context-owned due cursor validation, before any SQL. Shape
 * problems are INVALID_CURSOR; a well-formed cursor from another filter or
 * clock is STALE_CURSOR. `lu` is a bounded stored text value: it is compared
 * exactly against `study_materials.updated_at`, which older rows may not
 * store in the canonical instant form.
 */
export function validateDueCursor(raw: Record<string, unknown> | null, context: DueCursorContext): DueCursor | null {
  if (raw === null) return null;
  if (!exactKeys(raw, ["v", "type", "remIds", "lc", "lp", "lu", "isExhausted", "ctx"])) refuseRead("INVALID_CURSOR");
  if (raw.v !== 1 || raw.type !== "due") refuseRead("INVALID_CURSOR");
  const ctx = raw.ctx;
  if (ctx === null || typeof ctx !== "object" || Array.isArray(ctx)) refuseRead("INVALID_CURSOR");
  const c = ctx as Record<string, unknown>;
  if (!exactKeys(c, ["topic", "statusFilter", "nowUtc", "nextLocalMidnightUtc"])) refuseRead("INVALID_CURSOR");
  if (typeof raw.isExhausted !== "boolean") refuseRead("INVALID_CURSOR");
  if (!Array.isArray(raw.remIds) || raw.remIds.length > MAX_CANDIDATE_BATCH) refuseRead("INVALID_CURSOR");
  const seen = new Set<string>();
  for (const id of raw.remIds) {
    if (!isBoundedId(id) || seen.has(id)) refuseRead("INVALID_CURSOR");
    seen.add(id);
  }
  if (!isBoundedId(raw.lc)) refuseRead("INVALID_CURSOR");
  if (raw.lp !== 0 && raw.lp !== 1) refuseRead("INVALID_CURSOR");
  if (!isBoundedId(raw.lu)) refuseRead("INVALID_CURSOR");
  if (
    c.topic !== context.topic ||
    c.statusFilter !== context.statusFilter ||
    c.nowUtc !== context.nowUtc ||
    c.nextLocalMidnightUtc !== context.nextLocalMidnightUtc
  ) {
    refuseRead("STALE_CURSOR");
  }
  return raw as unknown as DueCursor;
}

export interface HistoryCursorContext {
  materialId: string | null;
  topic: string | null;
}

export interface HistoryCursor {
  v: 1;
  type: "history";
  t: string;
  id: string;
  ctx: HistoryCursorContext;
}

export function validateHistoryCursor(
  raw: Record<string, unknown> | null,
  context: HistoryCursorContext,
): HistoryCursor | null {
  if (raw === null) return null;
  if (!exactKeys(raw, ["v", "type", "t", "id", "ctx"])) refuseRead("INVALID_CURSOR");
  if (raw.v !== 1 || raw.type !== "history") refuseRead("INVALID_CURSOR");
  const ctx = raw.ctx;
  if (ctx === null || typeof ctx !== "object" || Array.isArray(ctx)) refuseRead("INVALID_CURSOR");
  const c = ctx as Record<string, unknown>;
  if (!exactKeys(c, ["materialId", "topic"])) refuseRead("INVALID_CURSOR");
  if (!isIsoInstant(raw.t) || !isBoundedId(raw.id)) refuseRead("INVALID_CURSOR");
  if (c.materialId !== context.materialId || c.topic !== context.topic) refuseRead("STALE_CURSOR");
  return raw as unknown as HistoryCursor;
}

/* ------------------------------------------------------------------ */
/* Schedule validation for history rows                                */
/* ------------------------------------------------------------------ */

export interface ValidatedSchedule {
  schedulerVersion: "simple-v1";
  step: number;
  dueAt: string | null;
  lastReviewedAt: string | null;
  reps: number | null;
  lapses: number | null;
  intervalDays: number | null;
  intervalMinutes: number | null;
  intervalLabel: string | null;
}

export interface ScheduleValidation {
  parsed: Record<string, unknown> | null;
  schedule: ValidatedSchedule | null;
}

const isNonNegativeInteger = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * Validate a stored schedule JSON against `simple-v1`, owned by the event's
 * own scheduler version. An unsupported event version, or a state without a
 * version under anything but `simple-v1`, yields no schedule; the raw audit
 * text is kept by the caller either way. Nothing is invented.
 */
export function validateScheduleState(stateJson: string | null, eventSchedulerVersion: string | null): ScheduleValidation {
  if (stateJson === null || stateJson === "") return { parsed: null, schedule: null };
  let value: unknown;
  try {
    value = JSON.parse(stateJson);
  } catch {
    return { parsed: null, schedule: null };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { parsed: null, schedule: null };
  const parsed = value as Record<string, unknown>;
  const invalid = { parsed, schedule: null };
  if (eventSchedulerVersion !== null && eventSchedulerVersion !== SCHEDULER_VERSION) return invalid;
  if (parsed.schedulerVersion !== undefined && parsed.schedulerVersion !== null) {
    if (parsed.schedulerVersion !== SCHEDULER_VERSION) return invalid;
  } else if (eventSchedulerVersion !== SCHEDULER_VERSION) {
    return invalid;
  }
  const step = parsed.step;
  if (typeof step !== "number" || !Number.isInteger(step) || step < -1 || step > LADDER_DAYS.length - 1) return invalid;
  for (const key of ["dueAt", "lastReviewedAt"] as const) {
    if (parsed[key] !== undefined && parsed[key] !== null && !isIsoInstant(parsed[key])) return invalid;
  }
  for (const key of ["reps", "lapses"] as const) {
    if (parsed[key] !== undefined && parsed[key] !== null && !isNonNegativeInteger(parsed[key])) return invalid;
  }
  const intervalDays = step >= 0 ? LADDER_DAYS[step]! : null;
  const intervalMinutes = step === -1 ? AGAIN_DELAY_MINUTES : intervalDays! * 1440;
  return {
    parsed,
    schedule: {
      schedulerVersion: SCHEDULER_VERSION,
      step,
      dueAt: (parsed.dueAt as string | undefined) ?? null,
      lastReviewedAt: (parsed.lastReviewedAt as string | undefined) ?? null,
      reps: isNonNegativeInteger(parsed.reps) ? (parsed.reps as number) : null,
      lapses: isNonNegativeInteger(parsed.lapses) ? (parsed.lapses as number) : null,
      intervalDays,
      intervalMinutes,
      intervalLabel: step === -1 ? `${AGAIN_DELAY_MINUTES}m` : `${intervalDays}d`,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Due/new evaluation of a derived current version (C1 semantics)     */
/* ------------------------------------------------------------------ */

export interface ItemStateRow {
  step: number;
  dueAt: string | null;
  suspended: boolean;
  flagged: boolean;
}

export interface DueCounts {
  cardCount: number;
  againCount: number;
  dayCount: number;
  totalDueCount: number;
  newCount: number;
  retainedCardCount: number;
  earliestDueAt: string | null;
}

export function evaluateDueCounts(
  itemIds: readonly string[],
  states: ReadonlyMap<string, ItemStateRow>,
  nowUtc: string,
  nextLocalMidnightUtc: string,
): DueCounts {
  let againCount = 0;
  let dayCount = 0;
  let newCount = 0;
  let retainedCardCount = 0;
  let earliestDueAt: string | null = null;
  for (const itemId of itemIds) {
    const state = states.get(itemId);
    if (state) retainedCardCount += 1;
    if (state && (state.suspended || state.flagged)) continue;
    if (!state || state.dueAt === null) {
      newCount += 1;
      continue;
    }
    const due = state.step < 0 ? state.dueAt <= nowUtc : state.dueAt < nextLocalMidnightUtc;
    if (!due) continue;
    if (state.step < 0) againCount += 1;
    else dayCount += 1;
    if (earliestDueAt === null || state.dueAt < earliestDueAt) earliestDueAt = state.dueAt;
  }
  return {
    cardCount: itemIds.length,
    againCount,
    dayCount,
    totalDueCount: againCount + dayCount,
    newCount,
    retainedCardCount,
    earliestDueAt,
  };
}

export function matchesDueFilter(counts: Pick<DueCounts, "totalDueCount" | "newCount">, filter: DueStatusFilter): boolean {
  if (filter === "due_today") return counts.totalDueCount > 0;
  if (filter === "new_only") return counts.totalDueCount === 0 && counts.newCount > 0;
  return counts.totalDueCount > 0 || counts.newCount > 0;
}

export interface RankedMaterial extends DueCounts {
  materialId: string;
  title: string;
  priority: string;
}

const urgencyBucket = (m: RankedMaterial) =>
  m.againCount > 0 ? 0 : m.dayCount > 0 ? 1 : m.totalDueCount === 0 && m.newCount > 0 ? 2 : 3;

/** Code-unit string order, identical in every reader (no locale). */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Urgency ranking within one evaluated batch (C2-D3): Again due, then day
 * due, then new only; ties by Next Up priority, earliest due instant, title,
 * then id.
 */
export function compareUrgency(a: RankedMaterial, b: RankedMaterial): number {
  const bucket = urgencyBucket(a) - urgencyBucket(b);
  if (bucket !== 0) return bucket;
  const priority = (a.priority === "next_up" ? 0 : 1) - (b.priority === "next_up" ? 0 : 1);
  if (priority !== 0) return priority;
  if (a.earliestDueAt !== b.earliestDueAt) {
    if (a.earliestDueAt === null) return 1;
    if (b.earliestDueAt === null) return -1;
    return compareText(a.earliestDueAt, b.earliestDueAt);
  }
  if (a.title !== b.title) return compareText(a.title, b.title);
  return compareText(a.materialId, b.materialId);
}

/** UTF-8 byte length of a string, as transferred from SQLite. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
