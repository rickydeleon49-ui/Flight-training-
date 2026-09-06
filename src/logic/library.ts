/**
 * Ordering the Study Library.
 *
 * Recently added first is the right default for a growing binder, but when
 * she is working a backlog she wants what matters most at the top, and when
 * she is looking for one specific handout she wants it alphabetical.
 */
import { type Priority, type StudyMaterial } from "@/domain/types";

export type MaterialSort = "recent" | "priority" | "title";

export const MATERIAL_SORT_OPTIONS: Array<{ value: MaterialSort; label: string }> = [
  { value: "recent", label: "Recently added" },
  { value: "priority", label: "Priority" },
  { value: "title", label: "Title" },
];

const PRIORITY_ORDER: Record<Priority, number> = { next_up: 0, important: 1, later: 2 };

/** A new array; the caller's list is left alone. */
export function sortMaterials(materials: StudyMaterial[], order: MaterialSort): StudyMaterial[] {
  const sorted = [...materials];

  switch (order) {
    case "title":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case "priority":
      // Within a priority, the newest is the one she is most likely to want.
      return sorted.sort(
        (a, b) =>
          PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
          b.createdAt.localeCompare(a.createdAt),
      );
    case "recent":
    default:
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
