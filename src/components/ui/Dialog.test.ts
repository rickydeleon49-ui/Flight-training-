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
