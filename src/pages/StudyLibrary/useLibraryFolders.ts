import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LibraryFolder, LibraryPlacement } from "@/logic/libraryFolders";
import { useAppData } from "@/state/AppDataContext";

/**
 * Her folders and where each material sits. Reloads when the app data
 * changes (a move, a sync). A folder id that no longer exists counts as
 * "Not in a folder", so folderOf never hands back a deleted folder.
 */
export function useLibraryFolders() {
  const { dataRevision, repositories } = useAppData();
  // Held in a ref so a new repositories object alone never triggers a reload.
  const repoRef = useRef(repositories?.libraryFolders);
  repoRef.current = repositories?.libraryFolders;
  const hasRepo = !!repositories;
  const [state, setState] = useState<{
    folders: LibraryFolder[];
    placements: LibraryPlacement[];
  }>({ folders: [], placements: [] });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const repo = repoRef.current;
    if (!hasRepo || !repo) return;
    let cancelled = false;
    void (async () => {
      try {
        const [folders, placements] = await Promise.all([
          repo.listFolders(),
          repo.listPlacements(),
        ]);
        if (!cancelled) setState({ folders, placements });
      } catch {
        // Folders are optional; the library still works without them.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasRepo, dataRevision, tick]);

  const { folders, placements } = state;
  const folderOf = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const placed = new Map(placements.map((p) => [p.materialId, p.folderId]));
    return (materialId: string): LibraryFolder | null => {
      const id = placed.get(materialId);
      return (id && byId.get(id)) || null;
    };
  }, [folders, placements]);

  return { folders, placements, folderOf, reload };
}
