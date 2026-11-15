// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { diagramsForTopic } from "@/logic/diagrams";
import { DiagramsStrip } from "./DiagramsStrip";

// jsdom has no layout: the stage reports a fixed 1000 x 500 box. Fit = min(1000/730, 500/430) = 1.1628.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openFirst() {
  render(<MemoryRouter><DiagramsStrip topic="weather" /></MemoryRouter>);
  const first = diagramsForTopic("weather")[0]!;
  fireEvent.click(screen.getByRole("button", { name: new RegExp(first.title) }));
  const dialog = await screen.findByRole("dialog", { name: first.title, hidden: true });
  await waitFor(() => expect(dialog.querySelector("svg")).toBeTruthy());
  return dialog;
}
const label = () => screen.getByTestId("diagram-zoom-label").textContent;
const inner = (dialog: HTMLElement) => dialog.querySelector<HTMLElement>(".diagram-stage__inner")!;
const btn = (name: string) => screen.getByRole("button", { name, hidden: true });

it("shows a Tap to enlarge hint on each inline diagram tile", () => {
  render(<MemoryRouter><DiagramsStrip topic="weather" /></MemoryRouter>);
  const first = diagramsForTopic("weather")[0]!;
  expect(screen.getByRole("button", { name: new RegExp(first.title) }).textContent).toContain("Tap to enlarge");
});

it("opens fitted to the window with the helper line and labelled header buttons", async () => {
  const dialog = await openFirst();
  expect(label()).toBe("Fit");
  expect(inner(dialog).style.width).toBe(`${Math.round(730 * (500 / 430))}px`);
  expect(dialog.textContent).toContain("Whole diagram fits the window. Use + or pinch to zoom; drag to move around when zoomed.");
  for (const name of ["Zoom out", "Zoom in", "Actual size", "Close"]) expect(btn(name)).toBeTruthy();
});

it("zoom buttons step in 25% and clamp back to Fit; Actual size goes to 100%", async () => {
  const dialog = await openFirst();
  fireEvent.click(btn("Zoom in"));
  expect(label()).toBe("125%");
  expect(inner(dialog).style.width).toBe("913px");
  fireEvent.click(btn("Zoom out"));
  expect(label()).toBe("Fit");
  fireEvent.click(btn("Zoom out"));
  expect(label()).toBe("Fit");
  fireEvent.click(btn("Actual size"));
  expect(label()).toBe("Fit"); // 100% is below this window's fit scale, so it stays Fit
});

it("+, - and 0 keys zoom and reset", async () => {
  await openFirst();
  fireEvent.keyDown(document, { key: "+" });
  expect(label()).toBe("125%");
  fireEvent.keyDown(document, { key: "+" });
  expect(label()).toBe("150%");
  fireEvent.keyDown(document, { key: "-" });
  expect(label()).toBe("125%");
  fireEvent.keyDown(document, { key: "0" });
  expect(label()).toBe("Fit");
});

it("ctrl + wheel zooms and the zoomed view becomes a scrollable region", async () => {
  const dialog = await openFirst();
  const scroller = dialog.querySelector(".diagram-stage__scroll")!;
  fireEvent.wheel(scroller, { ctrlKey: true, deltaY: -30 });
  expect(label()).not.toBe("Fit");
  expect(screen.getByRole("region", { name: "Zoomed diagram, scrollable", hidden: true })).toBeTruthy();
});
