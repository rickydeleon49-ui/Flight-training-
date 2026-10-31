// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { practiceRetirementRecord } from "@/data/practiceAuthoring";
import { buildPracticeEditOperation, draftFromSnapshot } from "@/data/practiceAuthoringDraft";
import { PracticeAuthoringError, PRACTICE_AUTHORING_ERROR_MESSAGES } from "@/data/persistenceErrors";
import type { PracticeAuthoringQuestion } from "@/domain/types";
import { MaterialDetail } from "./MaterialDetail";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";
import * as documentService from "@/services/documents";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
let context: ReturnType<typeof useAppData>;
function Probe() { context = useAppData(); return null; }
function Ready() {
  return useAppData().status === "ready" ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) })) : null;
}
async function open() {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/study/mat"] }, h(Probe), h(Ready))));
  await waitFor(() => expect(context.status).toBe("ready"));
}
configure({ asyncUtilTimeout: 10_000 });
let repos: ReturnType<typeof createRepositories>;
const uid = () => crypto.randomUUID();
const question = (over: Partial<PracticeAuthoringQuestion> = {}): PracticeAuthoringQuestion => ({
  identity: uid(), question: "My crosswind question", options: ["Upwind wing", "Downwind wing"], correctIndex: 0,
  explanation: "Keep the upwind wing low.", sourcePage: 4, origin: "user", ...over,
});
const GENERATED: geminiService.GeneratedPracticeTest = { title: "New generated questions", model: "gemini-3.5-flash", questions: [{
  question: "How is altitude measured?", options: ["Altimeter", "Compass"], correctIndex: 0, explanation: "Read the altimeter.", sourcePage: 2,
}] };
const JOB = "job-999999999999999999999999";
const CHECKPOINT = `her-flight-deck.reviewed-regeneration.${JOB}`;
const snapshot = () => repos.documents.readPracticeSnapshot("mat");
const receipts = () => db.select("SELECT * FROM practice_save_operations");
async function seed(questions = [question()], provider: "manual" | "gemini" = "manual") {
  await repos.documents.savePracticeAuthoring({ operationId: uid(), sourceMaterialId: "mat", reason: "create", expected: null,
    next: { title: "Current practice", provider, model: "synthetic", questions, retired: [] } });
}
function journal(answer = GENERATED): geminiService.GeminiJobRecord[] {
  return [{ id: JOB, kind: "practice-test", materialId: "mat", relativePath: "documents/synthetic.pdf",
    contentSha256: "", createdAt: 0, updatedAt: 0, stage: "ready", result: answer }];
}
async function regenerate(answer = GENERATED) {
  vi.spyOn(geminiService, "generatePracticeTest").mockResolvedValue({ ...answer, jobId: JOB, checkpointed: true, contentSha256: "" });
  await open();
  // Only a practice test is seeded, so there is a single Regenerate button.
  fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
  fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
}
async function review() {
  const button = await screen.findByRole("button", { name: "Review the new practice test" });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button);
  const scope = within(await screen.findByRole("dialog", { name: "Review the new practice test" }));
  await scope.findByLabelText("Keep my questions");
  return scope;
}
async function save(scope: ReturnType<typeof within>) {
  fireEvent.click(scope.getByRole("button", { name: "Save the reviewed practice test" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review the new practice test" })).toBeNull());
}
beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase(); repos = createRepositories(db);
  await repos.documents.create({ id: "mat", title: "Synthetic material", filePath: "documents/synthetic.pdf", originalFileName: "synthetic.pdf", fileSize: 1 });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: true, model: "gemini-3.5-flash", choice: "standard" });
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([]);
  vi.spyOn(geminiService, "watchGeminiJobs").mockResolvedValue(() => {});
  vi.spyOn(geminiService, "acknowledgeGeminiJob").mockResolvedValue(true);
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

describe("reviewing regenerated practice questions", () => {
  it("waits for Save, then keeps hers verbatim after the new questions", async () => {
    await seed([question(), question({ question: "Instructor correction question", origin: "instructor" })]);
    const before = (await snapshot())!;
    await regenerate();
    const scope = await review();
    expect(await snapshot()).toEqual(before);
    expect(await receipts()).toHaveLength(1);
    // Answers start hidden so reading the new questions doesn't spoil them.
    expect(scope.queryByText("Correct answer: Altimeter")).toBeNull();
    expect(scope.queryByText("Explanation: Read the altimeter.")).toBeNull();
    fireEvent.click(scope.getByRole("button", { name: "Show answers" }));
    expect(scope.getByText("Correct answer: Altimeter")).toBeTruthy();
    expect(scope.getByText("Explanation: Read the altimeter.")).toBeTruthy();
    expect(scope.getByLabelText("Keep my questions")).toHaveProperty("checked", true);
    expect(document.activeElement?.closest("dialog")).toBeTruthy();
    await save(scope);
    const saved = (await snapshot())!;
    expect(saved.questions.slice(1)).toEqual(before.questions);
    expect(saved.questions[0]!.origin).toBeUndefined();
    expect(await receipts()).toHaveLength(2);
  });
  it("replace removes hers with a deleted retirement", async () => {
    await seed(); const before = (await snapshot())!;
    await regenerate(); const scope = await review();
    fireEvent.click(scope.getByLabelText("Replace everything"));
    expect(scope.getByText("1 of your questions will be removed.")).toBeTruthy();
    await save(scope);
    expect((await snapshot())!.questions).toHaveLength(1);
    expect((await snapshot())!.retired).toEqual([await practiceRetirementRecord(before.questions[0]!, "deleted")]);
  });
  async function deleteQuestion() {
    const old = question(); await seed([old, question({ question: "A remaining question" })]);
    const expected = (await snapshot())!;
    const draft = draftFromSnapshot(expected).slice(1);
    await repos.documents.savePracticeAuthoring(await buildPracticeEditOperation({ operationId: uid(), materialId: "mat", expected, title: expected.title, draft }));
    return old;
  }
  it.each([false, true])("holds exact repeats by default; explicit bring-back=%s retains the record", async (bringBack) => {
    const old = await deleteQuestion();
    const retired = (await snapshot())!.retired;
    await regenerate({ ...GENERATED, questions: [...GENERATED.questions, old] });
    const scope = await review();
    const held = within(scope.getByRole("region", { name: "Left out" }));
    expect(held.getByLabelText(`Bring it back: ${old.question}`)).toHaveProperty("checked", false);
    fireEvent.click(scope.getByRole("button", { name: "Show answers" }));
    expect(held.getAllByText(`Correct answer: ${old.options[0]}`)).toHaveLength(2); // candidate + earlier snapshot
    if (bringBack) fireEvent.click(held.getByLabelText(`Bring it back: ${old.question}`));
    await save(scope);
    expect((await snapshot())!.questions.some((q) => q.question === old.question)).toBe(bringBack);
    expect((await snapshot())!.retired).toEqual(retired);
  });
  it("a near repeat of a deleted question highlights the words that changed, in both versions", async () => {
    const old = await deleteQuestion();
    await regenerate({ ...GENERATED, questions: [{ question: "My crosswind landing question", options: ["Upwind wing", "Downwind wing"],
      correctIndex: 0, explanation: "Keep the upwind wing lowered.", sourcePage: 4 }] });
    const scope = await review();
    const near = scope.getByRole("region", { name: "Needs your choice" });
    fireEvent.click(scope.getByRole("button", { name: "Show answers" }));
    expect([...near.querySelectorAll("ins")].map((node) => node.textContent)).toEqual(["added: landing ", "added: lowered"]);
    expect([...near.querySelectorAll("del")].map((node) => node.textContent)).toEqual(["removed: low"]);
    for (const node of near.querySelectorAll("ins, del")) expect(node.querySelector(".visually-hidden")).not.toBeNull();
    // The earlier wording is still shown whole, and unchanged options are plain.
    expect(within(near).getAllByText("Upwind wing")).toHaveLength(2);
    expect(old.explanation).toBe("Keep the upwind wing low.");
    expect([...near.querySelectorAll("p")].map((node) => node.textContent).filter((text) => text?.startsWith("Explanation:")))
      .toEqual(["Explanation: Keep the upwind wing added: lowered.", "Explanation: Keep the upwind wing removed: low."]);
  });
  it("Cancel writes nothing", async () => {
    await seed(); const before = await snapshot();
    await regenerate(); const scope = await review();
    fireEvent.click(scope.getByLabelText("Replace everything"));
    fireEvent.click(scope.getByRole("button", { name: "Cancel" }));
    expect(await snapshot()).toEqual(before);
    expect(await receipts()).toHaveLength(1);
    expect(localStorage.getItem(CHECKPOINT)).toBeNull();
  });
  it("keeps the dialog and checkpoint after transport failure and reuses one id on retry", async () => {
    await seed(); await regenerate(); const scope = await review();
    fireEvent.click(scope.getByLabelText("Replace everything"));
    const spy = vi.spyOn(db, "savePracticeAuthoringAtomically").mockRejectedValueOnce(new PracticeAuthoringError("IPC_TRANSPORT_ERROR"));
    const button = scope.getByRole("button", { name: "Save the reviewed practice test" });
    fireEvent.click(button); fireEvent.click(button); // synchronous lock
    await scope.findByText(PRACTICE_AUTHORING_ERROR_MESSAGES.IPC_TRANSPORT_ERROR);
    expect(scope.getByLabelText("Replace everything")).toHaveProperty("checked", true);
    expect(localStorage.getItem(CHECKPOINT)).not.toBeNull();
    expect(await receipts()).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    await save(scope);
    expect(spy.mock.calls[0]![0]).toEqual(spy.mock.calls[1]![0]);
    expect(await receipts()).toHaveLength(2);
    await waitFor(() => expect(localStorage.getItem(CHECKPOINT)).toBeNull());
  });
  it.each(["keep", "replace"] as const)("reopening after restart settles %s without a second write", async (mode) => {
    await seed(); await regenerate(); const scope = await review();
    if (mode === "replace") fireEvent.click(scope.getByLabelText("Replace everything"));
    const real = db.savePracticeAuthoringAtomically!.bind(db);
    vi.spyOn(db, "savePracticeAuthoringAtomically").mockImplementationOnce(async (operation) => {
      await real(operation); throw new PracticeAuthoringError("IPC_TRANSPORT_ERROR");
    });
    fireEvent.click(scope.getByRole("button", { name: "Save the reviewed practice test" }));
    await scope.findByText(PRACTICE_AUTHORING_ERROR_MESSAGES.IPC_TRANSPORT_ERROR);
    expect(await receipts()).toHaveLength(2);
    const stored = await snapshot();
    expect(localStorage.getItem(CHECKPOINT)).not.toBeNull();
    cleanup();
    vi.mocked(geminiService.listGeminiJobs).mockResolvedValue(journal());
    await open();
    const button = await screen.findByRole("button", { name: "Review the new practice test" });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Review the new practice test" })).toBeNull());
    expect(await snapshot()).toEqual(stored);
    expect(await receipts()).toHaveLength(2);
    expect(await db.select("SELECT * FROM study_set_history WHERE kind = 'practice'")).toHaveLength(1);
    await waitFor(() => expect(localStorage.getItem(CHECKPOINT)).toBeNull());
  });
  it("a generated-only test uses the plain path and abandons its in-progress attempt", async () => {
    const generated = question();
    delete generated.origin;
    await seed([generated], "gemini");
    const current = (await snapshot())!;
    await repos.practiceSessions.saveSessionAction({ action: "start_or_resume", operationId: uid(), materialId: "mat", versionId: current.versionId });
    await regenerate();
    await waitFor(async () => expect((await snapshot())!.title).toBe(GENERATED.title));
    expect(screen.queryByRole("dialog", { name: "Review the new practice test" })).toBeNull();
    expect(await db.select("SELECT status FROM practice_attempts")).toEqual([{ status: "abandoned" }]);
    expect(await receipts()).toHaveLength(2);
  });
  it("retains the checkpoint until the journal truly acknowledges the reviewed save", async () => {
    await seed(); await regenerate(); const scope = await review();
    vi.mocked(geminiService.acknowledgeGeminiJob).mockRejectedValue(new Error("Synthetic acknowledgement failure"));
    await save(scope);
    await waitFor(() => expect(geminiService.acknowledgeGeminiJob).toHaveBeenCalled());
    expect(localStorage.getItem(CHECKPOINT)).not.toBeNull();
    expect(await receipts()).toHaveLength(2);
  });
});
