/**
 * Splitting a study PDF into the part the student is studying.
 *
 * Google reads a PDF up to 50 MB or 1,000 pages, whichever comes first, and a
 * handbook is past both — see logic/aiLimits. The work happens in Rust on the student's
 * own machine; nothing here leaves the computer.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { isTauri } from "@/data";
import { isSplitSourceReceipt, SplitResultShapeError } from "@/data/splitLineageShapes";
import type { SplitSourceReceipt } from "@/domain/types";

import { DesktopOnlyError } from "./documents";

export interface PdfOutline {
  pages: number;
  /** The most pages one split may take, so the form can say so. */
  maxPagesPerSplit: number;
  /** Most pages are pictures with almost no text (a scan). Absent in old data. */
  mostlyPictures?: boolean;
  /** Chapters covering every page, in order; the first may be "Front pages". */
  chapters?: PdfChapter[];
  /** How the chapters were found: the PDF's outline, its page text, or even chunks. */
  chapterSource?: "outline" | "text" | "chunks";
}

export interface PdfChapter {
  title: string;
  firstPage: number;
  lastPage: number;
}

/** A page range to save as its own part. */
export interface PdfRangeRequest {
  firstPage: number;
  lastPage: number;
  title: string;
}

export const canSplitPdfs = (): boolean => isTauri();

/** How many pages a stored PDF has. */
export async function inspectPdf(relativePath: string): Promise<PdfOutline> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke<PdfOutline>("inspect_pdf", { relativePath });
}

/**
 * Save pages `firstPage`–`lastPage` of `sourceMaterialId`'s PDF as a new
 * document in private storage.
 *
 * `materialId` is the id the new study material will be created with, so the
 * stored file cannot collide with anything already in the library. Nothing is
 * in the library yet: the returned receipt records exactly what was split and
 * is handed back unchanged to `documents.saveSplitBatch` (or cancelled).
 */
export async function splitPdf(
  request: {
    relativePath: string;
    materialId: string;
    firstPage: number;
    lastPage: number;
    fileName: string;
    sourceMaterialId: string;
  },
  call: (command: string, args: Record<string, unknown>) => Promise<unknown> = invoke,
): Promise<SplitSourceReceipt> {
  if (!isTauri()) throw new DesktopOnlyError();
  const receipt = await call("split_pdf", request);
  if (!isSplitSourceReceipt(receipt)) throw new SplitResultShapeError("split_pdf");
  return receipt;
}

/** Create study-sized parts while preserving the source PDF.
 * Pages too large alone are returned in core.skippedPages and recorded in the receipt.
 */
export async function splitPdfAutomatically(
  request: {
    relativePath: string;
    batchId: string;
    fileName: string;
    sourceMaterialId: string;
  },
  call: (command: string, args: Record<string, unknown>) => Promise<unknown> = invoke,
): Promise<SplitSourceReceipt> {
  if (!isTauri()) throw new DesktopOnlyError();
  const receipt = await call("split_pdf_automatically", request);
  if (!isSplitSourceReceipt(receipt)) throw new SplitResultShapeError("split_pdf_automatically");
  return receipt;
}

/**
 * Save several page ranges (chapters) as parts under ONE receipt: all or
 * nothing. Ranges too long or too large to study are split further natively;
 * a single page too large to send is refused by name. The original is kept.
 */
export async function splitPdfRanges(
  request: {
    relativePath: string;
    batchId: string;
    fileName: string;
    ranges: PdfRangeRequest[];
    sourceMaterialId: string;
  },
  call: (command: string, args: Record<string, unknown>) => Promise<unknown> = invoke,
): Promise<SplitSourceReceipt> {
  if (!isTauri()) throw new DesktopOnlyError();
  const receipt = await call("split_pdf_ranges", request);
  if (!isSplitSourceReceipt(receipt)) throw new SplitResultShapeError("split_pdf_ranges");
  return receipt;
}

/**
 * Follow along while an automatic split reads and writes each part.
 *
 * A large or illustrated handbook can take real time per part; a spinner
 * that says nothing that whole time reads as a hang. The Rust side sends the
 * sentence; this only carries it. Returns a function that stops listening.
 */
export async function watchSplitProgress(
  onMessage: (message: string) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<{ message: string }>("pdf-split-progress", (event) => {
    onMessage(event.payload.message);
  });
}
