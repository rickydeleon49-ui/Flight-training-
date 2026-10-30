// @vitest-environment jsdom
/**
 * Dialog where the engine has no modal <dialog> (WebKit before Safari 15.4 /
 * macOS 12.3): showModal and close are removed, so useModalDialog's fallback
 * runs. jsdom also has no inert or ::backdrop, like that WebKit.
 */
import { StrictMode, createElement as h, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { removeCapabilities } from "@/testing/capabilities";

import { ConfirmDialog, Dialog } from "./Dialog";
import { supportsNativeModal } from "./useModalDialog";

let restore: () => void;
beforeEach(() => {
  restore = removeCapabilities([
    [HTMLDialogElement.prototype, "showModal"],
    [HTMLDialogElement.prototype, "close"],
  ]);
  expect(supportsNativeModal()).toBe(false);
});
afterEach(() => {
  cleanup();
  restore();
  document.body.innerHTML = "";
});

/**
 * Excluded behind the top modal: inside an aria-hidden and inert region. The
 * fallback renders dialogs at <body> level, so exclusion is applied to the
 * page's body-level region rather than to <main> itself.
 */
const excluded = (element: Element) =>
  element.closest("[aria-hidden='true']") !== null && element.closest("[inert]") !== null;
/** The page's region at <body> level, which the fallback excludes as a whole. */
const pageRegion = () => document.querySelector("main")!.closest("body > *")!;

/** No fallback exclusion remains (icons keep their own aria-hidden). */
const nothingExcluded = () =>
  document.querySelector("[inert]") === null && !excluded(document.querySelector("main")!);

const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey: shift });
const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

/** A page with content behind the dialog and a button that opens it. */
function Page({ initiallyOpen = false, dismissible = true, onClose = () => {} }: {
  initiallyOpen?: boolean; dismissible?: boolean; onClose?: () => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return h("div", null,
    h("main", null,
      h("button", { type: "button", onClick: () => setOpen(true) }, "Open details"),
      h("button", { type: "button" }, "Background action")),
    h(Dialog, {
      open, dismissible, title: "Edit material", description: "Synthetic",
      onClose: () => { onClose(); setOpen(false); },
      footer: h("button", { type: "button" }, "Save"),
      children: h("input", { "aria-label": "Title" }),
    }));
}

function openFromButton() {
  const opener = screen.getByRole("button", { name: "Open details" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("Dialog without native modal support", () => {
  it("shows a named modal dialog with a backdrop and focuses inside it", () => {
    render(h(Page));
    openFromButton();
    const dialog = screen.getByRole("dialog", { name: "Edit material" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.classList.contains("modal-fallback")).toBe(true);
    expect(document.querySelector(".modal-fallback-backdrop")).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("keeps Tab and Shift+Tab inside the dialog", () => {
    render(h(Page));
    openFromButton();
    const close = screen.getByRole("button", { name: "Close" });
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    tab();
    expect(document.activeElement).toBe(close);
    tab(true);
    expect(document.activeElement).toBe(save);
  });

  it("BUGFIX-064 P-1: Tab and Shift+Tab cycle through a <details> summary as the last control", () => {
    render(h(Dialog, {
      open: true, title: "Send to Google", onClose: () => {},
      footer: h("details", null, h("summary", null, "What Google keeps"), h("p", null, "Synthetic")),
      children: h("input", { "aria-label": "Title" }),
    }));
    const close = screen.getByRole("button", { name: "Close" });
    const summary = screen.getByText("What Google keeps");
    summary.focus();
    tab();
    expect(document.activeElement).toBe(close);
    tab(true);
    expect(document.activeElement).toBe(summary);
  });

  it("ASTRA-FIX-2 #6: skips controls locked by a disabled fieldset, holds focus on the dialog, and returns it on unlock", async () => {
    function Locking({ locked }: { locked: boolean }) {
      return h(Dialog, {
        open: true, title: "Saving", onClose: () => {}, dismissible: !locked,
        footer: h("button", { type: "button", disabled: locked }, "Save"),
        children: h("fieldset", { disabled: locked }, h("input", { "aria-label": "Title" })),
      });
    }
    const ui = render(h(Locking, { locked: false }));
    const dialog = screen.getByRole("dialog");
    const title = screen.getByRole("textbox", { name: "Title" });
    title.focus();
    ui.rerender(h(Locking, { locked: true }));
    expect(title.matches(":disabled")).toBe(true);
    expect(title.hasAttribute("disabled")).toBe(false);
    await act(async () => {});
    expect(document.activeElement).toBe(dialog);
    tab();
    expect(document.activeElement).toBe(dialog);
    tab(true);
    expect(document.activeElement).toBe(dialog);
    ui.rerender(h(Locking, { locked: false }));
    await act(async () => {});
    expect(document.activeElement).toBe(title);
  });

  it("brings focus back when something outside tries to take it", () => {
    render(h(Page));
    openFromButton();
    screen.getByRole("button", { name: "Background action", hidden: true }).focus();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("hides the page behind from assistive technology and restores it afterwards", () => {
    render(h(Page));
    const region = pageRegion();
    region.setAttribute("aria-hidden", "false"); // an original value to preserve
    openFromButton();
    expect(region.getAttribute("aria-hidden")).toBe("true");
    expect(region.hasAttribute("inert")).toBe(true);
    expect(excluded(screen.getByRole("button", { name: "Background action", hidden: true }))).toBe(true);
    expect(excluded(screen.getByRole("dialog"))).toBe(false);
    escape();
    expect(region.getAttribute("aria-hidden")).toBe("false");
    expect(region.hasAttribute("inert")).toBe(false);
  });

  it("closes on Escape and backdrop through the owner, and returns focus to the opener", () => {
    const onClose = vi.fn();
    render(h(Page, { onClose }));
    const opener = openFromButton();
    escape();
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);

    openFromButton();
    fireEvent.click(document.querySelector(".modal-fallback-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(opener);
  });

  it("ignores clicks on the dialog box itself; only the backdrop dismisses", () => {
    const onClose = vi.fn();
    render(h(Page, { onClose }));
    openFromButton();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open and modal for a running task (dismissible=false)", () => {
    const onClose = vi.fn();
    render(h(Page, { initiallyOpen: true, dismissible: false, onClose }));
    escape();
    fireEvent.click(document.querySelector(".modal-fallback-backdrop")!);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
    expect(excluded(document.querySelector("main")!)).toBe(true);
  });

  it("stays open and modal when the owner refuses the close during cleanup", () => {
    const onClose = vi.fn(); // never sets open=false, like a failed async cleanup
    render(h(Dialog, { open: true, onClose, title: "Add material", children: h("button", { type: "button" }, "Retry") }));
    escape();
    expect(onClose).toHaveBeenCalledOnce();
    const dialog = screen.getByRole("dialog");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    screen.getByRole("button", { name: "Retry" }).focus();
    tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("leaves nothing behind after repeated opening and closing", () => {
    const onClose = vi.fn();
    render(h(Page, { onClose }));
    for (let i = 0; i < 3; i++) {
      openFromButton();
      escape();
    }
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(nothingExcluded()).toBe(true);
    escape();
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("cleans up when unmounted while open", () => {
    const onClose = vi.fn();
    const outside = document.body.appendChild(document.createElement("button"));
    outside.focus();
    const { unmount } = render(h(Dialog, { open: true, onClose, title: "Temporary", children: h("p", null, "x") }));
    expect(outside.getAttribute("aria-hidden")).toBe("true");
    unmount();
    expect(outside.hasAttribute("aria-hidden")).toBe(false);
    expect(document.activeElement).toBe(outside);
    escape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("behaves the same under StrictMode's repeated effects", () => {
    const onClose = vi.fn();
    render(h(StrictMode, null, h(Page, { onClose })));
    const opener = openFromButton();
    expect(excluded(document.querySelector("main")!)).toBe(true);
    escape();
    expect(onClose).toHaveBeenCalledOnce();
    expect(nothingExcluded()).toBe(true);
    expect(document.activeElement).toBe(opener);
  });
});

describe("layered fallback dialogs", () => {
  function Layered({ onCancelConfirm = () => {} }: { onCancelConfirm?: () => void }) {
    const [outer, setOuter] = useState(true);
    const [confirm, setConfirm] = useState(false);
    return h("div", null,
      h("main", null, h("button", { type: "button" }, "Page action")),
      h(Dialog, {
        open: outer, onClose: () => setOuter(false), title: "Edit material",
        children: h("button", { type: "button", onClick: () => setConfirm(true) }, "Delete"),
      }),
      h(ConfirmDialog, {
        open: confirm, title: "Delete it?", message: "Synthetic",
        onConfirm: () => setConfirm(false),
        onCancel: () => { onCancelConfirm(); setConfirm(false); },
      }),
      h("button", { type: "button", onClick: () => setOuter(false) }, "Force close outer"));
  }

  it("gives keys and focus only to the top dialog and restores the lower one intact", () => {
    const onCancelConfirm = vi.fn();
    render(h(Layered, { onCancelConfirm }));
    const outer = screen.getByRole("dialog", { name: "Edit material" });
    const remove = screen.getByRole("button", { name: "Delete" });
    remove.focus();
    fireEvent.click(remove);
    const confirm = screen.getByRole("dialog", { name: "Delete it?" });
    expect(confirm.contains(document.activeElement)).toBe(true);
    expect(outer.getAttribute("aria-hidden")).toBe("true");
    expect(Number(confirm.style.zIndex)).toBeGreaterThan(Number(outer.style.zIndex));

    tab();
    tab();
    tab();
    expect(confirm.contains(document.activeElement)).toBe(true);
    escape();
    expect(onCancelConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Delete it?" })).toBeNull();
    // The outer dialog is still open, modal and focused where the user left it.
    expect(outer.hasAttribute("aria-hidden")).toBe(false);
    expect(outer.hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(remove);
    expect(excluded(document.querySelector("main")!)).toBe(true);
  });

  it("does not let a lower dialog closing first restore the background or take focus", () => {
    render(h(Layered));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog", { name: "Delete it?" });
    const focused = document.activeElement;
    // The outer dialog closes underneath (e.g. its owner finished) while confirm is on top.
    act(() => {
      // Not via a role query: the button is (correctly) excluded behind the modal.
      Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Force close outer")!.click();
    });
    expect(screen.queryByRole("dialog", { name: "Edit material" })).toBeNull();
    expect(document.activeElement).toBe(focused);
    expect(confirm.contains(document.activeElement)).toBe(true);
    expect(excluded(document.querySelector("main")!)).toBe(true);
    escape();
    expect(nothingExcluded()).toBe(true);
  });
});

describe("Dialog with native modal support", () => {
  it("uses showModal/close and adds no fallback semantics", () => {
    restore();
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
    const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
    restore = (() => {
      const previous = [
        Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"),
        Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close"),
      ];
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", { value: showModal, configurable: true, writable: true });
      Object.defineProperty(HTMLDialogElement.prototype, "close", { value: close, configurable: true, writable: true });
      return () => {
        for (const [key, descriptor] of [["showModal", previous[0]], ["close", previous[1]]] as const) {
          if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
          else delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>)[key];
        }
      };
    })();
    expect(supportsNativeModal()).toBe(true);
    const onClose = vi.fn();
    const { container, rerender } = render(h(Dialog, { open: true, onClose, title: "Native", children: h("p", null, "x") }));
    const dialog = container.querySelector("dialog")!;
    expect(showModal).toHaveBeenCalledOnce();
    expect(dialog.hasAttribute("role")).toBe(false);
    expect(dialog.classList.contains("modal-fallback")).toBe(false);
    expect(container.querySelector(".modal-fallback-backdrop")).toBeNull();
    expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(dialog.hasAttribute("open")).toBe(true);
    rerender(h(Dialog, { open: false, onClose, title: "Native", children: h("p", null, "x") }));
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("fallback modal stack (Codex A3-R1–R3 regressions)", () => {
  /** A page with sibling dialogs in a chosen DOM order, opened by name. */
  function stack(open: string[], order = ["A", "B", "C"]) {
    return h("div", null,
      h("main", null, h("button", { id: "opener", type: "button" }, "Open")),
      ...order.map((name) => h(Dialog, {
        key: name, open: open.includes(name), title: name, onClose() {},
        children: h("button", { id: `inside-${name}`, type: "button" }, `Inside ${name}`),
      })));
  }
  const box = (name: string) => screen.getByText(name, { selector: "h2" }).closest("dialog")!;
  const layer = (name: string) => Number(box(name).style.zIndex);
  const backdropBelow = (name: string) => Number((box(name).previousElementSibling as HTMLElement).style.zIndex);

  it("A3-R1: hides the previous sibling modal when a third modal opens", () => {
    const ui = render(stack(["A"]));
    ui.rerender(stack(["A", "B"]));
    ui.rerender(stack(["A", "B", "C"]));
    expect(box("C").contains(document.activeElement)).toBe(true);
    expect(box("A").getAttribute("aria-hidden")).toBe("true");
    expect(box("B").getAttribute("aria-hidden")).toBe("true");
    expect(box("B").hasAttribute("inert")).toBe(true);
    expect(box("C").hasAttribute("aria-hidden")).toBe(false);
  });

  it("A3-R1: re-exposes each lower modal as the ones above close, in reverse and out of order", () => {
    const ui = render(stack([]));
    const main = pageRegion();
    main.setAttribute("aria-hidden", "false"); // an original value to preserve
    ui.rerender(stack(["A"]));
    ui.rerender(stack(["A", "B"]));
    ui.rerender(stack(["A", "B", "C"]));
    expect(box("B").getAttribute("aria-hidden")).toBe("true");
    // Reverse order: C closes, B becomes the top and is exposed; A stays hidden.
    ui.rerender(stack(["A", "B"]));
    expect(box("B").hasAttribute("aria-hidden")).toBe(false);
    expect(box("A").getAttribute("aria-hidden")).toBe("true");
    expect(main.getAttribute("aria-hidden")).toBe("true");
    // Out of order: A closes underneath B; B stays the exposed top.
    ui.rerender(stack(["B"]));
    expect(box("B").hasAttribute("aria-hidden")).toBe(false);
    expect(main.getAttribute("aria-hidden")).toBe("true");
    ui.rerender(stack([]));
    expect(main.getAttribute("aria-hidden")).toBe("false");
    expect(document.querySelector("[inert]")).toBeNull();
    for (const name of ["A", "B", "C"]) expect(box(name).hasAttribute("aria-hidden")).toBe(false);
  });

  it("A3-R1/R4: makes a nested modal the only reachable one, excluding its parent until it closes", () => {
    // With the fallback portalled to <body>, the parent is a lower modal like
    // any other, as the native top layer would treat it.
    function Nested({ inner }: { inner: boolean }) {
      return h("div", null,
        h("main", null, h("button", { type: "button" }, "Page")),
        h(Dialog, {
          open: true, title: "Outer", onClose() {},
          children: h("div", null,
            h("button", { type: "button" }, "Outer action"),
            h(Dialog, { open: inner, title: "Inner", onClose() {}, children: h("button", { type: "button" }, "Inner action") })),
        }));
    }
    const outerAction = () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Outer action")!;
    const ui = render(h(Nested, { inner: false }));
    ui.rerender(h(Nested, { inner: true }));
    const outer = box("Outer");
    const inner = box("Inner");
    expect(inner.contains(document.activeElement)).toBe(true);
    expect(excluded(inner)).toBe(false);
    expect(excluded(outer)).toBe(true);
    expect(excluded(outerAction())).toBe(true);
    expect(excluded(document.querySelector("main")!)).toBe(true);
    ui.rerender(h(Nested, { inner: false }));
    expect(excluded(outer)).toBe(false);
    expect(excluded(outerAction())).toBe(false);
    expect(excluded(document.querySelector("main")!)).toBe(true);
  });

  it("A3-R2: gives a new top modal a higher layer after a lower modal closed", () => {
    const ui = render(stack(["A", "B"], ["A", "C", "B"]));
    ui.rerender(stack(["B"], ["A", "C", "B"]));
    ui.rerender(stack(["B", "C"], ["A", "C", "B"]));
    expect(box("C").contains(document.activeElement)).toBe(true);
    expect(layer("C")).toBeGreaterThan(layer("B"));
    expect(backdropBelow("C")).toBeGreaterThan(layer("B"));
    expect(backdropBelow("C")).toBeLessThan(layer("C"));
  });

  it("A3-R2: keeps strict paint order across reopening in every DOM order", () => {
    for (const order of [["A", "B", "C"], ["C", "B", "A"], ["B", "C", "A"]]) {
      const ui = render(stack(["A"], order));
      ui.rerender(stack(["A", "B"], order));
      ui.rerender(stack(["B"], order));
      ui.rerender(stack(["B", "C"], order));
      ui.rerender(stack(["B", "C", "A"], order));
      expect(layer("C")).toBeGreaterThan(layer("B"));
      expect(layer("A")).toBeGreaterThan(layer("C"));
      expect(backdropBelow("A")).toBeGreaterThan(layer("C"));
      expect(box("A").contains(document.activeElement)).toBe(true);
      ui.unmount();
    }
  });

  it("A3-R3: returns focus to the surviving opener when the lower modal closes first", () => {
    const ui = render(stack([]));
    const opener = document.getElementById("opener")!;
    opener.focus();
    ui.rerender(stack(["A"]));
    document.getElementById("inside-A")!.focus();
    ui.rerender(stack(["A", "B"]));
    ui.rerender(stack(["B"]));
    expect(box("B").contains(document.activeElement)).toBe(true);
    ui.rerender(stack([]));
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(opener.hasAttribute("aria-hidden")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("A3-R3: restores into the surviving lower modal, not a closed middle one", () => {
    const ui = render(stack([]));
    document.getElementById("opener")!.focus();
    ui.rerender(stack(["A"]));
    document.getElementById("inside-A")!.focus();
    ui.rerender(stack(["A", "B"]));
    document.getElementById("inside-B")!.focus();
    ui.rerender(stack(["A", "B", "C"]));
    ui.rerender(stack(["A", "C"])); // middle closes underneath C
    expect(box("C").contains(document.activeElement)).toBe(true);
    ui.rerender(stack(["A"]));
    expect(document.activeElement).toBe(document.getElementById("inside-A"));
  });

  it("A3-R3: never focuses a removed prior target; stays in the surviving modal or leaves the page", () => {
    function WithTransient({ open, showTransient }: { open: string[]; showTransient: boolean }) {
      return h("div", null,
        h("main", null, showTransient ? h("button", { id: "transient", type: "button" }, "Transient") : null),
        h(Dialog, { open: open.includes("A"), title: "A", onClose() {}, children: h("button", { type: "button" }, "In A") }));
    }
    const ui = render(h(WithTransient, { open: [], showTransient: true }));
    document.getElementById("transient")!.focus();
    ui.rerender(h(WithTransient, { open: ["A"], showTransient: true }));
    ui.rerender(h(WithTransient, { open: ["A"], showTransient: false }));
    ui.rerender(h(WithTransient, { open: [], showTransient: false }));
    expect(document.activeElement?.isConnected).toBe(true);
    expect(document.activeElement).toBe(document.body);
  });
});

describe("nested fallback dialog lifetime (Codex A3-R4)", () => {
  function nested(outer: boolean, inner: boolean, innerProps: Record<string, unknown> = {}) {
    return h("div", null,
      h("main", null, h("button", { id: "page-opener", type: "button" }, "Page")),
      h(Dialog, {
        open: outer, title: "Outer", onClose() {},
        children: h("div", null,
          h("button", { id: "outer-action", type: "button" }, "Outer action"),
          h(Dialog, { open: inner, title: "Inner", onClose() {}, ...innerProps, children: h("button", { type: "button" }, "Inner action") })),
      }));
  }
  const box = (name: string) => screen.getByText(name, { selector: "h2" }).closest("dialog")!;

  it("A3-R4: keeps an open nested modal outside closed ancestors when its parent closes first", () => {
    const ui = render(nested(true, false));
    ui.rerender(nested(true, true));
    expect(box("Inner").contains(document.activeElement)).toBe(true);
    ui.rerender(nested(false, true));
    expect(box("Inner").hasAttribute("open")).toBe(true);
    expect(box("Inner").parentElement!.closest("dialog:not([open])")).toBeNull();
  });

  it("A3-R4: presents the still-open child and its backdrop at viewport level, above the parent", () => {
    const ui = render(nested(true, false));
    ui.rerender(nested(true, true));
    ui.rerender(nested(false, true));
    const inner = box("Inner");
    const backdrop = inner.previousElementSibling as HTMLElement;
    expect(backdrop.classList.contains("modal-fallback-backdrop")).toBe(true);
    // Both are direct children of <body>, so no closed, hidden or transformed dialog contains them.
    expect(inner.parentElement).toBe(document.body);
    expect(backdrop.parentElement).toBe(document.body);
    expect(inner.closest("[aria-hidden='true'], [inert], [hidden]")).toBeNull();
    expect(box("Outer").hasAttribute("open")).toBe(false);
    expect(Number(backdrop.style.zIndex)).toBeLessThan(Number(inner.style.zIndex));
    expect(document.querySelector("main")!.closest("[aria-hidden='true'][inert]")).not.toBeNull();
    expect(inner.contains(document.activeElement)).toBe(true);
  });

  it("A3-R4: sends Escape and backdrop requests only to the open child's owner", () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    const tree = (outer: boolean, inner: boolean) => h("div", null,
      h("main", null, h("button", { type: "button" }, "Page")),
      h(Dialog, {
        open: outer, title: "Outer", onClose: outerClose,
        children: h(Dialog, { open: inner, title: "Inner", onClose: innerClose, children: h("button", { type: "button" }, "Inner action") }),
      }));
    const ui = render(tree(true, false));
    ui.rerender(tree(true, true));
    ui.rerender(tree(false, true));
    escape();
    fireEvent.click(box("Inner").previousElementSibling!);
    expect(innerClose).toHaveBeenCalledTimes(2);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it("A3-R4: keeps a refusing child visible and modal after its parent closes", () => {
    const ui = render(nested(true, false, { dismissible: false }));
    ui.rerender(nested(true, true, { dismissible: false }));
    ui.rerender(nested(false, true, { dismissible: false }));
    escape();
    fireEvent.click(box("Inner").previousElementSibling!);
    const inner = box("Inner");
    expect(inner.hasAttribute("open")).toBe(true);
    expect(inner.getAttribute("aria-modal")).toBe("true");
    expect(inner.parentElement!.closest("dialog:not([open])")).toBeNull();
    screen.getByRole("button", { name: "Inner action" }).focus();
    tab();
    expect(inner.contains(document.activeElement)).toBe(true);
    expect(document.querySelector("main")!.closest("[aria-hidden='true'][inert]")).not.toBeNull();
  });

  it("A3-R4: returns focus to the page opener and clears exclusion when the child finally closes", () => {
    const ui = render(nested(false, false));
    const opener = document.getElementById("page-opener")!;
    opener.focus();
    ui.rerender(nested(true, false));
    document.getElementById("outer-action")!.focus();
    ui.rerender(nested(true, true));
    ui.rerender(nested(false, true));
    ui.rerender(nested(false, false));
    expect(document.activeElement).toBe(opener);
    expect(nothingExcluded()).toBe(true);
    expect(document.querySelector(".modal-fallback-backdrop")).toBeNull();
    // Reopening both works normally afterwards.
    ui.rerender(nested(true, false));
    ui.rerender(nested(true, true));
    expect(box("Inner").contains(document.activeElement)).toBe(true);
    expect(excluded(box("Outer"))).toBe(true);
  });

  it("A3-R4: cleans up when the whole tree unmounts with the child open", () => {
    const onClose = vi.fn();
    const tree = (outer: boolean) => h("div", null,
      h("main", null, h("button", { type: "button" }, "Page")),
      h(Dialog, {
        open: outer, title: "Outer", onClose() {},
        children: h(Dialog, { open: true, title: "Inner", onClose, children: h("button", { type: "button" }, "Inner action") }),
      }));
    const ui = render(tree(true));
    ui.rerender(tree(false));
    ui.unmount();
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.querySelector("[inert], .modal-fallback-backdrop")).toBeNull();
    escape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("A3-R4: behaves the same under StrictMode", () => {
    const strict = (outer: boolean, inner: boolean) => h(StrictMode, null, nested(outer, inner));
    const ui = render(strict(false, false));
    const opener = document.getElementById("page-opener")!;
    opener.focus();
    ui.rerender(strict(true, false));
    ui.rerender(strict(true, true));
    ui.rerender(strict(false, true));
    const inner = box("Inner");
    expect(inner.hasAttribute("open")).toBe(true);
    expect(inner.parentElement).toBe(document.body);
    expect(document.querySelectorAll(".modal-fallback-backdrop")).toHaveLength(1);
    ui.rerender(strict(false, false));
    expect(nothingExcluded()).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it("A3-R4: renders inline, without a portal, when rendered on a server", () => {
    const html = renderToStaticMarkup(h(Dialog, { open: true, title: "Server", onClose() {}, children: h("p", null, "x") }));
    expect(html).toContain("<dialog");
    expect(html).toContain("Server");
  });
});
