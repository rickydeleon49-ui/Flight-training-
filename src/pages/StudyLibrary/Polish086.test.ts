// @vitest-environment jsdom
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
import { GeminiOrphanNotices } from "@/components/gemini/GeminiOrphanNotices";

/**
 * POLISH-086 (student run R11 friction): status near the button, short card counts,
 * one start screen. Based on the GUIDE-PACK-01 harness. A first guide brings 20 flashcards and a practice test
 * (skipping what the material has), and "Make 10 more cards" appends.
 * Synthetic materials only; Gemini and the native journal are stand-ins.
 */

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
  const { status } = useAppData();
  // The shell shows orphaned answers above every screen.
  return status === "ready"
    ? h(
        "div",
        null,
        h(GeminiOrphanNotices),
        h(
          Routes,
          null,
          h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }),
          h(Route, { path: "*", element: h("p", null, "Somewhere else") }),
        ),
      )
    : null;
}

async function open(path: string) {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Probe), h(Ready))));
  await waitFor(() => expect(context.status).toBe("ready"));
}

const AID = {
  title: "Synthetic guide",
  summary: "Synthetic summary.",
  sections: [{ heading: "Class B", body: "Synthetic." }],
  flashcards: [{ front: "Q", back: "A", sourcePage: 1 }],
  sourceNotes: "",
  model: "gemini-3.5-flash",
};
const TEST = {
  title: "Synthetic quiz",
  questions: [{ question: "Q?", options: ["A", "B"], correctIndex: 1, explanation: "Because.", sourcePage: 2 }],
  model: "gemini-3.5-flash",
};

let repos: ReturnType<typeof createRepositories>;
let jobEvents: Array<(change: { id: string; stage: geminiService.GeminiJobStage }) => void>;
let acknowledge: ReturnType<typeof vi.fn<(jobId: string) => Promise<boolean>>>;

async function material(id: string, title: string, filePath = `documents/${id}.txt`) {
  return repos.documents.create({ id, title, filePath, originalFileName: `${id}.txt`, fileSize: 1024 });
}

async function startStudyAid() {
  fireEvent.click(await screen.findByRole("button", { name: /Create study aid|Regenerate/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
}

const three = Array.from({ length: 3 }, (_, n) => ({ front: `Front ${n}`, back: `Back ${n}`, sourcePage: 1 }));

describe("POLISH-086 guide-pack friction", () => {
  beforeEach(async () => {
    localStorage.clear();
    db = await createNodeSqliteDatabase();
    repos = createRepositories(db);
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: true, model: "gemini-3.5-flash", choice: "standard" });
    vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([]);
    jobEvents = [];
    vi.spyOn(geminiService, "watchGeminiJobs").mockImplementation(async (handler) => { jobEvents.push(handler); return () => {}; });
    acknowledge = vi.fn<(jobId: string) => Promise<boolean>>().mockResolvedValue(true);
    vi.spyOn(geminiService, "acknowledgeGeminiJob").mockImplementation(acknowledge);
    vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
    vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
  });

  afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

  it("item 1: a status line sits under the guide button while it works, then points to the draft", async () => {
    await material("mat-a", "Material A");
    let finish!: (value: geminiService.GeneratedStudyAid) => void;
    vi.spyOn(geminiService, "generateStudyAid").mockReturnValue(new Promise((resolve) => { finish = resolve as never; }));
    await open("/study/mat-a");
    await startStudyAid();
    await waitFor(() => expect(document.querySelector("[data-guide-status]")?.textContent).toBe("Making your study guide…"));
    await act(async () => finish({ ...AID, jobId: "job-111111111111111111111111", contentSha256: "" } as never));
    await waitFor(() => expect(document.querySelector("[data-guide-status]")?.textContent).toMatch(/Your guide is ready below/));
    expect(document.getElementById("material-guide-draft")).not.toBeNull();
  });

  it("item 1: Make 10 more cards shows its own status line under the Flashcards header", async () => {
    await material("mat-a", "Material A");
    await repos.documents.saveAiStudySet({ sourceMaterialId: "mat-a", title: "Guide", summary: "S.", sections: [], flashcards: three, sourceNotes: "", model: "gemini-3.5-flash" });
    let finish!: (value: unknown) => void;
    vi.spyOn(geminiService, "generateStudyAid").mockReturnValue(new Promise((resolve) => { finish = resolve as never; }));
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Make 10 more cards" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    await waitFor(() => expect(document.querySelector("[data-cards-status]")?.textContent).toBe("Making 10 more cards…"));
    await act(async () => finish({ title: "More", summary: "", sections: [], sourceNotes: geminiService.MORE_CARDS_NOTE, model: "m", flashcards: [{ front: "New 1", back: "b", sourcePage: 1 }], jobId: "job-111111111111111111111111", contentSha256: "" }));
    await waitFor(() => expect(document.querySelector("[data-cards-status]")?.textContent).toBe("Gemini found 1 more card in this file."));
  });

  it("item 2: fewer cards than the target are explained once", async () => {
    await material("mat-a", "Material A");
    await repos.documents.saveAiStudySet({ sourceMaterialId: "mat-a", title: "Guide", summary: "S.", sections: [], flashcards: three, sourceNotes: "", model: "gemini-3.5-flash" });
    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({ title: "G", summary: "", sections: [], sourceNotes: "", model: "m", flashcards: three.slice(0, 2), jobId: "job-111111111111111111111111", contentSha256: "" });
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: /Make new cards with/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    await waitFor(() => expect(document.querySelector("[data-cards-status]")?.textContent).toBe("Gemini made 2 cards; this file is short, so there wasn't more to ask about."));
  });

  it("item 4: the practice test shows no question counter until Start", async () => {
    await material("mat-a", "Material A");
    await repos.documents.savePracticeTest({ sourceMaterialId: "mat-a", title: "Quiz", questions: TEST.questions, provider: "gemini", model: "gemini-3.5-flash" });
    await open("/study/mat-a");
    await screen.findByRole("button", { name: "Start practice test" });
    expect(screen.queryByRole("status", { name: "Practice progress" })).toBeNull();
    expect(screen.queryByText(/Question 1 of/)).toBeNull();
    expect(screen.queryByRole("heading", { name: /Question 1 of/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start practice test" }));
    await screen.findByRole("heading", { name: "Question 1 of 1" });
  });
});
