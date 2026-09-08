/**
 * Splitting a study PDF into the part she is studying.
 *
 * Google reads a PDF up to 50 MB or 1,000 pages, whichever comes first, and a
 * handbook is past both — see logic/aiLimits. The work happens in Rust on her
 * own machine; nothing here leaves the computer.
 */
import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "@/data";
import { DesktopOnlyError, type ImportedDocument } from "./documents";

export interface PdfOutline {
  pages: number;
  /** The most pages one split may take, so the form can say so. */
  maxPagesPerSplit: number;
}

export interface PdfPart extends ImportedDocument {
  firstPage: number;
  lastPage: number;
}

export const canSplitPdfs = (): boolean => isTauri();

/** How many pages a stored PDF has. */
export async function inspectPdf(relativePath: string): Promise<PdfOutline> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke<PdfOutline>("inspect_pdf", { relativePath });
}

/**
 * Save pages `firstPage`–`lastPage` as a new document in private storage.
 *
 * `materialId` is the id the new study material will be created with, so the
 * stored file cannot collide with anything already in the library.
 */
export async function splitPdf(request: {
  relativePath: string;
  materialId: string;
  firstPage: number;
  lastPage: number;
  fileName: string;
}): Promise<ImportedDocument> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke<ImportedDocument>("split_pdf", request);
}

/** Create consecutive, study-sized parts while preserving the source PDF. */
export async function splitPdfAutomatically(request: {
  relativePath: string;
  batchId: string;
  fileName: string;
}): Promise<PdfPart[]> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke<PdfPart[]>("split_pdf_automatically", request);
}
