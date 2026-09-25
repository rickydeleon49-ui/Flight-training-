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

export interface StagedDeletion {
  stagedId: string;
  originalRelativePath: string;
  alreadyMissing: boolean;
}

/** Stage a stored document for deletion into private trash. */
export async function stageDeleteDocument(
  relativePath: string,
): Promise<StagedDeletion | null> {
  if (!isTauri()) return null;
  return invoke<StagedDeletion>("stage_delete_document", { relativePath });
}

/** Roll back a staged deletion by moving the file back from private trash. */
export async function rollbackDeleteDocument(stagedId: string): Promise<void> {
  if (!isTauri() || !stagedId) return;
  await invoke("rollback_delete_document", { stagedId });
}

/** Commit and permanently purge a staged deletion from private trash. */
export async function commitDeleteDocument(stagedId: string): Promise<void> {
  if (!isTauri() || !stagedId) return;
  await invoke("commit_delete_document", { stagedId });
}

/** Remove a stored document from private storage. */
export async function deleteDocument(relativePath: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("delete_document", { relativePath });
}

export interface DocumentRepositories {
  documents: {
    remove: (id: string) => Promise<void>;
  };
}

export interface MaterialToDelete {
  id: string;
  filePath?: string | null;
}

/**
 * Perform recoverable deletion of a study material:
 * 1. Move managed file to private trash (.trash) first.
 *    If staging fails (e.g., file locked/open), DB and file remain untouched.
 * 2. Delete DB record only after staging succeeds.
 * 3. Roll back staged file if DB delete fails, rethrowing the DB error.
 * 4. Commit/purge staged file after DB delete succeeds.
 *
 * Product decision: If the file is locked (e.g. open in a PDF viewer on Windows),
 * staging fails safely, keeping both the record and file intact with an actionable
 * message to close the file. The old record-first order could leave a record and
 * file out of step; having the material reappear after the undo window if the file
 * is locked is an accepted trade-off for safety.
 *
 * If filePath is absent, delete the DB record without file calls.
 * If the file was already missing (alreadyMissing: true), delete the DB record without commit.
 */
export async function removeMaterialWithFile(
  repos: DocumentRepositories,
  material: MaterialToDelete,
): Promise<void> {
  let staged: StagedDeletion | null = null;
  if (material.filePath) {
    staged = await stageDeleteDocument(material.filePath);
  }
  try {
    await repos.documents.remove(material.id);
  } catch (dbError) {
    if (staged?.stagedId) {
      await rollbackDeleteDocument(staged.stagedId);
    }
    throw dbError;
  }
  if (staged?.stagedId && !staged.alreadyMissing) {
    await commitDeleteDocument(staged.stagedId);
  }
}

/** Delete every generated file and return the paths that could not be removed. */
export async function cleanupDocuments(
  relativePaths: string[],
  remove: (relativePath: string) => Promise<void> = deleteDocument,
): Promise<string[]> {
  const results = await Promise.allSettled(relativePaths.map((path) => remove(path)));
  return relativePaths.filter((_, index) => results[index]?.status === "rejected");
}

/** Human-readable file size, e.g. "1.4 MB". */
export function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
