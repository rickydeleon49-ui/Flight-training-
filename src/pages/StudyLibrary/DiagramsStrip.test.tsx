// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { diagramsForTopic } from "@/logic/diagrams";
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

it("shows nothing for a topic without diagrams, and for General", () => {
  const none = inRouter(<DiagramsStrip topic="landings" />);
  expect(none.container.textContent).toBe("");
  cleanup();
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
