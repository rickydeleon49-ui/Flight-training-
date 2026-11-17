// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";

import { figureCredit, getFigure } from "@/logic/figures";
import { FigureViewer } from "./FigureViewer";

const figure = getFigure("faa-49")!;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(cleanup);

it("shows the image with alt text, size attributes, lazy loading and the credit", () => {
  render(h(FigureViewer, { figure }));
  const img = screen.getByRole("img", { name: figure.alt }) as HTMLImageElement;
  expect(img.getAttribute("width")).toBe(String(figure.width));
  expect(img.getAttribute("height")).toBe(String(figure.height));
  expect(img.getAttribute("loading")).toBe("lazy");
  expect(img.getAttribute("decoding")).toBe("async");
  expect(screen.getByText(figureCredit(figure))).toBeTruthy();
  expect(screen.getByText("Practice, not for flight")).toBeTruthy();
});

it("zooms in 25% steps between 100 and 400, and Fit resets", () => {
  render(h(FigureViewer, { figure }));
  const label = () => screen.getByTestId("figure-zoom-label").textContent;
  expect(label()).toBe("100%");
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(label()).toBe("125%");
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  expect(label()).toBe("125%");
  for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(label()).toBe("400%");
  fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  expect(label()).toBe("100%");
  fireEvent.keyDown(screen.getByRole("region"), { key: "+" });
  expect(label()).toBe("125%");
  fireEvent.keyDown(screen.getByRole("region"), { key: "-" });
  expect(label()).toBe("100%");
});

it("opens full screen in a dialog and closes it with Escape", () => {
  const { container } = render(h(FigureViewer, { figure }));
  expect(container.querySelector("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
  const dialog = document.querySelector("dialog")!;
  expect(dialog).toBeTruthy();
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(document.querySelector("dialog")).toBeNull();
});
