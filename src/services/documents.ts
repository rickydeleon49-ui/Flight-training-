/**
 * Importing and opening study materials.
 *
 * Files are copied into the application's private data directory by the Rust
 * side, so the library keeps working when the original file is moved and no
 * personal document ever sits near the project.
 *
 * Outside the desktop shell these operations are unavailable; the Study
 * Library still works for notes and metadata, and says plainly that adding a
 * file needs the desktop application.
 */
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

import { isTauri } from "@/data";

export interface ImportedDocument {
  relativePath: string;
  originalFileName: string;
  fileSize: number;
}

export class DesktopOnlyError extends Error {
  constructor() {
    super("Adding a file needs the desktop application.");
    this.name = "DesktopOnlyError";
  }
}

export const canHandleFiles = (): boolean => isTauri();

export function documentErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

/** Ask the user for a file and copy it into private storage. */
export async function pickAndImportDocument(materialId: string): Promise<ImportedDocument | null> {
  if (!isTauri()) throw new DesktopOnlyError();

  const selected = await open({
    multiple: false,
    directory: false,
    title: "Add to your study library",
    filters: [
      {
        name: "Documents",
        extensions: ["pdf", "png", "jpg", "jpeg", "webp", "txt", "md", "rtf", "docx"],
      },
    ],
  });

  if (typeof selected !== "string") return null;

  return invoke<ImportedDocument>("import_document", {
    sourcePath: selected,
    materialId,
  });
}

/** Whether a stored document is still on disk. Missing files are shown, not hidden. */
export async function documentExists(relativePath: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("document_exists", { relativePath });
}

/** Open a stored document in the system's default viewer. */
export async function openDocument(relativePath: string): Promise<void> {
  if (!isTauri()) throw new DesktopOnlyError();
  const absolute = await invoke<string>("document_path", { relativePath });
  await openPath(absolute);
}

/** Select a stored document in Finder or File Explorer when its default app cannot open it. */
export async function revealDocument(relativePath: string): Promise<void> {
  if (!isTauri()) throw new DesktopOnlyError();
  const absolute = await invoke<string>("document_path", { relativePath });
  await revealItemInDir(absolute);
}

/** Remove a stored document from private storage. */
export async function deleteDocument(relativePath: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("delete_document", { relativePath });
}

/** Human-readable file size, e.g. "1.4 MB". */
export function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
