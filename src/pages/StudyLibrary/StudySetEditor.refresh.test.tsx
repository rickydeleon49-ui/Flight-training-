// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { StudySetEditor } from "@/pages/StudyLibrary/StudySetEditor";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";

/**
 * STALE-01: after "Get changes from my Mac" the open card list shows the new
 * wording without a relaunch, and a card dialog with typing in it keeps that
 * typing. The card is changed under the mounted list the way the import does:
 * a direct database write, then the same refresh() the Get changes card calls.
 */
let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

configure({ asyncUtilTimeout: 20_000 });
const SLOW = { timeout: 20_000 };
const materialId = "mat-stale";
let refresh: () => Promise<void>;

function Editor() {
  const ctx = useAppData();
  refresh = ctx.refresh;
  const material = ctx.data.materials.find((m) => m.id === materialId);
  const set = ctx.data.aiStudySets.find((s) => s.sourceMaterialId === materialId);
  return ctx.status === "ready" && material && set ? h(StudySetEditor, { material, studySet: set }) : null;
}

const bringInFromMac = async () => {
  const [row] = await db.select<{ flashcards_json: string }>("SELECT flashcards_json FROM ai_study_sets");
  const cards = JSON.parse(row!.flashcards_json);
  cards[0].front = "Reworded on the Mac";
  await db.execute("UPDATE ai_study_sets SET flashcards_json = ?", [JSON.stringify(cards)]);
  await act(async () => { await refresh(); });
};

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  const repos = createRepositories(db);
  await repos.documents.create({ id: materialId, title: "Synthetic material" });
  await repos.documents.saveAiStudySet({
    sourceMaterialId: materialId, title: "Guide", summary: "Saved summary.", sections: [],
    flashcards: [{ front: "Old wording", back: "Back", sourcePage: null }], sourceNotes: "", model: "gemini-3.5-flash",
  });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([]);
  vi.spyOn(geminiService, "watchGeminiJobs").mockResolvedValue(() => {});
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

describe("card list after changes are brought in", { timeout: 60_000 }, () => {
  it("shows the new wording without remounting", async () => {
    render(h(AppDataProvider, null, h(Editor)));
    await screen.findByText(/Old wording/, undefined, SLOW);
    await bringInFromMac();
    await waitFor(() => expect(screen.queryByText(/Old wording/)).toBeNull(), SLOW);
    expect(screen.getByText(/Reworded on the Mac/)).toBeTruthy();
  });

  it("keeps what she is typing in an open card dialog", async () => {
    render(h(AppDataProvider, null, h(Editor)));
    await screen.findByText(/Old wording/, undefined, SLOW);
    const row = screen.getByText(/Old wording/).closest(".row") as HTMLElement;
    fireEvent.click(within(row).getAllByRole("button", { name: /Edit/ })[0]!);
    const dialog = within(await screen.findByRole("dialog", undefined, SLOW));
    const box = (await dialog.findAllByRole("textbox"))[0] as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "My half-typed wording" } });
    await bringInFromMac();
    expect((within(screen.getByRole("dialog")).getAllByRole("textbox")[0] as HTMLTextAreaElement).value).toBe("My half-typed wording");
  });
});
