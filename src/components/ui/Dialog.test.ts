// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Dialog } from "./Dialog";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(cleanup);

it("keeps a running task's dialog open when Escape, backdrop, or Close is used", () => {
  const onClose = vi.fn();
  const { container } = render(h(Dialog, {
    open: true,
    dismissible: false,
    onClose,
    title: "Creating parts",
    children: h("p", null, "Working"),
  }));
  const dialog = container.querySelector("dialog")!;

  expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(false);
  fireEvent.click(dialog);
  expect(screen.getByRole("button", { name: "Close" }).hasAttribute("disabled")).toBe(true);
  expect(dialog.open).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
});

it("allows the same dialog to close after the task finishes", () => {
  const onClose = vi.fn();
  const { container, rerender } = render(h(Dialog, {
    open: true,
    dismissible: false,
    onClose,
    title: "Creating parts",
    children: h("p", null, "Working"),
  }));
  rerender(h(Dialog, {
    open: true,
    dismissible: true,
    onClose,
    title: "Creating parts",
    children: h("p", null, "Done"),
  }));
  fireEvent.click(container.querySelector("dialog")!);
  expect(onClose).toHaveBeenCalledOnce();
});

it("keeps Escape open until the owner finishes asynchronous cleanup", () => {
  const onClose = vi.fn();
  const { container } = render(h(Dialog, {
    open: true,
    onClose,
    title: "Add material",
    children: h("p", null, "Draft"),
  }));
  const dialog = container.querySelector("dialog")!;
  expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(false);
  expect(onClose).toHaveBeenCalledOnce();
  expect(dialog.open).toBe(true);
});

it("closes only the top dialog when Escape is pressed in a nested dialog", () => {
  const outerClose = vi.fn();
  const innerClose = vi.fn();
  render(h(Dialog, {
    open: true,
    onClose: outerClose,
    title: "Practice tests",
    children: h(Dialog, { open: true, onClose: innerClose, title: "Practice by checkride topic", children: h("p", null, "Topics") }),
  }));
  const inner = screen.getByRole("heading", { name: "Practice by checkride topic" }).closest("dialog")!;

  fireEvent(inner, new Event("cancel", { cancelable: true }));
  expect(innerClose).toHaveBeenCalledTimes(1);
  expect(outerClose).not.toHaveBeenCalled();
});

function scrollableDialog() {
  const view = render(h(Dialog, {
    open: true,
    onClose: vi.fn(),
    title: "Long",
    footer: h("button", null, "Done"),
    children: h("textarea", { "aria-label": "Notes" }),
  }));
  const body = view.container.querySelector<HTMLElement>(".dialog__body")!;
  Object.defineProperty(body, "clientHeight", { value: 100, configurable: true });
  Object.defineProperty(body, "scrollHeight", { value: 1000, configurable: true });
  return body;
}

it("scrolls the dialog body on PageDown, PageUp, Home and End from a footer button", () => {
  const body = scrollableDialog();
  const done = screen.getByRole("button", { name: "Done" });
  expect(fireEvent.keyDown(done, { key: "PageDown" })).toBe(false);
  expect(body.scrollTop).toBe(90);
  fireEvent.keyDown(done, { key: "PageUp" });
  expect(body.scrollTop).toBe(0);
  fireEvent.keyDown(done, { key: "End" });
  expect(body.scrollTop).toBe(900);
  fireEvent.keyDown(done, { key: "Home" });
  expect(body.scrollTop).toBe(0);
});

it("leaves paging keys alone in a text field", () => {
  const body = scrollableDialog();
  expect(fireEvent.keyDown(screen.getByLabelText("Notes"), { key: "PageDown" })).toBe(true);
  expect(body.scrollTop).toBe(0);
});
