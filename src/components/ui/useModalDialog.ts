/**
 * Modal behavior for the app's <dialog> elements, with a fallback for WebKit
 * that has no native modal dialog.
 *
 * The app promises macOS 12.0, but WebKit added <dialog>/showModal in Safari
 * 15.4 (macOS 12.3) and `inert` in 15.5. Where showModal and close both exist
 * the native top layer is used unchanged. Otherwise the same element is shown
 * with an `open` attribute, and this hook supplies what the platform would:
 * initial focus, Tab containment, Escape as a close request, focus return, and
 * keeping the page behind out of reach (a backdrop for the pointer, focus
 * containment for the keyboard, aria-hidden/inert for assistive technology).
 *
 * Escape only asks the owner to close. The modal stays visible and modal until
 * its owner sets `open` to false, so an owner can refuse during cleanup.
 *
 * In the fallback, components render the dialog and its backdrop through a
 * portal into <body> (`portalTarget`), so a nested dialog stays visible and
 * viewport-wide when the dialog it was opened from closes or is transformed.
 * React ownership, context and event bubbling are kept by the portal.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

/** True when this engine has a native modal <dialog> (showModal and close). */
export function supportsNativeModal(): boolean {
  return (
    typeof HTMLDialogElement === "function" &&
    typeof HTMLDialogElement.prototype.showModal === "function" &&
    typeof HTMLDialogElement.prototype.close === "function"
  );
}

interface ModalOptions {
  /** Escape was pressed: a request to close that the owner may refuse. */
  onEscape: () => void;
  /** Where focus goes on opening; defaults to the first focusable element. */
  initialFocus?: () => HTMLElement | null;
}

export interface ModalState {
  /** True when the fallback is in use instead of the native top layer. */
  fallback: boolean;
  /** Fallback only: render a backdrop sibling just before the dialog. */
  showBackdrop: boolean;
  /** Fallback only: z-index for the dialog; the backdrop sits one below. */
  zIndex: number;
  /** Fallback in the browser: render the dialog and backdrop into this element. */
  portalTarget: HTMLElement | null;
}

const BASE_Z_INDEX = 1000;

const noSubscription = () => () => {};
/** True in the browser and false while rendering on a server, where portals are unsupported. */
function useInBrowser(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
  // A <details> toggle (e.g. "What Google keeps") is focusable too.
  "details > summary:first-of-type",
].join(",");

function focusableIn(container: HTMLElement): HTMLElement[] {
  // `:disabled` also covers controls inside a disabled <fieldset> (a dialog
  // locked while it saves), which `[disabled]` alone would still offer.
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.closest("[hidden]") && !element.matches(":disabled"),
  );
}

/**
 * Fallback only: a dialog that locks its controls while saving would leave
 * focus on a control that can no longer hold it. Focus moves to the dialog
 * itself while locked, and back to the control she was on (or the first one
 * usable) once the dialog unlocks.
 */
function watchLocking(entry: OpenModal): () => void {
  if (typeof MutationObserver !== "function") return () => {};
  const observer = new MutationObserver(() => {
    if (top() !== entry) return;
    const element = entry.element;
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== element && element.contains(active) && active.matches(":disabled")) {
      entry.lockedFrom = active;
      element.focus();
      return;
    }
    if (active !== element && active !== null && active !== document.body) return;
    const items = focusableIn(element);
    if (items.length === 0) {
      if (active !== element) element.focus();
      return;
    }
    const back = entry.lockedFrom;
    entry.lockedFrom = null;
    (back && back.isConnected && items.includes(back) ? back : items[0]!).focus();
  });
  observer.observe(entry.element, { subtree: true, attributes: true, attributeFilter: ["disabled"] });
  return () => observer.disconnect();
}

interface OpenModal {
  element: HTMLElement;
  options: RefObject<ModalOptions>;
  /** Paint layer, above every modal that was open when this one opened. */
  layer: number;
  /** Where focus goes back when this modal closes (re-pointed if its region closes first). */
  restoreTo: HTMLElement | null;
  /** The control focus left when the dialog locked, to return to on unlock. */
  lockedFrom: HTMLElement | null;
}

/** Open fallback modals, bottom to top. Only the top one handles keys and focus. */
const stack: OpenModal[] = [];

function top(): OpenModal | undefined {
  return stack[stack.length - 1];
}

function onKeyDown(event: KeyboardEvent) {
  const modal = top();
  if (!modal) return;
  if (event.key === "Escape") {
    event.preventDefault();
    modal.options.current.onEscape();
    return;
  }
  if (event.key !== "Tab") return;
  const items = focusableIn(modal.element);
  const active = document.activeElement as HTMLElement | null;
  const inside = active !== null && modal.element.contains(active);
  if (items.length === 0) {
    event.preventDefault();
    modal.element.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (event.shiftKey && (!inside || active === first || active === modal.element)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}

/** Focus that escapes the top modal (e.g. by script) is brought back inside. */
function onFocusIn(event: FocusEvent) {
  const modal = top();
  const target = event.target as Node | null;
  if (!modal || (target && modal.element.contains(target))) return;
  (focusableIn(modal.element)[0] ?? modal.element).focus();
}

/**
 * Elements kept out of reach of assistive technology and interaction, with the
 * attributes they had before. Recomputed from the current top modal on every
 * stack change: the siblings along its path to <body> are excluded, and
 * everything else, including a modal that used to be on top, goes back to its
 * original state. Lower sibling modals are therefore excluded too.
 */
const excluded = new Map<Element, { ariaHidden: string | null; inert: boolean }>();

function outsideOf(element: HTMLElement): Set<Element> {
  const outside = new Set<Element>();
  for (let node: Element = element; node.parentElement && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || sibling.hasAttribute("data-modal-backdrop")) continue;
      if (sibling.tagName === "SCRIPT" || sibling.tagName === "STYLE") continue;
      outside.add(sibling);
    }
  }
  return outside;
}

function reconcileExclusion() {
  const current = top();
  const wanted = current ? outsideOf(current.element) : new Set<Element>();
  for (const [element, original] of excluded) {
    if (wanted.has(element)) continue;
    if (original.ariaHidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", original.ariaHidden);
    if (original.inert) element.setAttribute("inert", "");
    else element.removeAttribute("inert");
    excluded.delete(element);
  }
  for (const element of wanted) {
    if (!excluded.has(element)) {
      excluded.set(element, { ariaHidden: element.getAttribute("aria-hidden"), inert: element.hasAttribute("inert") });
    }
    element.setAttribute("aria-hidden", "true");
    // Honored where supported (Safari 15.5+); harmless elsewhere.
    element.setAttribute("inert", "");
  }
}

/**
 * A focus target is usable only if it is still in the page, outside the modal
 * that is closing, not in a closed dialog or an excluded/hidden region, and
 * inside the modal that remains on top, if any.
 */
function canRestoreTo(target: HTMLElement | null, closing: HTMLElement): target is HTMLElement {
  if (!target || !target.isConnected || target === document.body || closing.contains(target)) return false;
  if (target.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  const dialog = target.closest("dialog");
  if (dialog && !dialog.hasAttribute("open")) return false;
  const current = top();
  return !current || current.element.contains(target);
}

export function useModalDialog(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  options: ModalOptions,
): ModalState {
  const [fallback] = useState(() => !supportsNativeModal());
  const inBrowser = useInBrowser();
  const [layer, setLayer] = useState(0);
  const latest = useRef(options);
  latest.current = options;

  // Native path: the platform's top layer, focus trap and backdrop.
  useEffect(() => {
    if (fallback) return;
    const element = ref.current as HTMLDialogElement | null;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      latest.current.initialFocus?.()?.focus();
    }
    if (!open && element.open) element.close();
  }, [fallback, open, ref]);

  // Fallback path.
  useEffect(() => {
    if (!fallback || !open) return;
    const element = ref.current;
    if (!element) return;
    const entry: OpenModal = {
      element,
      options: latest,
      layer: Math.max(0, ...stack.map((modal) => modal.layer)) + 1,
      restoreTo: document.activeElement as HTMLElement | null,
      lockedFrom: null,
    };

    element.setAttribute("open", "");
    stack.push(entry);
    if (stack.length === 1) {
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("focusin", onFocusIn, true);
    }
    reconcileExclusion();
    setLayer(entry.layer);
    (latest.current.initialFocus?.() ?? focusableIn(element)[0] ?? element).focus();
    const stopWatching = watchLocking(entry);

    return () => {
      stopWatching();
      const wasTop = top() === entry;
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      // Modals above that would return focus into this one now return it to
      // wherever this one would have.
      for (const modal of stack) {
        if (modal.restoreTo && element.contains(modal.restoreTo)) modal.restoreTo = entry.restoreTo;
      }
      if (stack.length === 0) {
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("focusin", onFocusIn, true);
      }
      element.removeAttribute("open");
      reconcileExclusion();
      // Only the top modal hands focus back; a lower one closing must not
      // pull focus out of the modal still open above it.
      if (!wasTop) return;
      const current = top();
      if (canRestoreTo(entry.restoreTo, element)) {
        entry.restoreTo.focus();
      } else if (current) {
        (focusableIn(current.element)[0] ?? current.element).focus();
      } else if (element.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
      }
    };
  }, [fallback, open, ref]);

  return {
    fallback,
    showBackdrop: fallback && open,
    zIndex: BASE_Z_INDEX + 2 * Math.max(layer, 1),
    portalTarget: fallback && inBrowser ? document.body : null,
  };
}
