// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { AI_ILLUSTRATION_LABEL, diagramSourceLine, diagramsForTopic } from "@/logic/diagrams";
import { DiagramsStrip } from "./DiagramsStrip";
import { DiagramsView } from "./DiagramsView";

afterEach(cleanup);
const inRouter = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

it("shows the strip for a topic with diagrams and opens one large", async () => {
  inRouter(<DiagramsStrip topic="weather" />);
  expect(screen.getByRole("heading", { name: "Diagrams for Weather" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "All diagrams" }).getAttribute("href")).toBe("/study?tab=diagrams&topic=weather");
  const first = diagramsForTopic("weather")[0]!;
  fireEvent.click(screen.getByRole("button", { name: first.title }));
  const dialog = await screen.findByRole("dialog", { name: first.title, hidden: true });
  await waitFor(() => expect(dialog.querySelector("svg")).toBeTruthy());
  expect(dialog.textContent).toContain("Drawn from the FAA Pilot's Handbook (PHAK)");
});

it("shows nothing for General, which has no diagrams", () => {
  const general = inRouter(<DiagramsStrip topic="general" />);
  expect(general.container.textContent).toBe("");
});

it("lists diagrams by topic in the Diagrams tab and opens the topic from the address", async () => {
  inRouter(<DiagramsView topic="navigation" />);
  expect(screen.getByText(/^Weather \(\d+\)$/)).toBeTruthy();
  const nav = diagramsForTopic("navigation");
  expect(screen.getByText(`Navigation (${nav.length})`)).toBeTruthy();
  expect(screen.getByRole("button", { name: nav[0]!.title })).toBeTruthy();
});

it("labels the AI-made picture in its tile, its alt text and the large viewer, and leaves SVG tiles alone", async () => {
  inRouter(<DiagramsStrip topic="airports" />);
  const photo = diagramsForTopic("airports").find((d) => d.kind === "photo")!;
  const tile = screen.getByRole("button", { name: new RegExp(photo.title) });
  expect(tile.textContent).toContain(AI_ILLUSTRATION_LABEL);
  await waitFor(() => expect(tile.querySelector("img")).toBeTruthy());
  expect(tile.querySelector("img")!.getAttribute("alt")).toContain(AI_ILLUSTRATION_LABEL);
  const svgTile = screen.getByRole("button", { name: "Two-bar VASI" });
  expect(svgTile.textContent).not.toContain("AI-made");
  expect(svgTile.querySelector("img")).toBeNull();
  fireEvent.click(tile);
  const dialog = await screen.findByRole("dialog", { name: photo.title, hidden: true });
  await waitFor(() => expect(dialog.querySelector("img")).toBeTruthy());
  expect(dialog.textContent).toContain(AI_ILLUSTRATION_LABEL);
  expect(dialog.querySelector("img")!.getAttribute("alt")).toContain(AI_ILLUSTRATION_LABEL);
});

it("opens a diagram on one click or Enter, even right after focus was elsewhere and the tile art finished loading", async () => {
  inRouter(<><button type="button">Other</button><DiagramsView topic="weather" /></>);
  const first = diagramsForTopic("weather")[0]!;
  const other = screen.getByRole("button", { name: "Other" });
  other.focus();
  expect(document.activeElement).toBe(other);
  const tile = screen.getByRole("button", { name: first.title });
  fireEvent.mouseDown(tile);
  fireEvent.click(tile);
  expect(await screen.findByRole("dialog", { name: first.title, hidden: true })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Zoom in", hidden: true })).toBeTruthy();
  const dialog = screen.getByRole("dialog", { name: first.title, hidden: true });
  const source = dialog.querySelector(".diagram-zoom-bar .diagram-source")!;
  expect(source.textContent).toBe(diagramSourceLine(first));
  expect(source.compareDocumentPosition(dialog.querySelector(".diagram-stage")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
