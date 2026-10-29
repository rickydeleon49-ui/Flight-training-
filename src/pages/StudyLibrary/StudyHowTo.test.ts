// @vitest-environment jsdom
/**
 * STUDY-HOWTO-01: the general PDF how-to lives in a Study Library "How to"
 * tab next to History; a material page shows one quiet link to it instead of
 * the old Start here panel. Real router, AppDataProvider and a disposable
 * node:sqlite database; no provider or network.
 */
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import * as documents from "@/services/documents";
import * as gemini from "@/services/gemini";
import * as offline from "@/services/offlineContent";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

import { MaterialDetail } from "./MaterialDetail";
import { STUDY_LIBRARY_TOUR } from "./StudyHowTo";
import { StudyLibrary, libraryTabFrom } from "./StudyLibrary";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

let location: ReturnType<typeof useLocation>;
function Probe() {
  location = useLocation();
  return null;
}
function Ready() {
  const { status } = useAppData();
  return status === "ready" ? h(Routes, null,
    h(Route, { path: "/study", element: h(StudyLibrary) }),
    h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }),
  ) : null;
}
const renderAt = (path: string) => render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Probe), h(Ready))));

const STEP_TITLES = ["Choose a study-size PDF", "Create a study guide", "Create flashcards", "Try a practice test (optional)", "Review and save"];

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  const repos = createRepositories(db);
  await repos.app.set("airline_starter_pack", "skipped-for-test");
  await repos.documents.create({ id: "howto-pdf", title: "Synthetic PDF", filePath: "documents/synthetic.pdf", originalFileName: "synthetic.pdf", fileSize: 2048 });
  vi.spyOn(documents, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documents, "documentExists").mockResolvedValue(true);
  vi.spyOn(offline, "offlineStudyEnabled").mockReturnValue(true);
  vi.spyOn(offline, "offlineContentReadiness").mockResolvedValue([{ materialId: "howto-pdf", readiness: { state: "notPrepared" } }]);
  vi.spyOn(gemini, "getGeminiStatus").mockResolvedValue({ configured: false, model: "gemini-3.5-flash", choice: "standard" });
  vi.spyOn(gemini, "watchGeminiProgress").mockResolvedValue(() => {});
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

it("reads ?tab=howto as the How to tab", () => {
  expect(libraryTabFrom(new URLSearchParams("tab=howto"))).toBe("howto");
});

it("puts How to after History and shows the five general steps from a deep link", async () => {
  renderAt("/study?tab=howto");
  const tab = await screen.findByRole("tab", { name: "How to", selected: true });
  const tabs = screen.getAllByRole("tab").map(node => node.textContent);
  expect(tabs).toEqual(["Library", "Review due", "History", "How to"]);
  const panel = screen.getByRole("tabpanel");
  expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
  const steps = within(panel).getByRole("list", { name: "PDF study steps" });
  const items = within(steps).getAllByRole("listitem");
  expect(items).toHaveLength(5);
  STEP_TITLES.forEach((title, index) => expect(items[index]!.textContent).toContain(title));
  expect(within(panel).getByText(/No internet\?/).textContent).toContain("on-Mac study kit");
  expect(within(panel).getByText(/Read this PDF's text/)).toBeTruthy();
  // Generic: no per-material status and no buttons that need a material.
  expect(within(panel).queryByRole("button")).toBeNull();
  expect(within(panel).queryByText(/Do this next|Done|When you're ready/)).toBeNull();
});

it("reaches How to by keyboard from the History tab and records it in the address", async () => {
  renderAt("/study?tab=history");
  const howTo = await screen.findByRole("tab", { name: "How to" });
  expect(howTo.tagName).toBe("BUTTON");
  howTo.focus();
  expect(document.activeElement).toBe(howTo);
  fireEvent.click(howTo); // Enter/Space on a focused button activates it.
  expect(location.search).toBe("?tab=howto");
  expect(await screen.findByRole("list", { name: "PDF study steps" })).toBeTruthy();
});

it("replaces the Start here panel on a PDF page with one link line to How to", async () => {
  renderAt("/study/howto-pdf");
  await screen.findByRole("heading", { name: "Personal notes" });
  expect(screen.queryByRole("heading", { name: "Start here" })).toBeNull();
  expect(screen.queryByRole("list", { name: "PDF study steps" })).toBeNull();
  expect(screen.queryByText(/one step at a time/i)).toBeNull();
  const line = document.getElementById("material-start-here")!;
  expect(line.textContent).toBe("New to this? See How to in Study Library.");
  const link = within(line).getByRole("link", { name: "How to in Study Library" });
  expect(link.getAttribute("href")).toBe("/study?tab=howto");
  // Existing anchors on the page still exist.
  for (const id of ["material-file-actions", "material-study-guide", "material-flashcards", "material-practice-test", "material-mac-backup", "read-pdf-text"]) {
    await waitFor(() => expect(document.getElementById(id)).toBeTruthy());
  }
  fireEvent.click(link);
  expect(location.pathname).toBe("/study");
  expect(location.search).toBe("?tab=howto");
  expect(await screen.findByRole("tab", { name: "How to", selected: true })).toBeTruthy();
});

it("keeps the Hide section tips preference working on a PDF page, hiding the link line too", async () => {
  const view = renderAt("/study/howto-pdf");
  await screen.findByRole("heading", { name: "Personal notes" });
  fireEvent.click(screen.getByRole("button", { name: "Hide section tips" }));
  expect(screen.queryByRole("link", { name: "How to in Study Library" })).toBeNull();
  expect(localStorage.getItem("hfd:material-start-here:hidden")).toBe("1");
  view.unmount();
  renderAt("/study/howto-pdf");
  await screen.findByRole("heading", { name: "Personal notes" });
  fireEvent.click(screen.getByRole("button", { name: "Show section tips" }));
  expect(screen.getByRole("link", { name: "How to in Study Library" })).toBeTruthy();
});

it("shows Getting around the Study Library after the steps, one line per real control", async () => {
  renderAt("/study?tab=howto");
  const panel = await screen.findByRole("tabpanel");
  const tour = within(panel).getByRole("heading", { name: "Getting around the Study Library" });
  const steps = within(panel).getByRole("list", { name: "PDF study steps" });
  expect(steps.compareDocumentPosition(tour) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  for (const group of STUDY_LIBRARY_TOUR) {
    const list = within(panel).getByRole("list", { name: group.title });
    expect(within(list).getAllByRole("listitem").map(item => item.textContent)).toEqual(group.items.map(item => `${item.label} — ${item.text}`));
    expect(within(list).queryByRole("link")).toBeNull();
  }
});

it("names only controls that exist in the Study Library, so the tour can't drift", async () => {
  renderAt("/study");
  await screen.findByRole("tab", { name: "Library", selected: true });
  await screen.findByRole("button", { name: "Everything" });
  const find = (label: string, control: string) => {
    switch (control) {
      case "tab": return screen.getByRole("tab", { name: label });
      case "link": return screen.getByRole("link", { name: label });
      case "button": return screen.getByRole("button", { name: label });
      case "field": return screen.getByLabelText(label);
      case "disclosure": return screen.getByText(label, { selector: "summary" });
      default: return screen.getByRole("heading", { name: label });
    }
  };
  const items = STUDY_LIBRARY_TOUR.flatMap(group => group.items);
  expect(items.length).toBeGreaterThanOrEqual(20);
  for (const item of items) expect(find(item.label, item.control), item.label).toBeTruthy();
});
