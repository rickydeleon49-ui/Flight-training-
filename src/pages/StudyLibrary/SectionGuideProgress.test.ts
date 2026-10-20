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
let app: ReturnType<typeof useAppData>;
function Probe() { jobs = useGeminiJobs(); app = useAppData(); return null; }
function Ready() {
  return useAppData().status === "ready" ? h("div", null, h(GeminiOrphanNotices), h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }))) : null;
}
const AID = { title: "Section study guide", summary: "Gemini study aid.", sections: [{ heading: "Airspace", body: "Synthetic body." }], flashcards: [], sourceNotes: "Synthetic PDF provenance.", model: "gemini-3.5-flash" };
function record(stage: gemini.GeminiJobStage = "failed", complete = 3, total = 7): gemini.GeminiJobRecord {
  const manifest = Array.from({ length: total }, (_, i) => ({ id: `s${i}`, heading: `Heading ${i + 1}`, pageStart: i * 5 + 1, pageEnd: i * 5 + 5 }));
  return { id: "section-job", requestId: "synthetic-request", kind: "study-aid", materialId: "m", relativePath: "documents/m.pdf", contentSha256: "a".repeat(64), baseRevision: null,
    stage, createdAt: 0, updatedAt: 0, draft: { kind: "guide-sections-v1", identity: { chosenPages: Array.from({ length: total * 5 }, (_, i) => i + 1), baseRevision: null, manifest },
      results: Object.fromEntries(manifest.map((s, i) => [s.id, { status: i < complete ? "complete" : "pending" }])) } };
}
async function open() {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/study/m"] }, h(Probe), h(Ready))));
  await screen.findByRole("heading", { name: "Synthetic handbook" });
  await waitFor(() => expect(jobs.recovery).toBe("ready"));
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function fail(code?: gemini.SectionGuideErrorCode, jobRecord = record(code === "CANCELLED" ? "cancelled" : "failed")) {
  vi.mocked(gemini.resumeStudyGuide).mockImplementationOnce(async () => {
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([jobRecord]);
    throw new gemini.SectionGuideError(code ?? "GUIDE_PAUSED");
  });
  await open();
  await act(async () => { await jobs.start("study-aid", { materialId: "m", filePath: "documents/m.pdf" }); });
}
function noProviderText() {
  expect(document.body.textContent).not.toMatch(/SOURCE_CHANGED|KEY_CHANGED|REFERENCE_[A-Z_]+|files\/|https:\/\//);
}
beforeEach(async () => {
  localStorage.clear(); db = await createNodeSqliteDatabase();
  await createRepositories(db).documents.create({ id: "m", title: "Synthetic handbook", filePath: "documents/m.pdf", originalFileName: "synthetic.pdf", fileSize: 2000 });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.spyOn(gemini, "getGeminiStatus").mockResolvedValue({ configured: true, model: "gemini-3.5-flash", choice: "standard" });
  vi.spyOn(gemini, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(gemini, "watchGeminiJobs").mockResolvedValue(() => {});
  vi.spyOn(gemini, "listGeminiJobs").mockResolvedValue([]);
  vi.spyOn(gemini, "acknowledgeGeminiJob").mockResolvedValue(true);
  vi.spyOn(gemini, "resumeStudyGuide").mockResolvedValue({ ...AID, jobId: "section-job", checkpointed: true });
  vi.spyOn(gemini, "restartStudyGuide").mockResolvedValue({ ...AID, jobId: "new-section-job", checkpointed: true });
  vi.spyOn(gemini, "generateStudyAid").mockResolvedValue(AID);
  vi.spyOn(pdf, "inspectPdf").mockResolvedValue({ pages: 35, maxPagesPerSplit: 1000 });
  vi.spyOn(documents, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documents, "documentExists").mockResolvedValue(true);
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

describe("section guide progress and deliberate recovery", () => {
  it("shows durable counts and the current heading, with Cancel and no percentage", async () => {
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([record("running")]); await open();
    expect(screen.getByText("3 of 7 sections ready")).toBeTruthy(); expect(screen.getByText("Heading 4")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy(); expect(document.body.textContent).not.toContain("%");
  });
  it("local progress reads counts from its own journal record and Cancel keeps the draft", async () => {
    let reject!: (error: unknown) => void;
    vi.mocked(gemini.resumeStudyGuide).mockImplementationOnce(request => {
      vi.mocked(gemini.listGeminiJobs).mockResolvedValue([{ ...record("running"), requestId: request.requestId }]);
      return new Promise((_, r) => { reject = r; });
    });
    vi.spyOn(gemini, "cancelGeminiJob").mockImplementation(async () => {
      vi.mocked(gemini.listGeminiJobs).mockResolvedValue([record("cancelled")]);
      reject(new gemini.SectionGuideError("CANCELLED")); return { cancelled: true, stage: "cancelled" };
    });
    await open();
    act(() => { void jobs.start("study-aid", { materialId: "m", filePath: "documents/m.pdf" }); });
    await waitFor(() => expect(gemini.resumeStudyGuide).toHaveBeenCalledTimes(1));
    act(() => { vi.mocked(gemini.watchGeminiJobs).mock.calls[0]![0]({ id: "section-job", stage: "running" }); });
    await screen.findByText("3 of 7 sections ready");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("Stopped. Your finished sections are kept.");
    expect(gemini.cancelGeminiJob).toHaveBeenCalledWith(expect.objectContaining({ jobId: "section-job" }));
    expect(gemini.acknowledgeGeminiJob).not.toHaveBeenCalled();
  });
  it("an older in-flight PDF job keeps its legacy path and is never resubmitted", async () => {
    const legacy = { ...record("running"), draft: { target: 40, cards: [] } };
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([legacy]); await open();
    expect(jobs.jobs[0]?.sectionGuide).toBe(false);
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([{ ...legacy, stage: "ready", result: AID }]);
    act(() => { vi.mocked(gemini.watchGeminiJobs).mock.calls[0]![0]({ id: "section-job", stage: "ready" }); });
    await screen.findByRole("button", { name: "Save the new study guide and cards" });
    expect(gemini.resumeStudyGuide).not.toHaveBeenCalled(); expect(gemini.restartStudyGuide).not.toHaveBeenCalled();
    expect(gemini.generateStudyAid).not.toHaveBeenCalled();
  });
  it("new PDFs use the section command and partial retry keeps the job id, even on double click", async () => {
    await fail();
    expect(gemini.generateStudyAid).not.toHaveBeenCalled();
    expect(screen.getByText("Your 3 finished sections are saved. Try again to continue with section 4.")).toBeTruthy();
    const answer = deferred<gemini.GeneratedStudyAid>(); vi.mocked(gemini.resumeStudyGuide).mockReturnValue(answer.promise);
    const retry = screen.getByRole("button", { name: "Try again" });
    act(() => { fireEvent.click(retry); fireEvent.click(retry); });
    await waitFor(() => expect(gemini.resumeStudyGuide).toHaveBeenCalledTimes(2));
    expect(vi.mocked(gemini.resumeStudyGuide).mock.calls[1]).toEqual([expect.objectContaining({ materialId: "m", chosenPages: record().draft!.identity!.chosenPages }), "section-job"]);
    await act(async () => { answer.resolve(AID); }); noProviderText();
  });
  it("reopen keeps a partial draft and sends nothing until Try again", async () => {
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([record("interrupted")]); await open();
    expect(screen.getByText("Your finished sections are here. Continue when you're ready.")).toBeTruthy();
    expect(gemini.resumeStudyGuide).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(gemini.resumeStudyGuide).toHaveBeenCalledWith(expect.any(Object), "section-job"));
  });
  it("changed-source Keep sends nothing and leaves the draft intact", async () => {
    await fail("SOURCE_CHANGED"); fireEvent.click(screen.getByRole("button", { name: "Keep my earlier work" }));
    expect(gemini.resumeStudyGuide).toHaveBeenCalledTimes(1); expect(gemini.restartStudyGuide).not.toHaveBeenCalled();
    expect(gemini.acknowledgeGeminiJob).not.toHaveBeenCalled(); expect(jobs.jobs[0]?.jobId).toBe("section-job"); noProviderText();
  });
  it("changed-source Start a new guide requires her choice and retains the earlier draft", async () => {
    await fail("SOURCE_CHANGED"); expect(gemini.restartStudyGuide).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Start a new guide" }); act(() => { fireEvent.click(button); fireEvent.click(button); });
    await waitFor(() => expect(gemini.restartStudyGuide).toHaveBeenCalledTimes(1));
    expect(gemini.restartStudyGuide).toHaveBeenCalledWith("section-job", true, expect.objectContaining({ materialId: "m", chosenPages: record().draft!.identity!.chosenPages }));
    await waitFor(() => expect(jobs.jobs.some(j => j.jobId === "section-job")).toBe(true));
    expect(gemini.acknowledgeGeminiJob).not.toHaveBeenCalled(); noProviderText();
  });
  it("a restarted job can report progress before answering without duplicating the retained draft", async () => {
    await fail("SOURCE_CHANGED"); const answer = deferred<gemini.GeneratedStudyAid & gemini.GenerationJobIdentity>();
    vi.mocked(gemini.restartStudyGuide).mockImplementationOnce(async (_, __, request) => {
      vi.mocked(gemini.listGeminiJobs).mockResolvedValue([record(), { ...record("running"), id: "new-section-job", requestId: request.requestId }]);
      return answer.promise;
    });
    fireEvent.click(screen.getByRole("button", { name: "Start a new guide" }));
    await waitFor(() => expect(gemini.restartStudyGuide).toHaveBeenCalledTimes(1));
    act(() => { vi.mocked(gemini.watchGeminiJobs).mock.calls[0]![0]({ id: "new-section-job", stage: "running" }); });
    await waitFor(() => expect(jobs.jobs[0]?.jobId).toBe("new-section-job"));
    await act(async () => { answer.resolve({ ...AID, jobId: "new-section-job", checkpointed: true }); });
    expect(jobs.jobs.map(j => j.jobId)).toEqual(["new-section-job", "section-job"]);
    fireEvent.click(screen.getByRole("button", { name: "Discard it" }));
    expect(screen.getByRole("dialog", { name: "Discard this guide draft?" })).toBeTruthy();
    expect(gemini.acknowledgeGeminiJob).not.toHaveBeenCalled();
  });
  it("key change waits for Continue and plainly explains the possible new upload", async () => {
    await fail("KEY_CHANGED"); expect(screen.getByText(/Your Gemini key changed.*may upload the PDF again/)).toBeTruthy();
    expect(gemini.restartStudyGuide).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(gemini.restartStudyGuide).toHaveBeenCalledWith("section-job", true, expect.any(Object))); noProviderText();
  });
  it("too many sections asks for fewer pages", async () => { await fail("TOO_MANY_SECTIONS"); expect(screen.getByText("Choose fewer pages so your guide has at most 40 sections.")).toBeTruthy(); noProviderText(); });
  it.each(["REFERENCE_AUTH_FAILED", "REFERENCE_LOOKUP_FAILED", "DESCRIPTOR_INVALID"] as const)("%s keeps sections and says nothing was uploaded", async code => {
    await fail(code); expect(screen.getByText(/Your sections are kept; nothing was uploaded/)).toBeTruthy(); noProviderText();
  });
  it("Cancel keeps sections; Discard first opens a focused confirmation", async () => {
    HTMLDialogElement.prototype.showModal = undefined as never;
    await fail("CANCELLED"); expect(screen.getAllByText("Stopped. Your finished sections are kept.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    const dialog = screen.getByRole("dialog", { name: "Discard this guide draft?" });
    expect(gemini.acknowledgeGeminiJob).not.toHaveBeenCalled(); expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })); expect(gemini.acknowledgeGeminiJob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard" })); fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(gemini.acknowledgeGeminiJob).toHaveBeenCalledWith("section-job")); noProviderText();
  });
  it("a completed section guide routes edited content through the existing regeneration review", async () => {
    const repos = createRepositories(db); await repos.documents.saveAiStudySet({ sourceMaterialId: "m", ...AID });
    await db.execute("UPDATE ai_study_sets SET summary_origin = 'user' WHERE source_material_id = 'm'");
    await open(); await act(async () => { await jobs.start("study-aid", { materialId: "m", filePath: "documents/m.pdf" }); });
    expect(screen.queryByRole("button", { name: "Save the new study guide and cards" })).toBeNull();
    expect((await repos.documents.listAiStudySets())[0]?.summaryOrigin).toBe("user");
    fireEvent.click(screen.getByRole("button", { name: "Review the new study guide and cards" }));
    expect(screen.getByRole("dialog", { name: /Review/ })).toBeTruthy(); expect(gemini.acknowledgeGeminiJob).not.toHaveBeenCalled();
  });
  it("a draft whose document was removed still requires confirmation before discard", async () => {
    await fail();
    await act(async () => { await db.execute("DELETE FROM study_materials WHERE id = 'm'"); await app.refresh(); });
    expect(screen.getByText("This document was removed. Your finished sections are kept in a draft.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("dialog", { name: "Discard this guide draft?" })).toBeTruthy();
    expect(gemini.acknowledgeGeminiJob).not.toHaveBeenCalled();
  });
  it("checks the section job again at save time and surfaces changed-source consent without saving", async () => {
    const save = vi.spyOn(db, "saveStudySetAtomically").mockRejectedValue(new gemini.SectionGuideError("SOURCE_CHANGED"));
    await open(); await act(async () => { await jobs.start("study-aid", { materialId: "m", filePath: "documents/m.pdf" }); });
    fireEvent.click(screen.getByRole("button", { name: "Save the new study guide and cards" }));
    await screen.findByRole("button", { name: "Keep my earlier work" });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ materialId: "m" }), "section-job");
    expect(await createRepositories(db).documents.listAiStudySets()).toHaveLength(0);
    expect(gemini.acknowledgeGeminiJob).not.toHaveBeenCalled(); noProviderText();
  });
  it("never renders untrusted native failure text, provider file names or URIs", async () => {
    vi.mocked(gemini.resumeStudyGuide).mockImplementationOnce(async () => { vi.mocked(gemini.listGeminiJobs).mockResolvedValue([{ ...record(), error: "SOURCE_CHANGED files/private https://google.invalid/private" }]); throw { code: "FUTURE_CODE", message: "SOURCE_CHANGED files/private https://google.invalid/private" }; });
    await open(); await act(async () => { await jobs.start("study-aid", { materialId: "m", filePath: "documents/m.pdf" }); }); noProviderText();
  });
  it("one saved section shows singular saved notice and a one-section guide shows singular ready wording", async () => {
    await fail(undefined, record("failed", 1));
    expect(screen.getByText("Your 1 finished section is saved. Try again to continue with section 2.")).toBeTruthy();
  });
  it("a one-section guide shows 1 of 1 section ready", async () => {
    vi.mocked(gemini.listGeminiJobs).mockResolvedValue([record("running", 1, 1)]); await open();
    expect(screen.getByText("1 of 1 section ready")).toBeTruthy();
  });
});
