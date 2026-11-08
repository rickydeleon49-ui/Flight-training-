/**
 * Which materials a shared study pack must carry. A split book travels with
 * every chapter, and a chapter never travels without its book: the importer
 * groups chapters under the root book (chapterGroups.ts).
 */
import type { StudyMaterial } from "@/domain/types";
import { groupChapterParts } from "@/logic/chapterGroups";

export interface PackRow {
  material: StudyMaterial;
  /** Chapters shown under a book; empty for anything else. */
  chapters: StudyMaterial[];
}

/** One row per top-level material, with a book's chapters under it. */
export function packRows(materials: readonly StudyMaterial[]): PackRow[] {
  const { topLevel, partsOf } = groupChapterParts(materials);
  return topLevel.map((material) => ({ material, chapters: partsOf.get(material.id) ?? [] }));
}

/** The ids to export for the chosen row ids: each book plus all its chapters. */
export function packMaterialIds(materials: readonly StudyMaterial[], chosen: ReadonlySet<string>): string[] {
  const { topLevel, partsOf } = groupChapterParts(materials);
  const ids: string[] = [];
  const add = (id: string) => { if (!ids.includes(id)) ids.push(id); };
  for (const material of topLevel) {
    if (!chosen.has(material.id)) continue;
    add(material.id);
    for (const part of partsOf.get(material.id) ?? []) add(part.id);
  }
  return ids;
}

/** Mirrors MAX_PDF_BYTES in src-tauri/src/pdf.rs (a Rust test keeps them equal). */
export const MAX_SHARED_FILE_BYTES = 50 * 1024 * 1024;

/** A material whose file is over the sharing limit cannot go into a pack. */
export function packFileTooLarge(material: Pick<StudyMaterial, "filePath" | "fileSize">): boolean {
  return Boolean(material.filePath?.trim()) && (material.fileSize ?? 0) > MAX_SHARED_FILE_BYTES;
}

/** The short note shown beside a material that is too large to share. */
export function packTooLargeNote(hasChapters: boolean): string {
  return hasChapters ? "The full book is too large to share. Its chapters are shared." : "Too large to share (over 50 MB).";
}

/** A row that cannot be chosen: its file is too big and it has no chapters to carry the content. */
export function packRowBlocked(row: PackRow): boolean {
  return packFileTooLarge(row.material) && row.chapters.length === 0;
}

/**
 * Whether a material can go into a shared pack. Mirrors the native export: a
 * material with a file always can; a note needs a guide, at least one practice question or
 * saved video links.
 */
export function isPackExportable(material: StudyMaterial, hasGuide: boolean, practiceQuestionCount: number, hasVideos = false): boolean {
  if (packFileTooLarge(material)) return false;
  return Boolean(material.filePath?.trim()) || hasGuide || practiceQuestionCount > 0 || hasVideos;
}
