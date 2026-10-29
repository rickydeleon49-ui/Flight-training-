import { useRef, type ReactNode } from "react";

/** Native disclosure with ordinary tab-accessible buttons and explicit focus return. */
export function MaterialActionsMenu({ children }: { children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const close = () => {
    if (details.current) details.current.open = false;
    summary.current?.focus();
  };
  return <details ref={details} className="material-actions-menu" onKeyDown={event => {
    if (event.key === "Escape" && details.current?.open) {
      event.preventDefault(); event.stopPropagation(); close();
    }
  }}>
    <summary ref={summary} aria-label="More actions: edit, split, open, delete" onKeyDown={event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (details.current) details.current.open = !details.current.open;
      }
    }}>More ▾</summary>
    <div className="material-actions-menu__items" onClickCapture={event => {
      if ((event.target as HTMLElement).closest("button")) close();
    }}>{children}</div>
  </details>;
}
