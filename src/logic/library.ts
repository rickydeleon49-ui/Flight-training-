/**
 * Ordering the Study Library.
 *
 * Recently added first is the right default for a growing binder, but when
 * the student is working a backlog the student wants what matters most at the top, and when
 * the student is looking for one specific handout the student wants it alphabetical.
 */
import { type Priority, type StudyMaterial } from "@/domain/types";

export type MaterialSort = "recent" | "priority" | "title" | "studied";

export const MATERIAL_SORT_OPTIONS: Array<{
  value: MaterialSort;
  label: string;
}> = [
  { value: "recent", label: "Recently added" },
  { value: "priority", label: "Priority" },
  { value: "title", label: "Title" },
  { value: "studied", label: "Recently studied" },
];

/** Inside a folder she can also keep her own order. */
export type FolderSort = MaterialSort | "manual";

export const FOLDER_SORT_OPTIONS: Array<{ value: FolderSort; label: string }> =
  [{ value: "manual", label: "My order" }, ...MATERIAL_SORT_OPTIONS];

const PRIORITY_ORDER: Record<Priority, number> = {
  next_up: 0,
  important: 1,
  later: 2,
};

/** A new array; the caller's list is left alone. */
export function sortMaterials(
  materials: StudyMaterial[],
  order: MaterialSort,
  /** Ids she opened lately, newest first; used by "Recently studied". */
  opened: readonly string[] = [],
): StudyMaterial[] {
  const sorted = [...materials];

  switch (order) {
    case "title":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case "priority":
      // Within a priority, the newest is the one the student is most likely to want.
      return sorted.sort(
        (a, b) =>
          PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
          b.createdAt.localeCompare(a.createdAt),
      );
    case "studied": {
      // Lately opened first (newest first), then the rest by last review or newest added.
      const rank = new Map(opened.map((id, index) => [id, index]));
      return sorted.sort((a, b) => {
        const ra = rank.get(a.id);
        const rb = rank.get(b.id);
        if (ra !== undefined && rb !== undefined) return ra - rb;
        if (ra !== undefined) return -1;
        if (rb !== undefined) return 1;
        if (a.lastReviewedAt && b.lastReviewedAt) {
          return (
            b.lastReviewedAt.localeCompare(a.lastReviewedAt) ||
            b.createdAt.localeCompare(a.createdAt)
          );
        }
        if (a.lastReviewedAt) return -1;
        if (b.lastReviewedAt) return 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
    }
    case "recent":
    default:
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
