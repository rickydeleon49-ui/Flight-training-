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
