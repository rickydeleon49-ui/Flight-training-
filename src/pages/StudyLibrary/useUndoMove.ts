import { useCallback, useEffect, useRef, useState } from "react";

import type { LibraryPlacement } from "@/logic/libraryFolders";
import { isIOS, isMacOS } from "@/services/platform";

export const UNDO_VISIBLE_MS = 10_000;
const DONE_VISIBLE_MS = 4_000;

export interface PlacementSnapshot {
  materialId: string;
  folderId: string | null;
  position: number | null;
}

/** Where each material is now. A material without a row counts as Not in a folder. */
export function snapshotPlacements(
  ids: string[],
  placements: LibraryPlacement[],
): PlacementSnapshot[] {
  const byId = new Map(placements.map((p) => [p.materialId, p]));
  return [...new Set(ids)].map((materialId) => {
    const p = byId.get(materialId);
    return { materialId, folderId: p?.folderId ?? null, position: p?.position ?? null };
  });
}

export interface MoveNotice {
  text: string;
  /** False once it says "Undone". */
  canUndo: boolean;
}

/**
 * One level of Undo for a move, kept only in memory. A new move replaces the
 * old one; the toast goes after 10 seconds. Cmd-Z (Mac) or Ctrl-Z does the
 * same as the button while `keysOn` and no text field has focus.
 */
export function useUndoMove(
  restore: (rows: PlacementSnapshot[]) => Promise<void>,
  after: () => void,
  keysOn: boolean,
) {
  const saved = useRef<PlacementSnapshot[] | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [notice, setNotice] = useState<MoveNotice | null>(null);

  const show = useCallback((next: MoveNotice, ms: number) => {
    window.clearTimeout(timer.current);
    setNotice(next);
    timer.current = window.setTimeout(() => {
      saved.current = null;
      setNotice(null);
    }, ms);
  }, []);

  /** Call after the write worked; `before` is what the affected materials looked like. */
  const record = useCallback(
    (text: string, before: PlacementSnapshot[]) => {
      saved.current = before;
      show({ text, canUndo: true }, UNDO_VISIBLE_MS);
    },
    [show],
  );

  const undo = useCallback(async () => {
    const rows = saved.current;
    if (!rows) return;
    saved.current = null;
    try {
      await restore(rows);
      after();
      show({ text: "Undone", canUndo: false }, DONE_VISIBLE_MS);
    } catch {
      show({ text: "Could not undo that move.", canUndo: false }, DONE_VISIBLE_MS);
    }
  }, [restore, after, show]);

  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    if (!keysOn) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || event.shiftKey || event.altKey) return;
      if (isIOS()) return;
      if (isMacOS() ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return;
      const el = event.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable]")) return;
      if (!saved.current) return;
      event.preventDefault();
      void undoRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keysOn]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { notice, record, undo };
}
