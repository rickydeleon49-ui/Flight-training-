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
import { geminiModelSentence, MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
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

function status(choice: geminiService.GeminiModelChoice): geminiService.GeminiStatus {
  return {
    configured: true,
    model: choice === "most-capable" ? "gemini-4-argon" : "gemini-3.5-flash",
    choice,
  };
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

describe("Gemini model choice on a material", () => {
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

  it("names the model in the send message, and warns about cost only for Argon", () => {
    expect(geminiModelSentence(status("standard"))).toBe(" It will be read by Gemini Flash.");
    const argon = geminiModelSentence(status("most-capable"));
    expect(argon).toContain("It will be read by Gemini 4 Argon");
    expect(argon).toContain("costs more per document");
    expect(geminiModelSentence(null)).toBe("");
    expect(geminiModelSentence({ configured: false, model: null, choice: "standard" } as never)).toBe("");
  });

  it("STUDENT-1: asks before sending to Gemini 4 Argon, then labels the saved aid with the model that made it", async () => {
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue(status("most-capable"));
    // Argon could not answer, so the standard model made it: the label must say so.
    const generate = vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({
      title: "Synthetic guide",
      summary: "Synthetic summary",
      sections: [{ heading: "Section", body: "Body" }],
      flashcards: [{ front: "Q", back: "A", sourcePage: null }],
      sourceNotes: "",
      model: "gemini-3.5-flash",
    });
    const material = await seedMaterial();
    await open(material.id);

    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    const confirm = await screen.findByRole("dialog", { name: "Send this file to Google?" });
    expect(confirm.textContent).toContain("It will be read by Gemini 4 Argon");
    expect(confirm.textContent).toContain("will be sent to Google to generate the study aid.");
    expect(confirm.textContent).not.toContain("48 hours");
    expect(confirm.textContent).toContain("On the free tier Google may use it to improve its products");
    expect(confirm.textContent).not.toContain("will be uploaded");
    expect(generate).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send to Gemini" }));
    });
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(await createRepositories(db).documents.listAiStudySets()).toHaveLength(0);
    fireEvent.click(await screen.findByRole("button", { name: "Save the new study guide and cards" }));
    expect(await screen.findByText(/AI-generated study aid \(made with Gemini Flash\)/)).toBeTruthy();
  });

  it("names Gemini Flash for the standard choice", async () => {
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue(status("standard"));
    const material = await seedMaterial();
    await open(material.id);
    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    const confirm = await screen.findByRole("dialog", { name: "Send this file to Google?" });
    expect(confirm.textContent).toContain("It will be read by Gemini Flash.");
    expect(confirm.textContent).not.toContain("Argon");
  });
});
