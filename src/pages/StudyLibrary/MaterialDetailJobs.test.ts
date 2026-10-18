// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";
import * as documentService from "@/services/documents";
import { GeminiOrphanNotices } from "@/components/gemini/GeminiOrphanNotices";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * GEN-REL-02: a generation belongs to the app, not to the page. Its answer is
 * saved to the material it was made from while that material is unchanged; a
 * finished answer is a checkpoint that is saved again without asking Gemini;
 * after a reload or restart the journal is read back and nothing is resent.
 * Synthetic materials only; Gemini and the native journal are stand-ins.
 */

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

let context: ReturnType<typeof useAppData>;
let navigate: ReturnType<typeof useNavigate>;

function Probe() {
  context = useAppData();
  navigate = useNavigate();
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

async function material(id: string, title: string, filePath = `documents/${id}.pdf`) {
  return repos.documents.create({ id, title, filePath, originalFileName: `${id}.pdf`, fileSize: 1024 });
}

async function startStudyAid() {
  fireEvent.click(await screen.findByRole("button", { name: /Create study aid|Regenerate/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
}

const studySets = async () =>
  (await repos.documents.listAiStudySets()).map((set) => [set.sourceMaterialId, set.title]);

function record(
  overrides: Partial<geminiService.GeminiJobRecord> & Pick<geminiService.GeminiJobRecord, "stage">,
): geminiService.GeminiJobRecord {
  return {
    id: "job-aaaaaaaaaaaaaaaaaaaaaaaa",
    kind: "study-aid",
    materialId: "mat-a",
    relativePath: "documents/mat-a.pdf",
    contentSha256: "",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("Gemini generations outlive their page (GEN-REL-02)", () => {
  beforeEach(async () => {
    localStorage.clear();
    db = await createNodeSqliteDatabase();
    repos = createRepositories(db);
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({
      configured: true,
      model: "gemini-3.5-flash",
      choice: "standard",
    });
    vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([]);
    jobEvents = [];
    vi.spyOn(geminiService, "watchGeminiJobs").mockImplementation(async (handler) => {
      jobEvents.push(handler);
      return () => {};
    });
    acknowledge = vi.fn<(jobId: string) => Promise<boolean>>().mockResolvedValue(true);
    vi.spyOn(geminiService, "acknowledgeGeminiJob").mockImplementation(acknowledge);
    vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
    vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    db.close();
    vi.restoreAllMocks();
  });

  it("A → B → A: the job stays visible on A and its answer is saved to A", async () => {
    await material("mat-a", "Material A");
    await material("mat-b", "Material B");
    const answer = deferred<geminiService.GeneratedStudyAid & geminiService.GenerationJobIdentity>();
    const generate = vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);

    await open("/study/mat-a");
    await startStudyAid();
    await waitFor(() => expect(generate).toHaveBeenCalledWith("documents/mat-a.pdf", "mat-a", undefined));

    await act(async () => navigate("/study/mat-b"));
    await screen.findByRole("heading", { name: "Material B" });
    expect(screen.queryByText("Gemini is reviewing this document")).toBeNull();
    await act(async () => navigate("/study/mat-a"));
    await screen.findByRole("heading", { name: "Material A" });
    expect(screen.getByText("Gemini is reviewing this document")).toBeTruthy();

    await act(async () => answer.resolve({ ...AID, jobId: "job-111111111111111111111111", contentSha256: "" }));
    await waitFor(async () => expect(await studySets()).toEqual([["mat-a", "Synthetic guide"]]));
    await screen.findByRole("heading", { name: "Synthetic guide" });
    expect(acknowledge).toHaveBeenCalledWith("job-111111111111111111111111");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("leaving the material page entirely does not discard the answer", async () => {
    await material("mat-a", "Material A");
    const answer = deferred<geminiService.GeneratedStudyAid>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    await open("/study/mat-a");
    await startStudyAid();
    await act(async () => navigate("/flight-deck"));
    await screen.findByText("Somewhere else");
    await act(async () => answer.resolve(AID));
    await waitFor(async () => expect(await studySets()).toEqual([["mat-a", "Synthetic guide"]]));
  });

  it("a material deleted while Gemini works receives nothing, and the lock is released", async () => {
    await material("mat-a", "Material A");
    await material("mat-b", "Material B");
    const answer = deferred<geminiService.GeneratedStudyAid>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    await open("/study/mat-a");
    await startStudyAid();
    await act(async () => navigate("/study/mat-b"));
    await act(async () => {
      await context.mutate((r) => r.documents.remove("mat-a"));
    });
    await act(async () => answer.resolve(AID));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create study aid" }).hasAttribute("disabled")).toBe(false),
    );
    expect(await studySets()).toEqual([]);
  });

  it("changed file contents at the same path are detected and the answer is not saved", async () => {
    await material("mat-a", "Material A");
    // The stored bytes no longer match what was sent.
    (db as unknown as { fingerprintStoredDocuments: unknown }).fingerprintStoredDocuments = async (
      paths: string[],
    ) => paths.map((relativePath) => ({ relativePath, sha256: "b".repeat(64) }));
    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({
      ...AID,
      jobId: "job-222222222222222222222222",
      contentSha256: "a".repeat(64),
    });
    await open("/study/mat-a");
    await startStudyAid();
    expect(await screen.findByText(/changed or was removed while Gemini was working/)).toBeTruthy();
    expect(await studySets()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith("job-222222222222222222222222"));
  });

  it("a failed save is retried from the checkpoint without asking Gemini again, and the old guide stays", async () => {
    await material("mat-a", "Material A");
    await repos.documents.saveAiStudySet({
      sourceMaterialId: "mat-a",
      title: "Old guide",
      summary: "Old.",
      sections: [],
      flashcards: [],
      sourceNotes: "",
      model: "gemini-3.5-flash",
    });
    const execute = db.execute.bind(db);
    let failures = 1;
    db.execute = (async (sql: string, params?: unknown[]) => {
      if (failures > 0 && sql.includes("INSERT INTO ai_study_sets")) {
        failures -= 1;
        throw new Error("synthetic disk full");
      }
      return execute(sql, params as never);
    }) as typeof db.execute;
    const generate = vi
      .spyOn(geminiService, "generateStudyAid")
      .mockResolvedValue({ ...AID, title: "New guide", jobId: "job-333333333333333333333333" });

    await open("/study/mat-a");
    await startStudyAid();
    expect(await screen.findByText(/saving the answer did not work/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Old guide" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Regenerate" }).hasAttribute("disabled")).toBe(true);
    expect(acknowledge).not.toHaveBeenCalled();

    const again = screen.getByRole("button", { name: "Save again" });
    fireEvent.click(again);
    fireEvent.click(again);
    await screen.findByRole("heading", { name: "New guide" });
    expect(await studySets()).toEqual([["mat-a", "New guide"]]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  it("after a restart a finished answer waits for a deliberate save, and nothing is sent", async () => {
    await material("mat-a", "Material A");
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([
      record({ stage: "ready", result: { ...AID, title: "Recovered guide" } }),
    ]);
    const generate = vi.spyOn(geminiService, "generateStudyAid");
    await open("/study/mat-a");
    expect(await screen.findByText(/before the app was closed or reloaded/)).toBeTruthy();
    expect(await studySets()).toEqual([]);
    expect(screen.getByRole("button", { name: "Create study aid" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save the new study guide and cards" }));
    await screen.findByRole("heading", { name: "Recovered guide" });
    expect(acknowledge).toHaveBeenCalledWith("job-aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(generate).not.toHaveBeenCalled();
  });

  it("a recovered answer can be discarded, leaving saved content as it was", async () => {
    await material("mat-a", "Material A");
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([
      record({ stage: "ready", kind: "practice-test", result: TEST }),
    ]);
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Discard it" }));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith("job-aaaaaaaaaaaaaaaaaaaaaaaa"));
    expect(await repos.documents.listPracticeTests()).toEqual([]);
    expect(screen.queryByText(/before the app was closed or reloaded/)).toBeNull();
  });

  it("a recovered answer for a material whose file was replaced is not saved", async () => {
    await material("mat-a", "Material A", "documents/replacement.pdf");
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([
      record({ stage: "ready", result: AID, relativePath: "documents/mat-a.pdf" }),
    ]);
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Save the new study guide and cards" }));
    expect(await screen.findByText(/changed or was removed while Gemini was working/)).toBeTruthy();
    expect(await studySets()).toEqual([]);
  });

  it("a generation cut off by the app closing is shown as interrupted and never resent", async () => {
    await material("mat-a", "Material A");
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([record({ stage: "interrupted" })]);
    const generate = vi.spyOn(geminiService, "generateStudyAid");
    await open("/study/mat-a");
    expect(await screen.findByText(/interrupted when the app closed/)).toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
    // She may deliberately try again.
    expect(screen.getByRole("button", { name: "Create study aid" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith("job-aaaaaaaaaaaaaaaaaaaaaaaa"));
  });

  it("a job still running after a reload holds the lock until it finishes, then waits to be saved", async () => {
    await material("mat-a", "Material A");
    await material("mat-b", "Material B");
    const list = vi
      .spyOn(geminiService, "listGeminiJobs")
      .mockResolvedValue([record({ stage: "running" })]);
    const generate = vi.spyOn(geminiService, "generatePracticeTest");
    await open("/study/mat-b");
    await screen.findByRole("heading", { name: "Material B" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create practice test" }).hasAttribute("disabled")).toBe(true),
    );
    list.mockResolvedValue([record({ stage: "ready", result: AID })]);
    await act(async () => {
      for (const handler of jobEvents) handler({ id: "job-aaaaaaaaaaaaaaaaaaaaaaaa", stage: "ready" });
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create practice test" }).hasAttribute("disabled")).toBe(false),
    );
    await act(async () => navigate("/study/mat-a"));
    expect(await screen.findByText(/before the app was closed or reloaded/)).toBeTruthy();
    expect(await studySets()).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it("a refused generation is explained, saves nothing and frees the lock", async () => {
    await material("mat-a", "Material A");
    vi.spyOn(geminiService, "generateStudyAid").mockRejectedValue(
      "Connect the free Gemini API in Settings first.",
    );
    await open("/study/mat-a");
    await startStudyAid();
    expect(await screen.findByText("Connect the free Gemini API in Settings first.")).toBeTruthy();
    expect(await studySets()).toEqual([]);
    expect(screen.getByRole("button", { name: "Create study aid" }).hasAttribute("disabled")).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* Review round 1 regressions (GENREL02-R3, R4, R6, R7)             */
  /* ---------------------------------------------------------------- */

  async function savedAid(title: string) {
    await repos.documents.saveAiStudySet({
      sourceMaterialId: "mat-a",
      title,
      summary: AID.summary,
      sections: AID.sections,
      flashcards: AID.flashcards,
      sourceNotes: AID.sourceNotes,
      model: AID.model,
    });
    return (await repos.documents.listAiStudySets())[0];
  }

  it("R3: an answer already saved before the app closed is recognized, forgotten and never saved twice", async () => {
    await material("mat-a", "Material A");
    const before = await savedAid(AID.title);
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([record({ stage: "ready", result: AID })]);
    await open("/study/mat-a");
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith("job-aaaaaaaaaaaaaaaaaaaaaaaa"));
    expect(screen.queryByText(/before the app was closed or reloaded/)).toBeNull();
    const [after] = await repos.documents.listAiStudySets();
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("R3: something saved while Gemini worked is never overwritten", async () => {
    await material("mat-a", "Material A");
    const answer = deferred<geminiService.GeneratedStudyAid & geminiService.GenerationJobIdentity>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    await open("/study/mat-a");
    await startStudyAid();
    // An import, or another device's restore, saves a guide in the meantime.
    await act(async () => {
      await context.mutate((r) =>
        r.documents.saveAiStudySet({
          sourceMaterialId: "mat-a", title: "Newer guide", summary: "", sections: [], flashcards: [], sourceNotes: "", model: "",
        }),
      );
    });
    await act(async () => answer.resolve({ ...AID, jobId: "job-444444444444444444444444", checkpointed: true }));
    expect(await screen.findByText(/Something newer was saved/)).toBeTruthy();
    expect(await studySets()).toEqual([["mat-a", "Newer guide"]]);
  });

  it("R3: a recovered answer whose base was replaced since is not saved over the newer content", async () => {
    await material("mat-a", "Material A");
    await savedAid("Current guide");
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([
      record({ stage: "ready", result: { ...AID, title: "Old answer" }, baseRevision: "2020-01-01T00:00:00.000Z" }),
    ]);
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Save the new study guide and cards" }));
    expect(await screen.findByText(/Something newer was saved/)).toBeTruthy();
    expect(await studySets()).toEqual([["mat-a", "Current guide"]]);
  });

  it("R3: an acknowledgement that fails is retried later", async () => {
    await material("mat-a", "Material A");
    acknowledge.mockRejectedValueOnce(new Error("synthetic journal write failure"));
    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({
      ...AID, jobId: "job-555555555555555555555555", checkpointed: true,
    });
    await open("/study/mat-a");
    await startStudyAid();
    await screen.findByRole("heading", { name: "Synthetic guide" });
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));
    await act(async () => {
      for (const handler of jobEvents) handler({ id: "job-555555555555555555555555", stage: "ready" });
    });
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));
    expect(acknowledge).toHaveBeenLastCalledWith("job-555555555555555555555555");
  });

  it("R4: a job that finishes between the snapshot and the listener is still noticed", async () => {
    await material("mat-a", "Material A");
    const list = vi.spyOn(geminiService, "listGeminiJobs");
    list.mockResolvedValueOnce([record({ stage: "running" })]);
    list.mockResolvedValue([record({ stage: "ready", result: AID })]);
    await open("/study/mat-a");
    // No change event is ever delivered.
    expect(await screen.findByText(/before the app was closed or reloaded/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create practice test" }).hasAttribute("disabled")).toBe(false);
  });

  it("R4: a change event that arrives while the snapshot is pending is not lost", async () => {
    await material("mat-a", "Material A");
    const first = deferred<geminiService.GeminiJobRecord[]>();
    const list = vi.spyOn(geminiService, "listGeminiJobs");
    list.mockImplementationOnce(() => first.promise);
    list.mockResolvedValue([record({ stage: "ready", result: AID })]);
    await open("/study/mat-a");
    await waitFor(() => expect(jobEvents.length).toBe(1));
    await act(async () => {
      jobEvents[0]?.({ id: "job-aaaaaaaaaaaaaaaaaaaaaaaa", stage: "ready" });
    });
    await act(async () => first.resolve([record({ stage: "running" })]));
    expect(await screen.findByText(/before the app was closed or reloaded/)).toBeTruthy();
  });

  it("R4: a running job is followed on a timer when its event is missed", async () => {
    await material("mat-a", "Material A");
    const list = vi.spyOn(geminiService, "listGeminiJobs");
    list.mockResolvedValue([record({ stage: "running" })]);
    await open("/study/mat-a");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create practice test" }).hasAttribute("disabled")).toBe(true),
    );
    list.mockResolvedValue([record({ stage: "failed", error: "Synthetic stop." })]);
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Create practice test" }).hasAttribute("disabled")).toBe(false),
      { timeout: 6000 },
    );
    expect(screen.getByText("Synthetic stop.")).toBeTruthy();
  }, 10000);

  it("R6: nothing starts while earlier work is still being read back", async () => {
    await material("mat-a", "Material A");
    const pending = deferred<geminiService.GeminiJobRecord[]>();
    vi.spyOn(geminiService, "listGeminiJobs").mockImplementation(() => pending.promise);
    const generate = vi.spyOn(geminiService, "generateStudyAid");
    await open("/study/mat-a");
    const create = await screen.findByRole("button", { name: "Create study aid" });
    expect(create.hasAttribute("disabled")).toBe(true);
    fireEvent.click(create);
    expect(screen.queryByRole("button", { name: "Send to Gemini" })).toBeNull();
    await act(async () => pending.resolve([record({ stage: "ready", result: AID })]));
    expect(await screen.findByText(/before the app was closed or reloaded/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create study aid" }).hasAttribute("disabled")).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it("R6: if earlier work cannot be read back, she is told and can check again", async () => {
    await material("mat-a", "Material A");
    const list = vi.spyOn(geminiService, "listGeminiJobs");
    list.mockRejectedValueOnce(new Error("synthetic"));
    list.mockResolvedValue([]);
    await open("/study/mat-a");
    expect(await screen.findByText(/could not check for study aids Gemini was already working on/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create study aid" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create study aid" }).hasAttribute("disabled")).toBe(false),
    );
  });

  it("R7: a file changed while the save waited in the queue is caught at the moment of saving", async () => {
    await material("mat-a", "Material A");
    let stored = "a".repeat(64);
    (db as unknown as { fingerprintStoredDocuments: unknown }).fingerprintStoredDocuments = async (
      paths: string[],
    ) => paths.map((relativePath) => ({ relativePath, sha256: stored }));
    const answer = deferred<geminiService.GeneratedStudyAid & geminiService.GenerationJobIdentity>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    await open("/study/mat-a");
    await startStudyAid();
    // An earlier write holds the queue; the bytes change while the save waits.
    const hold = deferred<void>();
    let queued!: Promise<unknown>;
    act(() => {
      queued = context.mutate(() => hold.promise);
    });
    await act(async () =>
      answer.resolve({ ...AID, jobId: "job-666666666666666666666666", contentSha256: "a".repeat(64), checkpointed: true }),
    );
    stored = "b".repeat(64);
    await act(async () => {
      hold.resolve();
      await queued;
    });
    expect(await screen.findByText(/changed or was removed while Gemini was working/)).toBeTruthy();
    expect(await studySets()).toEqual([]);
  });

  it("R2: an answer that could not be kept natively says Save again works only while the app stays open", async () => {
    await material("mat-a", "Material A");
    const execute = db.execute.bind(db);
    db.execute = (async (sql: string, params?: unknown[]) => {
      if (sql.includes("INSERT INTO ai_study_sets")) throw new Error("synthetic disk full");
      return execute(sql, params as never);
    }) as typeof db.execute;
    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({ ...AID, jobId: null, checkpointed: false });
    await open("/study/mat-a");
    await startStudyAid();
    expect(await screen.findByText(/could not be kept on this Mac either/)).toBeTruthy();
  });

  /* ---------------------------------------------------------------- */
  /* Review round 2 regressions (GENREL02-R9, R12)                    */
  /* ---------------------------------------------------------------- */

  it("R9: a discard the journal could not record says so and can be tried again", async () => {
    await material("mat-a", "Material A");
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([record({ stage: "ready", result: AID })]);
    acknowledge.mockRejectedValueOnce(new Error("synthetic journal write failure"));
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Discard it" }));
    expect(await screen.findByText(/might come back after the app restarts/)).toBeTruthy();
    // Still waiting: nothing new can overwrite it meanwhile.
    expect(screen.getByRole("button", { name: "Create study aid" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText(/might come back after the app restarts/)).toBeNull());
    expect(acknowledge).toHaveBeenCalledTimes(2);
    expect(await studySets()).toEqual([]);
  });

  it("R9: after a save, a failed acknowledgement is retried on its own, without any event", async () => {
    await material("mat-a", "Material A");
    acknowledge.mockRejectedValueOnce(new Error("synthetic journal write failure"));
    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({
      ...AID, jobId: "job-777777777777777777777777", checkpointed: true,
    });
    await open("/study/mat-a");
    await startStudyAid();
    await screen.findByRole("heading", { name: "Synthetic guide" });
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2), { timeout: 6000 });
    expect(acknowledge).toHaveBeenLastCalledWith("job-777777777777777777777777");
  }, 10000);

  it("R12: a slow, older snapshot never brings back an answer already dismissed", async () => {
    await material("mat-a", "Material A");
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([record({ stage: "ready", result: AID })]);
    // Hold the first read of saved guides, so the first reconciliation is slow.
    const select = db.select.bind(db);
    const hold = deferred<void>();
    let held = false;
    db.select = (async (sql: string, params?: unknown[]) => {
      if (!held && sql.includes("FROM ai_study_sets") && context?.status === "ready") {
        held = true;
        await hold.promise;
      }
      return select(sql, params as never);
    }) as typeof db.select;
    await open("/study/mat-a");
    await waitFor(() => expect(jobEvents.length).toBe(1));
    // A change arrives while the first reconciliation is still reading.
    await act(async () => {
      jobEvents[0]?.({ id: "job-aaaaaaaaaaaaaaaaaaaaaaaa", stage: "ready" });
    });
    await act(async () => hold.resolve());
    fireEvent.click(await screen.findByRole("button", { name: "Discard it" }));
    await waitFor(() => expect(screen.queryByText(/before the app was closed or reloaded/)).toBeNull());
    // The journal stand-in still lists it (an older snapshot): it stays gone.
    await act(async () => {
      jobEvents[0]?.({ id: "job-aaaaaaaaaaaaaaaaaaaaaaaa", stage: "ready" });
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/before the app was closed or reloaded/)).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Discard it" })).toHaveLength(0);
  });

  /* ---------------------------------------------------------------- */
  /* Review round 4 regression (GENREL02-R15)                         */
  /* ---------------------------------------------------------------- */

  it("R15: an answer for a material deleted mid-generation is shown everywhere and can be dismissed", async () => {
    await material("mat-a", "Material A");
    await material("mat-b", "Material B");
    const answer = deferred<geminiService.GeneratedStudyAid & geminiService.GenerationJobIdentity>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    await open("/study/mat-a");
    await startStudyAid();
    await act(async () => navigate("/flight-deck"));
    await act(async () => {
      await context.mutate((r) => r.documents.remove("mat-a"));
    });
    await act(async () => answer.resolve({ ...AID, jobId: "job-888888888888888888888888", checkpointed: true }));
    expect(await screen.findByText(/for a document that has since been deleted, so it could not be saved/)).toBeTruthy();
    expect(await studySets()).toEqual([]);
    // Still visible on another material's page.
    await act(async () => navigate("/study/mat-b"));
    await screen.findByRole("heading", { name: "Material B" });
    expect(screen.getByText(/has since been deleted, so it could not be saved/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith("job-888888888888888888888888"));
    await waitFor(() => expect(screen.queryByText(/has since been deleted/)).toBeNull());
  });

  it("R15: after a restart, orphaned answers are offered for dismissal, freeing their journal places", async () => {
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([
      record({ stage: "ready", result: AID, materialId: "mat-gone" }),
      record({ id: "job-bbbbbbbbbbbbbbbbbbbbbbbb", stage: "ready", kind: "practice-test", result: TEST, materialId: "mat-gone-2" }),
    ]);
    acknowledge.mockRejectedValueOnce(new Error("synthetic journal write failure"));
    await open("/flight-deck");
    await screen.findByText("Somewhere else");
    const dismiss = await screen.findAllByRole("button", { name: "Dismiss" });
    expect(dismiss).toHaveLength(2);
    fireEvent.click(dismiss[0]!);
    // A dismissal the journal could not record says so and can be retried.
    expect(await screen.findByText(/might come back after the app restarts/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /Dismiss|Try again/ })).toHaveLength(0));
    expect(acknowledge).toHaveBeenCalledWith("job-aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(acknowledge).toHaveBeenCalledWith("job-bbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("R15: the app shell shows orphaned answers above every screen", () => {
    const shell = readFileSync(join(process.cwd(), "src/components/layout/AppShell.tsx"), "utf8");
    expect(shell).toMatch(/<div className="content__inner">\s*<GeminiOrphanNotices \/>/);
  });
});
