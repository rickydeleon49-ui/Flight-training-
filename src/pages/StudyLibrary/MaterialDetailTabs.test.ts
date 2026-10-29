// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
  fireEvent.click(await screen.findByRole("button", { name: "Review cards" }));
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
