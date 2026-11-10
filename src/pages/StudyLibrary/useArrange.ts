import { useCallback, useEffect, useRef, useState } from "react";

import { moveWithin, type LibraryPlacement } from "@/logic/libraryFolders";
import { useAppData } from "@/state/AppDataContext";

import { sectionDomId } from "./LibrarySections";
import type { MoveResult } from "./MoveToDialog";
import { snapshotPlacements, useUndoMove, type PlacementSnapshot } from "./useUndoMove";

export const FLASH_MS = 2000;

/** Which materials the "Move to…" dialog is open for. */
export interface MoveTarget {
  ids: string[];
  title?: string;
}

/**
 * Arrange mode in By folder: the selection, the Move to… dialog, up/down
 * moves, one-level Undo, and showing where things went.
 */
export function useArrange({
  placements,
  reload,
  inFolderView,
  expandSection,
}: {
  placements: LibraryPlacement[];
  reload: () => void;
  inFolderView: boolean;
  /** Opens a section that she had collapsed. */
  expandSection: (viewKey: string) => void;
}) {
  const { repositories } = useAppData();
  const repo = repositories?.libraryFolders;
  const [arranging, setArranging] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState<MoveTarget | null>(null);
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [focusBar, setFocusBar] = useState(0);
  const pending = useRef<PlacementSnapshot[]>([]);

  const restore = useCallback(
    async (rows: PlacementSnapshot[]) => {
      if (!repo) throw new Error("Folders are not ready yet.");
      await repo.restorePlacements(rows);
    },
    [repo],
  );
  const undoMove = useUndoMove(restore, reload, inFolderView);

  const leave = useCallback(() => {
    setArranging(false);
    setSelected(new Set());
    setTarget(null);
  }, []);
  // Changing the view (or anything that hides By folder) leaves Arrange.
  useEffect(() => {
    if (!inFolderView) leave();
  }, [inFolderView, leave]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  useEffect(() => {
    if (focusBar) barRef.current?.focus();
  }, [focusBar]);

  useEffect(() => {
    if (!flash) return;
    document.getElementById(sectionDomId(flash.key))?.scrollIntoView?.({ block: "nearest" });
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const showWhere = (folderId: string | null) => {
    const key = folderId ? `folder:folder:${folderId}` : "folder:none";
    expandSection(key);
    setFlash((f) => ({ key, n: (f?.n ?? 0) + 1 }));
  };

  const openMove = (ids: string[], title?: string) => setTarget({ ids, title });
  const remember = () => {
    pending.current = snapshotPlacements(target?.ids ?? [], placements);
  };
  const moved = (result: MoveResult) => {
    const what =
      result.count === 1 && target?.title ? `“${target.title}”` : result.count.toLocaleString();
    undoMove.record(`Moved ${what} to ${result.folderName}.`, pending.current);
    setTarget(null);
    setSelected(new Set());
    reload();
    showWhere(result.folderId);
    setFocusBar((n) => n + 1);
  };

  /** Swap one row with its neighbour and save the whole section's order. */
  const nudge = async (
    sectionFolderId: string | null,
    orderedIds: string[],
    id: string,
    title: string,
    direction: "up" | "down",
  ) => {
    if (!repo) return;
    const next = moveWithin(orderedIds, id, direction);
    if (next === orderedIds) return;
    const before = snapshotPlacements(orderedIds, placements);
    try {
      await repo.setOrder(sectionFolderId, next);
    } catch {
      return;
    }
    undoMove.record(`Moved “${title}” ${direction}.`, before);
    reload();
    setFocusBar((n) => n + 1);
  };

  return {
    arranging,
    start: () => setArranging(true),
    leave,
    selected,
    toggle,
    selectAll: (ids: string[]) => setSelected(new Set(ids)),
    target,
    openMove,
    closeMove: () => setTarget(null),
    remember,
    moved,
    nudge,
    flashKey: flash?.key ?? null,
    barRef,
    notice: undoMove.notice,
    undo: undoMove.undo,
  };
}
