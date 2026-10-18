/**
 * Document navigation persistence (M4 Slice 1): the browser and test twin of
 * the native `navigation_operation` in `src-tauri/src/navigation.rs`, in the
 * shape of the accepted transactions (`skillEvidenceTransaction.ts`): `exec`
 * for transaction control, `run` for data statements, `query` for reads, all
 * on one owned connection.
 *
 * Contract (shared cases: `src-tauri/fixtures/navigation/operation-cases.json`):
 * - The request is decoded strictly (exact keys, typed, bounded) before the
 *   transaction.
 * - `begin` reserves the next token under BEGIN IMMEDIATE and returns it only
 *   after exactly one claim row changed and a read-back finds that token
 *   (M4-R33/R38). It may cancel the token it supersedes in the same step.
 * - `commit` writes the whole page/hash/label tuple only for the exact,
 *   current, non-cancelled reserved token, within the recorded identity's
 *   page count (M4-R34). Every other case is a refusal verdict that writes
 *   nothing.
 * - `set_read` names the content hash and owner generation of the saved
 *   request it confirms or clears, and `add_bookmark` the content hash it was
 *   made for (M4S1-R1); a stale request is STALE_STATE and changes nothing.
 * - Identity is never written here: it comes only from the native inspector,
 *   which reads the file's bytes. Browser mode has no managed files. The
 *   native side additionally rereads the managed file inside the same
 *   transaction (M4S1-R3); that half has no browser counterpart.
 */
import type {
  NavigationBookmark,
  NavigationErrorCode,
  NavigationOperation,
  NavigationReadingState,
  NavigationResultByKind,
} from "@/domain/types";

import type { SqlValue } from "./db";

export const NAVIGATION_LIMITS = {
  idChars: 128,
  titleChars: 500,
  notesChars: 20_000,
  labelChars: 100,
  bookmarksPerMaterial: 500,
} as const;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** A refusal with one of the contract's codes. The message is written for her. */
export class NavigationError extends Error {
  constructor(
    readonly code: NavigationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NavigationError";
  }
}

/** The refusals and their fixed messages (`NavigationErrorCode::message` in navigation.rs). */
export const NAVIGATION_ERROR_MESSAGES: Record<NavigationErrorCode, string> = {
  INVALID_ARGUMENT: "That request is not valid.",
  NOT_FOUND: "That study material is no longer here.",
  FILE_MISSING: "The file for this material isn't in your library anymore.",
  NOT_A_PDF: "This file can't be read as a PDF, so its pages can't be checked.",
  FILE_CHANGED: "The file changed while it was being checked. Try again.",
  IDENTITY_UNKNOWN: "This document's pages haven't been checked yet.",
  PAGE_OUT_OF_RANGE: "That page isn't in this document.",
  STALE_STATE: "This changed somewhere else. Reload to see the latest.",
  LIMIT_EXCEEDED: "That is more than this can hold.",
  OPEN_FAILED: "Your PDF reader couldn't open this file.",
  STORAGE_FAILURE: "The change could not be saved.",
  DESKTOP_ONLY: "Checking a document's pages needs the desktop application.",
};

export const refuse = (code: NavigationErrorCode): never => {
  throw new NavigationError(code, NAVIGATION_ERROR_MESSAGES[code]);
};

/* ------------------------------------------------------------------ */
/* Strict decoding (native `decode_operation`)                         */
/* ------------------------------------------------------------------ */

type Fields = Record<string, unknown>;

/** ECMAScript trim, matching the native `js_trim`. */
const trimmed = (text: string) => text.trim() === text;
const codePoints = (text: string) => [...text].length;

function exact(value: unknown, keys: readonly string[]): Fields {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("INVALID_ARGUMENT");
  const fields = value as Fields;
  const own = Object.keys(fields);
  if (own.length !== keys.length || !keys.every((k) => Object.prototype.hasOwnProperty.call(fields, k))) {
    refuse("INVALID_ARGUMENT");
  }
  return fields;
}

function id(fields: Fields, key: string): string {
  const text = fields[key];
  if (typeof text !== "string" || text.length === 0 || codePoints(text) > NAVIGATION_LIMITS.idChars || !/^[A-Za-z0-9_-]+$/.test(text)) {
    refuse("INVALID_ARGUMENT");
  }
  return text as string;
}

function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_SAFE) refuse("INVALID_ARGUMENT");
  return value as number;
}

function nullablePositive(fields: Fields, key: string): number | null {
  const value = fields[key];
  return value === null ? null : positive(value);
}

function hash(fields: Fields, key: string): string {
  const text = fields[key];
  if (typeof text !== "string" || !/^[0-9a-f]{64}$/.test(text)) refuse("INVALID_ARGUMENT");
  return text as string;
}

function label(fields: Fields, key: string): string | null {
  const value = fields[key];
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || !trimmed(value) || codePoints(value) > NAVIGATION_LIMITS.labelChars) {
    refuse("INVALID_ARGUMENT");
  }
  return value as string;
}

function text(fields: Fields, key: string, max: number, allowEmpty: boolean): string {
  const value = fields[key];
  if (typeof value !== "string" || codePoints(value) > max || !trimmed(value) || (!allowEmpty && value.length === 0)) {
    refuse("INVALID_ARGUMENT");
  }
  return value as string;
}

export function decodeNavigationOperation(value: unknown): NavigationOperation {
  const kind = value && typeof value === "object" ? (value as Fields).kind : undefined;
  switch (kind) {
    case "begin": {
      const f = exact(value, ["kind", "materialId", "supersedeGeneration"]);
      return { kind, materialId: id(f, "materialId"), supersedeGeneration: nullablePositive(f, "supersedeGeneration") };
    }
    case "cancel": {
      const f = exact(value, ["kind", "materialId", "generation"]);
      return { kind, materialId: id(f, "materialId"), generation: positive(f.generation) };
    }
    case "commit": {
      const f = exact(value, ["kind", "materialId", "generation", "contentSha256", "physicalPage", "pageLabel"]);
      return {
        kind,
        materialId: id(f, "materialId"),
        generation: positive(f.generation),
        contentSha256: hash(f, "contentSha256"),
        physicalPage: positive(f.physicalPage),
        pageLabel: label(f, "pageLabel"),
      };
    }
    case "read": {
      const f = exact(value, ["kind", "materialId"]);
      return { kind, materialId: id(f, "materialId") };
    }
    case "set_read": {
      const f = exact(value, ["kind", "materialId", "expectedContentSha256", "expectedOwnerGeneration", "physicalPage", "confirmed"]);
      const materialId = id(f, "materialId");
      const expectedContentSha256 = hash(f, "expectedContentSha256");
      const expectedOwnerGeneration = positive(f.expectedOwnerGeneration);
      const physicalPage = positive(f.physicalPage);
      if (typeof f.confirmed !== "boolean") refuse("INVALID_ARGUMENT");
      return { kind, materialId, expectedContentSha256, expectedOwnerGeneration, physicalPage, confirmed: f.confirmed as boolean };
    }
    case "add_bookmark": {
      const f = exact(value, ["kind", "materialId", "expectedContentSha256", "bookmarkId", "physicalPage", "pageLabel", "title", "notes"]);
      return {
        kind,
        materialId: id(f, "materialId"),
        expectedContentSha256: hash(f, "expectedContentSha256"),
        bookmarkId: id(f, "bookmarkId"),
        physicalPage: positive(f.physicalPage),
        pageLabel: label(f, "pageLabel"),
        title: text(f, "title", NAVIGATION_LIMITS.titleChars, false),
        notes: text(f, "notes", NAVIGATION_LIMITS.notesChars, true),
      };
    }
    case "delete_bookmark": {
      const f = exact(value, ["kind", "materialId", "bookmarkId"]);
      return { kind, materialId: id(f, "materialId"), bookmarkId: id(f, "bookmarkId") };
    }
    default:
      return refuse("INVALID_ARGUMENT");
  }
}

/* ------------------------------------------------------------------ */
/* The transaction                                                     */
/* ------------------------------------------------------------------ */

export type Exec = (sql: string) => void | Promise<void>;
export type Run = (sql: string, params: SqlValue[]) => void | Promise<void>;
export type Query = (sql: string, params: SqlValue[]) => Record<string, unknown>[];

interface Tx {
  run: Run;
  query: Query;
}

const num = (row: Record<string, unknown>, key: string): number => Number(row[key]);
const str = (row: Record<string, unknown>, key: string): string => String(row[key]);
const optStr = (row: Record<string, unknown>, key: string): string | null => (row[key] === null || row[key] === undefined ? null : String(row[key]));

/** Storage faults are STORAGE_FAILURE; refusals pass through unchanged. */
async function guarded<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NavigationError) throw error;
    throw Object.assign(new NavigationError("STORAGE_FAILURE", NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE), { cause: error });
  }
}

function now(tx: Tx): string {
  return str(tx.query("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS t", [])[0]!, "t");
}

function changes(tx: Tx): number {
  return num(tx.query("SELECT changes() AS n", [])[0]!, "n");
}

function materialExists(tx: Tx, materialId: string): boolean {
  return num(tx.query("SELECT COUNT(*) AS n FROM study_materials WHERE id = ?", [materialId])[0]!, "n") === 1;
}

function identityOf(tx: Tx, materialId: string): { contentSha256: string; totalPages: number; verifiedAt: string } | null {
  const [row] = tx.query("SELECT content_sha256, total_pages, verified_at FROM material_content_identities WHERE material_id = ?", [materialId]);
  return row ? { contentSha256: str(row, "content_sha256"), totalPages: num(row, "total_pages"), verifiedAt: str(row, "verified_at") } : null;
}

function claimOf(tx: Tx, materialId: string): { reserved: number; cancelled: number } | null {
  const [row] = tx.query("SELECT reserved_generation, cancelled_generation FROM material_operation_claims WHERE material_id = ?", [materialId]);
  return row ? { reserved: num(row, "reserved_generation"), cancelled: num(row, "cancelled_generation") } : null;
}

function savedOwner(tx: Tx, materialId: string): number {
  const [row] = tx.query("SELECT owner_generation FROM material_reading_state WHERE material_id = ?", [materialId]);
  return row ? num(row, "owner_generation") : 0;
}

export function readingStateOf(query: Query, materialId: string): NavigationReadingState | null {
  const [row] = query(
    `SELECT last_requested_page, last_requested_page_label, confirmed_read, originating_content_sha256, status, owner_generation, updated_at
       FROM material_reading_state WHERE material_id = ?`,
    [materialId],
  );
  if (!row) return null;
  return {
    materialId,
    lastRequestedPage: num(row, "last_requested_page"),
    lastRequestedPageLabel: optStr(row, "last_requested_page_label"),
    confirmedRead: num(row, "confirmed_read") === 1,
    originatingContentSha256: optStr(row, "originating_content_sha256"),
    status: str(row, "status") as NavigationReadingState["status"],
    ownerGeneration: num(row, "owner_generation"),
    updatedAt: str(row, "updated_at"),
  };
}

const BOOKMARK_COLUMNS = "id, material_id, page_index, page_label, originating_content_sha256, title, notes, status, created_at, updated_at";

function bookmarkOf(row: Record<string, unknown>): NavigationBookmark {
  return {
    id: str(row, "id"),
    materialId: str(row, "material_id"),
    physicalPage: num(row, "page_index"),
    pageLabel: optStr(row, "page_label"),
    originatingContentSha256: optStr(row, "originating_content_sha256"),
    title: str(row, "title"),
    notes: str(row, "notes"),
    status: str(row, "status") as NavigationBookmark["status"],
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function refused(tx: Tx, materialId: string, reason: Exclude<NavigationResultByKind["commit"]["reason"], null>): NavigationResultByKind["commit"] {
  return { committed: false, reason, readingState: readingStateOf(tx.query, materialId) };
}

async function begin(tx: Tx, materialId: string, supersede: number | null): Promise<NavigationResultByKind["begin"]> {
  if (!materialExists(tx, materialId)) refuse("NOT_FOUND");
  const claim = claimOf(tx, materialId) ?? { reserved: 0, cancelled: 0 };
  const base = Math.max(claim.reserved, savedOwner(tx, materialId));
  if (base >= MAX_SAFE - 1) refuse("LIMIT_EXCEEDED");
  const next = base + 1;
  let cancelTo = claim.cancelled;
  if (supersede !== null) {
    if (supersede > claim.reserved) refuse("INVALID_ARGUMENT");
    cancelTo = Math.max(claim.cancelled, supersede);
  }
  await tx.run(
    `INSERT INTO material_operation_claims (material_id, reserved_generation, cancelled_generation, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(material_id) DO UPDATE SET
       reserved_generation = excluded.reserved_generation,
       cancelled_generation = excluded.cancelled_generation,
       updated_at = excluded.updated_at`,
    [materialId, next, cancelTo, now(tx)],
  );
  if (changes(tx) !== 1) refuse("STORAGE_FAILURE");
  const after = claimOf(tx, materialId);
  if (!after || after.reserved !== next || after.cancelled !== cancelTo) refuse("STORAGE_FAILURE");
  return { generation: next };
}

async function cancel(tx: Tx, materialId: string, generation: number): Promise<NavigationResultByKind["cancel"]> {
  if (!materialExists(tx, materialId)) refuse("NOT_FOUND");
  const claim = claimOf(tx, materialId);
  if (!claim) return refuse("INVALID_ARGUMENT");
  if (generation > claim.reserved) refuse("INVALID_ARGUMENT");
  if (generation <= claim.cancelled) return { cancelledGeneration: claim.cancelled };
  await tx.run("UPDATE material_operation_claims SET cancelled_generation = ?, updated_at = ? WHERE material_id = ?", [generation, now(tx), materialId]);
  if (changes(tx) !== 1) refuse("STORAGE_FAILURE");
  if (claimOf(tx, materialId)?.cancelled !== generation) refuse("STORAGE_FAILURE");
  return { cancelledGeneration: generation };
}

async function commit(tx: Tx, op: Extract<NavigationOperation, { kind: "commit" }>): Promise<NavigationResultByKind["commit"]> {
  const { materialId, generation } = op;
  if (!materialExists(tx, materialId)) refuse("NOT_FOUND");
  const claim = claimOf(tx, materialId);
  if (!claim) return refused(tx, materialId, "unreserved");
  if (claim.cancelled >= generation) return refused(tx, materialId, "cancelled");
  if (claim.reserved > generation) return refused(tx, materialId, "superseded");
  if (claim.reserved !== generation) return refused(tx, materialId, "unreserved");
  const identity = identityOf(tx, materialId);
  if (!identity) return refused(tx, materialId, "identity_unknown");
  if (identity.contentSha256 !== op.contentSha256) return refused(tx, materialId, "identity_changed");
  if (op.physicalPage > identity.totalPages) return refused(tx, materialId, "out_of_bounds");
  if (savedOwner(tx, materialId) >= generation) return refused(tx, materialId, "replayed");
  await tx.run(
    `INSERT INTO material_reading_state
       (material_id, last_requested_page, last_requested_page_label, confirmed_read,
        originating_content_sha256, status, owner_generation, updated_at)
     VALUES (?, ?, ?, 0, ?, 'active', ?, ?)
     ON CONFLICT(material_id) DO UPDATE SET
       last_requested_page = excluded.last_requested_page,
       last_requested_page_label = excluded.last_requested_page_label,
       confirmed_read = 0,
       originating_content_sha256 = excluded.originating_content_sha256,
       status = 'active',
       owner_generation = excluded.owner_generation,
       updated_at = excluded.updated_at`,
    [materialId, op.physicalPage, op.pageLabel, op.contentSha256, generation, now(tx)],
  );
  if (changes(tx) !== 1) refuse("STORAGE_FAILURE");
  const state = readingStateOf(tx.query, materialId);
  if (!state) return refuse("STORAGE_FAILURE");
  return { committed: true, reason: null, readingState: state };
}

async function read(tx: Tx, materialId: string): Promise<NavigationResultByKind["read"]> {
  if (!materialExists(tx, materialId)) refuse("NOT_FOUND");
  const identity = identityOf(tx, materialId);
  const bookmarks = tx
    .query(
      `SELECT ${BOOKMARK_COLUMNS} FROM material_bookmarks WHERE material_id = ?
        ORDER BY page_index ASC, created_at ASC, id ASC LIMIT ?`,
      [materialId, NAVIGATION_LIMITS.bookmarksPerMaterial],
    )
    .map(bookmarkOf);
  return {
    materialId,
    identity: identity ? { materialId, ...identity } : null,
    readingState: readingStateOf(tx.query, materialId),
    bookmarks,
  };
}

async function setRead(tx: Tx, op: Extract<NavigationOperation, { kind: "set_read" }>): Promise<NavigationResultByKind["set_read"]> {
  if (!materialExists(tx, op.materialId)) refuse("NOT_FOUND");
  const identity = identityOf(tx, op.materialId);
  if (!identity || identity.contentSha256 !== op.expectedContentSha256) return refuse("STALE_STATE");
  const state = readingStateOf(tx.query, op.materialId);
  if (
    !state ||
    state.lastRequestedPage !== op.physicalPage ||
    state.originatingContentSha256 !== op.expectedContentSha256 ||
    state.status !== "active" ||
    state.ownerGeneration !== op.expectedOwnerGeneration
  ) {
    refuse("STALE_STATE");
  }
  await tx.run(
    `UPDATE material_reading_state SET confirmed_read = ?, updated_at = ?
      WHERE material_id = ? AND owner_generation = ? AND originating_content_sha256 = ?`,
    [op.confirmed ? 1 : 0, now(tx), op.materialId, op.expectedOwnerGeneration, op.expectedContentSha256],
  );
  if (changes(tx) !== 1) refuse("STORAGE_FAILURE");
  const after = readingStateOf(tx.query, op.materialId);
  if (!after || after.confirmedRead !== op.confirmed || after.ownerGeneration !== op.expectedOwnerGeneration) return refuse("STORAGE_FAILURE");
  return after;
}

async function addBookmark(tx: Tx, op: Extract<NavigationOperation, { kind: "add_bookmark" }>): Promise<NavigationResultByKind["add_bookmark"]> {
  if (!materialExists(tx, op.materialId)) refuse("NOT_FOUND");
  const identity = identityOf(tx, op.materialId);
  if (!identity) return refuse("IDENTITY_UNKNOWN");
  if (identity.contentSha256 !== op.expectedContentSha256) refuse("STALE_STATE");
  if (op.physicalPage > identity.totalPages) refuse("PAGE_OUT_OF_RANGE");
  if (num(tx.query("SELECT COUNT(*) AS n FROM material_bookmarks WHERE id = ?", [op.bookmarkId])[0]!, "n") !== 0) refuse("INVALID_ARGUMENT");
  if (num(tx.query("SELECT COUNT(*) AS n FROM material_bookmarks WHERE material_id = ?", [op.materialId])[0]!, "n") >= NAVIGATION_LIMITS.bookmarksPerMaterial) {
    refuse("LIMIT_EXCEEDED");
  }
  const at = now(tx);
  await tx.run(
    `INSERT INTO material_bookmarks
       (id, material_id, page_index, page_label, originating_content_sha256, title, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?)`,
    [op.bookmarkId, op.materialId, op.physicalPage, op.pageLabel, identity.contentSha256, op.title, op.notes, at, at],
  );
  if (changes(tx) !== 1) refuse("STORAGE_FAILURE");
  const [row] = tx.query(`SELECT ${BOOKMARK_COLUMNS} FROM material_bookmarks WHERE id = ?`, [op.bookmarkId]);
  if (!row) return refuse("STORAGE_FAILURE");
  return bookmarkOf(row);
}

async function deleteBookmark(tx: Tx, materialId: string, bookmarkId: string): Promise<NavigationResultByKind["delete_bookmark"]> {
  if (!materialExists(tx, materialId)) refuse("NOT_FOUND");
  await tx.run("DELETE FROM material_bookmarks WHERE id = ? AND material_id = ?", [bookmarkId, materialId]);
  return { deleted: changes(tx) === 1 };
}

async function apply(tx: Tx, op: NavigationOperation): Promise<NavigationResultByKind[NavigationOperation["kind"]]> {
  switch (op.kind) {
    case "begin":
      return begin(tx, op.materialId, op.supersedeGeneration);
    case "cancel":
      return cancel(tx, op.materialId, op.generation);
    case "commit":
      return commit(tx, op);
    case "read":
      return read(tx, op.materialId);
    case "set_read":
      return setRead(tx, op);
    case "add_bookmark":
      return addBookmark(tx, op);
    case "delete_bookmark":
      return deleteBookmark(tx, op.materialId, op.bookmarkId);
  }
}

/**
 * Decode and apply one operation in one immediate transaction. Any refusal or
 * storage failure rolls the whole change back.
 */
export async function executeNavigationOperation(exec: Exec, run: Run, query: Query, input: unknown): Promise<unknown> {
  const op = decodeNavigationOperation(input);
  await guarded(() => exec("BEGIN IMMEDIATE"));
  try {
    const result = await guarded(() => apply({ run, query }, op));
    await guarded(() => exec("COMMIT"));
    return result;
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {
      // Already rolled back by the engine.
    }
    throw error;
  }
}

/** Whether an operation only reads (and so needs no durable write in browser mode). */
export const isReadOnlyNavigationOperation = (op: NavigationOperation): boolean => op.kind === "read";
