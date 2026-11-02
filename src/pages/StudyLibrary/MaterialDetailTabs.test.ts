// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as documents from "@/services/documents";
import * as gemini from "@/services/gemini";
import * as pdf from "@/services/pdf";
import * as offline from "@/services/offlineContent";
import { MaterialDetail } from "./MaterialDetail";
import { expectNoA11yViolations } from "@/testing/a11y";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
let context: ReturnType<typeof useAppData>;
function Address() { const location = useLocation(); const navigate = useNavigate(); return h("div", null,
  h("output", { "data-testid": "address" }, location.search + location.hash),
  h("button", { onClick: () => navigate(-1) }, "History back")); }
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

async function open(search = "") {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/before", `/study/tips${search}`], initialIndex: 1 }, h(Address), h(Ready))));
  await screen.findByRole("tab", { name: "Study" });
}
const pick = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
it("defaults to Study with three wired tabs and mounted hidden panels", async () => {
  await open();
  expect(screen.getAllByRole("tab")).toHaveLength(3);
  for (const name of ["Study", "Notes", "More"]) {
    const tab = screen.getByRole("tab", { name });
    const panel = document.getElementById(tab.getAttribute("aria-controls")!)!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    expect(tab.getAttribute("aria-selected")).toBe(String(name === "Study"));
    expect(panel.hidden).toBe(name !== "Study");
  }
  expect(screen.queryByRole("textbox", { name: "Personal notes" })).toBeNull();
  expect(document.querySelector('textarea[aria-label="Personal notes"]')).toBeTruthy();
  await expectNoA11yViolations(document.body);
});
it("Notes: Find your place is the second card for a PDF", async () => {
  await open("?tab=notes");
  const panel = screen.getByRole("tabpanel", { name: "Notes" });
  expect(within(panel).getAllByRole("heading", { level: 2 }).map(node => node.textContent)).toEqual([
    "Notes", "Personal notes", "Find your place", "Questions for my instructor", "Next steps for this material",
  ]);
});

it("More: Export, Related study and review status come before On this Mac", async () => {
  await createRepositories(db).documents.saveAiStudySet({ sourceMaterialId: "tips", title: "Synthetic guide", summary: "Synthetic summary", sections: [],
    flashcards: [], sourceNotes: "", model: "test" });
  await open("?tab=more");
  const panel = screen.getByRole("tabpanel", { name: "More" });
  await within(panel).findByRole("heading", { name: "Read this PDF's text" });
  expect(within(panel).getAllByRole("heading", { level: 2 }).map(node => node.textContent)).toEqual([
    "More", "Details and review status", "File details", "On this Mac (backup)", "Read this PDF's text", "A study kit from your PDF", "Details",
  ]);
  // Export and Related study retain their existing button and summary semantics.
  const ordered = [
    within(panel).getByRole("button", { name: "Export or print" }),
    within(panel).getByText("Related study", { selector: "summary" }),
    within(panel).getByRole("heading", { name: "Details and review status" }),
    within(panel).getByRole("heading", { name: "File details" }),
    within(panel).getByRole("heading", { name: "On this Mac (backup)" }),
    within(panel).getByRole("heading", { name: "Details" }),
  ];
  ordered.slice(1).forEach((node, index) => {
    expect(ordered[index]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

it("replaces URL state, preserves parameters and omits Study", async () => {
  await open("?tab=notes&keep=yes");
  expect(screen.getByRole("textbox", { name: "Personal notes" })).toBeTruthy();
  pick("More"); expect(screen.getByTestId("address").textContent).toBe("?tab=more&keep=yes");
  pick("Study"); expect(screen.getByTestId("address").textContent).toBe("?keep=yes");
  fireEvent.click(screen.getByRole("button", { name: "History back" }));
  await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
});
it("moves roving keyboard focus and selection, and focuses the panel on Enter", async () => {
  await open();
  const study = screen.getByRole("tab", { name: "Study" }); study.focus();
  fireEvent.keyDown(study, { key: "ArrowRight" });
  const notes = screen.getByRole("tab", { name: "Notes" });
  expect(document.activeElement).toBe(notes); expect(notes.getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(notes, { key: "End" }); expect(document.activeElement?.textContent).toBe("More");
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" }); expect(document.activeElement).toBe(study);
  fireEvent.keyDown(study, { key: "ArrowLeft" }); expect(document.activeElement?.textContent).toBe("More");
  fireEvent.keyDown(document.activeElement!, { key: "Home" }); expect(document.activeElement).toBe(study);
  fireEvent.keyDown(study, { key: "Enter" });
  await waitFor(() => expect(document.activeElement?.id).toBe("material-panel-heading-study"));
});
it("keeps the actual textarea and unsaved question draft across switches", async () => {
  await open("?tab=notes");
  const notes = screen.getByRole("textbox", { name: "Personal notes" });
  const question = screen.getByRole("textbox", { name: "New question" });
  fireEvent.change(notes, { target: { value: "Fictional notes draft" } });
  fireEvent.change(question, { target: { value: "Unsaved fictional question" } });
  pick("Study"); pick("More"); pick("Notes");
  expect(screen.getByRole("textbox", { name: "Personal notes" })).toBe(notes);
  expect((notes as HTMLTextAreaElement).value).toBe("Fictional notes draft");
  expect(screen.getByRole("textbox", { name: "New question" })).toBe(question);
  expect((question as HTMLInputElement).value).toBe("Unsaved fictional question");
});

it("keeps a revealed card and a live card review session mounted", async () => {
  await createRepositories(db).documents.saveAiStudySet({ sourceMaterialId: "tips", title: "Synthetic saved cards", summary: "Synthetic guide", sections: [],
    flashcards: [{ front: "Synthetic card question", back: "Synthetic card answer", sourcePage: null }], sourceNotes: "", model: "test" });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Reveal flashcard answer" }));
  const answer = screen.getByText("Synthetic card answer");
  pick("Notes"); pick("Study");
  expect(screen.getByText("Synthetic card answer")).toBe(answer);
  fireEvent.click(await screen.findByRole("button", { name: "Start 1 new card" }));
  fireEvent.click(await screen.findByRole("button", { name: "Show answer" }));
  const session = document.querySelector(".card-review__session")!;
  expect(session.textContent).toContain("Synthetic card answer");
  pick("Notes"); pick("More"); pick("Study");
  expect(document.querySelector(".card-review__session")).toBe(session);
  expect(screen.getByRole("group", { name: "Rate this card" })).toBeTruthy();
});
it("keeps all tabs for a material without a file and handles unknown URL tabs", async () => {
  await createRepositories(db).documents.update("tips", { filePath: null, originalFileName: null });
  await open("?tab=unknown");
  expect(screen.getByRole("tab", { name: "Study" }).getAttribute("aria-selected")).toBe("true");
  pick("Notes"); expect(screen.getByRole("textbox", { name: "Personal notes" })).toBeTruthy();
  pick("More"); expect(screen.getByRole("combobox", { name: "Review status" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Ask about this PDF" })).toBeNull();
});

it("keeps Delete inside More, supports keyboard dismissal and returns focus for Edit", async () => {
  await open();
  const header = screen.getByRole("heading", { name: "Synthetic PDF" }).closest("header")!;
  const deletion = within(header).getByRole("button", { name: "Delete" });
  expect(deletion.closest("details")?.open).toBe(false);
  expect(deletion.closest(".material-actions-menu")).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Jump to" })).toBeNull();
  const more = screen.getByText("File ▾");
  more.focus(); fireEvent.keyDown(more, { key: "Enter" });
  expect(more.closest("details")!.open).toBe(true);
  expect(within(more.closest("details")!).getByRole("button", { name: "Delete" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(more.closest("details")!.open).toBe(false);
  expect(document.activeElement).toBe(more);
  fireEvent.click(more);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(document.activeElement).toBe(more));
});
it("opens PDF questions in a dialog even when Gemini is not configured", async () => {
  await open();
  const ask = screen.getByRole("button", { name: "Ask about this PDF" });
  expect(ask.closest("header")).toBeTruthy();
  ask.focus(); fireEvent.click(ask);
  const dialog = await screen.findByRole("dialog", { name: "Ask about this PDF" });
  expect(within(dialog).getByText("Connect Gemini in Settings to ask questions about this PDF.")).toBeTruthy();
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(ask));
});
it("puts the numbered review action above browsing and updates the header status chip", async () => {
  await createRepositories(db).documents.saveAiStudySet({ sourceMaterialId: "tips", title: "Synthetic cards", summary: "Guide", sections: [],
    flashcards: [{ front: "Fictional front", back: "Fictional back", sourcePage: null }], sourceNotes: "", model: "test" });
  await open();
  const review = await screen.findByRole("button", { name: "Start 1 new card" });
  expect(review.classList.contains("button--primary")).toBe(true);
  expect(review.compareDocumentPosition(screen.getByRole("button", { name: "Reveal flashcard answer" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  pick("More");
  fireEvent.change(screen.getByRole("combobox", { name: "Review status" }), { target: { value: "confident" } });
  await waitFor(() => expect(document.querySelector(".material-header-meta")?.textContent).toContain("Confident"));
});

it("starts an acknowledged practice attempt, keeps it through tabs and links its completed saved review", async () => {
  const repos = createRepositories(db);
  await repos.documents.savePracticeTest({ sourceMaterialId: "tips", title: "Synthetic test", provider: "manual", model: "",
    questions: [{ question: "Synthetic practice question", options: ["A", "B"], correctIndex: 0, explanation: "Synthetic explanation", sourcePage: null }] });
  await open();
  const start = await screen.findByRole("button", { name: "Start practice test" });
  expect(start.classList.contains("button--primary")).toBe(true);
  expect((await screen.findByRole("button", { name: "Short saved review" })).hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("link", { name: /View practice history/ })).toBeNull();
  fireEvent.click(start);
  await waitFor(() => expect(screen.getByRole("status", {name:"Practice progress"}).textContent).toBe("Question 1 of 1"));
  expect(screen.queryByText(/Resuming your attempt/)).toBeNull();
  await waitFor(async () => expect((await repos.practiceSessions.getCurrentAttempt("tips"))?.responses).toHaveLength(0));
  expect(screen.getByRole("status", { name: "Practice progress" }).textContent).toBe("Question 1 of 1");
  const question = await screen.findByRole("heading", { name: "Question 1 of 1" });
  pick("Notes"); pick("Study");
  expect(await screen.findByRole("heading", { name: "Question 1 of 1" })).toBe(question);
  fireEvent.click((await screen.findAllByRole("radio"))[1]!);
  const score = await screen.findByRole("button", { name: "See score" });
  await waitFor(() => expect(score.hasAttribute("disabled")).toBe(false));
  fireEvent.click(score);
  const completedLink = await screen.findByRole("link", { name: "Short saved review" });
  const scoreHistory = await screen.findByRole("link", { name: "View practice history (1)" });
  expect(scoreHistory.parentElement).toBe((await screen.findByRole("button", { name: "Retake this test" })).parentElement);
  expect(screen.getAllByRole("link", { name: /View practice history/ })).toHaveLength(1);
  const [attempt] = await repos.practiceSessions.getCompletedHistory("tips", 1);
  const path = `/study/history/tips/${attempt!.attemptId}?review=missed`;
  expect(completedLink.getAttribute("href")).toBe(`#${path}`);
  cleanup();
  await open();
  const link = await screen.findByRole("link", { name: "Short saved review" });
  expect(link.getAttribute("href")).toBe(path);
  const history = await screen.findByRole("link", { name: "View practice history (1)" });
  const reopenedStart = await screen.findByRole("button", { name: "Start practice test" });
  expect(history.parentElement).toBe(reopenedStart.parentElement);
  expect(history.parentElement!.contains(link)).toBe(true);
  fireEvent.click(reopenedStart);
  await screen.findByRole("heading", { name: "Question 1 of 1" });
  expect(screen.getByRole("link", { name: "View practice history (1)" }).parentElement!.contains(
    screen.getByRole("link", { name: "Short saved review" }),
  )).toBe(true);
  expect(screen.queryByText(/Resuming your attempt/)).toBeNull();
  expect(screen.getAllByRole("link", { name: /View practice history/ })).toHaveLength(1);
  expect(history.getAttribute("href")).toBe("/study/history/tips");
}, 40_000);

it("offers the existing manual guide editor for an empty material and keeps an empty new guide editable", async () => {
  await createRepositories(db).documents.update("tips", { filePath: null, originalFileName: null });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Write your own study guide" }));
  const dialog = await screen.findByRole("dialog", { name: "Write your own study guide" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create study guide" }));
  expect(await screen.findByRole("button", { name: "Add a section" })).toBeTruthy();
});

it("offers a secondary Mac kit button that opens its destination", async () => {
  await open();
  const kit = screen.getByRole("button", { name: "or make a kit on this Mac" });
  expect(kit.classList.contains("button--secondary")).toBe(true);
  fireEvent.click(kit);
  await waitFor(() => expect(screen.getByRole("tab", { name: "More" }).getAttribute("aria-selected")).toBe("true"));
});

it("offers file actions only in the header", async () => {
  await open("?tab=more");
  const panel = screen.getByRole("tabpanel");
  for (const name of ["Split automatically", "Take out a chapter", "Open"]) {
    expect(within(panel).queryByRole("button", { name })).toBeNull();
    expect(screen.getAllByRole("button", { name })).toHaveLength(1);
  }
});

it("opens legacy file-action deep links in the header menu", async () => {
  await open("?tab=more#material-file-actions");
  await waitFor(() => expect(document.getElementById("material-file-actions")?.closest("details")?.open).toBe(true));
  await waitFor(() => expect(document.activeElement).toBe(document.getElementById("material-file-actions")));
});

function Where() { const location = useLocation(); const type = useNavigationType();
  return h("output", { "data-testid": "where" }, `${type} ${location.pathname}`); }
it.each([
  [true, "POP /study"],
  [false, "PUSH /study"],
])("'‹ Study Library' goes back to her place only when opened from the library (fromLibrary=%s)", async (fromLibrary, expected) => {
  render(h(AppDataProvider, null, h(MemoryRouter, {
    initialEntries: ["/study", { pathname: "/study/tips", state: fromLibrary ? { fromLibrary: true } : null }], initialIndex: 1,
  }, h(Where), h(Ready))));
  await screen.findByRole("tab", { name: "Study" });
  pick("Notes");
  fireEvent.click(screen.getByRole("link", { name: "‹ Study Library" }));
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(expected));
});

async function saveFullKit() {
  const repos = createRepositories(db);
  await repos.documents.saveAiStudySet({sourceMaterialId: "tips", title: "Synthetic kit", summary: "Guide", sections: [],
    flashcards: [{front: "Synthetic front", back: "Synthetic back", sourcePage: null}], sourceNotes: "", model: "test"});
  await repos.documents.savePracticeTest({sourceMaterialId: "tips", title: "Synthetic test", provider: "manual", model: "",
    questions: [{question: "Synthetic question", options: ["A", "B"], correctIndex: 0, explanation: "A", sourcePage: null}]});
}
it("folds Make a study kit once guide, cards and test are saved and reopens while a kit job runs", async () => {
  await saveFullKit();
  vi.mocked(gemini.getGeminiStatus).mockResolvedValue({configured: true, model: "gemini-3.5-flash", choice: "standard"});
  vi.spyOn(pdf, "inspectPdf").mockResolvedValue({pages: 2, maxPagesPerSplit: 150});
  vi.spyOn(gemini, "generateStudyKit").mockImplementation(() => new Promise(() => {}));
  await open();
  const summary = await screen.findByText("Make a new study kit");
  const fold = summary.closest("details")!;
  expect(fold.open).toBe(false);
  const practice = document.getElementById("material-practice-test")!;
  expect(practice.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(fold.compareDocumentPosition(screen.getByText("Practice an oral question", {selector: "summary"})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(summary);
  const make = await screen.findByRole("button", {name: "Make my study kit"});
  await waitFor(() => expect(make.hasAttribute("disabled")).toBe(false));
  fireEvent.click(make);
  const consent = await screen.findByRole("dialog", {name: "Send this file to Google?"});
  fireEvent.click(within(consent).getByRole("button", {name: "Make my study kit"}));
  await screen.findAllByText("Making your study kit…");
  expect(screen.queryByText("Make a new study kit")).toBeNull();
  const active = screen.getByRole("button", {name: "Make my study kit"});
  expect(active.closest("details")).toBeNull();
  expect(active.compareDocumentPosition(document.getElementById("material-study-guide")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("opens a folded kit destination for a jump link", async () => {
  await saveFullKit();
  await open("#material-study-kit");
  await waitFor(() => expect(document.getElementById("material-study-kit")?.closest("details")?.open).toBe(true));
  await waitFor(() => expect(document.activeElement?.id).toBe("material-study-kit"));
});
it("keeps the fresh PDF kit maker open at the top and omits it on iOS", async () => {
  await open();
  const make = screen.getByRole("button", {name: "Make my study kit"});
  expect(make.closest("details")).toBeNull();
  expect(make.compareDocumentPosition(document.getElementById("material-study-guide")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  cleanup();
  await saveFullKit();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
  await open();
  expect(screen.queryByText("Make a new study kit")).toBeNull();
  expect(screen.queryByRole("button", {name: "Make my study kit"})).toBeNull();
});
