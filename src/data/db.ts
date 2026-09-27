/**
 * The narrow database surface the rest of the application depends on.
 *
 * Repositories talk to this interface, never to a concrete driver, so the
 * same repository code runs against Tauri's bundled SQLite in the desktop
 * app, sql.js in a plain browser during development, and node:sqlite in
 * tests. Replacing local persistence with a hosted backend means writing
 * one new implementation of this interface.
 */
export interface SqlDatabase {
  /** Run a query and return typed rows. */
  select<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Run a statement that returns no rows. */
  execute(sql: string, params?: SqlValue[]): Promise<void>;
  /** Flush to durable storage where the driver needs it. Optional. */
  persist?(): Promise<void>;
  /** Desktop-only pinned transaction for a batch of PDF part records. */
  saveMaterialsAtomically?(materials: import("@/domain/types").StudyMaterial[]): Promise<void>;
  /** Single-connection atomic transaction for debrief multi-record acceptance. */
  saveDebriefAtomically?(operation: DebriefSaveOperation): Promise<void>;
}

/**
 * The one debrief-save contract, shared by the form, this interface, the Tauri
 * adapter (`invoke("save_debrief_operation", { operation })`), the Rust
 * `DebriefSaveOperation` (which rejects unknown fields), and the browser/test
 * transaction in `debriefTransaction.ts`. Checked-in fixtures captured from the
 * real form (`src-tauri/fixtures/debrief-contract/`) are replayed by both sides.
 *
 * Retry versus deliberate edit:
 * - `operationId` identifies one exact save. The form keeps it while that
 *   operation's content is unchanged, so a retry after a lost response sends
 *   the same id. An id that already committed is a complete no-op.
 * - A new id is a deliberate save. It writes the journal as shown in the form,
 *   and on an action/question it owns it writes only the debrief-managed
 *   fields (action title and material; question text, lesson and material).
 *   Status, completion, answers, priority, category, dates and estimates are
 *   never written on update.
 * - `targetId`, `action.id` and `question.id` are pre-assigned by the form.
 *   Existence in the database decides insert versus update; an existing record
 *   not owned by this journal is refused, never overwritten or deleted.
 */
export interface DebriefSaveOperation {
  operationId: string;
  targetId: string;
  journal: {
    eventId?: string | null;
    date: string;
    title: string;
    aircraftType?: string | null;
    aircraftId?: string | null;
    departureAirport?: string | null;
    arrivalAirport?: string | null;
    instructorName?: string | null;
    totalTime?: number | null;
    dualReceived?: number | null;
    soloTime?: number | null;
    picTime?: number | null;
    crossCountryTime?: number | null;
    nightTime?: number | null;
    actualInstrumentTime?: number | null;
    simulatedInstrumentTime?: number | null;
    dayLandings?: number | null;
    nightLandings?: number | null;
    mission?: string | null;
    practiced?: string | null;
    wentWell?: string | null;
    wasDifficult?: string | null;
    instructorFeedback?: string | null;
    questionsForNextTime?: string | null;
    confidence?: number | null;
    goalId?: string | null;
    materialIds?: string[];
  };
  action?: {
    id: string;
    title: string;
    materialId?: string | null;
  } | null;
  withdrawActionId?: string | null;
  question?: {
    id: string;
    text: string;
    eventId?: string | null;
    materialId?: string | null;
  } | null;
  withdrawQuestionId?: string | null;
}

export type SqlValue = string | number | null;

/**
 * Rewrite `?` placeholders to the `$1, $2, …` form Tauri's SQL plugin wants.
 *
 * All application queries are written with `?` so they stay portable across
 * the three drivers. Our SQL never contains a literal `?` inside a string,
 * which is what makes this safe.
 */
export function toNumberedPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/* ---------------------------- row helpers ---------------------------- */

/** SQLite has no boolean type; it stores 0/1. */
export const toBool = (value: unknown): boolean => value === 1 || value === true;
export const fromBool = (value: boolean): number => (value ? 1 : 0);

export const toText = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

export const toNullableText = (value: unknown): string | null =>
  value == null || value === "" ? null : String(value);

export const toNullableNumber = (value: unknown): number | null =>
  value == null ? null : Number(value);

/** Narrow a stored string to a known union, falling back when data is old. */
export function toEnum<T extends string>(
  value: unknown,
  allowed: Record<T, unknown>,
  fallback: T,
): T {
  const text = typeof value === "string" ? value : "";
  return Object.prototype.hasOwnProperty.call(allowed, text) ? (text as T) : fallback;
}
