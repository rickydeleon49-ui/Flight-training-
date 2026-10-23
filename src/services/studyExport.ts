/**
 * Saving an exported study packet or printable handout (P54-04), or a
 * printable lesson brief (P54-05).
 *
 * The Rust command opens the native save dialog and writes the file all at
 * once, so the webview never names a path. Cancelling the dialog resolves to
 * `null`; nothing is written.
 */
import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "@/data";
import { DesktopOnlyError } from "./documents";

export type StudyExportKind = "packet" | "handout" | "markdown" | "brief" | "calendar" | "csv";

export interface SavedStudyExport {
  fileName: string;
  byteLength: number;
}

export type StudyExportCode = "too_large" | "not_regular_file" | "write_failed";

const MESSAGES: Readonly<Record<StudyExportCode, string>> = Object.freeze({
  too_large: "This export is too large to save. Choose fewer parts.",
  not_regular_file: "That name belongs to a folder or something other than a file. Choose another name.",
  write_failed: "The file could not be saved there. Nothing was changed. Try another folder.",
});

/** A fixed save failure. The message never contains a path. */
export class StudyExportError extends Error {
  constructor(readonly code: StudyExportCode) {
    super(MESSAGES[code]);
    this.name = "StudyExportError";
  }
}

function exportCode(error: unknown): StudyExportCode {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(MESSAGES, code) ? (code as StudyExportCode) : "write_failed";
}

function isSaved(value: unknown): value is SavedStudyExport {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.fileName === "string" && typeof v.byteLength === "number";
}

/**
 * Ask where to save `contents` and write it. Resolves to `null` when the
 * dialog is cancelled; rejects with `StudyExportError` when the save fails and
 * with `DesktopOnlyError` outside the desktop app.
 */
export async function saveStudyExport(kind: StudyExportKind, suggestedName: string, contents: string): Promise<SavedStudyExport | null> {
  if (!isTauri()) throw new DesktopOnlyError();
  let result: unknown;
  try {
    result = await invoke<unknown>("save_study_export", { kind, suggestedName, contents });
  } catch (error) {
    throw new StudyExportError(exportCode(error));
  }
  if (result === null) return null;
  if (!isSaved(result)) throw new StudyExportError("write_failed");
  return result;
}
