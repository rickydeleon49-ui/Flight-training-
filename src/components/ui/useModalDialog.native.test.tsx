// @vitest-environment jsdom
/** Native modal path of useModalDialog and Dialog: focus return, name, Escape. */
import { createElement as h, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "./Dialog";
import { supportsNativeModal } from "./useModalDialog";

const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
const saved: Record<string, PropertyDescriptor | undefined> = {};

beforeEach(() => {
  for (const key of ["showModal", "close"]) saved[key] = Object.getOwnPropertyDescriptor(proto, key);
  Object.defineProperty(proto, "showModal", {
    configurable: true, writable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
      // A real engine moves focus to the first control.
      this.querySelector<HTMLElement>("button, input")?.focus();
    },
  });
  // Simulates an engine that does NOT return focus on close.
  Object.defineProperty(proto, "close", {
    configurable: true, writable: true,
    value(this: HTMLDialogElement) { this.removeAttribute("open"); (document.activeElement as HTMLElement | null)?.blur(); },
  });
});
afterEach(() => {
  cleanup();
  for (const key of ["showModal", "close"]) {
    if (saved[key]) Object.defineProperty(proto, key, saved[key]!);
    else delete proto[key];
  }
});

function Page() {
  const [open, setOpen] = useState(false);
  return h("div", null,
    h("button", { type: "button", onClick: () => setOpen(true) }, "Opener"),
    h(Dialog, { open, onClose: () => setOpen(false), title: "Sample", children: h("input", { "aria-label": "Field" }) }));
}

describe("native modal path", () => {
  it("is in use, names the dialog, focuses inside, closes on cancel and returns focus", () => {
    expect(supportsNativeModal()).toBe(true);
    render(h(Page));
    const opener = screen.getByText("Opener");
    opener.focus();
    fireEvent.click(opener);
    const dialog = document.querySelector("dialog")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBe(screen.getByText("Sample", { selector: "h2" }).id);
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("does not steal focus that moved somewhere deliberate", () => {
    const onClose = vi.fn();
    const { rerender } = render(h("div", null, h("button", { id: "a" }, "a"), h("button", { id: "b" }, "b"),
      h(Dialog, { open: false, onClose, title: "T", children: h("input", { "aria-label": "F" }) })));
    document.getElementById("a")!.focus();
    rerender(h("div", null, h("button", { id: "a" }, "a"), h("button", { id: "b" }, "b"),
      h(Dialog, { open: true, onClose, title: "T", children: h("input", { "aria-label": "F" }) })));
    rerender(h("div", null, h("button", { id: "a" }, "a"), h("button", { id: "b" }, "b"),
      h(Dialog, { open: false, onClose, title: "T", children: h("input", { "aria-label": "F" }) })));
    expect(document.activeElement).toBe(document.getElementById("a"));
  });
});
