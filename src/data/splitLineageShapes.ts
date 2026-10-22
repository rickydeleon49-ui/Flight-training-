/**
 * Shape checks for what the desktop split commands hand back (M2 split
 * lineage). A result that does not match is refused rather than trusted:
 * a receipt in particular is passed back to the native save unchanged, so it
 * must be exactly what the splitter produced.
 */
import type {
  SavedSplitPart,
  SplitBatchCancelResult,
  SplitBatchReconciliation,
  SplitBatchSaveResult,
  SplitParentSnapshot,
  SplitPlanPart,
  SplitReceiptCore,
  SplitSourceReceipt,
  StoredDocumentFingerprint,
} from "@/domain/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isPage = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const orNull = <T>(check: (value: unknown) => value is T) => (value: unknown): value is T | null =>
  value === null || check(value);

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => key in value);
}

const PLAN_KEYS = [
  "id", "selection", "childPageCount", "canonicalRootStart", "canonicalRootEnd",
  "filePath", "fileSize", "originalFileName",
] as const;

export function isSplitPlanPart(value: unknown): value is SplitPlanPart {
  return (
    isRecord(value) &&
    hasExactly(value, PLAN_KEYS) &&
    isText(value.id) &&
    isRecord(value.selection) &&
    hasExactly(value.selection, ["start", "end"]) &&
    isPage(value.selection.start) &&
    isPage(value.selection.end) &&
    isPage(value.childPageCount) &&
    isPage(value.canonicalRootStart) &&
    isPage(value.canonicalRootEnd) &&
    isText(value.filePath) &&
    isCount(value.fileSize) &&
    isText(value.originalFileName)
  );
}

const SNAPSHOT_KEYS = [
  "rootMaterialId", "rootTitle", "rootFileName", "rootContentSha256", "rootTotalPages",
  "parentRootPageStart", "parentRootPageEnd", "parentTotalPages", "parentNestedLevel",
  "parentTitle", "parentFileName",
] as const;

export function isSplitParentSnapshot(value: unknown): value is SplitParentSnapshot {
  return (
    isRecord(value) &&
    hasExactly(value, SNAPSHOT_KEYS) &&
    orNull(isText)(value.rootMaterialId) &&
    isText(value.rootTitle) &&
    isText(value.rootFileName) &&
    orNull(isSha256)(value.rootContentSha256) &&
    orNull(isPage)(value.rootTotalPages) &&
    isPage(value.parentRootPageStart) &&
    isPage(value.parentRootPageEnd) &&
    isPage(value.parentTotalPages) &&
    isPage(value.parentNestedLevel) &&
    isText(value.parentTitle) &&
    isText(value.parentFileName)
  );
}

const CORE_KEYS = [
  "sourceMaterialId", "sourceFilePath", "sourceFileSize", "sourceContentSha256",
  "sourceTotalPages", "isNested", "rootMaterialId", "rootTitle", "rootFileName",
  "rootContentSha256", "rootTotalPages", "parentSnapshot", "nestedLevel", "plan",
] as const;

function isSplitReceiptCore(value: unknown): value is SplitReceiptCore {
  return (
    isRecord(value) &&
    hasExactly(value, "skippedPages" in value ? [...CORE_KEYS, "skippedPages"] : CORE_KEYS) &&
    isText(value.sourceMaterialId) &&
    isText(value.sourceFilePath) &&
    isCount(value.sourceFileSize) &&
    isSha256(value.sourceContentSha256) &&
    isPage(value.sourceTotalPages) &&
    typeof value.isNested === "boolean" &&
    orNull(isText)(value.rootMaterialId) &&
    isText(value.rootTitle) &&
    isText(value.rootFileName) &&
    orNull(isSha256)(value.rootContentSha256) &&
    orNull(isPage)(value.rootTotalPages) &&
    (value.isNested ? isSplitParentSnapshot(value.parentSnapshot) : value.parentSnapshot === null) &&
    isPage(value.nestedLevel) &&
    Array.isArray(value.plan) &&
    value.plan.length > 0 &&
    value.plan.every(isSplitPlanPart) &&
    (!("skippedPages" in value) || (
      Array.isArray(value.skippedPages) &&
      value.skippedPages.every((page, index, pages) =>
        isPage(page) && page <= (value.sourceTotalPages as number) &&
        (index === 0 || pages[index - 1] < page) &&
        !(value.plan as SplitPlanPart[]).some((part) => page >= part.selection.start && page <= part.selection.end),
      )
    ))
  );
}

export function isSplitSourceReceipt(value: unknown): value is SplitSourceReceipt {
  return (
    isRecord(value) &&
    hasExactly(value, ["core", "receiptHash", "operationId"]) &&
    isSplitReceiptCore(value.core) &&
    isSha256(value.receiptHash) &&
    value.operationId === value.receiptHash
  );
}

function isSavedSplitPart(value: unknown): value is SavedSplitPart {
  return (
    isRecord(value) &&
    isText(value.id) &&
    isText(value.title) &&
    orNull(isText)(value.filePath) &&
    orNull(isCount)(value.fileSize)
  );
}

export function isSplitBatchSaveResult(value: unknown): value is SplitBatchSaveResult {
  return (
    isRecord(value) &&
    isText(value.operationId) &&
    Array.isArray(value.parts) &&
    value.parts.every(isSavedSplitPart) &&
    typeof value.idempotentReplay === "boolean"
  );
}

const STATUSES = new Set(["pending", "committed", "cancelled", "unknown"]);

export function isSplitBatchReconciliation(value: unknown): value is SplitBatchReconciliation {
  return (
    isRecord(value) &&
    isText(value.operationId) &&
    isText(value.status) &&
    STATUSES.has(value.status) &&
    Array.isArray(value.parts) &&
    value.parts.every(isSavedSplitPart) &&
    typeof value.reconciled === "boolean"
  );
}

export function isSplitBatchCancelResult(value: unknown): value is SplitBatchCancelResult {
  return (
    isRecord(value) &&
    isText(value.operationId) &&
    isText(value.status) &&
    STATUSES.has(value.status) &&
    typeof value.cancelled === "boolean" &&
    Array.isArray(value.removedFiles) &&
    value.removedFiles.every(isText)
  );
}

export function isFingerprintList(
  value: unknown,
  requested: readonly string[],
): value is StoredDocumentFingerprint[] {
  return (
    Array.isArray(value) &&
    value.length === requested.length &&
    value.every(
      (item, index) =>
        isRecord(item) &&
        item.relativePath === requested[index] &&
        orNull(isSha256)(item.sha256),
    )
  );
}

/** A desktop split command returned something other than what it promises. */
export class SplitResultShapeError extends Error {
  constructor(command: string) {
    super(`The ${command} result could not be trusted, so nothing was changed.`);
    this.name = "SplitResultShapeError";
  }
}
