/**
 * Choosing a structured study packet (`hfd-study-packet`) from disk.
 *
 * The Rust command opens the native dialog and reads the chosen file with a
 * hard size bound, so the webview never names a path. Nothing is copied into
 * the library: the returned text goes to the validator in `@/logic/studyPacket`,
 * and only the validated persistence payload is saved (Slice B, through
 * `buildImportOperation` and `documents.importStudyPacket`).
 */
import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "@/data";
import type { StructuredImportSaveOperation } from "@/data/db";
import { canonicalPersistenceJson, type ImportPayload } from "@/logic/studyPacket";
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

/** Lowercase hex SHA-256 of a string's UTF-8 bytes, computed locally. */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Secure hashing is unavailable, so this study packet cannot be saved.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The save operation for a validated payload. `materialId` is minted once per
 * preview and doubles as the operation id, so "Try again" resends the same
 * identity. Fields are copied one by one: the native boundary refuses any key
 * it does not know, so nothing beyond the contract may travel.
 */
export async function buildImportOperation(
  payload: ImportPayload,
  materialId: string,
): Promise<StructuredImportSaveOperation> {
  const set = payload.studySet;
  const test = payload.practiceTest;
  return {
    operationId: materialId,
    materialId,
    contentHash: await sha256Hex(canonicalPersistenceJson(payload)),
    material: { title: payload.material.title },
    studySet: set
      ? {
          title: set.title,
          provider: "import",
          model: "",
          summary: set.summary,
          sections: set.sections.map((section) => ({ heading: section.heading, body: section.body })),
          flashcards: set.flashcards.map((card) => ({ front: card.front, back: card.back, sourcePage: null })),
          sourceNotes: set.sourceNotes,
        }
      : null,
    practiceTest: test
      ? {
          title: test.title,
          provider: "import",
          model: "",
          questions: test.questions.map((question) => ({
            question: question.question,
            options: [...question.options],
            correctIndex: question.correctIndex,
            explanation: question.explanation,
            sourcePage: null,
          })),
        }
      : null,
  };
}
