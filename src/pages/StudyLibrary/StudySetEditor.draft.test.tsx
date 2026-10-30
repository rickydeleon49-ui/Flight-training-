// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { StudySetSaveError } from "@/data/persistenceErrors";
import type { StudySetSaveOperation } from "@/data/studySetTransaction";
import { readDraft } from "@/lib/drafts";
import { StudySetEditor, studySetDraftKey } from "@/pages/StudyLibrary/StudySetEditor";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";

/**
 * QUIT-01: typing in a study-set dialog is kept as a draft, so quitting (or
 * any unmount without Cancel or Save) never loses it. Synthetic data only.
 */
let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

configure({ asyncUtilTimeout: 20_000 });
const SLOW = { timeout: 20_000 };
const materialId = "mat-draft";
const key = studySetDraftKey(materialId);
let repos: ReturnType<typeof createRepositories>;

function Editor() {
  const { status, data } = useAppData();
  const material = data.materials.find((m) => m.id === materialId);
  const set = data.aiStudySets.find((s) => s.sourceMaterialId === materialId);
  return status === "ready" && material && set ? h(StudySetEditor, { material, studySet: set }) : null;
}
const mount = () => render(h(AppDataProvider, null, h(Editor)));
const savedSummary = async () => (await repos.documents.listAiStudySets())[0]!.summary;

async function openSummary() {
  const region = within(await screen.findByRole("region", { name: "Edit this study guide" }, SLOW));
  fireEvent.click(region.getAllByRole("button", { name: "Edit" })[0]!);
  const dialog = within(await screen.findByRole("dialog", { name: "Edit this summary" }, SLOW));
  await dialog.findByLabelText("Summary");
  return dialog;
}

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
  await repos.documents.create({ id: materialId, title: "Synthetic material" });
  await repos.documents.saveAiStudySet({
    sourceMaterialId: materialId, title: "Synthetic guide", summary: "Saved summary.", sections: [],
    flashcards: [{ front: "Synthetic front", back: "Synthetic back", sourcePage: null }], sourceNotes: "", model: "gemini-3.5-flash",
  });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([]);
  vi.spyOn(geminiService, "watchGeminiJobs").mockResolvedValue(() => {});
});

afterEach(() => {
  cleanup();
  db.close();
  vi.restoreAllMocks();
});

describe("study-set editor drafts", { timeout: 60_000 }, () => {
  it("brings her typing back after the editor goes away, with no question when nothing changed", async () => {
    mount();
    const dialog = await openSummary();
    fireEvent.change(dialog.getByLabelText("Summary"), { target: { value: "My unsaved summary." } });
    expect(readDraft<{ fields: string[] }>(key)?.fields).toEqual(["My unsaved summary."]);
    cleanup(); // As if she quit with the dialog open.

    mount();
    const again = within(await screen.findByRole("dialog", { name: "Edit this summary" }, SLOW));
    await waitFor(() => expect(again.getByLabelText("Summary")).toHaveProperty("value", "My unsaved summary."));
    expect(again.queryByText(/unsaved changes to this summary from earlier/)).toBeNull();
    fireEvent.click(again.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await savedSummary()).toBe("My unsaved summary."), SLOW);
    await waitFor(() => expect(readDraft(key)).toBeNull());
  });

  it("asks before using a draft whose saved set changed, and can go back to the saved one", async () => {
    mount();
    const dialog = await openSummary();
    fireEvent.change(dialog.getByLabelText("Summary"), { target: { value: "Typed before quitting." } });
    cleanup();
    await db.execute("UPDATE ai_study_sets SET summary = 'Changed elsewhere.'");

    mount();
    const again = within(await screen.findByRole("dialog", { name: "Edit this summary" }, SLOW));
    await again.findByText("You have unsaved changes to this summary from earlier.");
    expect(again.getByLabelText("Summary")).toHaveProperty("value", "Typed before quitting.");
    expect(again.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    fireEvent.click(again.getByRole("button", { name: "Use the saved summary" }));
    await waitFor(() => expect(again.getByLabelText("Summary")).toHaveProperty("value", "Changed elsewhere."));
    expect(again.queryByText(/from earlier/)).toBeNull();
  });

  it("keeping a draft over a changed set is refused at save, never overwriting", async () => {
    mount();
    const dialog = await openSummary();
    fireEvent.change(dialog.getByLabelText("Summary"), { target: { value: "Mine." } });
    cleanup();
    await db.execute("UPDATE ai_study_sets SET summary = 'Changed elsewhere.'");

    mount();
    const again = within(await screen.findByRole("dialog", { name: "Edit this summary" }, SLOW));
    fireEvent.click(await again.findByRole("button", { name: "Keep these" }));
    fireEvent.click(again.getByRole("button", { name: "Save" }));
    expect(await again.findByText(/changed after you opened it/, undefined, SLOW)).toBeTruthy();
    expect(await savedSummary()).toBe("Changed elsewhere.");
    expect(again.getByLabelText("Summary")).toHaveProperty("value", "Mine.");
  });

  it("Cancel lets the draft go", async () => {
    mount();
    const dialog = await openSummary();
    fireEvent.change(dialog.getByLabelText("Summary"), { target: { value: "Throw away." } });
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit this summary" })).toBeNull());
    expect(readDraft(key)).toBeNull();
    cleanup();
    mount();
    await screen.findByRole("region", { name: "Edit this study guide" }, SLOW);
    expect(screen.queryByRole("dialog", { name: "Edit this summary" })).toBeNull();
  });

  it("an uncertain save that committed is not applied twice after a relaunch", async () => {
    const save = db.saveStudySetAtomically!.bind(db);
    const seen: StudySetSaveOperation[] = [];
    let lose = 1;
    db.saveStudySetAtomically = async (operation) => {
      seen.push(operation);
      const result = await save(operation);
      if (lose) {
        lose--;
        throw new StudySetSaveError("IPC_TRANSPORT_ERROR");
      }
      return result;
    };
    mount();
    const dialog = await openSummary();
    fireEvent.change(dialog.getByLabelText("Summary"), { target: { value: "Saved, but the answer was lost." } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await dialog.findByText(/your text is still here|couldn't|connection|answer/i, undefined, SLOW);
    // The uncertain save's identity is kept with the draft, for a retry after relaunch.
    await waitFor(() => expect(readDraft<{ pending: { operation: StudySetSaveOperation } | null }>(key)?.pending?.operation.operationId).toBe(seen[0]!.operationId));
    cleanup();

    mount();
    const again = within(await screen.findByRole("dialog", { name: "Edit this summary" }, SLOW));
    // The save did happen, so the set moved on: she is asked, keeps hers, saves.
    fireEvent.click(await again.findByRole("button", { name: "Keep these" }));
    fireEvent.click(again.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit this summary" })).toBeNull(), SLOW);
    // Either nothing is left to save, or the retry is the very same operation.
    expect(seen.length).toBeLessThanOrEqual(2);
    if (seen.length === 2) expect(seen[1]!.operationId).toBe(seen[0]!.operationId);
    expect(await db.select("SELECT id FROM study_set_history")).toHaveLength(1);
    expect(await savedSummary()).toBe("Saved, but the answer was lost.");
    expect(readDraft(key)).toBeNull();
  });
});
