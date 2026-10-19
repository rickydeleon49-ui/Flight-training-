// @vitest-environment jsdom
/**
 * GEN-REL-01 in the interface: before anything is sent, the Send confirmation
 * offers choosing a chapter or pages first (the existing manual split, with
 * nothing sent), says exactly what leaves this Mac and that Google keeps a
 * temporary copy, and a split part is generated from that part only and saved
 * to that part. Real AppDataProvider and router on disposable SQLite; the
 * desktop commands are stubbed and record what they were asked. Synthetic
 * values only; no provider or file leaves this test.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import * as documentService from "@/services/documents";
import * as geminiService from "@/services/gemini";
import * as pdfService from "@/services/pdf";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

import { MaterialDetail } from "./MaterialDetail";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

const T0 = "2026-10-18T12:00:00.000Z";

function Ready() {
  const { status } = useAppData();
  return status === "ready" ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) })) : null;
}

async function openMaterial(id: string, title: string) {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [`/study/${id}`] }, h(Ready))));
  await screen.findByRole("heading", { name: title });
}

async function materialRow(id: string, title: string, file: string) {
  await db.execute(
    "INSERT INTO study_materials (id, title, file_path, original_file_name, file_size, created_at, updated_at) VALUES (?, ?, ?, ?, 2048, ?, ?)",
    [id, title, file, file.split("/").pop() ?? file, T0, T0],
  );
}

/** A first-level part holding original pages `start`–`end`. */
async function part(id: string, title: string, start: number, end: number) {
  await materialRow(id, title, `documents/${id}.pdf`);
  await db.execute(
    `INSERT INTO material_split_lineage (material_id, parent_material_id, root_material_id, source_page_start,
       source_page_end, child_page_count, source_file_name, source_title, source_content_sha256,
       source_total_pages, nested_level, created_at)
     VALUES (?, NULL, 'root', ?, ?, ?, 'handbook.pdf', 'Synthetic Handbook', ?, 300, 1, ?)`,
    [id, start, end, end - start + 1, "1".repeat(64), T0],
  );
}

const STUDY_AID: geminiService.GeneratedStudyAid = {
  title: "Chapter guide",
  summary: "A synthetic summary.",
  sections: [{ heading: "Airspace", body: "Synthetic body." }],
  flashcards: [{ front: "Q", back: "A", sourcePage: 3 }],
  sourceNotes: "Synthetic notes.",
  model: "gemini-3.5-flash",
};

let generateStudyAid: ReturnType<typeof vi.spyOn>;
let generatePracticeTest: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: true, model: "gemini-3.5-flash", choice: "standard" });
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  generateStudyAid = vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue(STUDY_AID);
  generatePracticeTest = vi.spyOn(geminiService, "generatePracticeTest");
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
  vi.spyOn(pdfService, "canSplitPdfs").mockReturnValue(true);
  vi.spyOn(pdfService, "inspectPdf").mockResolvedValue({ pages: 300, maxPagesPerSplit: 1000 });
  await materialRow("root", "Synthetic Handbook", "documents/handbook.pdf");
});

afterEach(() => {
  cleanup();
  db.close();
  vi.restoreAllMocks();
});

const sendDialog = () => screen.getByRole("dialog", { name: "Send this file to Google?" });

describe("choosing what to send (GEN-REL-01)", () => {
  it("a whole PDF can be narrowed to a chapter first, which opens the page chooser and sends nothing", async () => {
    await openMaterial("root", "Synthetic Handbook");
    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    const dialog = await waitFor(sendDialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose a chapter or pages first" }));
    expect(await screen.findByRole("dialog", { name: "Take out a chapter" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Send this file to Google?" })).toBeNull();
    expect(generateStudyAid).not.toHaveBeenCalled();
    expect(generatePracticeTest).not.toHaveBeenCalled();
  });

  it("the practice-test confirmation offers the same choice", async () => {
    await openMaterial("root", "Synthetic Handbook");
    fireEvent.click(await screen.findByRole("button", { name: "Create practice test" }));
    const dialog = await waitFor(sendDialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose a chapter or pages first" }));
    expect(await screen.findByRole("dialog", { name: "Take out a chapter" })).toBeTruthy();
    expect(generatePracticeTest).not.toHaveBeenCalled();
  });

  it("says exactly what leaves this Mac and that Google keeps a temporary copy", async () => {
    await openMaterial("root", "Synthetic Handbook");
    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    const text = (await waitFor(sendDialog)).textContent ?? "";
    expect(text).toMatch(/Only “handbook\.pdf” leaves this Mac/);
    expect(text).toMatch(/temporary copy for up to 48 hours/);
    expect(text).toMatch(/practice test can use it without uploading it again/);
    expect(text).toMatch(/copy on this Mac is not changed/);
  });

  it("cancelling sends nothing", async () => {
    await openMaterial("root", "Synthetic Handbook");
    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    fireEvent.click(within(await waitFor(sendDialog)).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Send this file to Google?" })).toBeNull());
    expect(generateStudyAid).not.toHaveBeenCalled();
  });

  it("whole-document generation is still available and sends the whole document", async () => {
    await openMaterial("root", "Synthetic Handbook");
    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    fireEvent.click(within(await waitFor(sendDialog)).getByRole("button", { name: "Send to Gemini" }));
    await waitFor(() => expect(generateStudyAid).toHaveBeenCalledWith("documents/handbook.pdf", "root", undefined, expect.stringMatching(/^req-/)));
  });

  it("a part sends only that part, names its pages, and saves to the part, not the original", async () => {
    await part("ch3", "Chapter 3", 41, 60);
    await openMaterial("ch3", "Chapter 3");
    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    const dialog = await waitFor(sendDialog);
    expect(dialog.textContent).toMatch(/Only “ch3\.pdf”, pages 41–60 of “Synthetic Handbook”, leaves this Mac/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to Gemini" }));
    await waitFor(() => expect(generateStudyAid).toHaveBeenCalledTimes(1));
    expect(generateStudyAid).toHaveBeenCalledWith("documents/ch3.pdf", "ch3", undefined, expect.stringMatching(/^req-/));
    const repos = createRepositories(db);
    await waitFor(async () => expect(await repos.documents.listAiStudySets()).toHaveLength(1));
    const [saved] = await repos.documents.listAiStudySets();
    expect(saved?.sourceMaterialId).toBe("ch3");
    // The card's page is the part's own page, shown once; it is not mapped onto the original again.
    expect(saved?.flashcards[0]?.sourcePage).toBe(3);
  });

  it("a text file is sent with the request only, and offers no chapter choice", async () => {
    await materialRow("notes", "Synthetic Notes", "documents/notes.txt");
    await openMaterial("notes", "Synthetic Notes");
    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    const dialog = await waitFor(sendDialog);
    expect(within(dialog).queryByRole("button", { name: "Choose a chapter or pages first" })).toBeNull();
    expect(dialog.textContent).toMatch(/sent with this request only/);
    expect(dialog.textContent).not.toMatch(/48 hours/);
  });

  it("a failed generation leaves the saved guide exactly as it was", async () => {
    const repos = createRepositories(db);
    await repos.documents.saveAiStudySet({
      sourceMaterialId: "root",
      title: "Existing guide",
      summary: "Kept.",
      sections: [{ heading: "Kept", body: "Kept body." }],
      flashcards: [{ front: "Kept Q", back: "Kept A", sourcePage: 1 }],
      sourceNotes: "",
      provider: "gemini",
      model: "gemini-3.5-flash",
    } as never);
    const before = await repos.documents.listAiStudySets();
    generateStudyAid.mockRejectedValueOnce("Google could not process this PDF, so no study aid was made.");
    await openMaterial("root", "Synthetic Handbook");
    fireEvent.click(await screen.findByRole("button", { name: /Regenerate|Create study aid/ }));
    await act(async () => {
      fireEvent.click(within(await waitFor(sendDialog)).getByRole("button", { name: "Send to Gemini" }));
    });
    expect(await screen.findByText(/Google could not process this PDF/)).toBeTruthy();
    expect(await repos.documents.listAiStudySets()).toEqual(before);
    expect(screen.getAllByText("Existing guide").length).toBeGreaterThan(0);
  });
});
