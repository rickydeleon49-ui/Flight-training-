/**
 * Start for an action that lives on Flight Deck: bring its own control into
 * view and give it keyboard focus.
 *
 * Flight Deck renders an action in one of two places: "Today's plan" (due
 * today or undated, wrapped in `#action-<id>`) or "Needs attention" (overdue,
 * wrapped in `#attention-<id>`). Future-dated actions are not rendered at all,
 * so this reports whether focus actually landed and lets the caller fall back.
 */
export function focusRenderedAction(actionId: string, doc: Document = document): boolean {
  for (const id of [`action-${actionId}`, `attention-${actionId}`]) {
    const container = doc.getElementById(id);
    const control = container?.querySelector<HTMLElement>(
      "input:not([disabled]), button:not([disabled])",
    );
    if (container && control) {
      container.scrollIntoView?.({ behavior: "smooth", block: "center" });
      control.focus();
      if (doc.activeElement === control) return true;
    }
  }
  return false;
}
