// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { StudySetEditor } from "@/pages/StudyLibrary/StudySetEditor";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

configure({ asyncUtilTimeout: 20_000 });
const SLOW = { timeout: 20_000 };
const materialId = "mat-quizlet";

function Editor() {
  const ctx = useAppData();
  const material = ctx.data.materials.find((m) => m.id === materialId);
  const set = ctx.data.aiStudySets.find((s) => s.sourceMaterialId === materialId);
  return ctx.status === "ready" && material && set ? h(StudySetEditor, { material, studySet: set }) : null;
}

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  const repos = createRepositories(db);
  await repos.documents.create({ id: materialId, title: "Synthetic material" });
  await repos.documents.saveAiStudySet({
    sourceMaterialId: materialId, title: "Guide", summary: "Saved summary.", sections: [],
    flashcards: [{ front: "Existing", back: "Back", sourcePage: null }], sourceNotes: "", model: "gemini-3.5-flash",
  });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([]);
  vi.spyOn(geminiService, "watchGeminiJobs").mockResolvedValue(() => {});
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

describe("Add cards from Quizlet", { timeout: 60_000 }, () => {
  it("previews pasted lines and adds them as cards in one save", async () => {
    render(h(AppDataProvider, null, h(Editor)));
    fireEvent.click(await screen.findByRole("button", { name: "Add cards from Quizlet" }, SLOW));
    fireEvent.change(await screen.findByLabelText("Quizlet text"), { target: { value: "Lift\tUpward force\nDrag\tResists motion" } });
    expect(await screen.findByText(/2 cards found/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add 2 cards" }));
    await waitFor(() => {
      expect(screen.getByText(/^Lift/)).toBeTruthy();
      expect(screen.getByText(/^Drag/)).toBeTruthy();
    }, SLOW);
    const [row] = await db.select<{ flashcards_json: string }>("SELECT flashcards_json FROM ai_study_sets");
    const cards = JSON.parse(row!.flashcards_json);
    expect(cards).toHaveLength(3);
    expect(cards[1].origin).toBe("user");
  });
});
