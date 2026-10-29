// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { useGeminiJobs } from "@/state/GeminiJobs";
import * as gemini from "@/services/gemini";
import * as pdf from "@/services/pdf";
import * as documents from "@/services/documents";
import { GeminiOrphanNotices } from "@/components/gemini/GeminiOrphanNotices";
import { MaterialDetail } from "./MaterialDetail";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
let jobs: ReturnType<typeof useGeminiJobs>;
function Probe() { jobs = useGeminiJobs(); return null; }
function Ready() {
  return useAppData().status === "ready"
    ? h("div", null, h(GeminiOrphanNotices), h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) })))
    : null;
}
const AID = {
  title: "Section study guide",
  summary: "Gemini study aid.",
  sections: [{ heading: "Airspace", body: "Synthetic body." }],
  flashcards: [],
  sourceNotes: "Synthetic PDF provenance.",
  model: "gemini-3.5-flash",
};

function waitingRecord(total = 7): gemini.GeminiJobRecord {
  const manifest = Array.from({ length: total }, (_, i) => ({
    id: `s${i}`,
    heading: `Heading ${i + 1}`,
    pageStart: i * 5 + 1,
    pageEnd: i * 5 + 5,
  }));
  return {
    id: "queued-job-1",
    requestId: "synthetic-request",
    kind: "study-aid",
    materialId: "m",
    relativePath: "documents/m.pdf",
    contentSha256: "a".repeat(64),
    baseRevision: null,
    stage: "interrupted",
    createdAt: 0,
    updatedAt: 0,
    draft: {
      kind: "guide-sections-v1",
      queueState: "waiting-for-her",
      identity: {
        chosenPages: Array.from({ length: total * 5 }, (_, i) => i + 1),
        baseRevision: null,
        manifest,
      },
      results: Object.fromEntries(manifest.map((s) => [s.id, { status: "pending" }])),
    },
  };
}

function cancelledRecord(total = 7, queueState: "cancelled" | "waiting-for-her" = "cancelled"): gemini.GeminiJobRecord {
  const manifest = Array.from({ length: total }, (_, i) => ({
    id: `s${i}`,
    heading: `Heading ${i + 1}`,
    pageStart: i * 5 + 1,
    pageEnd: i * 5 + 5,
  }));
  return {
    id: "queued-job-1",
    requestId: "synthetic-request",
    kind: "study-aid",
    materialId: "m",
    relativePath: "documents/m.pdf",
    contentSha256: "a".repeat(64),
    baseRevision: null,
    stage: "cancelled",
    error: gemini.GEMINI_CANCELLED_MESSAGE,
    createdAt: 0,
    updatedAt: 0,
    draft: {
      kind: "guide-sections-v1",
      queueState,
      identity: {
        chosenPages: Array.from({ length: total * 5 }, (_, i) => i + 1),
        baseRevision: null,
        manifest,
      },
      results: Object.fromEntries(manifest.map((s) => [s.id, { status: "pending" }])),
    },
  };
}

async function open() {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/study/m"] }, h(Probe), h(Ready))));
  await screen.findByRole("heading", { name: "Synthetic handbook" });
  await waitFor(() => expect(jobs.recovery).toBe("ready"));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function noProviderText() {
  expect(document.body.textContent).not.toMatch(
    /SOURCE_CHANGED|KEY_CHANGED|REFERENCE_[A-Z_]+|GUIDE_PAUSED|WAITING_FOR_HER|files\/|https:\/\//,
  );
}

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  await createRepositories(db).documents.create({
    id: "m",
    title: "Synthetic handbook",
    filePath: "documents/m.pdf",
    originalFileName: "synthetic.pdf",
    fileSize: 2000,
  });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.spyOn(gemini, "getGeminiStatus").mockResolvedValue({ configured: true, model: "gemini-3.5-flash", choice: "standard" });
  vi.spyOn(gemini, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(gemini, "watchGeminiJobs").mockResolvedValue(() => {});
  vi.spyOn(gemini, "listGeminiJobs").mockResolvedValue([]);
  vi.spyOn(gemini, "acknowledgeGeminiJob").mockResolvedValue(true);
  vi.spyOn(gemini, "resumeStudyGuide").mockResolvedValue({ ...AID, jobId: "queued-job-1", checkpointed: true });
  vi.spyOn(gemini, "queueStudyGuide").mockResolvedValue("queued-job-1");
  vi.spyOn(gemini, "cancelGeminiJob").mockResolvedValue({ cancelled: true, stage: null });
  vi.spyOn(pdf, "inspectPdf").mockResolvedValue({ pages: 35, maxPagesPerSplit: 1000 });
  vi.spyOn(documents, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documents, "documentExists").mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  db.close();
  vi.restoreAllMocks();
});

describe("GEN-02d: the generate-later queue", () => {
  it("the Generate later choice is available when asking for a study guide", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Create study guide" }));
    const dialog = await screen.findByRole("dialog", { name: "Send this file to Google?" });
    const laterBtn = within(dialog).getByRole("button", { name: "Generate later" });
    expect(laterBtn).toBeTruthy();
    noProviderText();
  });

  it("the waiting copy with Start now and Cancel shows material title and section count", async () => {
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([waitingRecord(7)]);
    await open();
    expect(screen.getByText("Waiting for you to start. Press Start now when you have a good connection.")).toBeTruthy();
    expect(screen.getByText("7 sections planned")).toBeTruthy();
    expect(screen.getAllByText("Synthetic handbook").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Start now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    noProviderText();
  });

  it("Start now calls resume exactly once, even on double click", async () => {
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([waitingRecord(7)]);
    await open();
    const startNow = screen.getByRole("button", { name: "Start now" });
    const answer = deferred<gemini.GeneratedStudyAid & gemini.GenerationJobIdentity>();
    vi.mocked(gemini.resumeStudyGuide).mockReturnValue(answer.promise);

    act(() => {
      fireEvent.click(startNow);
      fireEvent.click(startNow);
    });

    await waitFor(() => expect(gemini.resumeStudyGuide).toHaveBeenCalledTimes(1));
    expect(vi.mocked(gemini.resumeStudyGuide)).toHaveBeenCalledWith(
      expect.objectContaining({ materialId: "m", chosenPages: waitingRecord(7).draft!.identity!.chosenPages }),
      "queued-job-1",
    );
    await act(async () => {
      answer.resolve({ ...AID, jobId: "queued-job-1", checkpointed: true, contentSha256: "a".repeat(64) });
    });
    noProviderText();
  });

  it("after a simulated reload, nothing is called until Start now", async () => {
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([waitingRecord(7)]);
    await open();
    // Reopen/reload: resume is NOT called automatically
    expect(gemini.resumeStudyGuide).not.toHaveBeenCalled();
    expect(gemini.queueStudyGuide).not.toHaveBeenCalled();

    // Now press Start now
    const startNow = screen.getByRole("button", { name: "Start now" });
    fireEvent.click(startNow);
    await waitFor(() => expect(gemini.resumeStudyGuide).toHaveBeenCalledTimes(1));
    noProviderText();
  });

  it("Cancel removes a waiting item", async () => {
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([waitingRecord(7)]);
    await open();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    act(() => {
      fireEvent.click(cancelBtn);
    });
    await waitFor(() => expect(gemini.cancelGeminiJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "queued-job-1" }),
    ));
    noProviderText();
  });

  it("no raw codes are shown", async () => {
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([waitingRecord(7)]);
    await open();
    noProviderText();
  });

  it("a reloaded cancelled section draft shows 'Stopped. Your finished sections are kept.', not the waiting copy, and does not offer Start now", async () => {
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([cancelledRecord(7)]);
    await open();
    expect(screen.getByText("Stopped. Your finished sections are kept.")).toBeTruthy();
    expect(
      screen.queryByText("Waiting for you to start. Press Start now when you have a good connection."),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Start now" })).toBeNull();
    noProviderText();
  });
});

describe("CARDS-FIX-01: a disabled guide button always says why", () => {
  const interrupted = (): gemini.GeminiJobRecord => {
    const record = waitingRecord();
    return { ...record, draft: { ...record.draft!, queueState: "running" } } as gemini.GeminiJobRecord;
  };
  it.each(["cancelled", "interrupted"] as const)("%s draft with finished work keeps Regenerate disabled", async phase => {
    const record = phase === "cancelled" ? cancelledRecord() : interrupted();
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([{ ...record, draft: { ...record.draft!, results: { s0: { status: "complete" } } } }]);
    await open();
    const button = await screen.findByRole("button", { name: /Create study guide|Regenerate/ });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
  it.each([
    ["waiting", () => waitingRecord(), "Your study guide draft above is waiting — continue or discard it first."],
    ["cancelled", () => cancelledRecord(), "You stopped the study guide draft above — continue or discard it first."],
    ["interrupted", interrupted, "The study guide draft above didn't finish — try again or discard it first."],
  ] as const)("%s draft", async (_label, record, reason) => {
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([record()]);
    await open();
    const button = await screen.findByRole("button", { name: /Create study guide|Regenerate/ });
    if (_label === "waiting") {
      await waitFor(() => expect(button.hasAttribute("disabled")).toBe(true));
      expect(await screen.findByText(reason)).toBeTruthy();
    } else {
      expect(button.hasAttribute("disabled")).toBe(false);
      expect(screen.queryByText(reason)).toBeNull();
    }
  });
});
