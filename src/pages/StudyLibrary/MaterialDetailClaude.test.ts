// @vitest-environment jsdom
// Text-source fixtures retain coverage of the legacy generation path.
// PDF section-guide behavior is covered in SectionGuideProgress.test.ts.
/**
 * The Gemini model choice as she sees it on a material: the "Send this file
 * to Google?" message names the model that will read the file, and a saved
 * study aid says which model actually made it (which can be the fallback).
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";
import * as documentService from "@/services/documents";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  return null;
}
function Ready() {
  return useAppData().status === "ready"
    ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }))
    : null;
}
async function open(id: string) {
  render(
    h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [`/study/${id}`] }, h(Probe), h(Ready))),
  );
  await waitFor(() => expect(context.status).toBe("ready"));
}

async function seedMaterial() {
  return createRepositories(db).documents.create({
    id: "mat-model",
    title: "Synthetic handbook",
    filePath: "documents/handbook.txt",
    originalFileName: "handbook.txt",
    fileSize: 2048,
  });
}

describe("Claude confirmations and model labels", () => {
  beforeEach(async () => {
    localStorage.clear();
    db = await createNodeSqliteDatabase();
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
    vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
    vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    db.close();
    vi.restoreAllMocks();
  });

  it.each([false, true])("names Anthropic, its disclosure and the answering model (PDF: %s)", async (pdf) => {
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({configured:true, model:"claude-haiku-5-5",choice:"standard"});
    const generate=vi.spyOn(geminiService,"generateStudyAid").mockResolvedValue({title:"Fictional guide",summary:"Synthetic summary",sections:[{heading:"Wing",body:"Fictional wing."}],flashcards:[],sourceNotes:"",model:"claude-haiku-5-5"});
    const material = pdf
      ? await createRepositories(db).documents.create({ id: "mat-pdf", title: "Synthetic PDF", filePath: "documents/synthetic.pdf", originalFileName: "synthetic.pdf", fileSize: 2048 })
      : await seedMaterial();
    await open(material.id);
    expect(await screen.findByRole("heading",{name: pdf ? "Study guide" : "Claude study assistant"})).toBeTruthy();
    expect(screen.getByText(pdf ? /Claude will read this PDF and build a study guide section by section/ : /Claude will read only this file and create a source-based study guide/)).toBeTruthy();
    if (pdf) return; // PDF generation itself uses the separate native section path.
    fireEvent.click(await screen.findByRole("button",{name:"Create study aid"}));
    const dialog=await screen.findByRole("dialog",{name:"Send this file to Anthropic?"});
    expect(dialog.textContent).toContain("It will be read by Claude Haiku 5.5.");
    expect(dialog.textContent).toContain("Anthropic: your files are not used for training and are deleted within 30 days.");
    expect(dialog.textContent).not.toMatch(/Google|Gemini|48 hours/);
    expect(dialog.textContent).toContain("Short sources may give you fewer cards.");
    expect(dialog.textContent).not.toContain("A maximum, not a promise");
    expect(generate).not.toHaveBeenCalled();
    await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Send to Claude"}));});
    await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button",{name:"Save the new study guide"}));
    expect(await screen.findByText(/AI-generated study aid \(made with Claude Haiku 5.5\)/)).toBeTruthy();
    const saved=await createRepositories(db).documents.listAiStudySets();
    expect(saved[0]!.model).toBe("claude-haiku-5-5");
    const provenance = screen.getByLabelText("Saved study aid provenance");
    expect(provenance.textContent).toContain("Claude");
    expect(provenance.textContent).not.toContain("Gemini");
  });
});
