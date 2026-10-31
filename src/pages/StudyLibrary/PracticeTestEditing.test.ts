// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import { StartManualPracticeTest } from "@/pages/StudyLibrary/PracticeTestEditing";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";
import * as documentService from "@/services/documents";
import { PracticeAuthoringError, PRACTICE_AUTHORING_ERROR_MESSAGES } from "@/data/persistenceErrors";
import { buildPracticeEditOperation, draftFromSnapshot } from "@/data/practiceAuthoringDraft";

// Synthetic materials only; all authoring saves use the real SQLite transaction.
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
  const material = data.materials.find((m) => m.id === materialId);
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
            material ? h(StartManualPracticeTest, { material }) : null,
          ),
        }),
      )
    : null;
}

async function open(path: string) {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Probe), h(Ready))));
  await waitFor(() => expect(context.status).toBe("ready"));
}

let repos: ReturnType<typeof createRepositories>;
// Every step here runs the real save path; under a loaded full-suite run a
// default one-second wait is not enough. Scoped to this file's worker.
configure({ asyncUtilTimeout: 10_000 });
// A reviewed save runs the whole job path; under a loaded full-suite run it can
// outlast the default one-second wait.
const SLOW_RUNNER = { timeout: 10_000 };

const materialId = "mat-practice";
const snapshot = () => repos.documents.readPracticeSnapshot(materialId);
const receipts = () => db.select("SELECT operation_id FROM practice_save_operations");
const seed = async (origins: ("user" | "instructor" | undefined)[] = ["user"]) => {
  await repos.documents.savePracticeAuthoring({
    operationId: crypto.randomUUID(), sourceMaterialId: materialId, reason: "create", expected: null,
    next: { title: "Synthetic questions", provider: "manual", model: "", retired: [], questions: origins.map((origin, index) => ({
      identity: crypto.randomUUID(), question: `Synthetic question ${index + 1}`, options: ["First", "Second"], correctIndex: 0,
      explanation: "Private answer explanation", sourcePage: null, ...(origin ? { origin } : {}),
    })) },
  });
};
async function directEdit(wording: string, index = 0) {
  const expected = (await snapshot())!;
  const draft = draftFromSnapshot(expected);
  draft[index]!.question = wording;
  await repos.documents.savePracticeAuthoring(await buildPracticeEditOperation({ operationId: crypto.randomUUID(), materialId, expected, title: expected.title, draft }));
}
async function editor() {
  const button = await screen.findByRole("button", { name: "Edit questions" });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button);
  const scope = await dialog("Edit questions");
  await scope.findByLabelText("Question 1 wording");
  return scope;
}
async function saveAndClose(scope: ReturnType<typeof within>) {
  fireEvent.click(scope.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit questions" })).toBeNull(), SLOW_RUNNER);
}
async function restoreFirst() {
  const list = within(await screen.findByRole("list", { name: "Previous practice versions" }));
  fireEvent.click(list.getAllByRole("button", { name: "Bring this version back" })[0]!);
  const confirm = await dialog("Bring this version back?");
  const button = confirm.getByRole("button", { name: "Bring this version back" });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Bring this version back?" })).toBeNull(), SLOW_RUNNER);
}

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
  await repos.documents.create({ id: materialId, title: "Synthetic material" });
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

describe("practice question authoring on the material page", () => {
  it("keeps a first draft open after a committed save loses its acknowledgement", async () => {
    await open(`/study/${materialId}`);
    fireEvent.click(await screen.findByRole("button", { name: "Write your own practice questions" }));
    const create = await dialog("Write your own practice questions");
    await fill(create, "Question 1 wording", "A first draft I can retry");
    await fill(create, "Question 1, option 1", "First answer");
    await fill(create, "Question 1, option 2", "Second answer");
    const real = db.savePracticeAuthoringAtomically!.bind(db);
    const spy = vi.spyOn(db, "savePracticeAuthoringAtomically").mockImplementationOnce(async (operation) => {
      await real(operation);
      throw new PracticeAuthoringError("IPC_TRANSPORT_ERROR");
    });
    fireEvent.click(create.getByRole("button", { name: "Save" }));
    await create.findByText(PRACTICE_AUTHORING_ERROR_MESSAGES.IPC_TRANSPORT_ERROR);
    expect(create.getByLabelText("Question 1 wording")).toHaveProperty("value", "A first draft I can retry");
    expect(await receipts()).toHaveLength(1);
    fireEvent.click(create.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Write your own practice questions" })).toBeNull());
    expect(spy.mock.calls[0]![0]).toEqual(spy.mock.calls[1]![0]);
    expect(await receipts()).toHaveLength(1);
    expect(await db.select("SELECT id FROM practice_test_versions")).toHaveLength(1);
  });

  it("writes a first manual test with one version", async () => {
    await open(`/study/${materialId}`);
    fireEvent.click(await screen.findByRole("button", { name: "Write your own practice questions" }));
    const create = await dialog("Write your own practice questions");
    await fill(create, "Question 1 wording", "My first question");
    await fill(create, "Question 1, option 1", "Answer one");
    await fill(create, "Question 1, option 2", "Answer two");
    fireEvent.click(create.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await snapshot())?.provider).toBe("manual"));
    expect((await snapshot())?.questions[0]).toMatchObject({ question: "My first question", origin: "user" });
    expect(await db.select("SELECT id FROM practice_test_versions")).toHaveLength(1);
    expect(await receipts()).toHaveLength(1);
    await screen.findByText("Practice questions you wrote. Check them against your source and your instructor's guidance.");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit questions" })));
  });

  it("edits a stem and keeps its corrected retirement", async () => {
    await seed();
    await open(`/study/${materialId}`);
    const edit = await editor();
    await fill(edit, "Question 1 wording", "My revised question");
    await saveAndClose(edit);
    expect((await snapshot())?.questions[0]?.question).toBe("My revised question");
    expect((await snapshot())?.retired).toMatchObject([{ reason: "corrected" }]);
  });

  it("keeps the instructor mark checked and disabled after saving", async () => {
    await seed();
    await open(`/study/${materialId}`);
    const edit = await editor();
    fireEvent.click(edit.getByLabelText("My instructor corrected this"));
    await saveAndClose(edit);
    const again = await editor();
    expect(again.getByLabelText("My instructor corrected this")).toHaveProperty("checked", true);
    expect(again.getByLabelText("My instructor corrected this")).toHaveProperty("disabled", true);
    expect((await snapshot())?.questions[0]?.origin).toBe("instructor");
  });

  it("confirms deletion inside a dialog and records it only on Save", async () => {
    await seed(["user", undefined]);
    await open(`/study/${materialId}`);
    const edit = await editor();
    fireEvent.click(edit.getByRole("button", { name: "Delete question 1" }));
    const confirm = await dialog("Delete this question?");
    expect((await snapshot())?.questions).toHaveLength(2);
    fireEvent.click(confirm.getByRole("button", { name: "Cancel" }));
    expect(edit.getByLabelText("Question 2 wording")).toBeTruthy();
    fireEvent.click(edit.getByRole("button", { name: "Delete question 1" }));
    fireEvent.click((await dialog("Delete this question?")).getByRole("button", { name: "Delete" }));
    expect((await snapshot())?.questions).toHaveLength(2);
    await saveAndClose(edit);
    expect((await snapshot())?.retired).toMatchObject([{ reason: "deleted" }]);
    expect((await snapshot())?.questions).toHaveLength(1);
  });

  it("Cancel leaves the receipt count and snapshot unchanged", async () => {
    await seed();
    const before = await snapshot();
    await open(`/study/${materialId}`);
    const edit = await editor();
    await fill(edit, "Question 1 wording", "Unsaved draft");
    fireEvent.click(edit.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit questions" })).toBeNull());
    expect(await snapshot()).toEqual(before);
    expect(await receipts()).toHaveLength(1);
  });

  it("keeps the draft and reuses the operation id after a transport failure", async () => {
    await seed();
    await db.execute("DELETE FROM practice_save_operations");
    await open(`/study/${materialId}`);
    const edit = await editor();
    await fill(edit, "Question 1 wording", "Retry my draft");
    const spy = vi.spyOn(db, "savePracticeAuthoringAtomically").mockRejectedValueOnce(new PracticeAuthoringError("IPC_TRANSPORT_ERROR"));
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    await edit.findByText(PRACTICE_AUTHORING_ERROR_MESSAGES.IPC_TRANSPORT_ERROR);
    expect(edit.getByLabelText("Question 1 wording")).toHaveProperty("value", "Retry my draft");
    await saveAndClose(edit);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]![0]).toEqual(spy.mock.calls[1]![0]);
    expect(await receipts()).toHaveLength(1);
  });

  it("refuses a stale draft and loads latest only after confirmation", async () => {
    await seed();
    await open(`/study/${materialId}`);
    const edit = await editor();
    await fill(edit, "Question 1 wording", "Stale draft");
    await directEdit("Changed elsewhere");
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    await edit.findByText(PRACTICE_AUTHORING_ERROR_MESSAGES.STALE_CONTENT);
    expect((await snapshot())?.questions[0]?.question).toBe("Changed elsewhere");
    expect(await receipts()).toHaveLength(2);
    fireEvent.click(edit.getByRole("button", { name: "Load the latest version" }));
    const confirm = await dialog("Load the latest version?");
    expect(edit.getByLabelText("Question 1 wording")).toHaveProperty("value", "Stale draft");
    fireEvent.click(confirm.getByRole("button", { name: "Load latest" }));
    await waitFor(() => expect(edit.getByLabelText("Question 1 wording")).toHaveProperty("value", "Changed elsewhere"));
    expect(await receipts()).toHaveLength(2);
  });

  it("disables editing during an in-progress attempt", async () => {
    await seed();
    const active = (await repos.practiceSessions.getActiveVersion(materialId))!;
    await repos.practiceSessions.saveSessionAction({ action: "start_or_resume", operationId: crypto.randomUUID(), materialId, versionId: active.version.id });
    await open(`/study/${materialId}`);
    await screen.findByText(/use Abandon attempt below/);
    expect(screen.getByRole("button", { name: "Edit questions" })).toHaveProperty("disabled", true);
    expect(await screen.findByRole("button", { name: "Abandon attempt" })).toBeTruthy();
  });

  it("brings an earlier version back without revealing answers in history", async () => {
    await seed();
    const earlier = (await snapshot())!;
    await directEdit("New wording");
    await open(`/study/${materialId}`);
    const list = within(await screen.findByRole("list", { name: "Previous practice versions" }));
    expect(list.getByText(/ · 1 question$/)).toBeTruthy();
    expect(list.queryByText("Private answer explanation")).toBeNull();
    expect(list.queryByText("Correct answer")).toBeNull();
    await restoreFirst();
    expect((await snapshot())?.questions).toEqual(earlier.questions);
    expect((await snapshot())?.retired).toHaveLength(1);
  });

  it("restores after removal with the union of all preserved ledgers", async () => {
    await seed();
    const earliest = (await snapshot())!;
    await directEdit("Second wording");
    await directEdit("Third wording");
    const ledger = (await snapshot())!.retired;
    await repos.documents.removePracticeTest(materialId);
    await open(`/study/${materialId}`);
    const list = within(await screen.findByRole("list", { name: "Previous practice versions" }));
    const buttons = list.getAllByRole("button", { name: "Bring this version back" });
    // Saves can share a timestamp; history ids break that tie, not version age.
    const history = await repos.documents.listPracticeHistory(materialId);
    const earliestIndex = history.findIndex((entry) => entry.snapshot?.versionId === earliest.versionId);
    expect(earliestIndex).toBeGreaterThanOrEqual(0);
    fireEvent.click(buttons[earliestIndex]!);
    const confirm = await dialog("Bring this version back?");
    const bringBack = confirm.getByRole("button", { name: "Bring this version back" });
    await waitFor(() => expect(bringBack).toHaveProperty("disabled", false));
    fireEvent.click(bringBack);
    await waitFor(async () => expect((await snapshot())?.questions).toEqual(earliest.questions));
    expect((await snapshot())?.retired).toEqual(ledger);
  });

  it("blocks an empty option inline before calling the save wire", async () => {
    await seed();
    await open(`/study/${materialId}`);
    const edit = await editor();
    await fill(edit, "Question 1, option 2", "");
    const spy = vi.spyOn(db, "savePracticeAuthoringAtomically");
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    await edit.findByText("Write an answer option first.");
    expect(spy).not.toHaveBeenCalled();
  });

  it("uses a new operation when the draft changes after a transport failure", async () => {
    await seed();
    await open(`/study/${materialId}`);
    const edit = await editor();
    const spy = vi.spyOn(db, "savePracticeAuthoringAtomically").mockRejectedValueOnce(new PracticeAuthoringError("IPC_TRANSPORT_ERROR"));
    await fill(edit, "Question 1 wording", "First intent");
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    await edit.findByText(PRACTICE_AUTHORING_ERROR_MESSAGES.IPC_TRANSPORT_ERROR);
    await fill(edit, "Question 1 wording", "Second intent");
    await saveAndClose(edit);
    expect(spy.mock.calls[0]![0].operationId).not.toBe(spy.mock.calls[1]![0].operationId);
  });

  it("retries a restore with the same operation after a lost acknowledgement", async () => {
    await seed();
    await directEdit("Revised wording");
    await open(`/study/${materialId}`);
    const list = within(await screen.findByRole("list", { name: "Previous practice versions" }));
    fireEvent.click(list.getByRole("button", { name: "Bring this version back" }));
    const confirm = await dialog("Bring this version back?");
    const button = confirm.getByRole("button", { name: "Bring this version back" });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    const real = db.savePracticeAuthoringAtomically!.bind(db);
    const spy = vi.spyOn(db, "savePracticeAuthoringAtomically").mockImplementationOnce(async (operation) => {
      await real(operation);
      throw new PracticeAuthoringError("IPC_TRANSPORT_ERROR");
    });
    fireEvent.click(button);
    await confirm.findByText(PRACTICE_AUTHORING_ERROR_MESSAGES.IPC_TRANSPORT_ERROR);
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Bring this version back?" })).toBeNull());
    expect(spy.mock.calls[0]![0]).toEqual(spy.mock.calls[1]![0]);
    expect(await receipts()).toHaveLength(3);
  });

  it("validates answer selection and all text/page bounds without saving", async () => {
    await seed();
    await open(`/study/${materialId}`);
    const edit = await editor();
    const spy = vi.spyOn(db, "savePracticeAuthoringAtomically");
    await fill(edit, "Practice test title", "t".repeat(501));
    await fill(edit, "Question 1 wording", "q".repeat(10_001));
    await fill(edit, "Question 1, option 1", "a".repeat(1_001));
    await fill(edit, "Question 1 explanation (optional)", "e".repeat(5_001));
    await fill(edit, "Question 1 page (optional)", "1001");
    fireEvent.click(edit.getByRole("button", { name: "Save" }));
    await edit.findByText("Keep the title within 500 characters.");
    expect(edit.getByText("Keep the question within 10,000 characters.")).toBeTruthy();
    expect(edit.getByText("Keep each option within 1,000 characters.")).toBeTruthy();
    expect(edit.getByText("Keep the explanation within 5,000 characters.")).toBeTruthy();
    expect(edit.getByText("Use a page from 1 to 1,000, or leave it empty.")).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });
});

// QUIT-01: typing in any practice editor is kept as she types, so quitting
// with the dialog open never loses it.
describe("practice question drafts", () => {
  const mirrorKey = `hfd:practice-questions:${materialId}`;
  const stored = () => JSON.parse(localStorage.getItem(mirrorKey) ?? "null");

  it("keeps a manual first test's typing and opens it again by itself", async () => {
    await open(`/study/${materialId}`);
    fireEvent.click(await screen.findByRole("button", { name: "Write your own practice questions" }));
    const create = await dialog("Write your own practice questions");
    await fill(create, "Question 1 wording", "Typed before quitting");
    await waitFor(() => expect(stored()?.draft[0]?.question).toBe("Typed before quitting"));
    cleanup(); // As if she quit with the dialog open.

    await open(`/study/${materialId}`);
    const again = await dialog("Write your own practice questions");
    await waitFor(() => expect(again.getByLabelText("Question 1 wording")).toHaveProperty("value", "Typed before quitting"));
    expect(again.queryByText(/unsaved changes to these questions from earlier/)).toBeNull();
    expect(again.getByText("We kept your unsaved changes from last time. Save them, or Cancel to drop them.")).toBeTruthy();
    await fill(again, "Question 1, option 1", "One");
    await fill(again, "Question 1, option 2", "Two");
    fireEvent.click(again.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await snapshot())?.questions[0]?.question).toBe("Typed before quitting"), SLOW_RUNNER);
    expect(stored()).toBeNull();
  });

  it("keeps an edit's typing, asks when the saved test changed, and can use the saved questions", async () => {
    await seed();
    await open(`/study/${materialId}`);
    const edit = await editor();
    await fill(edit, "Question 1 wording", "My unsaved edit");
    cleanup();
    await directEdit("Changed elsewhere");

    await open(`/study/${materialId}`);
    const again = await dialog("Edit questions");
    await again.findByText("You have unsaved changes to these questions from earlier.");
    expect(again.getByLabelText("Question 1 wording")).toHaveProperty("value", "My unsaved edit");
    expect(again.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    fireEvent.click(again.getByRole("button", { name: "Use the saved questions" }));
    await waitFor(() => expect(again.getByLabelText("Question 1 wording")).toHaveProperty("value", "Changed elsewhere"));
    expect(again.queryByText(/from earlier/)).toBeNull();
  });

  it("keeping a draft over a changed test is refused at save, never overwriting", async () => {
    await seed();
    await open(`/study/${materialId}`);
    const edit = await editor();
    await fill(edit, "Question 1 wording", "Mine");
    cleanup();
    await directEdit("Changed elsewhere");

    await open(`/study/${materialId}`);
    const again = await dialog("Edit questions");
    fireEvent.click(await again.findByRole("button", { name: "Keep these" }));
    fireEvent.click(again.getByRole("button", { name: "Save" }));
    await again.findByText(PRACTICE_AUTHORING_ERROR_MESSAGES.STALE_CONTENT);
    expect((await snapshot())?.questions[0]?.question).toBe("Changed elsewhere");
  });

  it("Cancel lets the draft go, and nothing opens by itself next time", async () => {
    await seed();
    await open(`/study/${materialId}`);
    const edit = await editor();
    // A normal open says nothing about kept changes.
    expect(edit.queryByText(/We kept your unsaved changes/)).toBeNull();
    await fill(edit, "Question 1 wording", "Throw away");
    fireEvent.click(edit.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit questions" })).toBeNull());
    expect(stored()).toBeNull();
    cleanup();
    await open(`/study/${materialId}`);
    await screen.findByRole("button", { name: "Edit questions" });
    expect(screen.queryByRole("dialog", { name: "Edit questions" })).toBeNull();
  });
});

it("lets her choose and clear the ACS task in the existing editor", async () => {
  await seed();
  await open(`/study/${materialId}`);
  const edit = await editor();
  const picker = edit.getByRole("combobox", { name: "Question 1 ACS task (optional)" });
  expect(within(picker).getAllByRole("option")).toHaveLength(62);
  fireEvent.change(picker, { target: { value: "PA.II.A" } });
  await saveAndClose(edit);
  expect((await snapshot())?.questions[0]?.acsTask).toBe("PA.II.A");
  const again = await editor();
  fireEvent.change(again.getByRole("combobox", { name: "Question 1 ACS task (optional)" }), { target: { value: "" } });
  await saveAndClose(again);
  expect((await snapshot())?.questions[0]?.acsTask).toBeUndefined();
});
