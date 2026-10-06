/**
 * Typed persistence failures, so callers can tell them apart and show fixed
 * wording instead of a raw engine message.
 */
import type { NativeImportSaveErrorCode } from "./db";

/** The allowlisted message for each structured-import refusal. */
export const IMPORT_SAVE_MESSAGES: Readonly<Record<NativeImportSaveErrorCode, string>> = Object.freeze({
  INVALID_ARGUMENT: "The import operation payload is malformed or invalid.",
  INVALID_OPERATION_ID: "The operation ID is invalid or does not match the material ID.",
  INVALID_HASH_FORMAT: "The packet hash must be a 64-character lowercase hexadecimal string.",
  EMPTY_SUBSTANTIVE_CONTENT: "The material must contain at least one study aid with substantive content.",
  CONTENT_LIMIT_EXCEEDED: "One or more material fields exceed the allowed length or count limits.",
  INVALID_SOURCE_PAGE: "Source page must be null for imported packets.",
  UNSUPPORTED_PROVIDER: "The specified AI provider or model is not recognized or permitted.",
  IDEMPOTENCY_CONFLICT:
    "An existing material with this ID exists but its stored content does not match the import.",
  STORAGE_FAILURE: "Failed to durably persist the imported study material.",
  IPC_TRANSPORT_ERROR: "Desktop communication failure during structured study import.",
});

export function isImportSaveErrorCode(value: unknown): value is NativeImportSaveErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(IMPORT_SAVE_MESSAGES, value);
}

/** A structured-import refusal. Its message is always the allowlisted one. */
export class StructuredImportSaveError extends Error {
  readonly code: NativeImportSaveErrorCode;
  constructor(code: NativeImportSaveErrorCode, options?: { cause?: unknown }) {
    super(IMPORT_SAVE_MESSAGES[code], options);
    this.name = "StructuredImportSaveError";
    this.code = code;
  }
}

/** The database driver cannot save a packet atomically, so import refuses. */
export class AtomicPersistenceUnsupportedError extends Error {
  constructor() {
    super("Study packets can only be imported where the database can save them in one step.");
    this.name = "AtomicPersistenceUnsupportedError";
  }
}

/**
 * Browser development storage refused a committed change. The live database
 * was put back to what storage holds, so nothing was saved and a retry is safe.
 */
export class StorageDurabilityError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageDurabilityError";
  }
}

/** The browser database could not be returned to a safe state; reload required. */
export class DatabaseDisabledError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      "The local database connection could not be returned to a safe state. Reload the app before making more changes.",
      options,
    );
    this.name = "DatabaseDisabledError";
  }
}

/* ------------------------------------------------------------------ */
/* Practice Sessions Errors (M2 PR 1)                                  */
/* ------------------------------------------------------------------ */

export type PracticeSessionErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_STATE"
  | "NOT_FOUND"
  | "OPERATION_CONFLICT"
  | "STORAGE_ERROR"
  | "IPC_TRANSPORT_ERROR";

export const PRACTICE_SESSION_ERROR_MESSAGES: Readonly<Record<PracticeSessionErrorCode, string>> = Object.freeze({
  INVALID_ARGUMENT: "The request parameters are invalid.",
  INVALID_STATE: "The requested operation cannot be performed in the current state.",
  NOT_FOUND: "The requested resource was not found.",
  OPERATION_CONFLICT: "The operation could not be completed due to a conflict.",
  STORAGE_ERROR: "A storage error occurred while saving the practice session.",
  IPC_TRANSPORT_ERROR: "Desktop communication failure during practice session operation.",
});

export function isPracticeSessionErrorCode(value: unknown): value is PracticeSessionErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRACTICE_SESSION_ERROR_MESSAGES, value);
}

export class PracticeSessionError extends Error {
  readonly code: PracticeSessionErrorCode;
  constructor(code: PracticeSessionErrorCode, options?: { cause?: unknown }) {
    super(PRACTICE_SESSION_ERROR_MESSAGES[code], options);
    this.name = "PracticeSessionError";
    this.code = code;
  }
}
