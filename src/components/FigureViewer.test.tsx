// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

it("uses the src override when given", () => {
  render(h(FigureViewer, { figure, src: "data:image/webp;base64,AAAA" }));
  expect((screen.getByRole("img", { name: figure.alt }) as HTMLImageElement).getAttribute("src")).toBe("data:image/webp;base64,AAAA");
});

it("keeps the default layout unless questionFirst is set", () => {
  const { container, rerender } = render(h(FigureViewer, { figure }));
  expect(container.querySelector(".figure-view--question-first")).toBeNull();
  rerender(h(FigureViewer, { figure, questionFirst: true }));
  expect(container.querySelector(".figure-view--question-first")).toBeTruthy();
});

it("caps the pinned question so the Ruler bar stays reachable on a phone", () => {
  const css = readFileSync(resolve(__dirname, "FigureViewer.css"), "utf8");
  const rule = css.match(/\.figure-run--question-first \.figure-run__question \{[^}]*max-height: (\d+)dvh/);
  expect(rule).toBeTruthy();
  expect(Number(rule![1])).toBeLessThanOrEqual(40);
});

it("shows a Ruler toggle only for figures with a scale", () => {
  render(h(FigureViewer, { figure }));
  expect(screen.queryByRole("button", { name: "Ruler" })).toBeNull();
  cleanup();
  render(h(FigureViewer, { figure: { ...figure, pxPerNm: 20 } }));
  expect(screen.getByRole("button", { name: "Ruler" })).toBeTruthy();
  expect(screen.queryByTestId("figure-ruler")).toBeNull();
});

it("ruler ends stay put at 100% and 300% zoom, keys move them, and the readout updates", () => {
  const fig = { ...figure, width: 900, height: 600, pxPerNm: 30 };
  render(h(FigureViewer, { figure: fig }));
  fireEvent.click(screen.getByRole("button", { name: "Ruler" }));
  const end = () => screen.getByRole("slider", { name: "Ruler end" });
  const pos = () => [end().getAttribute("cx"), end().getAttribute("cy")];
  expect(pos()).toEqual(["600", "300"]);
  expect(screen.getByTestId("figure-ruler-readout").textContent).toContain("10.0 NM (11.5 SM)");
  for (let i = 0; i < 8; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByTestId("figure-zoom-label").textContent).toBe("300%");
  expect(pos()).toEqual(["600", "300"]);
  fireEvent.keyDown(end(), { key: "ArrowRight", shiftKey: true });
  expect(pos()).toEqual(["630", "300"]);
  fireEvent.keyDown(end(), { key: "ArrowDown" });
  expect(pos()).toEqual(["630", "306"]);
  expect(screen.getByTestId("figure-ruler-readout").textContent).toContain("11.0 NM");
  fireEvent.click(screen.getByRole("button", { name: "Ruler" }));
  expect(screen.queryByTestId("figure-ruler")).toBeNull();
});

it("dragging an end maps the pointer to the same image point at 100% and 300%", () => {
  const fig = { ...figure, width: 900, height: 600, pxPerNm: 30 };
  render(h(FigureViewer, { figure: fig }));
  fireEvent.click(screen.getByRole("button", { name: "Ruler" }));
  const end = () => screen.getByRole("slider", { name: "Ruler start" });
  const svg = screen.getByTestId("figure-ruler");
  for (const scale of [1, 3]) {
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300 * scale, height: 200 * scale, right: 300 * scale, bottom: 200 * scale, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    (end() as unknown as SVGElement).setPointerCapture = () => {};
    (end() as unknown as SVGElement).hasPointerCapture = () => true;
    fireEvent.pointerDown(end(), { button: 0, pointerId: 1 });
    fireEvent.pointerMove(end(), { pointerId: 1, clientX: 60 * scale, clientY: 40 * scale });
    expect([end().getAttribute("cx"), end().getAttribute("cy")]).toEqual(["180", "120"]);
  }
});
