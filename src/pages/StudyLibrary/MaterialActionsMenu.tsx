import { useEffect, useRef, type ReactNode } from "react";

/** Native disclosure with ordinary tab-accessible buttons and explicit focus return. */
export function MaterialActionsMenu({ children }: { children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const items = useRef<HTMLDivElement>(null);
  const position = () => {
    if (!details.current?.open || !summary.current || !items.current) return;
    const bounds = summary.current.getBoundingClientRect();
    const width = Math.min(352, window.innerWidth - 16);
    const top = Math.min(bounds.bottom + 4, window.innerHeight - 60);
    Object.assign(items.current.style, {
      width: `${width}px`,
      left: `${Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))}px`,
      top: `${Math.max(8, top)}px`,
      maxHeight: `${Math.max(44, window.innerHeight - Math.max(8, top) - 8)}px`,
    });
  };
  useEffect(() => {
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(position) : null;
    if (summary.current) observer?.observe(summary.current);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      observer?.disconnect();
    };
  }, []);
  const close = () => {
    if (details.current) details.current.open = false;
    summary.current?.focus();
  };
  return <details ref={details} className="material-actions-menu" onToggle={position} onKeyDown={event => {
    if (event.key === "Escape" && details.current?.open) {
      event.preventDefault(); event.stopPropagation(); close();
    }
  }}>
    <summary id="material-file-actions" ref={summary} aria-label="File actions: edit, split, open, delete" onKeyDown={event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (details.current) details.current.open = !details.current.open;
      }
    }}>File ▾</summary>
    <div ref={items} className="material-actions-menu__items" onClickCapture={event => {
      if ((event.target as HTMLElement).closest("button")) close();
    }}>{children}</div>
  </details>;
}
