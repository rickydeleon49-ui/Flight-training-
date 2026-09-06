import { useEffect, useState } from "react";

import { UNDO_WINDOW_MS, useAppData } from "@/state/AppDataContext";

import "./undoBar.css";

/**
 * The few seconds after a deletion in which she can change her mind.
 *
 * The bar also carries a progress line, so the window is visible rather than
 * something to guess at.
 */
export function UndoBar() {
  const { pendingDelete, undoDelete } = useAppData();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!pendingDelete) return;
    setElapsed(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => window.clearInterval(timer);
  }, [pendingDelete]);

  if (!pendingDelete) return null;

  const remaining = Math.max(0, 1 - elapsed / UNDO_WINDOW_MS);

  return (
    <div className="undo-bar" role="status" aria-live="polite">
      <span className="undo-bar__progress" style={{ transform: `scaleX(${remaining})` }} />
      <p className="undo-bar__text truncate">
        Deleted <span className="strong">{pendingDelete.label}</span>
      </p>
      <button type="button" className="undo-bar__action" onClick={undoDelete}>
        Undo
      </button>
    </div>
  );
}
