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
  /** Local byte identity only; this does not verify a publication's edition. */
  pdfIdentity?: { contentSha256: string; totalPages: number } | null;
}

export interface MissingMaterialInfo {
  id: string;
  title: string;
  filePath: string;
  originalFileName: string | null;
}

export interface UnlinkedFileInfo {
  relativePath: string;
  fileName: string;
  fileSize: number;
}

export interface LibraryReport {
  missingMaterials: MissingMaterialInfo[];
  unlinkedFiles: UnlinkedFileInfo[];
  totalMaterials: number;
  totalFiles: number;
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
export async function pickAndImportDocument(materialId: string, pdfOnly = false): Promise<ImportedDocument | null> {
  if (!isTauri()) throw new DesktopOnlyError();

  const selected = await open({
    multiple: false,
    directory: false,
    title: "Add to your study library",
    filters: [
      {
        name: pdfOnly ? "PDF" : "Documents",
        extensions: pdfOnly ? ["pdf"] : ["pdf", "png", "jpg", "jpeg", "webp", "txt", "md", "rtf", "docx"],
      },
    ],
  });

  if (typeof selected !== "string") return null;

  return invoke<ImportedDocument>("import_document", {
    sourcePath: selected,
    materialId,
    ...(pdfOnly ? { pdfOnly: true } : {}),
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

export { formatFileSize } from "@/logic/aiLimits";

/** Compare database file references with app-owned document storage. */
export async function checkLibrary(): Promise<LibraryReport> {
  if (!isTauri()) {
    return {
      missingMaterials: [],
      unlinkedFiles: [],
      totalMaterials: 0,
      totalFiles: 0,
    };
  }
  return invoke<LibraryReport>("check_library");
}

/** Attach a stored, currently unlinked file to a material whose file is missing. */
export async function reattachUnlinkedFile(materialId: string, relativePath: string): Promise<void> {
  if (!isTauri()) throw new DesktopOnlyError();
  await invoke("reattach_unlinked_file", { materialId, relativePath });
}

/** Make an existing app-owned file visible as a new Study Library material. */
export async function importUnlinkedFile(relativePath: string): Promise<string> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke<string>("import_unlinked_file", { relativePath });
}

/** Move an app-owned unlinked file to private trash, returning an undo token. */
export async function trashUnlinkedFile(relativePath: string): Promise<StagedDeletion> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke<StagedDeletion>("trash_unlinked_file", { relativePath });
}

/** Local PDF kits never configure a provider or submit a generation request. */
export async function preparePdfStudyKit(materialId: string, pages?: number[]): Promise<string> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke("prepare_pdf_study_kit", { materialId, ...(pages ? { pages } : {}) });
}
export interface PdfStudyKitDraft {
  kind: "pdf-kit";
  version: 1;
  runId: string;
  editorOperationId: string;
  createdAt: string;
  reviewState: "review-required";
  identity: { materialId: string; contentSha256: string; selectedPages: number[]; extractorVersion: number; algorithmVersion: number; pageCount: number };
  candidates: Record<string, unknown> | null;
}
export async function getPdfStudyKit(jobId: string): Promise<PdfStudyKitDraft> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke("get_pdf_study_kit", { jobId });
}

export async function listPdfStudyKitJobs(): Promise<{ id: string; materialId: string; stage: string; createdAt: number; runId?: string }[]> {
  if (!isTauri()) return [];
  const jobs = await invoke<{ id: string; materialId: string; kind: string; stage: string; createdAt: number; draft?: { runId?: string } }[]>("gemini_jobs");
  return jobs.filter(job => job.kind === "pdf-kit").map(job => ({ ...job, runId: job.draft?.runId }));
}
