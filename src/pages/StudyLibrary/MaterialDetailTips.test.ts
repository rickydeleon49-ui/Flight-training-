// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as documents from "@/services/documents";
import * as gemini from "@/services/gemini";
import * as pdf from "@/services/pdf";
import * as offline from "@/services/offlineContent";
import { MaterialDetail } from "./MaterialDetail";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
let context: ReturnType<typeof useAppData>;
function Ready() {
  context = useAppData();
  return context.status === "ready" ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) })) : null;
}
beforeEach(async () => {
  localStorage.clear(); db = await createNodeSqliteDatabase();
  await createRepositories(db).documents.create({ id: "tips", title: "Synthetic PDF", filePath: "documents/synthetic.pdf", originalFileName: "synthetic.pdf", fileSize: 2048 });
  vi.spyOn(documents, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documents, "documentExists").mockResolvedValue(true);
  vi.spyOn(pdf, "canSplitPdfs").mockReturnValue(true);
  vi.spyOn(offline, "offlineStudyEnabled").mockReturnValue(true);
  vi.spyOn(offline, "offlineContentReadiness").mockResolvedValue([{ materialId: "tips", readiness: { state: "notPrepared" } }]);
  vi.spyOn(gemini, "getGeminiStatus").mockResolvedValue({ configured: false, model: "gemini-3.5-flash", choice: "standard" });
  vi.spyOn(gemini, "watchGeminiProgress").mockResolvedValue(() => {});
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

it("places Start here first, connects its destinations, and explains file, page and review actions", async () => {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/study/tips"] }, h(Ready))));
  await screen.findByRole("heading", { name: "Start here" });
  await waitFor(() => expect(context.repositories).toBeTruthy());
  // The page chooser uses the same navigation repository in desktop mode;
  // only its capability is enabled here. No file is opened or inspected.
  vi.spyOn(context.repositories!.navigation, "canCheckFiles").mockReturnValue(true);
  // Trigger a normal app reload to render the desktop page controls.
  await context.mutate(repos => repos.documents.update("tips", { notes: "Synthetic note" }));
  expect(screen.getByRole("heading", { name: "Start here" }).closest(".detail__column")?.firstElementChild?.textContent).toContain("Start here");
  for (const id of ["material-file-actions", "material-offline-study", "material-pdf-kit", "material-study-guide"]) {
    expect(document.getElementById(id)).toBeTruthy();
  }
  expect(screen.getByText("Makes parts of up to 50 MB; each becomes its own library item. Your original stays as it is.")).toBeTruthy();
  expect(screen.getByText("Choose a page range, like 12–40, to make a smaller copy.")).toBeTruthy();
  expect(screen.getByText("Opens the PDF in your Mac's PDF app. In Preview, press ⌥⌘G to go to a page.")).toBeTruthy();
  expect(await screen.findByText("Check pages counts this PDF's pages and checks whether the file has changed.")).toBeTruthy();
  // "Open at page" was removed (owner, 22 October): no trace of it or its tip.
  expect(screen.queryByText(/Open at page/)).toBeNull();
  expect(screen.getByText("Save a named place so you can return to it later without remembering the page number.")).toBeTruthy();
  expect(screen.getByText("Needs Review and Studying make this material eligible for suggestions in Today's Flight Plan.")).toBeTruthy();
  expect(screen.getByText("Records today's date as your last review. Choose your review status separately.")).toBeTruthy();
});


async function openPage() {
  const view = render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/study/tips"] }, h(Ready))));
  await screen.findByRole("heading", { name: "Personal notes" });
  return view;
}

it("keeps Delete apart from Edit at the end of the material header and still confirms", async () => {
  await openPage();
  const edit = screen.getByRole("button", { name: "Edit" });
  const remove = screen.getByRole("button", { name: "Delete" });
  expect(edit.nextElementSibling).toBe(remove);
  expect(remove.parentElement?.lastElementChild).toBe(remove);
  expect(remove.classList.contains("destructive-action")).toBe(true);
  expect(remove.classList.contains("button--danger")).toBe(true);
  expect(screen.queryByRole("button", { name: "Del" })).toBeNull();
  fireEvent.click(remove);
  const dialog = await screen.findByRole("dialog", { name: "Delete this material?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(context.data.materials.some(material => material.id === "tips")).toBe(true);
});

it("jumps from right after Ask about this PDF to each present heading with focus, even with tips hidden", async () => {
  await openPage();
  const jumps = screen.getByRole("navigation", { name: "Jump to" });
  expect(document.getElementById("material-ask-gemini")?.nextElementSibling).toBe(jumps);
  const destinations = [
    ["Study guide", "Study guide"],
    ["Flashcards", "Flashcards"],
    ["Practice test", "Practice test"],
    ["Backup on this Mac", "On this Mac (backup)"],
  ];
  expect(within(jumps).getAllByRole("button").map(button => button.textContent)).toEqual(destinations.map(([label]) => label));
  fireEvent.click(screen.getByRole("button", { name: "Hide tips" }));
  expect(screen.getByRole("button", { name: "Split automatically" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Take out a chapter" })).toBeTruthy();
  for (const [label, title] of destinations) {
    const heading = screen.getByRole("heading", { name: title });
    const scroll = vi.fn();
    heading.scrollIntoView = scroll;
    const button = within(jumps).getByRole("button", { name: label });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(document.activeElement).toBe(heading);
    expect(heading.tabIndex).toBe(-1);
    expect(heading.classList.contains("section-jump-target")).toBe(true);
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "start" });
  }
});

it("only offers jumps to sections present on a PDF whose file has been detached", async () => {
  await createRepositories(db).documents.update("tips", { filePath: null });
  await openPage();
  const jumps = screen.getByRole("navigation", { name: "Jump to" });
  expect(within(jumps).getAllByRole("button").map(button => button.textContent)).toEqual(["Practice test"]);
  fireEvent.click(within(jumps).getByRole("button", { name: "Practice test" }));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Practice test" }));
});

it("orders the PDF workflow with both backup panels together at the bottom", async () => {
  await openPage();
  const column = screen.getByRole("heading", { name: "Start here" }).closest(".detail__column")!;
  const headings = within(column as HTMLElement).getAllByRole("heading", { level: 2 }).map(node => node.textContent);
  expect(headings.slice(0, 11)).toEqual(["Start here", "Ask about this PDF", "Study guide", "Flashcards", "Practice test", "Practice an oral question", "Personal notes", "Next actions", "Questions from this material", "Find your place", "On this Mac (backup)"]);
  const file = document.getElementById("material-file-actions")!;
  const geminiSection = document.getElementById("material-study-guide")!;
  const backup = screen.getByRole("region", { name: "On this Mac (backup)" });
  expect(column.firstElementChild?.textContent).toContain("Start here");
  expect(column.children[1]).toBe(document.getElementById("material-ask-gemini"));
  expect(column.children[2]).toBe(screen.getByRole("navigation", { name: "Jump to" }));
  expect(column.children[3]).toBe(file);
  expect(file.compareDocumentPosition(geminiSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(geminiSection.compareDocumentPosition(backup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(column.lastElementChild).toBe(backup);
  expect(backup.contains(document.getElementById("material-offline-study"))).toBe(true);
  expect(backup.contains(document.getElementById("material-pdf-kit"))).toBe(true);
  expect(await within(backup).findByRole("heading", { name: "Read this PDF's text" })).toBeTruthy();
  expect(within(backup).getByRole("button", { name: "Make a study kit from this PDF" })).toBeTruthy();
  expect(within(backup).getByText("Making a PDF study kit works in the desktop app.")).toBeTruthy();
});

const sectionTitles = ["Study guide", "Flashcards", "Practice test", "Personal notes", "Next actions", "Questions from this material", "Find your place", "Review status", "Details", "On this Mac (backup)"];
it("shows a short muted tip under every section header and Hide tips hides them across visits", async () => {
  let view = await openPage();
  const tips = sectionTitles.map(title => {
    const header = screen.getByRole("heading", { name: title }).closest("header")!;
    const tip = header.nextElementSibling!;
    expect(tip.tagName).toBe("P"); expect(tip.classList.contains("muted")).toBe(true);
    expect(tip.textContent?.length).toBeGreaterThan(20);
    return tip.textContent!;
  });
  fireEvent.click(screen.getByRole("button", { name: "Hide tips" }));
  for (const text of tips) expect(screen.queryByText(text, { exact: true })).toBeNull();
  expect(screen.queryByRole("list", { name: "PDF study steps" })).toBeNull();
  expect(screen.queryByText("Choose a page range, like 12–40, to make a smaller copy.")).toBeNull();
  expect(screen.queryByText("Save a named place so you can return to it later without remembering the page number.")).toBeNull();
  // Hiding guidance keeps the features and both backup panels usable.
  expect(screen.getByRole("button", { name: "Make a study kit from this PDF" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Personal notes" })).toBeTruthy();
  view.unmount(); view = await openPage();
  expect(screen.getByRole("button", { name: "Show tips" })).toBeTruthy();
  for (const text of tips) expect(screen.queryByText(text, { exact: true })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show tips" }));
  for (const text of tips) expect(screen.getByText(text, { exact: true })).toBeTruthy();
  view.unmount();
});

it("keeps non-PDF materials usable with only applicable sections and a tips toggle", async () => {
  await createRepositories(db).documents.update("tips", { filePath: null, originalFileName: null });
  await openPage();
  expect(screen.queryByRole("heading", { name: "Start here" })).toBeNull();
  expect(screen.queryByRole("navigation", { name: "Jump to" })).toBeNull();
  expect(screen.queryByRole("region", { name: "On this Mac (backup)" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Find your place" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Write your own study guide" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Hide tips" }));
  expect(screen.queryByText("Write what you want to remember. Your notes save as you type; watch for Saved.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show tips" }));
  expect(screen.getByText("Write what you want to remember. Your notes save as you type; watch for Saved.")).toBeTruthy();
});


it("places a saved guide written by her before flashcards and keeps its source label", async () => {
  await createRepositories(db).documents.saveStudySet({ operationId: crypto.randomUUID(), materialId: "tips", reason: "create", expected: null,
    next: { title: "My guide", summary: "My summary", summaryOrigin: "user", sections: [], flashcards: [], sourceNotes: "", provider: "manual", model: "", retired: [] } });
  await openPage();
  const guide = screen.getByRole("heading", { name: "Study guide" }).closest(".card")!;
  const practice = document.getElementById("material-practice-test")!;
  expect(guide.compareDocumentPosition(practice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(guide as HTMLElement).getByText("Written by you, saved on this computer")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Write your own study guide" })).toBeNull();
});


it("keeps file-backed text materials working without PDF-only controls", async () => {
  await createRepositories(db).documents.update("tips", { filePath: "documents/synthetic.txt", originalFileName: "synthetic.txt" });
  await openPage();
  expect(screen.queryByRole("region", { name: "On this Mac (backup)" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Find your place" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Split automatically" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Gemini study assistant" })).toBeTruthy();
  expect(await screen.findByRole("heading", { name: "Read this PDF's text" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
});
