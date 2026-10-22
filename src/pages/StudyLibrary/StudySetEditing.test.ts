// @vitest-environment jsdom
// Text-source fixtures retain coverage of the legacy generation path.
// PDF section-guide behavior is covered in SectionGuideProgress.test.ts.
import { createElement as h } from "react";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import { StartManualStudySet } from "@/pages/StudyLibrary/StudySetEditor";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";
import * as documentService from "@/services/documents";
import { StudySetSaveError } from "@/data/persistenceErrors";

/**
 * OFFLINE-03a in the material page: her own study guide, editing with
 * history first, instructor corrections, restoring an earlier version, and
 * reviewing a regenerated guide that would otherwise replace her items.
 * Synthetic materials only; Gemini is a stand-in.
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
  const { status, data } = useAppData();
  const material = data.materials.find((m) => m.id === "mat-n");
  return status === "ready"
    ? h(
        Routes,
        null,
        h(Route, {
          path: "/study/:materialId",
          element: h(
            "div",
            null,
            h(MaterialDetail),
            material ? h(StartManualStudySet, { material }) : null,
          ),
        }),
      )
    : null;
}

async function open(path: string) {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Probe), h(Ready))));
  await waitFor(() => expect(context.status).toBe("ready"), SLOW_RUNNER);
}

let repos: ReturnType<typeof createRepositories>;
// Every step here runs the real save path; under a loaded full-suite run a
// default wait is not enough. Scoped to this file's worker.
configure({ asyncUtilTimeout: 30_000 });
// Generous per-call timeout for async operations under full-suite parallel load.
const SLOW_RUNNER = { timeout: 30_000 };
const TEST_TIMEOUT = 60_000;

const AID = {
  title: "Synthetic guide",
  summary: "Synthetic summary.",
  sections: [{ heading: "Crab", body: "Point the nose into the wind." }],
  flashcards: [
    { front: "Which wing is lowered?", back: "The downwind wing.", sourcePage: 4 },
    { front: "What does the rudder do?", back: "Aligns the nose with the runway.", sourcePage: null },
  ],
  sourceNotes: "",
  model: "gemini-3.5-flash",
};

const history = () => db.select<{ reason: string }>("SELECT reason FROM study_set_history ORDER BY created_at, id");
const savedSet = async () => (await repos.documents.listAiStudySets())[0]!;

async function click(btn: HTMLElement | Promise<HTMLElement>) {
  const element = await btn;
  await waitFor(() => expect(element).toHaveProperty("disabled", false), SLOW_RUNNER);
  fireEvent.click(element);
  return element;
}

async function dialog(name: string) {
  return within(await screen.findByRole("dialog", { name }, SLOW_RUNNER));
}

async function fill(scope: ReturnType<typeof within>, label: string, value: string) {
  const field = await scope.findByLabelText(label, undefined, SLOW_RUNNER);
  fireEvent.change(field, { target: { value } });
}

async function openEditor() {
  await click(screen.findByRole("button", { name: "Edit study guide" }, SLOW_RUNNER));
  return within(await screen.findByRole("region", { name: "Edit this study guide" }, SLOW_RUNNER));
}

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
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: true, model: "gemini-3.5-flash", choice: "standard" });
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([]);
  vi.spyOn(geminiService, "watchGeminiJobs").mockResolvedValue(() => {});
  vi.spyOn(geminiService, "acknowledgeGeminiJob").mockResolvedValue(true);
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  db.close();
  vi.restoreAllMocks();
});

describe("a study guide she writes herself", { timeout: TEST_TIMEOUT }, () => {
  it("starts on a material with no file, is labelled as hers, and takes her cards", async () => {
    await repos.documents.create({ id: "mat-n", title: "My notes" });
    await open("/study/mat-n");
    await click(screen.findByRole("button", { name: "Write your own study guide" }, SLOW_RUNNER));
    const create = await dialog("Write your own study guide");
    await fill(create, "Summary (optional)", "Crosswind basics in my words.");
    fireEvent.click(create.getByRole("button", { name: "Create study guide" }));

    await screen.findByText("Your study guide", undefined, SLOW_RUNNER);
    expect(screen.getAllByText(/A study guide you wrote/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/AI-generated study aid/)).toBeNull();
    expect((await savedSet()).provider).toBe("manual");

    const editor = await openEditor();
    await click(editor.findByRole("button", { name: "Add a card" }));
    const add = await dialog("Add a card");
    await fill(add, "Question", "When do I flare?");
    await fill(add, "Answer", "About ten feet up.");
    fireEvent.click(add.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await savedSet()).flashcards).toHaveLength(1), SLOW_RUNNER);
    expect((await savedSet()).flashcards[0]).toMatchObject({ front: "When do I flare?", origin: "user" });
    expect((await history()).map((row) => row.reason)).toEqual(["edit"]);
  });
});

describe("editing a generated study guide", { timeout: TEST_TIMEOUT }, () => {
  beforeEach(async () => {
    await repos.documents.create({ id: "mat-a", title: "Material A", filePath: "documents/mat-a.txt", originalFileName: "a.txt", fileSize: 1 });
    await repos.documents.saveAiStudySet({ sourceMaterialId: "mat-a", ...AID });
  });

  it("an edit is marked as hers and keeps the earlier wording, which she can restore", async () => {
    await open("/study/mat-a");
    const editor = await openEditor();
    fireEvent.click(editor.getAllByRole("button", { name: "Edit" })[2]!);
    const edit = await dialog("Edit this card");
    await fill(edit, "Answer", "The upwind wing.");
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await savedSet()).flashcards[0]!.back).toBe("The upwind wing."), SLOW_RUNNER);
    const set = await savedSet();
    expect(set.flashcards[0]).toMatchObject({ origin: "user", sourcePage: 4 });
    expect(set.flashcards[1]!.origin).toBeUndefined();
    expect(set.retired).toHaveLength(1);
    await waitFor(() => expect(screen.getAllByText("Written by you").length).toBeGreaterThan(0), SLOW_RUNNER);

    await click(screen.findByRole("button", { name: "Previous versions" }, SLOW_RUNNER));
    const versions = within(await screen.findByRole("list", { name: "Previous versions" }, SLOW_RUNNER));
    expect(await versions.findByText("Before an edit", undefined, SLOW_RUNNER)).toBeTruthy();
    await click(versions.findByRole("button", { name: "Restore" }, SLOW_RUNNER));
    const restoreConfirm = await dialog("Restore this version?");
    fireEvent.click(restoreConfirm.getByRole("button", { name: "Restore" }));
    await waitFor(async () => expect((await savedSet()).flashcards[0]!.back).toBe("The downwind wing."), SLOW_RUNNER);
    expect((await history()).map((row) => row.reason)).toEqual(["edit", "restore"]);
    // What she retired since stays retired.
    expect((await savedSet()).retired).toHaveLength(1);
  });

  it("an instructor's correction replaces the original and stays out of exports by default", async () => {
    await open("/study/mat-a");
    const editor = await openEditor();
    fireEvent.click(editor.getAllByRole("button", { name: "Instructor's correction" })[2]!);
    const correct = await dialog("Record your instructor's correction to this card");
    await fill(correct, "Answer", "The upwind wing, per my CFI.");
    fireEvent.click(correct.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await savedSet()).flashcards[0]!.origin).toBe("instructor"), SLOW_RUNNER);
    const set = await savedSet();
    expect(set.flashcards).toHaveLength(2);
    expect(set.flashcards[0]!.replaces).toBeTruthy();
    expect((await history()).map((row) => row.reason)).toEqual(["correct"]);
    await waitFor(() => expect(screen.getAllByText("Instructor correction").length).toBeGreaterThan(0), SLOW_RUNNER);
    // Editing it later keeps it her instructor's: no relabelling button is offered.
    await waitFor(() => expect(editor.getAllByRole("button", { name: "Instructor's correction" })).toHaveLength(3), SLOW_RUNNER);
  });

  it("a failed save keeps her text, and saving again records one change", async () => {
    await open("/study/mat-a");
    const editor = await openEditor();
    fireEvent.click(editor.getAllByRole("button", { name: "Edit" })[0]!);
    const edit = await dialog("Edit this summary");
    await fill(edit, "Summary", "My own summary.");
    let failures = 1;
    db.beforeStatement = (sql) => {
      if (failures && sql.includes("INSERT INTO ai_study_sets")) {
        failures--;
        throw new Error("synthetic disk full");
      }
    };
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    expect(await edit.findByText(/A storage problem stopped this study set from saving/, undefined, SLOW_RUNNER)).toBeTruthy();
    expect((edit.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe("My own summary.");
    expect(await history()).toEqual([]);
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await savedSet()).summary).toBe("My own summary."), SLOW_RUNNER);
    expect((await savedSet()).summaryOrigin).toBe("user");
    expect(await history()).toHaveLength(1);
  });

  it("a change saved elsewhere after she opened the dialog is refused, not overwritten", async () => {
    await open("/study/mat-a");
    const editor = await openEditor();
    fireEvent.click(editor.getAllByRole("button", { name: "Edit" })[0]!);
    const edit = await dialog("Edit this summary");
    await fill(edit, "Summary", "Mine.");
    await db.execute("UPDATE ai_study_sets SET summary = 'Changed in another window.'");
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    expect(await edit.findByText(/changed after you opened it/, undefined, SLOW_RUNNER)).toBeTruthy();
    expect((await savedSet()).summary).toBe("Changed in another window.");
    expect(await history()).toEqual([]);
  });

  it("regenerating over her items waits for her review, holds back what she deleted, and keeps her items", async () => {
    // She deletes the second card and edits the first.
    const read = (await repos.documents.readStudySetForEdit("mat-a"))!;
    const { authoringStateOf, frameOf, nextSetOf } = await import("@/logic/studySetEditing");
    const { prepareStudyEdit } = await import("@/logic/studyAuthoring");
    const state = authoringStateOf(read.set);
    const removed = await prepareStudyEdit(state, { kind: "delete", itemId: state.items[3]!.itemId });
    const edited = await prepareStudyEdit(removed.next, { kind: "edit", itemId: state.items[2]!.itemId, fields: ["Which wing is lowered?", "The upwind wing."], origin: "user" });
    await repos.documents.saveStudySet({ operationId: crypto.randomUUID(), materialId: "mat-a", reason: "edit", expected: read.stored, next: nextSetOf(frameOf(read.set), edited.next) });

    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({
      ...AID,
      summary: "A new summary.",
      flashcards: [AID.flashcards[1]!, { front: "When do you flare?", back: "About ten feet up.", sourcePage: 7 }],
      jobId: "job-333333333333333333333333",
      contentSha256: "",
    });
    await open("/study/mat-a");
    await click(screen.findByRole("button", { name: "Regenerate" }, SLOW_RUNNER));
    await click(screen.findByRole("button", { name: "Send to Gemini" }, SLOW_RUNNER));
    await click(screen.findByRole("button", { name: "Review the new study guide and cards" }, SLOW_RUNNER));
    const review = await dialog("Review the new study guide");
    await review.findByText(/Bring it back: Card: What does the rudder do\?/, undefined, SLOW_RUNNER);
    expect(review.getByLabelText(/Keep my items/)).toHaveProperty("checked", true);
    await click(review.findByRole("button", { name: "Save the reviewed study guide" }));

    await waitFor(async () => expect((await savedSet()).summary).toBe("A new summary."), SLOW_RUNNER);
    const set = await savedSet();
    expect(set.flashcards.map((card) => [card.front, card.origin ?? null])).toEqual([
      ["When do you flare?", null],
      ["Which wing is lowered?", "user"],
    ]);
    expect((await history()).map((row) => row.reason)).toEqual(["edit", "regenerate"]);
  });

  it("a plain save never replaces her items, even without the page asking", async () => {
    const read = (await repos.documents.readStudySetForEdit("mat-a"))!;
    await repos.documents.saveStudySet({
      operationId: crypto.randomUUID(), materialId: "mat-a", reason: "edit", expected: read.stored,
      next: { ...JSON.parse(JSON.stringify({
        title: read.stored.title, summary: "Mine", summaryOrigin: "user", sections: JSON.parse(read.stored.sections_json),
        flashcards: JSON.parse(read.stored.flashcards_json), sourceNotes: "", provider: "gemini", model: read.stored.model, retired: [],
      })) },
    });
    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({ ...AID, summary: "Generated", jobId: "job-444444444444444444444444", contentSha256: "" });
    await open("/study/mat-a");
    await click(screen.findByRole("button", { name: "Regenerate" }, SLOW_RUNNER));
    await click(screen.findByRole("button", { name: "Send to Gemini" }, SLOW_RUNNER));
    await screen.findByRole("button", { name: "Review the new study guide and cards" }, SLOW_RUNNER);
    expect((await savedSet()).summary).toBe("Mine");
  });

  async function herEditThenRegenerate(generated: Partial<typeof AID> = {}) {
    const read = (await repos.documents.readStudySetForEdit("mat-a"))!;
    const { authoringStateOf, frameOf, nextSetOf } = await import("@/logic/studySetEditing");
    const { prepareStudyEdit } = await import("@/logic/studyAuthoring");
    const state = authoringStateOf(read.set);
    const edited = await prepareStudyEdit(state, { kind: "edit", itemId: state.items[2]!.itemId, fields: ["Which wing is lowered?", "The upwind wing."], origin: "user" });
    await repos.documents.saveStudySet({ operationId: crypto.randomUUID(), materialId: "mat-a", reason: "edit", expected: read.stored, next: nextSetOf(frameOf(read.set), edited.next) });
    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({ ...AID, summary: "A new summary.", ...generated, jobId: "job-555555555555555555555555", contentSha256: "" });
    await open("/study/mat-a");
    await click(screen.findByRole("button", { name: "Regenerate" }, SLOW_RUNNER));
    await click(screen.findByRole("button", { name: "Send to Gemini" }, SLOW_RUNNER));
    await click(screen.findByRole("button", { name: "Review the new study guide and cards" }, SLOW_RUNNER));
    const review = await dialog("Review the new study guide");
    // The Save button shows before the comparison loads; wait for the choices.
    await review.findByLabelText(/Keep my items/, undefined, SLOW_RUNNER);
    return review;
  }

  /**
   * The journal's own record of the answer `herEditThenRegenerate` just made:
   * unacknowledged, so it is still there and can come back after a restart.
   * Only set this after she has regenerated — before the window opens, it would
   * recover this very answer as a second job.
   */
  const journalHoldsTheAnswer = (): geminiService.GeminiJobRecord[] => [
    {
      id: "job-555555555555555555555555", kind: "study-aid", materialId: "mat-a", relativePath: "documents/mat-a.txt",
      contentSha256: "", createdAt: 0, updatedAt: 0, stage: "ready", result: { ...AID, summary: "A new summary." },
    },
  ];

  it("a failed reviewed save keeps the dialog and her choices open; saving again saves once", async () => {
    const review = await herEditThenRegenerate();
    fireEvent.click(review.getByLabelText(/Replace everything/));
    let failures = 1;
    db.beforeStatement = (sql) => {
      if (failures && sql.includes("INSERT INTO ai_study_sets")) {
        failures--;
        throw new Error("synthetic disk full");
      }
    };
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
    expect(await review.findByText(/Your choices are still here/, undefined, SLOW_RUNNER)).toBeTruthy();
    expect(review.getByLabelText(/Replace everything/)).toHaveProperty("checked", true);
    expect((await history()).map((row) => row.reason)).toEqual(["edit"]);
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
    await waitFor(async () => expect((await savedSet()).summary).toBe("A new summary."), SLOW_RUNNER);
    expect((await savedSet()).flashcards.every((card) => card.origin === undefined)).toBe(true);
    expect((await history()).map((row) => row.reason)).toEqual(["edit", "regenerate"]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review the new study guide" })).toBeNull(), SLOW_RUNNER);
  });

  it("a reviewed save that committed before its answer was lost is recognised on retry, not applied twice", async () => {
    const review = await herEditThenRegenerate();
    const save = db.saveStudySetAtomically!.bind(db);
    let lose = 1;
    db.saveStudySetAtomically = async (operation) => {
      const result = await save(operation);
      if (lose && operation.reason === "regenerate") {
        lose--;
        throw new StudySetSaveError("IPC_TRANSPORT_ERROR");
      }
      return result;
    };
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
    expect(await review.findByText(/Your choices are still here/, undefined, SLOW_RUNNER)).toBeTruthy();
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review the new study guide" })).toBeNull(), SLOW_RUNNER);
    expect((await history()).map((row) => row.reason)).toEqual(["edit", "regenerate"]);
  });

  it("restoring is refused when the guide changed after she opened the confirmation", async () => {
    await open("/study/mat-a");
    const editor = await openEditor();
    fireEvent.click(editor.getAllByRole("button", { name: "Edit" })[0]!);
    const edit = await dialog("Edit this summary");
    await fill(edit, "Summary", "Mine.");
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await savedSet()).summary).toBe("Mine."), SLOW_RUNNER);
    await click(screen.findByRole("button", { name: "Previous versions" }, SLOW_RUNNER));
    const versions = within(await screen.findByRole("list", { name: "Previous versions" }, SLOW_RUNNER));
    const restoreBtn = await versions.findByRole("button", { name: "Restore" }, SLOW_RUNNER);
    const readSpy = vi.spyOn(context.repositories!.documents, "readStoredStudySet");
    await click(restoreBtn);
    const confirm = await dialog("Restore this version?");
    // The confirmation has read the set she is looking at.
    await waitFor(() => expect(readSpy).toHaveBeenCalled(), SLOW_RUNNER);
    await readSpy.mock.results[readSpy.mock.results.length - 1]!.value;
    await db.execute("UPDATE ai_study_sets SET summary = 'Changed in another window.'");
    fireEvent.click(confirm.getByRole("button", { name: "Restore" }));
    expect(await confirm.findByText(/changed after you opened it/, undefined, SLOW_RUNNER)).toBeTruthy();
    expect((await savedSet()).summary).toBe("Changed in another window.");
    expect((await history()).map((row) => row.reason)).toEqual(["edit"]);
  });

  it("a reviewed save that committed is recognised even after she closes and reopens the review", async () => {
    const review = await herEditThenRegenerate();
    const save = db.saveStudySetAtomically!.bind(db);
    let lose = 1;
    db.saveStudySetAtomically = async (operation) => {
      const result = await save(operation);
      if (lose && operation.reason === "regenerate") {
        lose--;
        throw new StudySetSaveError("IPC_TRANSPORT_ERROR");
      }
      return result;
    };
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
    expect(await review.findByText(/Your choices are still here/, undefined, SLOW_RUNNER)).toBeTruthy();
    fireEvent.click(review.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review the new study guide" })).toBeNull(), SLOW_RUNNER);
    await click(screen.findByRole("button", { name: "Review again" }, SLOW_RUNNER));
    // Reopening finds the save already committed and confirms it instead of saving again.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Review again" })).toBeNull(), SLOW_RUNNER);
    expect((await history()).map((row) => row.reason)).toEqual(["edit", "regenerate"]);
    expect((await savedSet()).summary).toBe("A new summary.");
  });

  it("a regenerated card with a page outside the PDF range is reviewed and saved with no page", async () => {
    const review = await herEditThenRegenerate({
      flashcards: [{ front: "When do you flare?", back: "About ten feet up.", sourcePage: 1001 }],
    });
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
    await waitFor(async () => expect((await savedSet()).summary).toBe("A new summary."), SLOW_RUNNER);
    expect((await savedSet()).flashcards.find((card) => card.front === "When do you flare?")!.sourcePage).toBeNull();
  });

  it("the review shows each item's full text and the earlier wording it resembles before she chooses", async () => {
    // Her instructor corrects the rudder card, and she deletes the section.
    const read = (await repos.documents.readStudySetForEdit("mat-a"))!;
    const { authoringStateOf, frameOf, nextSetOf } = await import("@/logic/studySetEditing");
    const { prepareStudyEdit } = await import("@/logic/studyAuthoring");
    const state = authoringStateOf(read.set);
    const corrected = await prepareStudyEdit(state, { kind: "correct", itemId: state.items[3]!.itemId, fields: ["What does the rudder do?", "Keeps the longitudinal axis aligned with the runway."], origin: "instructor" });
    await repos.documents.saveStudySet({ operationId: crypto.randomUUID(), materialId: "mat-a", reason: "correct", expected: read.stored, next: nextSetOf(frameOf(read.set), corrected.next) });
    const again = (await repos.documents.readStudySetForEdit("mat-a"))!;
    const now = authoringStateOf(again.set);
    const removed = await prepareStudyEdit(now, { kind: "delete", itemId: now.items[1]!.itemId });
    await repos.documents.saveStudySet({ operationId: crypto.randomUUID(), materialId: "mat-a", reason: "delete", expected: again.stored, next: nextSetOf(frameOf(again.set), removed.next) });

    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({
      ...AID,
      summary: "A new summary.",
      sections: [{ heading: "Crab", body: "Point the nose into the wind." }],
      flashcards: [
        { front: "What does the rudder do?", back: "It aligns the nose with runway.", sourcePage: null },
        { front: "When do you flare?", back: "About ten feet up.", sourcePage: 7 },
      ],
      jobId: "job-777777777777777777777777",
      contentSha256: "",
    });
    await open("/study/mat-a");
    await click(screen.findByRole("button", { name: "Regenerate" }, SLOW_RUNNER));
    await click(screen.findByRole("button", { name: "Send to Gemini" }, SLOW_RUNNER));
    await click(screen.findByRole("button", { name: "Review the new study guide and cards" }, SLOW_RUNNER));
    const review = await dialog("Review the new study guide");
    const choice = within(await review.findByRole("region", { name: "Needs your choice" }, SLOW_RUNNER));
    // The proposed answer, and the wrong answer her instructor corrected, are both shown.
    expect(choice.getByText("Answer: It aligns the nose with runway.")).toBeTruthy();
    expect(choice.getByText("Answer: Aligns the nose with the runway.")).toBeTruthy();
    expect(choice.getByText(/something you corrected or rewrote/)).toBeTruthy();
    // The held-back section shows its text; new cards show their answers.
    const left = within(review.getByRole("region", { name: "Left out" }));
    expect(left.getByText("Point the nose into the wind.")).toBeTruthy();
    const fresh = within(review.getByRole("region", { name: "New" }));
    expect(fresh.getByText("Answer: About ten feet up.")).toBeTruthy();
    expect(fresh.getByText("A new summary.")).toBeTruthy();
  });

  it("a reviewed save that committed before a restart is recognised after the restart, not applied again", async () => {
    const review = await herEditThenRegenerate();
    const save = db.saveStudySetAtomically!.bind(db);
    db.saveStudySetAtomically = async (operation) => {
      const result = await save(operation);
      // Committed, then the app closes before the answer arrives.
      if (operation.reason === "regenerate") throw new StudySetSaveError("IPC_TRANSPORT_ERROR");
      return result;
    };
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
    expect(await review.findByText(/Your choices are still here/, undefined, SLOW_RUNNER)).toBeTruthy();
    expect((await history()).map((row) => row.reason)).toEqual(["edit", "regenerate"]);

    // Restart: a fresh window, the same database, the journal still holding the answer.
    cleanup();
    db.saveStudySetAtomically = save;
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue(journalHoldsTheAnswer());
    await open("/study/mat-a");
    await click(screen.findByRole("button", { name: "Review the new study guide and cards" }, SLOW_RUNNER));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Review the new study guide and cards" })).toBeNull(), SLOW_RUNNER);
    expect((await history()).map((row) => row.reason)).toEqual(["edit", "regenerate"]);
    // The checkpoint is dropped only once the journal confirms it forgot the
    // answer, which follows the recognition above asynchronously.
    await waitFor(() => expect(localStorage.getItem("her-flight-deck.reviewed-regeneration.job-555555555555555555555555")).toBeNull(), SLOW_RUNNER);
  });

  // Her reviewed save is two writes: the study set, and the journal confirming
  // it no longer needs Gemini's answer. The first can succeed while the second
  // does not, and until it does the journal hands the same answer back. Only
  // the checkpoint of the exact operation tells a restart that this guide is
  // already saved — a save that reported success says nothing about here.
  const CHECKPOINT = "her-flight-deck.reviewed-regeneration.job-555555555555555555555555";

  /** A restart: a fresh window, the same database, the answer still in the journal. */
  function restartWithTheAnswerStillThere() {
    cleanup();
    vi.mocked(geminiService.acknowledgeGeminiJob).mockResolvedValue(true);
    vi.mocked(geminiService.listGeminiJobs).mockResolvedValue(journalHoldsTheAnswer());
  }

  /** Her items as stored, ids included: merging a second time would give new ones. */
  const herItems = (set: Awaited<ReturnType<typeof savedSet>>) =>
    set.flashcards.map((card) => [card.itemId ?? null, card.front, card.back, card.origin ?? null]);

  const notAcknowledged: ReadonlyArray<readonly [string, () => void]> = [
    ["the journal could not write it down", () => vi.mocked(geminiService.acknowledgeGeminiJob).mockRejectedValue(new Error("synthetic journal write failure"))],
    [
      "the journal would not forget the answer",
      () => {
        // It really does still hold it: a `false` for an entry that is gone is
        // told apart from this by reading the journal back.
        vi.mocked(geminiService.acknowledgeGeminiJob).mockResolvedValue(false);
        vi.mocked(geminiService.listGeminiJobs).mockResolvedValue(journalHoldsTheAnswer());
      },
    ],
  ];

  for (const [why, refuseToForget] of notAcknowledged) {
    it(`a reviewed save whose acknowledgement failed because ${why} is recognised after a restart, not saved again`, async () => {
      const review = await herEditThenRegenerate();
      // Set only now: her answer is this window's own generation, and the
      // journal's copy of it must not be recovered as a second job.
      refuseToForget();
      fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review the new study guide" })).toBeNull(), SLOW_RUNNER);
      await waitFor(() => expect(geminiService.acknowledgeGeminiJob).toHaveBeenCalled(), SLOW_RUNNER);
      expect((await history()).map((row) => row.reason)).toEqual(["edit", "regenerate"]);
      // Saved, but the journal is not finished with its answer: her exact
      // operation stays on this computer where a restart can find it.
      expect(localStorage.getItem(CHECKPOINT)).toBeTruthy();
      const before = herItems(await savedSet());

      restartWithTheAnswerStillThere();
      await open("/study/mat-a");
      // The answer is offered again. Opening the review recognises the save it
      // already holds and confirms it, so she is never asked to choose twice.
      await click(screen.findByRole("button", { name: "Review the new study guide and cards" }, SLOW_RUNNER));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Review the new study guide and cards" })).toBeNull(), SLOW_RUNNER);
      expect((await history()).map((row) => row.reason)).toEqual(["edit", "regenerate"]);
      const after = await savedSet();
      expect(herItems(after)).toEqual(before);
      expect(after.summary).toBe("A new summary.");
      expect(after.flashcards.find((card) => card.front === "Which wing is lowered?")!.back).toBe("The upwind wing.");
      // The acknowledgement that finally lands is what clears the checkpoint.
      await waitFor(() => expect(localStorage.getItem(CHECKPOINT)).toBeNull(), SLOW_RUNNER);
    });
  }

  it("re-confirming a committed reviewed save keeps its checkpoint until the journal acknowledges it", async () => {
    const review = await herEditThenRegenerate();
    const save = db.saveStudySetAtomically!.bind(db);
    db.saveStudySetAtomically = async (operation) => {
      const result = await save(operation);
      // Committed, then the answer was lost.
      if (operation.reason === "regenerate") throw new StudySetSaveError("IPC_TRANSPORT_ERROR");
      return result;
    };
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
    expect(await review.findByText(/Your choices are still here/, undefined, SLOW_RUNNER)).toBeTruthy();
    expect(localStorage.getItem(CHECKPOINT)).toBeTruthy();

    // Confirming it resends the same operation, which is recognised as saved.
    db.saveStudySetAtomically = save;
    vi.mocked(geminiService.acknowledgeGeminiJob).mockRejectedValue(new Error("synthetic journal write failure"));
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review the new study guide" })).toBeNull(), SLOW_RUNNER);
    await waitFor(() => expect(geminiService.acknowledgeGeminiJob).toHaveBeenCalled(), SLOW_RUNNER);
    expect((await history()).map((row) => row.reason)).toEqual(["edit", "regenerate"]);
    // Confirmed, not acknowledged: her operation is still needed.
    expect(localStorage.getItem(CHECKPOINT)).toBeTruthy();
    // The retried acknowledgement is what finishes the job.
    vi.mocked(geminiService.acknowledgeGeminiJob).mockResolvedValue(true);
    await waitFor(() => expect(localStorage.getItem(CHECKPOINT)).toBeNull(), SLOW_RUNNER);
  });

  it("discarding an answer she never committed is recorded, and cleaned up, only once the journal acknowledges it", async () => {
    const review = await herEditThenRegenerate();
    // Its stated scenario: the journal still holds her answer, which is what a
    // `false` acknowledgement then means. The read-back is only asked for when
    // the journal answers `false`, and it answers that the answer is still there.
    vi.mocked(geminiService.listGeminiJobs).mockResolvedValue(journalHoldsTheAnswer());
    let failures = 1;
    db.beforeStatement = (sql) => {
      if (failures && sql.includes("INSERT INTO ai_study_sets")) {
        failures--;
        throw new Error("synthetic disk full");
      }
    };
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
    expect(await review.findByText(/Your choices are still here/, undefined, SLOW_RUNNER)).toBeTruthy();
    fireEvent.click(review.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review the new study guide" })).toBeNull(), SLOW_RUNNER);
    expect((await history()).map((row) => row.reason)).toEqual(["edit"]);

    // She leaves the answer behind instead. Neither way of not recording that
    // may throw her reviewed operation away.
    vi.mocked(geminiService.acknowledgeGeminiJob).mockRejectedValueOnce(new Error("synthetic journal write failure"));
    await click(screen.findByRole("button", { name: "Discard the new study guide and cards" }, SLOW_RUNNER));
    expect(await screen.findByText(/might come back after the app restarts/, undefined, SLOW_RUNNER)).toBeTruthy();
    expect(localStorage.getItem(CHECKPOINT)).toBeTruthy();
    vi.mocked(geminiService.acknowledgeGeminiJob).mockResolvedValueOnce(false);
    await click(screen.findByRole("button", { name: "Try again" }, SLOW_RUNNER));
    expect(await screen.findByText(/might come back after the app restarts/, undefined, SLOW_RUNNER)).toBeTruthy();
    expect(localStorage.getItem(CHECKPOINT)).toBeTruthy();

    // Once it is written down, the answer is gone — and so is her save's record.
    await click(screen.findByRole("button", { name: "Try again" }, SLOW_RUNNER));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Discard the new study guide and cards" })).toBeNull(), SLOW_RUNNER);
    await waitFor(() => expect(localStorage.getItem(CHECKPOINT)).toBeNull(), SLOW_RUNNER);
    expect((await history()).map((row) => row.reason)).toEqual(["edit"]);
  });

  /**
   * A reviewed save that did not go through, with the review closed: the answer
   * still waits on the page and her exact operation is still checkpointed,
   * because nothing has acknowledged it yet.
   */
  async function aReviewSheLeftUncommitted() {
    const review = await herEditThenRegenerate();
    let failures = 1;
    db.beforeStatement = (sql) => {
      if (failures && sql.includes("INSERT INTO ai_study_sets")) {
        failures--;
        throw new Error("synthetic disk full");
      }
    };
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
    expect(await review.findByText(/Your choices are still here/, undefined, SLOW_RUNNER)).toBeTruthy();
    fireEvent.click(review.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review the new study guide" })).toBeNull(), SLOW_RUNNER);
    expect(localStorage.getItem(CHECKPOINT)).toBeTruthy();
    expect((await history()).map((row) => row.reason)).toEqual(["edit"]);
  }

  it("a false answer for an entry another window already removed finishes the discard and clears her checkpoint", async () => {
    await aReviewSheLeftUncommitted();
    // The journal says `false`, which it also says for a record it cannot let go
    // of; reading it back is what shows this answer was removed elsewhere.
    vi.mocked(geminiService.acknowledgeGeminiJob).mockResolvedValue(false);
    vi.mocked(geminiService.listGeminiJobs).mockResolvedValue([]);
    await click(screen.findByRole("button", { name: "Discard the new study guide and cards" }, SLOW_RUNNER));
    await waitFor(() => expect(geminiService.acknowledgeGeminiJob).toHaveBeenCalled(), SLOW_RUNNER);
    // Confirmed absence is the answer being gone for good: the discard finishes,
    // so the operation it held is dropped and nothing is left to come back.
    await waitFor(() => expect(localStorage.getItem(CHECKPOINT)).toBeNull(), SLOW_RUNNER);
    expect(screen.queryByText(/might come back after the app restarts/)).toBeNull();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Discard the new study guide and cards" })).toBeNull(), SLOW_RUNNER);
    expect((await history()).map((row) => row.reason)).toEqual(["edit"]);
  });

  it("a false answer the journal cannot be read back for keeps the discard failed and her checkpoint", async () => {
    await aReviewSheLeftUncommitted();
    vi.mocked(geminiService.acknowledgeGeminiJob).mockResolvedValue(false);
    vi.mocked(geminiService.listGeminiJobs).mockRejectedValue(new Error("synthetic journal read failure"));
    await click(screen.findByRole("button", { name: "Discard the new study guide and cards" }, SLOW_RUNNER));
    expect(await screen.findByText(/might come back after the app restarts/, undefined, SLOW_RUNNER)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    // A read that failed proves nothing: the answer may still be in the journal,
    // and her operation is only safe to forget once it is known not to be.
    expect(localStorage.getItem(CHECKPOINT)).toBeTruthy();
    expect((await history()).map((row) => row.reason)).toEqual(["edit"]);

    // Absence confirmed on the retry is what finishes it.
    vi.mocked(geminiService.listGeminiJobs).mockResolvedValue([]);
    await click(screen.findByRole("button", { name: "Try again" }, SLOW_RUNNER));
    await waitFor(() => expect(localStorage.getItem(CHECKPOINT)).toBeNull(), SLOW_RUNNER);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Discard the new study guide and cards" })).toBeNull(), SLOW_RUNNER);
    expect((await history()).map((row) => row.reason)).toEqual(["edit"]);
  });
});
