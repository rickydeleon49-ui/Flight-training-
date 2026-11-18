import { useEffect } from "react";

/** Esc does what the page's Back/Cancel button does. An open dialog or menu keeps its own Esc. */
export function useEscapeBack(onBack: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("dialog[open], [role='dialog'], [role='menu']")) return;
      // Esc while typing in a field never leaves the page.
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
      onBack();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onBack, enabled]);
}
