// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { CANCELLED_BEFORE_SENDING } from "@/state/GeminiJobs";
import * as geminiService from "@/services/gemini";
import * as documentService from "@/services/documents";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * GEN-REL-04: honest, job-scoped progress, Cancel, and stage-appropriate
 * recovery. Gemini and the native journal are stand-ins; synthetic materials.
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
  return status === "ready"
    ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }))
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
  summary: "Synthetic.",
  sections: [{ heading: "Class B", body: "Synthetic." }],
  flashcards: [{ front: "Q", back: "A", sourcePage: 1 }],
  sourceNotes: "",
  model: "gemini-3.5-flash",
};
const CANCELLED_TEXT = geminiService.GEMINI_CANCELLED_MESSAGE;
const JOB = "job-cccccccccccccccccccccccc";

let repos: ReturnType<typeof createRepositories>;
let progress: Array<(event: geminiService.GeminiProgressEvent) => void>;
type CancelTarget = { requestId?: string; jobId?: string };
let cancel: ReturnType<typeof vi.fn<(target: CancelTarget) => Promise<geminiService.GeminiCancelOutcome>>>;

function emit(event: Partial<geminiService.GeminiProgressEvent>) {
  const full: geminiService.GeminiProgressEvent = {
    jobId: null,
    materialId: "mat-a",
    kind: "study-aid",
    stage: null,
    message: null,
    attempt: 0,
    maxAttempts: 9,
    ...event,
  };
  act(() => {
    for (const handler of progress) handler(full);
  });
}

async function startStudyAid() {
  fireEvent.click(await screen.findByRole("button", { name: /Create study aid|Regenerate/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
}

const studySets = async () => (await repos.documents.listAiStudySets()).map((s) => [s.sourceMaterialId, s.title]);

describe("honest progress, Cancel and recovery (GEN-REL-04)", () => {
  beforeEach(async () => {
    localStorage.clear();
    db = await createNodeSqliteDatabase();
    repos = createRepositories(db);
    await repos.documents.create({ id: "mat-a", title: "Material A", filePath: "documents/a.pdf", originalFileName: "a.pdf", fileSize: 1024 });
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: true, model: "gemini-3.5-flash", choice: "standard" });
    progress = [];
    vi.spyOn(geminiService, "watchGeminiProgress").mockImplementation(async (handler) => {
      progress.push(handler);
      return () => {
        progress = progress.filter((h) => h !== handler);
      };
    });
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([]);
    vi.spyOn(geminiService, "watchGeminiJobs").mockResolvedValue(() => {});
    vi.spyOn(geminiService, "acknowledgeGeminiJob").mockResolvedValue(true);
    cancel = vi.fn<(target: CancelTarget) => Promise<geminiService.GeminiCancelOutcome>>().mockResolvedValue({ cancelled: true, stage: "cancelled" });
    vi.spyOn(geminiService, "cancelGeminiJob").mockImplementation(cancel);
    vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
    vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    db.close();
    vi.restoreAllMocks();
  });

  it("shows the stage actually reached, the request and the time, in a live status, and no percentage", async () => {
    const answer = deferred<geminiService.GeneratedStudyAid>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    await open("/study/mat-a");
    await startStudyAid();
    await waitFor(() => expect(progress.length).toBe(1));
    emit({ jobId: JOB, stage: "uploading" });
    const status = screen.getByRole("status", { name: "" });
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toMatch(/Sending the PDF to Google/);
    expect(status.textContent).toMatch(/s so far/);
    emit({ jobId: JOB, stage: "generating", attempt: 2 });
    expect(screen.getByText(/Waiting for Gemini's answer · request 2 of 9/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/%/);
    // Another job's progress is never shown here.
    emit({ jobId: "job-dddddddddddddddddddddddd", stage: "reading" });
    emit({ jobId: null, materialId: "mat-other", stage: "reading" });
    expect(screen.queryByText(/Receiving Gemini's answer/)).toBeNull();
    await act(async () => answer.resolve(AID));
  });

  it("Cancel is a keyboard-reachable button that stops the job, and nothing is saved", async () => {
    const answer = deferred<geminiService.GeneratedStudyAid>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    await open("/study/mat-a");
    await startStudyAid();
    await waitFor(() => expect(progress.length).toBe(1));
    emit({ jobId: JOB, stage: "generating", attempt: 1 });
    const button = screen.getByRole("button", { name: "Cancel" });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({ requestId: expect.stringMatching(/^req-/), jobId: JOB }),
    );
    expect(screen.getByRole("button", { name: "Cancelling…" }).hasAttribute("disabled")).toBe(true);
    await act(async () => answer.reject(CANCELLED_TEXT));
    expect(await screen.findByText(CANCELLED_TEXT)).toBeTruthy();
    // Try again appears once the lock is released, without any other event.
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(await studySets()).toEqual([]);
    // A late event for the cancelled job does not bring the spinner back.
    emit({ jobId: JOB, stage: "reading" });
    expect(screen.queryByText("Gemini is reviewing this document")).toBeNull();
  });

  it("a cancel before the job has an id goes out at once, by the window's own request id", async () => {
    const answer = deferred<geminiService.GeneratedStudyAid>();
    const generate = vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    await open("/study/mat-a");
    await startStudyAid();
    await waitFor(() => expect(generate).toHaveBeenCalled());
    const requestId = generate.mock.calls[0]![3];
    expect(requestId).toMatch(/^req-/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ requestId, jobId: undefined }));
    await act(async () => answer.reject(CANCELLED_TEXT));
    expect(await screen.findByText(CANCELLED_TEXT)).toBeTruthy();
  });

  it("cancelling during the local checks sends nothing at all", async () => {
    const exists = deferred<boolean>();
    vi.spyOn(documentService, "documentExists").mockImplementation(() => exists.promise);
    const generate = vi.spyOn(geminiService, "generateStudyAid");
    await open("/study/mat-a");
    exists.resolve(true);
    // The first documentExists (on open) resolved; hold the preflight one.
    const preflight = deferred<boolean>();
    vi.spyOn(documentService, "documentExists").mockImplementation(() => preflight.promise);
    await startStudyAid();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await act(async () => preflight.resolve(true));
    expect(await screen.findByText(CANCELLED_BEFORE_SENDING)).toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("an answer that beat the cancel is never saved by itself: she chooses", async () => {
    const answer = deferred<geminiService.GeneratedStudyAid & geminiService.GenerationJobIdentity>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    cancel.mockResolvedValue({ cancelled: false, stage: "ready" });
    await open("/study/mat-a");
    await startStudyAid();
    await waitFor(() => expect(progress.length).toBe(1));
    emit({ jobId: JOB, stage: "reading" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancel).toHaveBeenCalled());
    await act(async () => answer.resolve({ ...AID, jobId: JOB, checkpointed: true }));
    expect(await screen.findByText(/before your cancel reached it/)).toBeTruthy();
    expect(await studySets()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Save the new study guide and cards" }));
    await screen.findByRole("heading", { name: "Synthetic guide" });
    expect(await studySets()).toEqual([["mat-a", "Synthetic guide"]]);
  });

  it("after a failure, Try again goes through the usual confirmation and asks again", async () => {
    const generate = vi
      .spyOn(geminiService, "generateStudyAid")
      .mockRejectedValueOnce("Gemini did not answer within the 5 minutes Her Flight Deck allows for one study aid.\nDetails: no answer in time.")
      .mockResolvedValueOnce(AID);
    await open("/study/mat-a");
    await startStudyAid();
    expect(await screen.findByText(/did not answer within the 5 minutes/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save the new study guide and cards" }));
    await screen.findByRole("heading", { name: "Synthetic guide" });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("a job cancelled before a restart is shown as cancelled and never resent", async () => {
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([
      {
        id: JOB,
        kind: "study-aid",
        materialId: "mat-a",
        relativePath: "documents/a.pdf",
        contentSha256: "",
        stage: "cancelled",
        createdAt: 0,
        updatedAt: 0,
        error: CANCELLED_TEXT,
      },
    ]);
    const generate = vi.spyOn(geminiService, "generateStudyAid");
    await open("/study/mat-a");
    expect(await screen.findByText(CANCELLED_TEXT)).toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText(CANCELLED_TEXT)).toBeNull());
  });

  it("this window's own job is never mistaken for one found after a reload, even once it has an id", async () => {
    const answer = deferred<geminiService.GeneratedStudyAid>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    // The journal stand-in never lists it: recovery must leave it alone.
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([]);
    await open("/study/mat-a");
    await startStudyAid();
    await waitFor(() => expect(progress.length).toBe(1));
    emit({ jobId: JOB, stage: "generating", attempt: 1 });
    // Longer than the follow-up timer for recovered jobs.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(screen.getByText("Gemini is reviewing this document")).toBeTruthy();
    expect(screen.queryByText(/stopped before Gemini's answer arrived/)).toBeNull();
    await act(async () => answer.resolve(AID));
    fireEvent.click(await screen.findByRole("button", { name: "Save the new study guide and cards" }));
    await screen.findByRole("heading", { name: "Synthetic guide" });
    expect(await studySets()).toEqual([["mat-a", "Synthetic guide"]]);
  }, 10000);

  /* ---------------------------------------------------------------- */
  /* Review round 1 regressions (GENREL04-R2, R3, R4)                 */
  /* ---------------------------------------------------------------- */

  for (const outcome of ["resolves", "rejects"] as const) {
    it(`R2: a cancel while progress is still being set up (it ${outcome}) sends nothing`, async () => {
      const setup = deferred<() => void>();
      vi.spyOn(geminiService, "watchGeminiProgress").mockImplementation(() => setup.promise);
      const generate = vi.spyOn(geminiService, "generateStudyAid");
      await open("/study/mat-a");
      await startStudyAid();
      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
      await act(async () => {
        if (outcome === "resolves") setup.resolve(() => {});
        else setup.reject(new Error("synthetic listener failure"));
      });
      expect(await screen.findByText(CANCELLED_BEFORE_SENDING)).toBeTruthy();
      expect(generate).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Create study aid" }).hasAttribute("disabled")).toBe(false);
    });
  }

  it("R3: with no progress events at all, Cancel still reaches the native work", async () => {
    vi.spyOn(geminiService, "watchGeminiProgress").mockRejectedValue(new Error("no events here"));
    const answer = deferred<geminiService.GeneratedStudyAid>();
    const generate = vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    await open("/study/mat-a");
    await startStudyAid();
    await waitFor(() => expect(generate).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({ requestId: generate.mock.calls[0]![3], jobId: undefined }),
    );
    await act(async () => answer.reject(CANCELLED_TEXT));
    expect(await screen.findByText(CANCELLED_TEXT)).toBeTruthy();
    expect(await studySets()).toEqual([]);
  });

  it("R4: a cancel that does not go through is reported and can be tried again; the failure is not called a cancel", async () => {
    const answer = deferred<geminiService.GeneratedStudyAid>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    cancel.mockRejectedValueOnce(new Error("synthetic journal write failure"));
    await open("/study/mat-a");
    await startStudyAid();
    await waitFor(() => expect(progress.length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText(/Cancelling did not go through/)).toBeTruthy();
    const again = screen.getByRole("button", { name: "Cancel" });
    expect(again.hasAttribute("disabled")).toBe(false);
    // It then fails for another reason: that is what it is called.
    await act(async () => answer.reject("Google's servers are busy right now."));
    expect(await screen.findByText("Google's servers are busy right now.")).toBeTruthy();
    expect(screen.queryByText(CANCELLED_TEXT)).toBeNull();
  });

  it("R4: when the native side reports the job had already failed, the window says it failed", async () => {
    const answer = deferred<geminiService.GeneratedStudyAid>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    cancel.mockResolvedValue({ cancelled: false, stage: "failed" });
    await open("/study/mat-a");
    await startStudyAid();
    await waitFor(() => expect(progress.length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancel).toHaveBeenCalled());
    await act(async () => answer.reject("Google refused the request (400)."));
    expect(await screen.findByText("Google refused the request (400).")).toBeTruthy();
    expect(screen.queryByText(CANCELLED_TEXT)).toBeNull();
  });

  it("the window's cancel message is the native one, word for word", () => {
    const native = readFileSync(join(process.cwd(), "src-tauri/src/gemini_cancel.rs"), "utf8");
    expect(native).toContain(`pub(crate) const CANCELLED: &str = "${geminiService.GEMINI_CANCELLED_MESSAGE}";`);
  });

  it("R4: a cancel the native side neither recorded nor held is reported, and Cancel works again", async () => {
    const answer = deferred<geminiService.GeneratedStudyAid>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => answer.promise);
    cancel.mockResolvedValueOnce({ cancelled: false, stage: null, pending: false });
    await open("/study/mat-a");
    await startStudyAid();
    await waitFor(() => expect(progress.length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText(/Cancelling did not go through/)).toBeTruthy();
    const again = screen.getByRole("button", { name: "Cancel" });
    expect(again.hasAttribute("disabled")).toBe(false);
    fireEvent.click(again);
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
    await act(async () => answer.reject(CANCELLED_TEXT));
    expect(await screen.findByText(CANCELLED_TEXT)).toBeTruthy();
  });

  it("R7: a job found still running after a reload can be cancelled, by its job id", async () => {
    const running = {
      id: JOB,
      kind: "study-aid" as const,
      materialId: "mat-a",
      relativePath: "documents/a.pdf",
      contentSha256: "",
      stage: "running" as const,
      createdAt: 0,
      updatedAt: 0,
    };
    const list = vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([running]);
    let jobEvent: ((change: { id: string; stage: geminiService.GeminiJobStage }) => void) | null = null;
    vi.spyOn(geminiService, "watchGeminiJobs").mockImplementation(async (handler) => {
      jobEvent = handler;
      return () => {};
    });
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ requestId: undefined, jobId: JOB }));
    // The journal now records it cancelled, and says so.
    list.mockResolvedValue([{ ...running, stage: "cancelled", error: CANCELLED_TEXT }]);
    await act(async () => jobEvent?.({ id: JOB, stage: "cancelled" }));
    expect(await screen.findByText(CANCELLED_TEXT)).toBeTruthy();
    expect(screen.queryByText("Gemini is reviewing this document")).toBeNull();
  });
});
