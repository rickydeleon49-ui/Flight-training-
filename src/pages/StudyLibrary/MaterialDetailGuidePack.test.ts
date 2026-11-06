// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";
import * as documentService from "@/services/documents";
import { GeminiOrphanNotices } from "@/components/gemini/GeminiOrphanNotices";
import { useStatusAfterEffects, waitForReadyAfterEffects } from "@/testing/afterEffects";

/**
 * GUIDE-PACK-01: a first study guide brings 20 flashcards and a practice test
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
  useStatusAfterEffects(context.status);
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
  await waitForReadyAfterEffects();
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

async function acceptStudyAid() {
  fireEvent.click(await screen.findByRole("button", { name: "Save the new study guide" }));
}

const GUIDE_ONLY = { ...AID, flashcards: [] as typeof AID.flashcards };
const twenty = Array.from({ length: 20 }, (_, n) => ({ front: `Front ${n}`, back: `Back ${n}`, sourcePage: 1 }));

describe("A study guide brings flashcards and a study test (GUIDE-PACK-01)", () => {
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

  const tests = async () => (await repos.documents.listPracticeTests()).map((test) => [test.sourceMaterialId, test.questions.length]);
  const cards = async (id: string) => (await repos.documents.listAiStudySets()).find((set) => set.sourceMaterialId === id)?.flashcards ?? [];

  it("a saved first guide queues 20 cards and the test once", async () => {
    await material("mat-a", "Material A");
    const generate = vi.spyOn(geminiService, "generateStudyAid")
      .mockResolvedValueOnce({ ...GUIDE_ONLY, jobId: "job-111111111111111111111111", contentSha256: "" })
      .mockResolvedValueOnce({ ...GUIDE_ONLY, flashcards: twenty, jobId: "job-222222222222222222222222", contentSha256: "" });
    const test = vi.spyOn(geminiService, "generatePracticeTest").mockResolvedValue({ ...TEST, jobId: "job-333333333333333333333333", contentSha256: "" });
    await open("/study/mat-a");
    await startStudyAid();
    await acceptStudyAid();
    await waitFor(async () => expect(await tests()).toEqual([["mat-a", 1]]));
    expect((await cards("mat-a")).length).toBe(20);
    expect(generate).toHaveBeenCalledTimes(2);
    // The card follow-up is a cards-only request for 20.
    expect(generate.mock.calls[1]![4]).toBe(20);
    expect(generate.mock.calls[1]![5]).toBe(true);
    expect(test).toHaveBeenCalledTimes(1);
    // The saved guide is still the guide.
    expect((await repos.documents.listAiStudySets())[0]!.title).toBe("Synthetic guide");
  });

  it("skips cards and test the material already has, replacing nothing", async () => {
    await material("mat-a", "Material A");
    await repos.documents.savePracticeTest({ sourceMaterialId: "mat-a", title: "Mine", questions: TEST.questions, provider: "gemini", model: "gemini-3.5-flash" });
    const generate = vi.spyOn(geminiService, "generateStudyAid")
      .mockResolvedValue({ ...AID, jobId: "job-111111111111111111111111", contentSha256: "" });
    const test = vi.spyOn(geminiService, "generatePracticeTest");
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    await acceptStudyAid();
    await waitFor(async () => expect((await cards("mat-a")).length).toBe(1));
    await waitFor(() => expect(screen.queryByText("Making your flashcards and study test…")).toBeNull());
    expect(generate).toHaveBeenCalledTimes(1);
    expect(test).not.toHaveBeenCalled();
    expect((await repos.documents.listPracticeTests())[0]!.title).toBe("Mine");
  });

  it("Regenerate makes the guide alone", async () => {
    await material("mat-a", "Material A");
    await repos.documents.saveAiStudySet({ sourceMaterialId: "mat-a", title: "Old", summary: "Old.", sections: [], flashcards: [], sourceNotes: "", model: "gemini-3.5-flash" });
    const generate = vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({ ...GUIDE_ONLY, jobId: "job-111111111111111111111111", contentSha256: "" });
    const test = vi.spyOn(geminiService, "generatePracticeTest");
    await open("/study/mat-a");
    await startStudyAid();
    await acceptStudyAid();
    await waitFor(async () => expect((await repos.documents.listAiStudySets())[0]!.title).toBe("Synthetic guide"));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(test).not.toHaveBeenCalled();
  });

  it("a failed follow-up keeps the guide and leaves a retry", async () => {
    await material("mat-a", "Material A");
    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({ ...AID, jobId: "job-111111111111111111111111", contentSha256: "" });
    vi.spyOn(geminiService, "generatePracticeTest").mockRejectedValue(new Error("synthetic network failure"));
    await open("/study/mat-a");
    await startStudyAid();
    await acceptStudyAid();
    await waitFor(() => expect(geminiService.generatePracticeTest).toHaveBeenCalledTimes(1));
    expect((await repos.documents.listAiStudySets())[0]!.title).toBe("Synthetic guide");
    expect(await tests()).toEqual([]);
    expect((await screen.findAllByRole("button", { name: "Try again" })).length).toBeGreaterThan(0);
  });

  it("Make 10 more cards sends the fronts, skips repeats, appends and keeps the student's own cards", async () => {
    await material("mat-a", "Material A");
    await repos.documents.saveAiStudySet({ sourceMaterialId: "mat-a", title: "Guide", summary: "S.", sections: [], flashcards: twenty.slice(0, 3), sourceNotes: "", model: "gemini-3.5-flash" });
    const generate = vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({
      title: "More flashcards", summary: "", sections: [], sourceNotes: geminiService.MORE_CARDS_NOTE, model: "gemini-3.5-flash",
      flashcards: [twenty[1]!, { front: " FRONT 2 ", back: "dupe", sourcePage: 1 }, ...twenty.slice(3, 8)],
      jobId: "job-111111111111111111111111", contentSha256: "",
    });
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Make 10 more cards" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    await waitFor(async () => expect((await cards("mat-a")).length).toBe(8));
    expect(generate.mock.calls[0]![6]).toEqual(["Front 0", "Front 1", "Front 2"]);
    expect((await cards("mat-a")).map((card) => card.front)).toEqual(
      ["Front 0", "Front 1", "Front 2", "Front 3", "Front 4", "Front 5", "Front 6", "Front 7"]);
    const set = (await repos.documents.listAiStudySets())[0]!;
    expect(set.title).toBe("Guide");
    expect(set.summary).toBe("S.");
  });

  const MORE = {
    title: "More flashcards", summary: "", sections: [], sourceNotes: geminiService.MORE_CARDS_NOTE, model: "gemini-3.5-flash",
    flashcards: twenty.slice(3, 8), jobId: "job-111111111111111111111111", contentSha256: "",
  };

  it("a more-cards answer that failed to save never offers the replace-style Review, and Save appends", async () => {
    await material("mat-a", "Material A");
    await repos.documents.saveAiStudySet({ sourceMaterialId: "mat-a", title: "Guide", summary: "S.", sections: [], flashcards: [...twenty.slice(0, 2), { front: "Mine", back: "Mine A", sourcePage: null, origin: "user" } as never], sourceNotes: "", model: "gemini-3.5-flash" });
    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue(MORE);
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Make 10 more cards" }));
    let failures = 1;
    db.beforeStatement = (sql) => { if (failures && sql.includes("INSERT INTO ai_study_sets")) { failures -= 1; throw new Error("synthetic storage failure"); } };
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    await screen.findByRole("button", { name: "Save again" });
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
    expect((await cards("mat-a")).length).toBeGreaterThanOrEqual(3);
    db.beforeStatement = undefined;
    const before = (await cards("mat-a")).length;
    fireEvent.click(screen.getByRole("button", { name: "Save again" }));
    await waitFor(async () => expect((await cards("mat-a")).length).toBe(before + 5));
    expect((await cards("mat-a")).slice(0, 3).map((c) => c.front)).toEqual(["Front 0", "Front 1", "Mine"]);
  });

  it("Try again after a failed Make 10 more cards reopens the More dialog, not the replace flow", async () => {
    await material("mat-a", "Material A");
    await repos.documents.saveAiStudySet({ sourceMaterialId: "mat-a", title: "Guide", summary: "S.", sections: [], flashcards: twenty.slice(0, 3), sourceNotes: "", model: "gemini-3.5-flash" });
    const generate = vi.spyOn(geminiService, "generateStudyAid").mockRejectedValue(new Error("synthetic network failure"));
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Make 10 more cards" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    const retry = (await screen.findAllByRole("button", { name: "Try again" }))[0]!;
    fireEvent.click(retry);
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    // The second request is again a "more" request carrying her card fronts.
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(generate.mock.calls[1]![6]).toEqual(["Front 0", "Front 1", "Front 2"]);
  });

  it("when nothing new was found, no Try again is offered", async () => {
    await material("mat-a", "Material A");
    await repos.documents.saveAiStudySet({ sourceMaterialId: "mat-a", title: "Guide", summary: "S.", sections: [], flashcards: twenty.slice(0, 3), sourceNotes: "", model: "gemini-3.5-flash" });
    vi.spyOn(geminiService, "generateStudyAid").mockRejectedValue(new Error("Gemini didn't find any new cards in this file. Your cards are unchanged."));
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Make 10 more cards" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    await screen.findByText(/didn.t find any new cards/);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("appending never replaces, dedupes against the set and stops at the card limit", async () => {
    await material("mat-a", "Material A");
    const many = Array.from({ length: 498 }, (_, n) => ({ front: `Own ${n}`, back: "b", sourcePage: null }));
    await repos.documents.saveAiStudySet({ sourceMaterialId: "mat-a", title: "Guide", summary: "S.", sections: [], flashcards: many, sourceNotes: "", model: "m" });
    const added = await repos.documents.appendGeneratedCards("mat-a", [
      { front: "own 3", back: "dupe", sourcePage: null },
      { front: "New 1", back: "b", sourcePage: 1 },
      { front: "New 2", back: "b", sourcePage: 1 },
      { front: "New 3", back: "b", sourcePage: 1 },
    ]);
    expect(added).toBe(2);
    expect((await cards("mat-a")).length).toBe(500);
    expect(await repos.documents.appendGeneratedCards("mat-a", [{ front: "Another", back: "b", sourcePage: 1 }])).toBe(0);
    expect(await repos.documents.appendGeneratedCards("nope", [{ front: "x", back: "y", sourcePage: 1 }])).toBeNull();
  });

  it("at the card limit the button is disabled with a short reason", async () => {
    await material("mat-a", "Material A");
    const full = Array.from({ length: 500 }, (_, n) => ({ front: `Own ${n}`, back: "b", sourcePage: null }));
    await repos.documents.saveAiStudySet({ sourceMaterialId: "mat-a", title: "Guide", summary: "S.", sections: [], flashcards: full, sourceNotes: "", model: "m" });
    await open("/study/mat-a");
    const button = await screen.findByRole("button", { name: "Make 10 more cards" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("You have the most cards one set can hold.")).toBeTruthy();
  });
});
