import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";

import { moveWithin, type LibraryPlacement } from "@/logic/libraryFolders";
import { isIOS, isMacOS } from "@/services/platform";
import { useAppData } from "@/state/AppDataContext";

import { sectionDomId } from "./LibrarySections";
import type { MoveResult } from "./MoveToDialog";
import { snapshotPlacements, useUndoMove, type PlacementSnapshot } from "./useUndoMove";

export const FLASH_MS = 2000;
/** How long the hidden announcement keeps its words. */
export const ANNOUNCE_MS = 5000;
const FOCUS_WAIT_MS = 1500;

export const DRAG_TYPE = "text/x-hfd-material";
/** What a drag is hovering over: a row (insert line) or a section header. */
export type DragOver = { kind: "row" | "head"; key: string };

/** Where focus should land once the list has redrawn after a move. */
type FocusRequest =
  | { kind: "checks"; ids: string[]; from: LibraryPlacement[]; at: number }
  | { kind: "nudge"; id: string; direction: "up" | "down"; from: LibraryPlacement[]; at: number };

const checkboxOf = (id: string): HTMLElement | null =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-arrange-check]")).find((el) => el.dataset.materialId === id) ?? null;

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
  selectableIds,
}: {
  placements: LibraryPlacement[];
  reload: () => void;
  inFolderView: boolean;
  /** Opens a section that she had collapsed. */
  expandSection: (viewKey: string) => void;
  /** What "Select all shown" (and Cmd-A or Ctrl-A) selects. */
  selectableIds: string[];
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
  const [announcement, setAnnouncement] = useState("");
  const announceTimer = useRef<number | undefined>(undefined);
  const focusReq = useRef<FocusRequest | null>(null);
  const [, setTick] = useState(0);
  const idsRef = useRef(selectableIds);
  idsRef.current = selectableIds;

  const announce = useCallback((text: string) => {
    window.clearTimeout(announceTimer.current);
    setAnnouncement(text);
    announceTimer.current = window.setTimeout(() => setAnnouncement(""), ANNOUNCE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(announceTimer.current), []);

  const askFocus = (req: FocusRequest) => {
    focusReq.current = req;
    // If nothing redraws, settle anyway after a moment.
    window.setTimeout(() => setTick((n) => n + 1), FOCUS_WAIT_MS + 100);
  };
  // After a move the list redraws once the new placements arrive; then put focus back.
  useEffect(() => {
    const req = focusReq.current;
    if (!req) return;
    if (placements === req.from && Date.now() - req.at < FOCUS_WAIT_MS) return;
    let el: HTMLElement | null = null;
    if (req.kind === "nudge") {
      const row = checkboxOf(req.id)?.closest(".arrange-row");
      const pick = (d: "up" | "down") =>
        row?.querySelector<HTMLButtonElement>(`[data-arrange-nudge="${d}"]`) ?? null;
      const same = pick(req.direction);
      const other = pick(req.direction === "up" ? "down" : "up");
      el = same && !same.disabled ? same : other && !other.disabled ? other : checkboxOf(req.id);
    } else {
      for (const id of req.ids) {
        el = checkboxOf(id);
        if (el) break;
      }
      el ??= barRef.current?.querySelector<HTMLElement>(".arrange-bar__done") ?? barRef.current;
    }
    focusReq.current = null;
    el?.focus();
  });

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
    focusReq.current = null;
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

  // Cmd-A (Mac) or Ctrl-A selects everything shown, unless she is typing in a field.
  const selectAllKey = useRef<(event: KeyboardEvent) => void>(() => {});
  selectAllKey.current = (event) => {
    if (event.key.toLowerCase() !== "a" || event.shiftKey || event.altKey || isIOS()) return;
    if (isMacOS() ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return;
    const el = event.target as HTMLElement | null;
    if (el?.closest("input:not([type=checkbox]), textarea, select, [contenteditable]")) return;
    if (target || document.querySelector("dialog[open]")) return;
    event.preventDefault();
    setSelected(new Set(idsRef.current));
  };
  useEffect(() => {
    if (!arranging) return;
    const onKey = (event: KeyboardEvent) => selectAllKey.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [arranging]);

  // The hidden announcement repeats the toast's "Undone" for screen readers.
  const noticeText = undoMove.notice && !undoMove.notice.canUndo ? undoMove.notice.text : "";
  useEffect(() => {
    if (noticeText) announce(noticeText);
  }, [noticeText, announce]);

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

  /** The checkbox order when Move to… opened, to find "the next row" later. */
  const rowOrder = useRef<string[]>([]);
  const openMove = (ids: string[], title?: string) => {
    rowOrder.current = Array.from(document.querySelectorAll<HTMLElement>("[data-arrange-check]")).map(
      (el) => el.dataset.materialId ?? "",
    );
    setTarget({ ids, title });
  };
  const remember = () => {
    pending.current = snapshotPlacements(target?.ids ?? [], placements);
  };
  const moved = (result: MoveResult) => {
    const what =
      result.count === 1 && target?.title ? `“${target.title}”` : result.count.toLocaleString();
    undoMove.record(`Moved ${what} to ${result.folderName}.`, pending.current);
    const ids = target?.ids ?? [];
    const fromRow = target?.title !== undefined && ids.length === 1;
    if (fromRow) {
      // The same row if it is still shown, else the next one, else Done.
      const order = rowOrder.current;
      const at = order.indexOf(ids[0]!);
      askFocus({ kind: "checks", ids: [ids[0]!, ...(at >= 0 ? order.slice(at + 1) : [])], from: placements, at: Date.now() });
    }
    setTarget(null);
    setSelected(new Set());
    reload();
    showWhere(result.folderId);
    if (!fromRow) setFocusBar((n) => n + 1);
    void announceMove(ids, result, target?.title);
  };

  const announceMove = async (ids: string[], result: MoveResult, title?: string) => {
    if (ids.length !== 1) {
      announce(`${result.count.toLocaleString()} materials moved to ${result.folderName}`);
      return;
    }
    const name = title ?? "1 material";
    let where = "";
    try {
      if (result.folderId && repo) {
        const inFolder = (await repo.listPlacements())
          .filter((p) => p.folderId === result.folderId)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const at = inFolder.findIndex((p) => p.materialId === ids[0]);
        if (at >= 0) where = `, position ${at + 1} of ${inFolder.length}`;
      }
    } catch {
      where = "";
    }
    announce(`${name} moved to ${result.folderName}${where}`);
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
    askFocus({ kind: "nudge", id, direction, from: placements, at: Date.now() });
    reload();
    announce(`${title} moved ${direction}, position ${next.indexOf(id) + 1} of ${next.length}`);
  };

  // Mac drag. The ids being dragged live in a ref (the browser hides drag data until the drop).
  const dragIds = useRef<string[]>([]);
  const [dragging, setDragging] = useState<ReadonlySet<string>>(new Set());
  const [over, setOver] = useState<DragOver | null>(null);
  const endDrag = () => {
    dragIds.current = [];
    setDragging(new Set());
    setOver(null);
  };
  useEffect(() => {
    if (!arranging) endDrag();
  }, [arranging]);
  const startDrag = (id: string) => {
    // Dragging a ticked row takes every ticked row; any other row goes alone.
    const ids = selected.has(id) ? [...selectableIds.filter((x) => selected.has(x)), ...[...selected].filter((x) => !selectableIds.includes(x))] : [id];
    dragIds.current = ids;
    setDragging(new Set(ids));
  };
  const isOurs = (event: { dataTransfer: DataTransfer | null }) =>
    dragIds.current.length > 0 && Array.from(event.dataTransfer?.types ?? []).includes(DRAG_TYPE);
  const dragOver = (event: ReactDragEvent<HTMLElement>, next: DragOver) => {
    if (!isOurs(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setOver((cur) => (cur?.kind === next.kind && cur.key === next.key ? cur : next));
  };

  /**
   * Drop on a row (beforeId set: put them just before it) or on a header (beforeId null:
   * at the end). One write for the whole drop; the Undo is the same as for Move to…
   */
  const drop = async (
    event: ReactDragEvent<HTMLElement>,
    dest: { folderId: string | null; folderName: string; order: string[]; beforeId: string | null; titleOf: (id: string) => string },
  ) => {
    if (!isOurs(event)) return;
    event.preventDefault();
    const ids = dragIds.current;
    endDrag();
    if (!repo || ids.length === 0) return;
    if (dest.beforeId !== null && ids.includes(dest.beforeId)) return;
    // A row drop renumbers the whole target section, so Undo must put all of it back.
    const before = snapshotPlacements(dest.beforeId === null ? ids : [...ids, ...dest.order], placements);
    const one = ids.length === 1 ? dest.titleOf(ids[0]!) : null;
    let text: string;
    let position = "";
    try {
      if (dest.beforeId === null) {
        await repo.moveMaterials(ids, dest.folderId);
        text = `Moved ${one ? `“${one}”` : ids.length.toLocaleString()} to ${dest.folderName}.`;
      } else {
        const rest = dest.order.filter((x) => !ids.includes(x));
        const at = rest.indexOf(dest.beforeId);
        const next = at < 0 ? [...rest, ...ids] : [...rest.slice(0, at), ...ids, ...rest.slice(at)];
        await repo.restorePlacements(next.map((materialId, i) => ({ materialId, folderId: dest.folderId, position: i + 1 })));
        const sameSection = snapshotPlacements(ids, placements).every((b) => b.folderId === dest.folderId);
        text = one && sameSection
          ? `Moved “${one}” before “${dest.titleOf(dest.beforeId)}”.`
          : `Moved ${one ? `“${one}”` : ids.length.toLocaleString()} to ${dest.folderName}.`;
        if (one && dest.folderId) position = `, position ${next.indexOf(ids[0]!) + 1} of ${next.length}`;
      }
    } catch {
      return;
    }
    undoMove.record(text, before);
    askFocus({ kind: "checks", ids, from: placements, at: Date.now() });
    setSelected(new Set());
    reload();
    showWhere(dest.folderId);
    if (dest.beforeId === null) {
      void announceMove(ids, { folderId: dest.folderId, folderName: dest.folderName, count: ids.length }, one ?? undefined);
    } else {
      announce(`${one ?? `${ids.length.toLocaleString()} materials`} moved to ${dest.folderName}${position}`);
    }
  };

  return {
    drag: { dragging, over, start: startDrag, end: endDrag, onOver: dragOver, drop },
    arranging,
    start: () => setArranging(true),
    leave,
    selected,
    toggle,
    selectAll: () => setSelected(new Set(selectableIds)),
    announcement,
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
