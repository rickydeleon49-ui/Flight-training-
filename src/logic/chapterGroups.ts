import type { StudyMaterial } from "@/domain/types";

/**
 * Parts split out of a book (see `lineage.rootMaterialId`) show under that
 * book in the Library, not as many separate rows. Only parts whose book is
 * also in `list` are tucked away, so a part is never hidden without its book.
 */
export interface ChapterGroups {
  /** The list without the grouped parts. */
  topLevel: StudyMaterial[];
  /** The grouped parts of each book, by the book's id, in list order. */
  partsOf: Map<string, StudyMaterial[]>;
}

export function groupChapterParts(list: readonly StudyMaterial[]): ChapterGroups {
  const present = new Set(list.map((material) => material.id));
  const partsOf = new Map<string, StudyMaterial[]>();
  const topLevel: StudyMaterial[] = [];
  for (const material of list) {
    const root = material.lineage?.rootMaterialId;
    if (root && root !== material.id && present.has(root)) {
      const parts = partsOf.get(root) ?? [];
      parts.push(material);
      partsOf.set(root, parts);
    } else {
      topLevel.push(material);
    }
  }
  return { topLevel, partsOf };
}

/** "23 chapters", "1 chapter". */
export function chapterCountLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "chapter" : "chapters"}`;
}
