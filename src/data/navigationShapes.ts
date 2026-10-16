/**
 * Strict adapters for the desktop navigation commands (M4 Slice 1), in the
 * manner of `skillEvidenceShapes.ts`: a native answer is accepted only when it
 * is exactly one allowlisted refusal with its fixed message, or a result of
 * exactly the expected shape for the request sent. Anything else becomes
 * STORAGE_FAILURE, and raw engine or transport text is never shown.
 */
import type {
  InspectedNavigationIdentity,
  NavigationBookmark,
  NavigationErrorCode,
  NavigationIdentity,
  NavigationOperation,
  NavigationReadingState,
  NavigationResultByKind,
  NavigationState,
} from "@/domain/types";

import { NAVIGATION_ERROR_MESSAGES, NavigationError } from "./navigationTransaction";

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const hasExactly = (v: Rec, keys: readonly string[]) => {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(v, k));
};
const isText = (v: unknown): v is string => typeof v === "string";
const isNullableText = (v: unknown) => v === null || typeof v === "string";
const isPositive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const isNonNegative = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isHash = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const isNullableHash = (v: unknown) => v === null || isHash(v);

export function isNavigationIdentityFor(materialId: string, v: unknown): v is NavigationIdentity {
  return (
    isRecord(v) &&
    hasExactly(v, ["materialId", "contentSha256", "totalPages", "verifiedAt"]) &&
    v.materialId === materialId &&
    isHash(v.contentSha256) &&
    isPositive(v.totalPages) &&
    isText(v.verifiedAt)
  );
}

export function isInspectedIdentityFor(materialId: string, v: unknown): v is InspectedNavigationIdentity {
  if (!isRecord(v) || typeof v.changed !== "boolean") return false;
  const { changed: _changed, ...rest } = v;
  return isNavigationIdentityFor(materialId, rest);
}

export function isReadingStateFor(materialId: string, v: unknown): v is NavigationReadingState {
  return (
    isRecord(v) &&
    hasExactly(v, [
      "materialId", "lastRequestedPage", "lastRequestedPageLabel", "confirmedRead",
      "originatingContentSha256", "status", "ownerGeneration", "updatedAt",
    ]) &&
    v.materialId === materialId &&
    isPositive(v.lastRequestedPage) &&
    isNullableText(v.lastRequestedPageLabel) &&
    typeof v.confirmedRead === "boolean" &&
    isNullableHash(v.originatingContentSha256) &&
    (v.status === "active" || v.status === "unverified" || v.status === "drifted") &&
    isNonNegative(v.ownerGeneration) &&
    isText(v.updatedAt)
  );
}

export function isBookmarkFor(materialId: string, v: unknown): v is NavigationBookmark {
  return (
    isRecord(v) &&
    hasExactly(v, [
      "id", "materialId", "physicalPage", "pageLabel", "originatingContentSha256",
      "title", "notes", "status", "createdAt", "updatedAt",
    ]) &&
    isText(v.id) &&
    v.materialId === materialId &&
    isPositive(v.physicalPage) &&
    isNullableText(v.pageLabel) &&
    isNullableHash(v.originatingContentSha256) &&
    isText(v.title) &&
    isText(v.notes) &&
    (v.status === "verified" || v.status === "unverified" || v.status === "drifted") &&
    isText(v.createdAt) &&
    isText(v.updatedAt)
  );
}

export function isNavigationStateFor(materialId: string, v: unknown): v is NavigationState {
  return (
    isRecord(v) &&
    hasExactly(v, ["materialId", "identity", "readingState", "bookmarks"]) &&
    v.materialId === materialId &&
    (v.identity === null || isNavigationIdentityFor(materialId, v.identity)) &&
    (v.readingState === null || isReadingStateFor(materialId, v.readingState)) &&
    Array.isArray(v.bookmarks) &&
    v.bookmarks.length <= 500 &&
    v.bookmarks.every((b) => isBookmarkFor(materialId, b))
  );
}

const REFUSALS = new Set(["unreserved", "superseded", "cancelled", "replayed", "identity_unknown", "identity_changed", "out_of_bounds"]);

type Op<K extends NavigationOperation["kind"]> = Extract<NavigationOperation, { kind: K }>;

/**
 * A successful acknowledgement must be bound to the request that was sent
 * (M4S1-R2): a commit saved exactly the requested page, label and content for
 * exactly this generation, active and not yet confirmed as read; a read
 * confirmation changed only the confirmation of exactly the saved request it
 * named; a bookmark holds exactly what was asked, on the named content.
 * Refusals are not bound this way: they may carry newer current state.
 */
export function isCommittedStateFor(op: Op<"commit">, v: unknown): v is NavigationReadingState {
  return (
    isReadingStateFor(op.materialId, v) &&
    v.lastRequestedPage === op.physicalPage &&
    v.lastRequestedPageLabel === op.pageLabel &&
    v.originatingContentSha256 === op.contentSha256 &&
    v.ownerGeneration === op.generation &&
    v.status === "active" &&
    v.confirmedRead === false
  );
}

export function isSetReadStateFor(op: Op<"set_read">, v: unknown): v is NavigationReadingState {
  return (
    isReadingStateFor(op.materialId, v) &&
    v.lastRequestedPage === op.physicalPage &&
    v.originatingContentSha256 === op.expectedContentSha256 &&
    v.ownerGeneration === op.expectedOwnerGeneration &&
    v.status === "active" &&
    v.confirmedRead === op.confirmed
  );
}

export function isAddedBookmarkFor(op: Op<"add_bookmark">, v: unknown): v is NavigationBookmark {
  return (
    isBookmarkFor(op.materialId, v) &&
    v.id === op.bookmarkId &&
    v.physicalPage === op.physicalPage &&
    v.pageLabel === op.pageLabel &&
    v.originatingContentSha256 === op.expectedContentSha256 &&
    v.title === op.title &&
    v.notes === op.notes &&
    v.status === "verified"
  );
}

/** Whether `v` is exactly the result `op` must produce. */
export function isNavigationResultFor<K extends NavigationOperation["kind"]>(
  op: Op<K>,
  v: unknown,
): v is NavigationResultByKind[K] {
  const m = op.materialId;
  const any = op as NavigationOperation;
  switch (any.kind) {
    case "begin":
      return isRecord(v) && hasExactly(v, ["generation"]) && isPositive(v.generation);
    case "cancel":
      return isRecord(v) && hasExactly(v, ["cancelledGeneration"]) && isPositive(v.cancelledGeneration) && v.cancelledGeneration >= any.generation;
    case "commit":
      if (!isRecord(v) || !hasExactly(v, ["committed", "reason", "readingState"])) return false;
      if (v.committed === true) return v.reason === null && isCommittedStateFor(any, v.readingState);
      return v.committed === false && REFUSALS.has(v.reason as string) && (v.readingState === null || isReadingStateFor(m, v.readingState));
    case "read":
      return isNavigationStateFor(m, v);
    case "set_read":
      return isSetReadStateFor(any, v);
    case "add_bookmark":
      return isAddedBookmarkFor(any, v);
    case "delete_bookmark":
      return isRecord(v) && hasExactly(v, ["deleted"]) && typeof v.deleted === "boolean";
    default:
      return false;
  }
}

const CODES = Object.keys(NAVIGATION_ERROR_MESSAGES) as NavigationErrorCode[];

/** Turn a native rejection into its refusal, or STORAGE_FAILURE for anything else. */
export function nativeNavigationRefusal(rejection: unknown): NavigationError {
  const { code, message } = (rejection ?? {}) as { code?: unknown; message?: unknown };
  if (typeof code === "string" && (CODES as string[]).includes(code) && code !== "DESKTOP_ONLY") {
    const known = code as NavigationErrorCode;
    if (message === NAVIGATION_ERROR_MESSAGES[known]) return new NavigationError(known, NAVIGATION_ERROR_MESSAGES[known]);
  }
  return Object.assign(new NavigationError("STORAGE_FAILURE", NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE), { cause: rejection });
}

type Call = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

async function callChecked<T>(call: Call, command: string, args: Record<string, unknown>, isShape: (value: unknown) => value is T): Promise<T> {
  let value: unknown;
  try {
    value = await call(command, args);
  } catch (rejection) {
    throw nativeNavigationRefusal(rejection);
  }
  if (!isShape(value)) {
    throw new NavigationError("STORAGE_FAILURE", NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE);
  }
  return value;
}

export function invokeNavigationOperation<K extends NavigationOperation["kind"]>(
  op: Extract<NavigationOperation, { kind: K }>,
  call: Call,
): Promise<NavigationResultByKind[K]> {
  return callChecked(call, "navigation_operation", { operation: op }, (v): v is NavigationResultByKind[K] => isNavigationResultFor(op, v));
}

/** The verified handover to the default reader (`open_navigation_document`). */
export interface OpenedNavigationDocument {
  materialId: string;
  contentSha256: string;
}

export function invokeOpenNavigationDocument(materialId: string, expectedContentSha256: string, call: Call): Promise<OpenedNavigationDocument> {
  return callChecked(
    call,
    "open_navigation_document",
    { input: { materialId, expectedContentSha256 } },
    (v): v is OpenedNavigationDocument =>
      isRecord(v) && hasExactly(v, ["materialId", "contentSha256"]) && v.materialId === materialId && v.contentSha256 === expectedContentSha256,
  );
}

export function invokeInspectNavigationIdentity(materialId: string, call: Call): Promise<InspectedNavigationIdentity> {
  return callChecked(call, "inspect_navigation_identity", { input: { materialId } }, (v): v is InspectedNavigationIdentity =>
    isInspectedIdentityFor(materialId, v),
  );
}
