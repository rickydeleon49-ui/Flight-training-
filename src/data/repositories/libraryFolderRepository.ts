import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import {
  MAX_FOLDERS,
  appendPositions,
  positionsFor,
  validateFolderName,
  type LibraryFolder,
  type LibraryPlacement,
} from "@/logic/libraryFolders";
import type { SqlDatabase } from "../db";

const FOLDER_COLUMNS = `id, name, position, created_at AS createdAt, updated_at AS updatedAt`;

export function libraryFolderRepository(db: SqlDatabase) {
  const listFolders = (): Promise<LibraryFolder[]> =>
    db.select<LibraryFolder>(
      `SELECT ${FOLDER_COLUMNS} FROM library_folders ORDER BY position ASC, name ASC, id ASC`,
    );

  /** One upsert for many placements. Callers pass distinct ids. */
  async function upsertPlacements(
    folderId: string | null,
    rows: Array<{ materialId: string; position: number | null }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const stamp = nowIso();
    const marks = rows.map(() => "(?, ?, ?, ?)").join(", ");
    await db.execute(
      `INSERT INTO library_placements (material_id, folder_id, position, updated_at) VALUES ${marks}
       ON CONFLICT(material_id) DO UPDATE SET folder_id = excluded.folder_id,
         position = excluded.position, updated_at = excluded.updated_at`,
      rows.flatMap((r) => [r.materialId, folderId, r.position, stamp]),
    );
  }

  const distinct = (ids: string[]): string[] => [...new Set(ids)];

  return {
    listFolders,

    /**
     * Puts earlier placements back (the Undo for a move). One statement, so all rows
     * return together or not at all. A folder id that no longer exists is kept as is;
     * it reads as "Not in a folder".
     */
    async restorePlacements(
      rows: Array<{ materialId: string; folderId: string | null; position: number | null }>,
    ): Promise<void> {
      const last = new Map(rows.map((r) => [r.materialId, r]));
      if (last.size === 0) return;
      const stamp = nowIso();
      const marks = [...last.values()].map(() => "(?, ?, ?, ?)").join(", ");
      await db.execute(
        `INSERT INTO library_placements (material_id, folder_id, position, updated_at) VALUES ${marks}
         ON CONFLICT(material_id) DO UPDATE SET folder_id = excluded.folder_id,
           position = excluded.position, updated_at = excluded.updated_at`,
        [...last.values()].flatMap((r) => [r.materialId, r.folderId, r.position, stamp]),
      );
    },

    async listPlacements(): Promise<LibraryPlacement[]> {
      return db.select<LibraryPlacement>(
        `SELECT material_id AS materialId, folder_id AS folderId, position, updated_at AS updatedAt
         FROM library_placements`,
      );
    },

    async createFolder(name: string): Promise<LibraryFolder> {
      const folders = await listFolders();
      if (folders.length >= MAX_FOLDERS) {
        throw new Error(`You can have up to ${MAX_FOLDERS} folders.`);
      }
      const checked = validateFolderName(name, folders);
      if (!checked.ok) throw new Error(checked.message);
      const stamp = nowIso();
      const folder: LibraryFolder = {
        id: newId(),
        name: checked.name,
        position: folders.reduce((max, f) => Math.max(max, f.position), 0) + 1,
        createdAt: stamp,
        updatedAt: stamp,
      };
      await db.execute(
        `INSERT INTO library_folders (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [folder.id, folder.name, folder.position, stamp, stamp],
      );
      return folder;
    },

    async renameFolder(id: string, name: string): Promise<void> {
      const folders = await listFolders();
      if (!folders.some((f) => f.id === id)) throw new Error("That folder no longer exists.");
      const checked = validateFolderName(name, folders, id);
      if (!checked.ok) throw new Error(checked.message);
      await db.execute(`UPDATE library_folders SET name = ?, updated_at = ? WHERE id = ?`, [
        checked.name,
        nowIso(),
        id,
      ]);
    },

    /** Rewrites every folder position 1..n in one statement. */
    async moveFolder(id: string, direction: "up" | "down"): Promise<void> {
      const ids = (await listFolders()).map((f) => f.id);
      const i = ids.indexOf(id);
      const j = direction === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= ids.length) return;
      const next = [...ids];
      next[i] = ids[j] as string;
      next[j] = id;
      const positions = positionsFor(next);
      const cases = positions.map(() => "WHEN ? THEN ?").join(" ");
      const marks = next.map(() => "?").join(", ");
      await db.execute(
        `UPDATE library_folders SET position = CASE id ${cases} END, updated_at = ? WHERE id IN (${marks})`,
        [...positions.flatMap((p) => [p.materialId, p.position]), nowIso(), ...next],
      );
    },

    /**
     * Clears the placements, then removes the folder. Never touches study_materials.
     * One transaction: if the delete fails, the placements are restored too.
     */
    async deleteFolder(id: string): Promise<void> {
      if (!db.deleteLibraryFolderAtomically) {
        throw new Error("Atomic folder deletes require transaction support.");
      }
      await db.deleteLibraryFolderAtomically(id, nowIso());
    },

    /** Moves materials to the end of a folder (or to "Not in a folder" with null) in one statement. */
    async moveMaterials(materialIds: string[], folderId: string | null): Promise<void> {
      const ids = distinct(materialIds);
      if (ids.length === 0) return;
      if (folderId === null) {
        await upsertPlacements(null, ids.map((materialId) => ({ materialId, position: null })));
        return;
      }
      const [row] = await db.select<{ max: number | null }>(
        `SELECT MAX(position) AS max FROM library_placements WHERE folder_id = ?`,
        [folderId],
      );
      await upsertPlacements(folderId, appendPositions(row?.max ?? null, ids));
    },

    /** Writes positions 1..n for the given order; the folder is kept. */
    async setOrder(folderId: string | null, orderedMaterialIds: string[]): Promise<void> {
      await upsertPlacements(folderId, positionsFor(distinct(orderedMaterialIds)));
    },
  };
}
