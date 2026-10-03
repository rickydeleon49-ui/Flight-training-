import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import { SearchIcon } from "@/components/ui";
import { useModalDialog } from "@/components/ui/useModalDialog";
import { todayIso } from "@/lib/dates";
import { quickFind } from "@/logic/quickFind";
import { useAppData } from "@/state/AppDataContext";

import "./quickFind.css";

/** Lets the sidebar button open Quick Find without threading state through. */
export const QUICK_FIND_EVENT = "quickfind:open";

/** Mac shows ⌘K, everywhere else Ctrl K. */
export function quickFindShortcutLabel(): string {
  const platform =
    typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent;
  return /mac|iphone|ipad/i.test(platform) ? "\u2318K" : "Ctrl K";
}

/** True when the keystroke should open Quick Find. */
function isOpenShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k";
}

/**
 * Search everything from anywhere, with ⌘K or Ctrl+K.
 *
 * Built on the native <dialog> like the rest of the app's modals, so focus
 * trapping and Escape are the platform's job rather than ours. WebKit before
 * macOS 12.3 has no modal <dialog>; useModalDialog covers that case.
 */
export function QuickFind() {
  const { data } = useAppData();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const today = todayIso();

  const results = useMemo(() => quickFind(data, query, today), [data, query, today]);

  useEffect(() => {
    const show = () => {
      setQuery("");
      setHighlighted(0);
      setOpen(true);
    };
    const handler = (event: KeyboardEvent) => {
      if (!isOpenShortcut(event)) return;
      event.preventDefault();
      show();
    };
    window.addEventListener("keydown", handler);
    window.addEventListener(QUICK_FIND_EVENT, show);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener(QUICK_FIND_EVENT, show);
    };
  }, []);

  const modal = useModalDialog(dialogRef, open, {
    onEscape: () => setOpen(false),
    initialFocus: () => inputRef.current,
  });

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    const handleClose = () => setOpen(false);
    element.addEventListener("close", handleClose);
    return () => element.removeEventListener("close", handleClose);
  }, []);

  // Keep the highlight on a row that still exists as she types.
  useEffect(() => {
    setHighlighted((current) => (current < results.length ? current : 0));
  }, [results.length]);

  const choose = (index: number) => {
    const result = results[index];
    if (!result) return;
    setOpen(false);
    navigate(result.to);
  };

  const presentation = (
    <>
      {modal.showBackdrop ? (
        <div
          className="modal-fallback-backdrop"
          data-modal-backdrop=""
          aria-hidden="true"
          style={{ zIndex: modal.zIndex - 1 }}
          onClick={() => setOpen(false)}
        />
      ) : null}
      <dialog
        ref={dialogRef}
        className={`quick-find${modal.fallback ? " modal-fallback" : ""}`}
        aria-label="Quick find"
        role={modal.fallback ? "dialog" : undefined}
        aria-modal={modal.showBackdrop ? true : undefined}
        tabIndex={modal.fallback ? -1 : undefined}
        style={modal.fallback ? { zIndex: modal.zIndex } : undefined}
        onClick={(event) => {
          if (!modal.fallback && event.target === dialogRef.current) setOpen(false);
        }}
      >
        <div className="quick-find__search">
          <SearchIcon size={17} />
          <input
            ref={inputRef}
            className="quick-find__input"
            type="text"
            value={query}
            placeholder="Search everything — materials, lessons, flights, questions"
            aria-label="Search everything"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlighted((current) => (current + 1) % Math.max(results.length, 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlighted((current) =>
                  (current - 1 + Math.max(results.length, 1)) % Math.max(results.length, 1),
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(highlighted);
              }
            }}
          />
          <kbd className="quick-find__hint">esc</kbd>
        </div>

        {results.length === 0 ? (
          <p className="quick-find__empty small muted">
            Nothing matches &ldquo;{query.trim()}&rdquo; yet.
          </p>
        ) : (
          <ul className="quick-find__results">
            {results.map((result, index) => (
              <li key={result.key}>
                <button
                  type="button"
                  className={`quick-find__result${index === highlighted ? " is-highlighted" : ""}`}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => choose(index)}
                >
                  <span className="quick-find__label truncate">{result.label}</span>
                  <span className="quick-find__detail truncate">{result.detail}</span>
                  <span className="quick-find__section">{result.section}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </dialog>
    </>
  );
  // In the fallback the dialog lives at <body> level; see useModalDialog.
  return modal.portalTarget ? createPortal(presentation, modal.portalTarget) : presentation;
}
