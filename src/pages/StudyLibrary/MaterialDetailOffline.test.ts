// @vitest-environment jsdom
/**
 * A4: a saved study guide, its flashcards and a saved practice test stay
 * readable and usable when Gemini is disconnected, its status is still loading
 * or failed, the network is unavailable, or the source file can no longer be
 * sent. Creating or regenerating is gated separately and explains why it is
 * unavailable. Synthetic records in disposable real SQLite.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { NewMaterial } from "@/data/repositories/documentRepository";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import * as documentService from "@/services/documents";
import * as geminiService from "@/services/gemini";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

let context: ReturnType<typeof useAppData>;
let navigate: ReturnType<typeof useNavigate>;
function Probe() {
  context = useAppData();
  navigate = useNavigate();
  return null;
}
function Ready() {
  const { status } = useAppData();
  return status === "ready"
    ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }))
    : null;
}

let repos: Repositories;
let network: ReturnType<typeof vi.spyOn>;
let studyAid: ReturnType<typeof vi.spyOn>;
let practice: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
  await repos.app.set("airline_starter_pack", "skipped-for-test");
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
  studyAid = vi.spyOn(geminiService, "generateStudyAid").mockRejectedValue(new Error("must not be called"));
  practice = vi.spyOn(geminiService, "generatePracticeTest").mockRejectedValue(new Error("must not be called"));
  // Any network use while reading saved content is a failure.
  network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
});

afterEach(() => {
  cleanup();
  db.close();
  vi.restoreAllMocks();
});

type Status = "disconnected" | "connected" | "pending" | "error";
function geminiStatus(status: Status) {
  const spy = vi.spyOn(geminiService, "getGeminiStatus");
  if (status === "pending") spy.mockReturnValue(new Promise(() => {}));
  else if (status === "error") spy.mockRejectedValue(new Error("status unavailable"));
  else spy.mockResolvedValue({ configured: status === "connected", model: "gemini-3.5-flash", choice: "standard" });
}

async function seed(material: Partial<NewMaterial> = {}) {
  const created = await repos.documents.create({
    id: "mat-saved",
    title: "VOR navigation handout",
    filePath: "documents/vor.pdf",
    originalFileName: "vor.pdf",
    fileSize: 4096,
    ...material,
  });
  await repos.documents.saveAiStudySet({
    sourceMaterialId: created.id,
    title: "Saved VOR guide",
    summary: "Saved summary of VOR tracking.",
    sections: [{ heading: "Tracking", body: "Saved section body about radials." }],
    flashcards: [
      { front: "What is a VOR?", back: "A VHF omnidirectional range.", sourcePage: 3 },
      { front: "Second saved question", back: "Second saved answer", sourcePage: null },
    ],
    sourceNotes: "Saved source notes.",
    model: "gemini-3.5-flash",
  });
  await repos.documents.savePracticeTest({
    sourceMaterialId: created.id,
    title: "Saved practice test",
    questions: [
      { question: "Saved question one?", options: ["Wrong choice", "Right choice"], correctIndex: 1, explanation: "Saved explanation one.", sourcePage: 2 },
      { question: "Saved question two?", options: ["Alpha", "Bravo"], correctIndex: 0, explanation: "Saved explanation two.", sourcePage: null },
    ],
    model: "gemini-3.5-flash",
  });
  return created;
}

async function open(id = "mat-saved") {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [`/study/${id}`] }, h(Probe), h(Ready))));
  await waitFor(() => expect(context.status).toBe("ready"));
  await screen.findByRole("heading", { name: "VOR navigation handout" });
}

/** Read the guide, flip and page the cards, and take the practice test. */
async function studySavedContent() {
  expect(screen.getByRole("heading", { name: "Saved VOR guide" })).toBeTruthy();
  expect(screen.getByText("Saved section body about radials.")).toBeTruthy();
  expect(screen.getByText("Saved source notes.")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Reveal flashcard answer" }));
  expect(screen.getByText("A VHF omnidirectional range.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Second saved question")).toBeTruthy();

  expect(screen.getByText("Saved question one?")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: /Right choice/ }));
  expect(within(await screen.findByRole("region", { name: "Question result" })).getByText("Correct")).toBeTruthy();
  expect(screen.getByText("Saved explanation one.")).toBeTruthy();
  const continueBtn = screen.getByRole("button", { name: "Continue" });
  await waitFor(() => expect(continueBtn.hasAttribute("disabled")).toBe(false));
  fireEvent.click(continueBtn);
  fireEvent.click(screen.getByRole("radio", { name: /Bravo/ }));
  const scoreBtn = screen.getByRole("button", { name: "See score" });
  await waitFor(() => expect(scoreBtn.hasAttribute("disabled")).toBe(false));
  fireEvent.click(scoreBtn);
  await screen.findByText("1 of 2 correct");
  expect(screen.getByText("1 of 2 correct")).toBeTruthy();
}

function expectNothingSent() {
  expect(studyAid).not.toHaveBeenCalled();
  expect(practice).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
}

const generateButtons = () =>
  screen.queryAllByRole("button", { name: /^(Create study aid|Regenerate|Create practice test)$/ });

describe("A4: saved study content without a usable Gemini connection", () => {
  it("keeps the saved guide, cards and practice test usable with Gemini disconnected", async () => {
    geminiStatus("disconnected");
    await seed();
    await open();
    await waitFor(() => expect(screen.getAllByText(/Connect the free Gemini API in Settings/).length).toBeGreaterThan(0));
    await studySavedContent();
    expect(generateButtons()).toHaveLength(0);
    expectNothingSent();
  });

  it("keeps saved content usable while the Gemini status is still loading", async () => {
    geminiStatus("pending");
    await seed();
    await open();
    await studySavedContent();
    expect(generateButtons()).toHaveLength(0);
    expectNothingSent();
  });

  it("keeps saved content usable when the Gemini status check fails", async () => {
    geminiStatus("error");
    await seed();
    await open();
    await waitFor(() => expect(geminiService.getGeminiStatus).toHaveBeenCalled());
    await studySavedContent();
    expect(generateButtons()).toHaveLength(0);
    expect(screen.getAllByText(/could not check the Gemini connection/i).length).toBeGreaterThan(0);
    expectNothingSent();
  });
});

describe("A4: saved study content when the source can no longer be sent", () => {
  it("explains a missing PDF and keeps saved content, with regeneration disabled", async () => {
    geminiStatus("connected");
    vi.mocked(documentService.documentExists).mockResolvedValue(false);
    await seed();
    await open();
    await screen.findByText("This file is no longer in your library storage.");
    await studySavedContent();
    for (const button of generateButtons()) expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText(/Restore or re-attach the file to regenerate/).length).toBeGreaterThan(0);
    expectNothingSent();
  });

  it("explains a replaced unsupported source and keeps saved content", async () => {
    geminiStatus("connected");
    await seed({ filePath: "documents/vor.docx", originalFileName: "vor.docx" });
    await open();
    await studySavedContent();
    expect(screen.getAllByText(/Convert this one to PDF first/).length).toBeGreaterThan(0);
    expect(generateButtons()).toHaveLength(0);
    expectNothingSent();
  });

  it("explains a replaced oversized source and keeps saved content", async () => {
    geminiStatus("connected");
    await seed({ fileSize: 60 * 1024 * 1024 });
    await open();
    await studySavedContent();
    expect(screen.getAllByText(/larger than Gemini|too large|over the/i).length).toBeGreaterThan(0);
    expect(generateButtons()).toHaveLength(0);
    expectNothingSent();
  });

  it("keeps saved content when the material no longer has a file attached", async () => {
    geminiStatus("connected");
    await seed({ filePath: null, originalFileName: null, fileSize: null });
    await open();
    await studySavedContent();
    expect(screen.getAllByText(/no file attached/).length).toBeGreaterThan(0);
    expect(generateButtons()).toHaveLength(0);
    expectNothingSent();
  });
});

describe("A4: generation eligibility stays separate from saved content", () => {
  it("offers regeneration for both saved items only when connected and the file is eligible", async () => {
    geminiStatus("connected");
    await seed();
    await open();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Regenerate" })).toHaveLength(2));
    for (const button of generateButtons()) expect(button.hasAttribute("disabled")).toBe(false);
    await studySavedContent();
    expectNothingSent();
  });

  it("keeps the old guide visible during and after a failed regeneration", async () => {
    geminiStatus("connected");
    await seed();
    let fail!: (error: Error) => void;
    studyAid.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    await open();
    const [regenerateGuide] = await screen.findAllByRole("button", { name: "Regenerate" });
    fireEvent.click(regenerateGuide!);
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    await screen.findByText("Gemini is reviewing this document");
    expect(screen.getByRole("heading", { name: "Saved VOR guide" })).toBeTruthy();
    await act(async () => fail(new Error("Gemini is unavailable right now.")));
    await screen.findByText(/Gemini is unavailable right now/);
    expect(screen.getByRole("heading", { name: "Saved VOR guide" })).toBeTruthy();
    expect((await repos.documents.listAiStudySets())[0]?.title).toBe("Saved VOR guide");
    expect(studyAid).toHaveBeenCalledTimes(1);
  });

  it("keeps the old practice test usable during and after a failed regeneration", async () => {
    geminiStatus("connected");
    await seed();
    let fail!: (error: Error) => void;
    practice.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    await open();
    const regenerate = await screen.findAllByRole("button", { name: "Regenerate" });
    fireEvent.click(regenerate[1]!);
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    await screen.findByText("Gemini is writing practice questions");
    expect(screen.getByText("Saved question one?")).toBeTruthy();
    await act(async () => fail(new Error("Gemini is unavailable right now.")));
    await screen.findByText(/Gemini is unavailable right now/);
    expect(screen.getByText("Saved question one?")).toBeTruthy();
    expect((await repos.documents.listPracticeTests())[0]?.title).toBe("Saved practice test");
  });

  it("keeps another material's saved content usable while a generation runs elsewhere, and a late result goes only to its own material", async () => {
    geminiStatus("connected");
    await seed();
    await repos.documents.create({
      id: "mat-other", title: "Weather handout", filePath: "documents/wx.pdf", originalFileName: "wx.pdf", fileSize: 2048,
    });
    let finish!: (aid: geminiService.GeneratedStudyAid) => void;
    studyAid.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/study/mat-other"] }, h(Probe), h(Ready))));
    await waitFor(() => expect(context.status).toBe("ready"));
    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    await waitFor(() => expect(studyAid).toHaveBeenCalledTimes(1));

    await act(async () => navigate("/study/mat-saved"));
    await screen.findByRole("heading", { name: "VOR navigation handout" });
    // The saved material is fully usable, but cannot start a second Gemini request.
    for (const button of generateButtons()) expect(button.hasAttribute("disabled")).toBe(true);
    await studySavedContent();

    await act(async () => finish({
      title: "Weather guide", summary: "Late summary", sections: [], flashcards: [], sourceNotes: "", model: "gemini-3.5-flash",
    }));
    // GEN-REL-02: a result that arrives after leaving its material is saved to
    // that material only; the material on screen is untouched.
    await waitFor(async () => {
      const sets = await repos.documents.listAiStudySets();
      expect(sets.map((set) => [set.sourceMaterialId, set.title]).sort()).toEqual([
        ["mat-other", "Weather guide"],
        ["mat-saved", "Saved VOR guide"],
      ]);
    });
    expect(screen.getByRole("heading", { name: "Saved VOR guide" })).toBeTruthy();
    // The lock is released once the other request settles.
    await waitFor(() => {
      for (const button of generateButtons()) expect(button.hasAttribute("disabled")).toBe(false);
    });
    expect(network).not.toHaveBeenCalled();
  });
});
