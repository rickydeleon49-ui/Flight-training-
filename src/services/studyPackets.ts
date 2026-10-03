/**
 * Choosing a structured study packet (`hfd-study-packet`) from disk.
 *
 * The Rust command opens the native dialog and reads the chosen file with a
 * hard size bound, so the webview never names a path. Nothing is copied into
 * the library and nothing is saved: the returned text goes to the validator in
 * `@/logic/studyPacket`. Not yet connected to any screen (Slice A only).
 */
import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "@/data";
import { DesktopOnlyError } from "./documents";

/** Returned by `pick_study_packet`. `sha256` covers the original bytes, BOM included; it is not the content hash. */
export interface PickedStudyPacket {
  fileName: string;
  byteLength: number;
  sha256: string;
  text: string;
  bomRemoved: boolean;
}

export type StudyPacketReadCode =
  | "file_empty"
  | "file_too_large"
  | "file_read_failed"
  | "unsupported_encoding"
  | "invalid_utf8";

const MESSAGES: Readonly<Record<StudyPacketReadCode, string>> = Object.freeze({
  file_empty: "The file is empty.",
  file_too_large: "The file is larger than the 4 MiB limit for a study packet.",
  file_read_failed: "The file could not be read.",
  unsupported_encoding: "The file is not UTF-8. Export it again as UTF-8 JSON.",
  invalid_utf8: "The file contains bytes that are not valid UTF-8.",
});

/** A fixed read failure. The message never contains file contents or a path. */
export class StudyPacketReadError extends Error {
  constructor(readonly code: StudyPacketReadCode) {
    super(MESSAGES[code]);
    this.name = "StudyPacketReadError";
  }
}

function readCode(error: unknown): StudyPacketReadCode {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(MESSAGES, code)
    ? (code as StudyPacketReadCode)
    : "file_read_failed";
}

function isPickedPacket(value: unknown): value is PickedStudyPacket {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.fileName === "string" &&
    typeof v.byteLength === "number" &&
    typeof v.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(v.sha256) &&
    typeof v.text === "string" &&
    typeof v.bomRemoved === "boolean"
  );
}

/**
 * Ask the user for one study packet. Resolves to `null` when the dialog is
 * cancelled; rejects with `StudyPacketReadError` for an unreadable, oversized
 * or non-UTF-8 file, and with `DesktopOnlyError` outside the desktop app.
 */
export async function pickStudyPacket(): Promise<PickedStudyPacket | null> {
  if (!isTauri()) throw new DesktopOnlyError();
  let result: unknown;
  try {
    result = await invoke<unknown>("pick_study_packet");
  } catch (error) {
    throw new StudyPacketReadError(readCode(error));
  }
  if (result === null) return null;
  if (!isPickedPacket(result)) throw new StudyPacketReadError("file_read_failed");
  return result;
}
