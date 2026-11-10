/**
 * Her own folders in the Study Library: pure logic, no database.
 *
 * Sections are always built from the materials list, never from placements,
 * so every top-level material shows up exactly once. A missing placement, a
 * null folder or an unknown folder all mean "Not in a folder". Sync can hand
 * us duplicate names, duplicate positions and dangling placements, so nothing
 * here throws on them. The limits apply only when she creates or renames.
 */
import {
  MATERIAL_TYPE_OPTIONS,
  TOPIC_OPTIONS,
  type StudyMaterial,
} from "@/domain/types";
import { sortMaterials, type FolderSort } from "./library";

export interface LibraryFolder {
  id: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryPlacement {
  materialId: string;
  folderId: string | null;
  position: number | null;
  updatedAt: string;
}

export const NOT_IN_A_FOLDER = "Not in a folder";
export const MAX_FOLDERS = 50;
export const MAX_FOLDER_NAME = 40;

export type FolderNameResult =
  { ok: true; name: string } | { ok: false; message: string };

/** One validator for create and rename. Length counts characters, as SQLite does. */
export function validateFolderName(
  name: string,
  existing: LibraryFolder[],
  ignoreId?: string,
): FolderNameResult {
  const trimmed = name.trim();
  if (trimmed.length === 0)
    return { ok: false, message: "Give the folder a name." };
  if ([...trimmed].length > MAX_FOLDER_NAME) {
    return { ok: false, message: "Use 40 characters or fewer." };
  }
  const lower = trimmed.toLowerCase();
  if (lower === NOT_IN_A_FOLDER.toLowerCase()) {
    return { ok: false, message: "That name is used by the app." };
  }
  const clash = existing.some(
    (f) => f.id !== ignoreId && f.name.trim().toLowerCase() === lower,
  );
  if (clash)
    return {
      ok: false,
      message: `You already have a folder called ${trimmed}.`,
    };
  return { ok: true, name: trimmed };
}

export type LibrarySection = {
  key: string;
  title: string;
  folderId: string | null;
  items: StudyMaterial[];
};

/** Nulls last, then ascending, so a missing position never jumps the queue. */
function byPosition(
  aPos: number | null,
  bPos: number | null,
  aTitle: string,
  bTitle: string,
  aId: string,
  bId: string,
): number {
  if (aPos !== null && bPos !== null && aPos !== bPos) return aPos - bPos;
  if (aPos !== null && bPos === null) return -1;
  if (aPos === null && bPos !== null) return 1;
  return aTitle.localeCompare(bTitle) || (aId < bId ? -1 : aId > bId ? 1 : 0);
}

export function sectionsByFolder(
  topLevel: StudyMaterial[],
  folders: LibraryFolder[],
  placements: LibraryPlacement[],
  sort: FolderSort,
  opened: readonly string[] = [],
): LibrarySection[] {
  const folderIds = new Set(folders.map((f) => f.id));
  const placementOf = new Map<string, LibraryPlacement>();
  for (const p of placements) placementOf.set(p.materialId, p);

  const buckets = new Map<string | null, StudyMaterial[]>();
  for (const m of topLevel) {
    const p = placementOf.get(m.id);
    const folderId =
      p && p.folderId !== null && folderIds.has(p.folderId) ? p.folderId : null;
    const list = buckets.get(folderId);
    if (list) list.push(m);
    else buckets.set(folderId, [m]);
  }

  const arrange = (items: StudyMaterial[]): StudyMaterial[] => {
    if (sort !== "manual") return sortMaterials(items, sort, opened);
    const positioned: StudyMaterial[] = [];
    const rest: StudyMaterial[] = [];
    for (const m of items) {
      (placementOf.get(m.id)?.position == null ? rest : positioned).push(m);
    }
    positioned.sort((a, b) =>
      byPosition(
        placementOf.get(a.id)?.position ?? null,
        placementOf.get(b.id)?.position ?? null,
        a.title,
        b.title,
        a.id,
        b.id,
      ),
    );
    return [...positioned, ...sortMaterials(rest, "recent")];
  };

  const orderedFolders = [...folders].sort((a, b) =>
    byPosition(a.position, b.position, a.name, b.name, a.id, b.id),
  );
  const sections: LibrarySection[] = orderedFolders.map((f) => ({
    key: `folder:${f.id}`,
    title: f.name,
    folderId: f.id,
    items: arrange(buckets.get(f.id) ?? []),
  }));
  sections.push({
    key: "none",
    title: NOT_IN_A_FOLDER,
    folderId: null,
    items: arrange(buckets.get(null) ?? []),
  });
  return sections;
}

function sectionsByLabel<T extends string>(
  topLevel: StudyMaterial[],
  sort: FolderSort,
  opened: readonly string[],
  opts: ReadonlyArray<{ value: T; label: string }>,
  pick: (m: StudyMaterial) => T,
): LibrarySection[] {
  const effective = sort === "manual" ? "recent" : sort;
  const out: LibrarySection[] = [];
  for (const o of opts) {
    const items = topLevel.filter((m) => pick(m) === o.value);
    if (items.length === 0) continue;
    out.push({
      key: `${o.value}`,
      title: o.label,
      folderId: null,
      items: sortMaterials(items, effective, opened),
    });
  }
  return out;
}

export function sectionsByTopic(
  topLevel: StudyMaterial[],
  sort: FolderSort,
  opened: readonly string[] = [],
): LibrarySection[] {
  return sectionsByLabel(topLevel, sort, opened, TOPIC_OPTIONS, (m) => m.topic);
}

export function sectionsByType(
  topLevel: StudyMaterial[],
  sort: FolderSort,
  opened: readonly string[] = [],
): LibrarySection[] {
  return sectionsByLabel(
    topLevel,
    sort,
    opened,
    MATERIAL_TYPE_OPTIONS,
    (m) => m.materialType,
  );
}

export function moveWithin(
  orderedIds: string[],
  id: string,
  direction: "up" | "down",
): string[] {
  const i = orderedIds.indexOf(id);
  if (i < 0) return orderedIds;
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= orderedIds.length) return orderedIds;
  const next = [...orderedIds];
  next[i] = orderedIds[j] as string;
  next[j] = id;
  return next;
}

/** Put `id` just before `beforeId`, or at the end when `beforeId` is null or unknown. */
export function placeBefore(
  orderedIds: string[],
  id: string,
  beforeId: string | null,
): string[] {
  if (!orderedIds.includes(id)) return orderedIds;
  const rest = orderedIds.filter((x) => x !== id);
  const at = beforeId === null || beforeId === id ? -1 : rest.indexOf(beforeId);
  if (at < 0) return [...rest, id];
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export function positionsFor(
  orderedIds: string[],
): Array<{ materialId: string; position: number }> {
  return orderedIds.map((materialId, i) => ({ materialId, position: i + 1 }));
}

export function appendPositions(
  existingMaxPosition: number | null,
  ids: string[],
): Array<{ materialId: string; position: number }> {
  const start = (existingMaxPosition ?? 0) + 1;
  return ids.map((materialId, i) => ({ materialId, position: start + i }));
}
