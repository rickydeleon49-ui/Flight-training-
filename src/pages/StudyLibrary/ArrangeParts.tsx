import type { MouseEvent } from "react";

import { Button } from "@/components/ui";
import {
  MATERIAL_TYPE_LABELS,
  REVIEW_STATUS_LABELS,
  TOPIC_LABELS,
  type StudyMaterial,
} from "@/domain/types";

import "@/components/undo/undoBar.css";
import type { MoveNotice } from "./useUndoMove";

export const MANUAL_ONLY_HINT = "Choose Sort: My order to arrange by hand";

/** The bar at the top of Arrange mode. It takes focus after a move. */
export function ArrangeBar({
  barRef,
  count,
  onSelectAll,
  onMove,
  onDone,
  announcement,
}: {
  barRef: React.RefObject<HTMLDivElement | null>;
  count: number;
  onSelectAll: () => void;
  onMove: () => void;
  onDone: () => void;
  /** Said once to screen readers after a move; empty most of the time. */
  announcement: string;
}) {
  return (
    <>
    <div ref={barRef} tabIndex={-1} role="group" aria-label="Arrange" className="arrange-bar">
      <span className="arrange-bar__count" aria-live="polite">{count.toLocaleString()} selected</span>
      <Button onClick={onSelectAll}>Select all shown</Button>
      <Button variant="primary" disabled={count === 0} onClick={onMove}>
        Move {count.toLocaleString()} to…
      </Button>
      <Button className="arrange-bar__done" onClick={onDone}>Done</Button>
    </div>
    <div role="status" aria-live="polite" className="visually-hidden">{announcement}</div>
    </>
  );
}

/** One material in Arrange mode. Tapping the row ticks it; it never opens the material. */
export function ArrangeRow({
  material,
  chapter,
  selected,
  chapterCount,
  showArrows,
  arrowTitle,
  upDisabled,
  downDisabled,
  onToggle,
  onNudge,
  onMove,
}: {
  material: StudyMaterial;
  /** A chapter under its book: not selectable, it moves with the book. */
  chapter: boolean;
  selected: boolean;
  chapterCount: number;
  showArrows: boolean;
  /** Why the arrows are off (shown on hover). */
  arrowTitle?: string;
  upDisabled: boolean;
  downDisabled: boolean;
  onToggle: () => void;
  onNudge: (direction: "up" | "down") => void;
  onMove: () => void;
}) {
  const click = (event: MouseEvent) => {
    if (chapter) return;
    if ((event.target as HTMLElement).closest("button, input, label")) return;
    onToggle();
  };
  return (
    <div className={`material-row arrange-row${selected ? " is-selected" : ""}`} onClick={click}>
      {chapter ? (
        <span className="material-row__title wrap-anywhere arrange-row__chapter">{material.title}</span>
      ) : (
        <label className="material-row__title wrap-anywhere arrange-row__label">
          <input
            type="checkbox"
            aria-label={`Select ${material.title}`}
            data-arrange-check=""
            data-material-id={material.id}
            checked={selected}
            onChange={onToggle}
          />
          <span>{material.title}</span>
        </label>
      )}
      <span className="material-row__col">{MATERIAL_TYPE_LABELS[material.materialType]}</span>
      <span className="material-row__col material-row__topic">{TOPIC_LABELS[material.topic]}</span>
      <span className="material-row__col">{REVIEW_STATUS_LABELS[material.reviewStatus]}</span>
      {chapter ? (
        <span className="tiny dim">Stays with its book</span>
      ) : (
        <span className="arrange-row__actions">
          {showArrows ? (
            <>
              <Button
                aria-label={`Move ${material.title} up`}
                data-arrange-nudge="up"
                title={arrowTitle}
                disabled={upDisabled}
                onClick={() => onNudge("up")}
              >
                <span aria-hidden="true">▲</span>
              </Button>
              <Button
                aria-label={`Move ${material.title} down`}
                data-arrange-nudge="down"
                title={arrowTitle}
                disabled={downDisabled}
                onClick={() => onNudge("down")}
              >
                <span aria-hidden="true">▼</span>
              </Button>
            </>
          ) : null}
          <Button onClick={onMove}>Move to…</Button>
        </span>
      )}
      {selected && chapterCount > 0 ? (
        <span className="tiny dim arrange-row__note">
          ({chapterCount.toLocaleString()} {chapterCount === 1 ? "chapter moves" : "chapters move"} with this book)
        </span>
      ) : null}
    </div>
  );
}

/** The toast after a move: where it went, and Undo for 10 seconds. */
export function MoveToast({ notice, onUndo }: { notice: MoveNotice | null; onUndo: () => void }) {
  if (!notice) return null;
  return (
    <div className="undo-bar move-toast" role="status" aria-live="off">
      <p className="undo-bar__text">{notice.canUndo ? `${notice.text} ` : notice.text}</p>
      {notice.canUndo ? (
        <button type="button" className="undo-bar__action" onClick={onUndo}>
          Undo
        </button>
      ) : null}
    </div>
  );
}
