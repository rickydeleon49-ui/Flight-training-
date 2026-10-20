// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
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
  const { status } = useAppData();
  return status === "ready" ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) })) : null;
}

async function open(path: string) {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Probe), h(Ready))));
  await waitFor(() => expect(context.status).toBe("ready"));
}

let repos: ReturnType<typeof createRepositories>;

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

async function dialog(name: string) {
  return within(await screen.findByRole("dialog", { name }));
}

async function fill(scope: ReturnType<typeof within>, label: string, value: string) {
  const field = await scope.findByLabelText(label);
  fireEvent.change(field, { target: { value } });
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

describe("a study guide she writes herself", () => {
  it("starts on a material with no file, is labelled as hers, and takes her cards", async () => {
    await repos.documents.create({ id: "mat-n", title: "My notes" });
    await open("/study/mat-n");
    fireEvent.click(await screen.findByRole("button", { name: "Write your own study guide" }));
    const create = await dialog("Write your own study guide");
    await fill(create, "Summary (optional)", "Crosswind basics in my words.");
    fireEvent.click(create.getByRole("button", { name: "Create study guide" }));

    await screen.findByText("Your study guide");
    expect(screen.getByText(/A study guide you wrote/)).toBeTruthy();
    expect(screen.queryByText(/AI-generated study aid/)).toBeNull();
    expect((await savedSet()).provider).toBe("manual");

    fireEvent.click(screen.getByRole("button", { name: "Edit study guide" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add a card" }));
    const add = await dialog("Add a card");
    await fill(add, "Question", "When do I flare?");
    await fill(add, "Answer", "About ten feet up.");
    fireEvent.click(add.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await savedSet()).flashcards).toHaveLength(1));
    expect((await savedSet()).flashcards[0]).toMatchObject({ front: "When do I flare?", origin: "user" });
    expect((await history()).map((row) => row.reason)).toEqual(["edit"]);
  });
});

describe("editing a generated study guide", () => {
  beforeEach(async () => {
    await repos.documents.create({ id: "mat-a", title: "Material A", filePath: "documents/mat-a.pdf", originalFileName: "a.pdf", fileSize: 1 });
    await repos.documents.saveAiStudySet({ sourceMaterialId: "mat-a", ...AID });
  });

  it("an edit is marked as hers and keeps the earlier wording, which she can restore", async () => {
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Edit study guide" }));
    const editor = within(await screen.findByRole("region", { name: "Edit this study guide" }));
    fireEvent.click(editor.getAllByRole("button", { name: "Edit" })[2]!);
    const edit = await dialog("Edit this card");
    await fill(edit, "Answer", "The upwind wing.");
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await savedSet()).flashcards[0]!.back).toBe("The upwind wing."));
    const set = await savedSet();
    expect(set.flashcards[0]).toMatchObject({ origin: "user", sourcePage: 4 });
    expect(set.flashcards[1]!.origin).toBeUndefined();
    expect(set.retired).toHaveLength(1);
    expect(screen.getAllByText("Written by you").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Previous versions" }));
    const versions = within(await screen.findByRole("list", { name: "Previous versions" }));
    expect(versions.getByText("Before an edit")).toBeTruthy();
    fireEvent.click(versions.getByRole("button", { name: "Restore" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Restore this version?" })).getByRole("button", { name: "Restore" }));
    await waitFor(async () => expect((await savedSet()).flashcards[0]!.back).toBe("The downwind wing."));
    expect((await history()).map((row) => row.reason)).toEqual(["edit", "restore"]);
    // What she retired since stays retired.
    expect((await savedSet()).retired).toHaveLength(1);
  });

  it("an instructor's correction replaces the original and stays out of exports by default", async () => {
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Edit study guide" }));
    const editor = within(await screen.findByRole("region", { name: "Edit this study guide" }));
    fireEvent.click(editor.getAllByRole("button", { name: "Instructor's correction" })[2]!);
    const correct = await dialog("Record your instructor's correction to this card");
    await fill(correct, "Answer", "The upwind wing, per my CFI.");
    fireEvent.click(correct.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await savedSet()).flashcards[0]!.origin).toBe("instructor"));
    const set = await savedSet();
    expect(set.flashcards).toHaveLength(2);
    expect(set.flashcards[0]!.replaces).toBeTruthy();
    expect((await history()).map((row) => row.reason)).toEqual(["correct"]);
    expect(screen.getAllByText("Instructor correction").length).toBeGreaterThan(0);
    // Editing it later keeps it her instructor's: no relabelling button is offered.
    expect(editor.getAllByRole("button", { name: "Instructor's correction" })).toHaveLength(3);
  });

  it("a failed save keeps her text, and saving again records one change", async () => {
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Edit study guide" }));
    const editor = within(await screen.findByRole("region", { name: "Edit this study guide" }));
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
    expect(await edit.findByText(/A storage problem stopped this study set from saving/)).toBeTruthy();
    expect((edit.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe("My own summary.");
    expect(await history()).toEqual([]);
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await savedSet()).summary).toBe("My own summary."));
    expect((await savedSet()).summaryOrigin).toBe("user");
    expect(await history()).toHaveLength(1);
  });

  it("a change saved elsewhere after she opened the dialog is refused, not overwritten", async () => {
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Edit study guide" }));
    const editor = within(await screen.findByRole("region", { name: "Edit this study guide" }));
    fireEvent.click(editor.getAllByRole("button", { name: "Edit" })[0]!);
    const edit = await dialog("Edit this summary");
    await fill(edit, "Summary", "Mine.");
    await db.execute("UPDATE ai_study_sets SET summary = 'Changed in another window.'");
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    expect(await edit.findByText(/changed after you opened it/)).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review the new study guide and cards" }));
    const review = await dialog("Review the new study guide");
    await review.findByText(/Bring it back: Card: What does the rudder do\?/);
    expect(review.getByLabelText(/Keep my items/)).toHaveProperty("checked", true);
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));

    await waitFor(async () => expect((await savedSet()).summary).toBe("A new summary."));
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
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    await screen.findByRole("button", { name: "Review the new study guide and cards" });
    expect((await savedSet()).summary).toBe("Mine");
  });

  async function herEditThenRegenerate() {
    const read = (await repos.documents.readStudySetForEdit("mat-a"))!;
    const { authoringStateOf, frameOf, nextSetOf } = await import("@/logic/studySetEditing");
    const { prepareStudyEdit } = await import("@/logic/studyAuthoring");
    const state = authoringStateOf(read.set);
    const edited = await prepareStudyEdit(state, { kind: "edit", itemId: state.items[2]!.itemId, fields: ["Which wing is lowered?", "The upwind wing."], origin: "user" });
    await repos.documents.saveStudySet({ operationId: crypto.randomUUID(), materialId: "mat-a", reason: "edit", expected: read.stored, next: nextSetOf(frameOf(read.set), edited.next) });
    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({ ...AID, summary: "A new summary.", jobId: "job-555555555555555555555555", contentSha256: "" });
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Gemini" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review the new study guide and cards" }));
    const review = await dialog("Review the new study guide");
    await review.findByRole("button", { name: "Save the reviewed study guide" });
    return review;
  }

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
    expect(await review.findByText(/Your choices are still here/)).toBeTruthy();
    expect(review.getByLabelText(/Replace everything/)).toHaveProperty("checked", true);
    expect((await history()).map((row) => row.reason)).toEqual(["edit"]);
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
    await waitFor(async () => expect((await savedSet()).summary).toBe("A new summary."));
    expect((await savedSet()).flashcards.every((card) => card.origin === undefined)).toBe(true);
    expect((await history()).map((row) => row.reason)).toEqual(["edit", "regenerate"]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review the new study guide" })).toBeNull());
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
    expect(await review.findByText(/Your choices are still here/)).toBeTruthy();
    fireEvent.click(review.getByRole("button", { name: "Save the reviewed study guide" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review the new study guide" })).toBeNull());
    expect((await history()).map((row) => row.reason)).toEqual(["edit", "regenerate"]);
  });

  it("restoring is refused when the guide changed after she opened the confirmation", async () => {
    await open("/study/mat-a");
    fireEvent.click(await screen.findByRole("button", { name: "Edit study guide" }));
    const editor = within(await screen.findByRole("region", { name: "Edit this study guide" }));
    fireEvent.click(editor.getAllByRole("button", { name: "Edit" })[0]!);
    const edit = await dialog("Edit this summary");
    await fill(edit, "Summary", "Mine.");
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await savedSet()).summary).toBe("Mine."));
    fireEvent.click(screen.getByRole("button", { name: "Previous versions" }));
    const versions = within(await screen.findByRole("list", { name: "Previous versions" }));
    fireEvent.click(versions.getByRole("button", { name: "Restore" }));
    const confirm = await dialog("Restore this version?");
    // The confirmation has read the set she is looking at.
    await waitFor(async () => expect(await repos.documents.readStoredStudySet("mat-a")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 20));
    await db.execute("UPDATE ai_study_sets SET summary = 'Changed in another window.'");
    fireEvent.click(confirm.getByRole("button", { name: "Restore" }));
    expect(await confirm.findByText(/changed after you opened it/)).toBeTruthy();
    expect((await savedSet()).summary).toBe("Changed in another window.");
    expect((await history()).map((row) => row.reason)).toEqual(["edit"]);
  });
});
