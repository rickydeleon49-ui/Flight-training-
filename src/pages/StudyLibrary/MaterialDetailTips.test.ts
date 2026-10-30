// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

it("places the How to link line first, keeps its destinations, and explains file, page and review actions", async () => {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/study/tips"] }, h(Ready))));
  await screen.findByRole("link", { name: "How to in Study Library" });
  await waitFor(() => expect(context.repositories).toBeTruthy());
  // The page chooser uses the same navigation repository in desktop mode;
  // only its capability is enabled here. No file is opened or inspected.
  vi.spyOn(context.repositories!.navigation, "canCheckFiles").mockReturnValue(true);
  // Trigger a normal app reload to render the desktop page controls.
  await context.mutate(repos => repos.documents.update("tips", { notes: "Synthetic note" }));
  expect(screen.getByRole("link", { name: "How to in Study Library" }).closest(".detail__column")?.firstElementChild).toBe(document.getElementById("material-start-here"));
  expect(screen.queryByRole("heading", { name: "Start here" })).toBeNull();
  for (const id of ["material-file-actions", "material-offline-study", "material-pdf-kit", "material-study-guide"]) {
    expect(document.getElementById(id)).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("tab", { name: "More" }));
  expect(screen.queryByText("Makes parts of up to 50 MB; each becomes its own library item. Your original stays as it is.")).toBeNull();
  expect(screen.queryByText("Choose a page range, like 12–40, to make a smaller copy.")).toBeNull();
  expect(screen.queryByText("Opens the PDF in your Mac's PDF app. In Preview, press ⌥⌘G to go to a page.")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
  expect(await screen.findByText("Check pages counts this PDF's pages and checks whether the file has changed.")).toBeTruthy();
  // "Open at page" was removed (owner, 22 October): no trace of it or its tip.
  expect(screen.queryByText(/Open at page/)).toBeNull();
  expect(screen.getByText("Save a named place so you can return to it later without remembering the page number.")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "More" }));
  expect(screen.getByText("Review again and Studying make this material eligible for suggestions in Today's Flight Plan.")).toBeTruthy();
  // One word, one meaning: the file menu says "File", only the tab says "More".
  expect(screen.getByText("See how this material is organized. Use Edit under File to change its details.")).toBeTruthy();
  expect(document.getElementById("material-file-actions")?.textContent).toBe("File ▾");
  expect(screen.getAllByText(/^More\b/).filter(el => el.closest("[role=tab]") || el.closest("summary")).map(el => el.textContent)).toEqual(["More"]);
  expect(screen.getByText("Records today's date as your last review. Choose your review status separately.")).toBeTruthy();
});


async function openPage() {
  const view = render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/study/tips"] }, h(Ready))));
  await screen.findByRole("heading", { name: "Synthetic PDF" });
  return view;
}

it("keeps Delete apart from Edit at the end of the material header and still confirms", async () => {
  await openPage();
  const edit = screen.getByRole("button", { name: "Edit" });
  const remove = screen.getByRole("button", { name: "Delete" });
  expect(edit.closest("details")).toBe(remove.closest("details"));
  expect(remove.parentElement?.lastElementChild).toBe(remove);
  expect(remove.classList.contains("destructive-action")).toBe(true);
  expect(remove.classList.contains("button--danger")).toBe(true);
  expect(screen.queryByRole("button", { name: "Del" })).toBeNull();
  fireEvent.click(remove);
  const dialog = await screen.findByRole("dialog", { name: "Delete this material?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(context.data.materials.some(material => material.id === "tips")).toBe(true);
});

it("uses tabs instead of Jump chips and keeps related destinations in More without writes", async () => {
  const question = await createRepositories(db).questions.create({ text: "Fictional linked question", materialId: "tips", status: "to_ask" });
  await openPage();
  expect(screen.queryByRole("navigation", { name: "Jump to" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "More" }));
  const details = document.getElementById("related-study")!.closest("details")!;
  expect(details.open).toBe(true);
  const list = await screen.findByRole("list", { name: "Related study destinations" });
  await waitFor(() => expect(screen.queryByText("Checking recent saved reviews…")).toBeNull());
  expect(within(list).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual([`/questions?question=${encodeURIComponent(question.id)}`]);
  const writes = vi.spyOn(db, "execute");
  const outbound = vi.spyOn(globalThis, "fetch");
  details.open = false; fireEvent(details, new Event("toggle"));
  await act(async () => {});
  expect(writes).not.toHaveBeenCalled(); expect(outbound).not.toHaveBeenCalled();
});

it("orders the PDF workflow inside its tab homes with both backup panels together", async () => {
  await openPage();
  const common = document.getElementById("material-start-here")!.closest(".detail__column")!;
  expect(common.firstElementChild?.textContent).toBe("New to this? See How to in Study Library.");
  expect(common.children).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Ask about this PDF" }).closest("header")).toBeTruthy();
  const study = screen.getByRole("tabpanel", { name: "Study" });
  expect(within(study).getAllByRole("heading", { level: 2 }).map(node => node.textContent)).toEqual(["Study", "Study guide", "Flashcards", "Practice test", "Practice an oral question"]);
  fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
  const notes = screen.getByRole("tabpanel", { name: "Notes" });
  expect(within(notes).getAllByRole("heading", { level: 2 }).map(node => node.textContent)).toEqual(["Notes", "Personal notes", "Questions for my instructor", "Next steps for this material", "Find your place"]);
  fireEvent.click(screen.getByRole("tab", { name: "More" }));
  const more = screen.getByRole("tabpanel", { name: "More" });
  const file = document.getElementById("material-file-details")!;
  const backup = screen.getByRole("region", { name: "On this Mac (backup)" });
  expect(more.contains(file)).toBe(true);
  // QUICKFIX-01: Read this PDF's text (in the backup card) comes before File details.
  expect(backup.compareDocumentPosition(file) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(await within(backup).findByRole("heading", { name: "Read this PDF's text" })).toBeTruthy();
  expect(within(more).getAllByRole("heading", { level: 2 }).map(node => node.textContent)).toEqual(["More", "On this Mac (backup)", "Read this PDF's text", "A study kit from your PDF", "File details", "Details and review status", "Details"]);
  expect(backup.contains(document.getElementById("material-offline-study"))).toBe(true);
  expect(backup.contains(document.getElementById("material-pdf-kit"))).toBe(true);
  expect(within(backup).getByRole("button", { name: "Make a study kit from this PDF" })).toBeTruthy();
  expect(within(backup).getByText("Making a PDF study kit works in the desktop app.")).toBeTruthy();
});

const selectSectionTab = (title: string) => fireEvent.click(screen.getByRole("tab", { name:
  ["Personal notes", "Next steps for this material", "Questions for my instructor", "Find your place"].includes(title) ? "Notes"
  : ["Details and review status", "Details", "On this Mac (backup)"].includes(title) ? "More" : "Study" }));
const sectionTitles = ["Study guide", "Flashcards", "Practice test", "Personal notes", "Next steps for this material", "Questions for my instructor", "Find your place", "Details and review status", "Details", "On this Mac (backup)"];
it("shows a short muted tip under every section header and Hide section tips hides them across visits", async () => {
  let view = await openPage();
  const tips = sectionTitles.map(title => {
    selectSectionTab(title);
    const header = screen.getByRole("heading", { name: title }).closest("header")!;
    const tip = header.nextElementSibling!;
    expect(tip.tagName).toBe("P"); expect(tip.classList.contains("muted")).toBe(true);
    expect(tip.textContent?.length).toBeGreaterThan(20);
    return tip.textContent!;
  });
  fireEvent.click(screen.getByRole("button", { name: "Hide section tips" }));
  for (const text of tips) expect(screen.queryByText(text, { exact: true })).toBeNull();
  expect(screen.queryByRole("link", { name: "How to in Study Library" })).toBeNull();
  expect(screen.queryByText("Choose a page range, like 12–40, to make a smaller copy.")).toBeNull();
  expect(screen.queryByText("Save a named place so you can return to it later without remembering the page number.")).toBeNull();
  // Hiding guidance keeps the features and both backup panels usable.
  fireEvent.click(screen.getByRole("tab", { name: "More" }));
  expect(screen.getByRole("button", { name: "Make a study kit from this PDF" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
  expect(screen.getByRole("textbox", { name: "Personal notes" })).toBeTruthy();
  expect(localStorage.getItem("hfd:material-start-here:hidden")).toBe("1");
  view.unmount(); view = await openPage();
  expect(screen.getByRole("button", { name: "Show section tips" })).toBeTruthy();
  for (const text of tips) expect(screen.queryByText(text, { exact: true })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show section tips" }));
  for (const text of tips) expect(screen.getByText(text, { exact: true })).toBeTruthy();
  view.unmount();
});

it("keeps non-PDF materials usable with only applicable sections and a tips toggle", async () => {
  await createRepositories(db).documents.update("tips", { filePath: null, originalFileName: null });
  await openPage();
  expect(screen.queryByRole("heading", { name: "Start here" })).toBeNull();
  expect(screen.queryByRole("link", { name: "How to in Study Library" })).toBeNull();
  expect(screen.queryByRole("navigation", { name: "Jump to" })).toBeNull();
  expect(screen.queryByRole("region", { name: "On this Mac (backup)" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Find your place" })).toBeNull();
  expect(screen.getByRole("button", { name: "Write your own study guide" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide section tips" }));
  expect(screen.queryByText("Write what you want to remember. Your notes save as you type; watch for Saved.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show section tips" }));
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
  fireEvent.click(screen.getByRole("tab", { name: "More" }));
  expect(await screen.findByRole("heading", { name: "Read this PDF's text" })).toBeTruthy();
  expect(within(document.getElementById("material-file-actions")!.closest("details")!).getByRole("button", { name: "Open" })).toBeTruthy();
});
