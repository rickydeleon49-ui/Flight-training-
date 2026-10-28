// @vitest-environment jsdom
/**
 * OFFLINE-02c: a link from offline search opens the guide section, card or
 * practice question it names, only while its text is the text that matched,
 * and never shows a practice answer. Synthetic records in real SQLite.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { itemDigest } from "@/logic/savedSearch";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import * as documentService from "@/services/documents";
import * as offlineService from "@/services/offlineContent";
import * as geminiService from "@/services/gemini";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  return null;
}
function Ready() {
  return useAppData().status === "ready"
    ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }))
    : null;
}

let repos: Repositories;
const section = { heading: "Tracking", body: "Saved section body about radials." };

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
  await repos.app.set("airline_starter_pack", "skipped-for-test");
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: false, model: "gemini-3.5-flash", choice: "standard" });
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
  const created = await repos.documents.create({
    id: "mat-saved",
    title: "VOR navigation handout",
    filePath: "documents/vor.pdf",
    originalFileName: "vor.pdf",
    fileSize: 4096,
  });
  await repos.documents.saveAiStudySet({
    sourceMaterialId: created.id,
    title: "Saved VOR guide",
    summary: "Saved summary of VOR tracking.",
    sections: [section, { heading: "Station passage", body: "The flag flips." }],
    flashcards: [
      { front: "What is a VOR?", back: "A VHF omnidirectional range.", sourcePage: 3 },
      { front: "Second saved question", back: "Second saved answer", sourcePage: null },
    ],
    sourceNotes: "",
    model: "gemini-3.5-flash",
  });
});

afterEach(() => {
  cleanup();
  db.close();
  vi.restoreAllMocks();
});

async function open(search: string) {
  const view = render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [`/study/mat-saved${search}`] }, h(Probe), h(Ready))));
  await waitFor(() => expect(context.status).toBe("ready"));
  await screen.findByRole("heading", { name: "VOR navigation handout" });
  return view;
}

const highlighted = (id: string) => document.getElementById(id)?.classList.contains("search-target") ?? false;

describe("links from offline search", () => {
  it("reports a failed practice-link read without raw error text and retries only the read", async () => {
    const select = db.select.bind(db);
    let blocked = true;
    let reads = 0;
    vi.spyOn(db, "select").mockImplementation(async (sql, params) => {
      if (sql.includes("WHERE source_material_id = ? AND is_active = 1")) {
        reads++;
        if (blocked) throw new Error("private database failure details");
      }
      return select(sql, params);
    });
    const mutate = vi.spyOn(db, "savePracticeSessionAtomically");
    await open("?question=not-current");
    expect(await screen.findByText("Couldn't open this search result. Try again.")).toBeTruthy();
    expect(screen.queryByText(/private database failure details/)).toBeNull();
    const beforeRetry = reads;
    blocked = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry opening search result" }));
    expect(await screen.findByText("That practice question isn't in this material's current practice test any more.")).toBeTruthy();
    expect(reads).toBe(beforeRetry + 1);
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry opening search result" })).toBeNull();
  });

  it("consumes a practice-link rejection after leaving the material page", async () => {
    const select = db.select.bind(db);
    let rejectRead: ((error: Error) => void) | undefined;
    vi.spyOn(db, "select").mockImplementation(async (sql, params) => {
      if (sql.includes("WHERE source_material_id = ? AND is_active = 1")) {
        return new Promise((_, reject) => { rejectRead = reject; });
      }
      return select(sql, params);
    });
    const view = await open("?question=not-current");
    await waitFor(() => expect(rejectRead).toBeDefined());
    view.unmount();
    await act(async () => {
      rejectRead!(new Error("late read failure"));
      await Promise.resolve();
    });
    // Vitest also fails this test run if that rejection goes unhandled.
  });

  it("opens a guide section while it is unchanged, and stops when its text changes with the same timestamp", async () => {
    const rev = await itemDigest([section.heading, section.body]);
    await open(`?guide=0&rev=${rev}`);
    await waitFor(() => expect(highlighted("search-target-guide-0")).toBe(true));
    expect(highlighted("search-target-guide-1")).toBe(false);

    // Different text at the same index, saved with the very same updated_at.
    const before = (await db.select<{ updated_at: string }>("SELECT updated_at FROM ai_study_sets WHERE source_material_id = 'mat-saved'"))[0]!.updated_at;
    await db.execute(
      "UPDATE ai_study_sets SET sections_json = ?, updated_at = ? WHERE source_material_id = 'mat-saved'",
      [JSON.stringify([{ heading: "Regenerated", body: "Entirely different text." }]), before],
    );
    await act(async () => {
      await context.refresh();
    });
    await waitFor(() => expect(highlighted("search-target-guide-0")).toBe(false));
    expect(await screen.findByText("This study guide has changed since you searched. Search again to find it.")).toBeTruthy();
  });

  it("shows the linked card", async () => {
    const rev = await itemDigest(["Second saved question", "Second saved answer"]);
    await open(`?card=1&rev=${rev}`);
    expect(await screen.findByRole("heading", { name: "Card 2 of 2" })).toBeTruthy();
    expect(highlighted("search-target-cards")).toBe(true);
    // The card shows its question side, as always; the answer stays hidden.
    expect(screen.queryByText("Second saved answer")).toBeNull();
  });

  it("refuses a link whose text no longer matches", async () => {
    await open(`?card=0&rev=${await itemDigest(["Old front", "Old back"])}`);
    expect(await screen.findByText("This study guide has changed since you searched. Search again to find it.")).toBeTruthy();
    expect(highlighted("search-target-cards")).toBe(false);
  });
});

it("PACKS-04 a material preparation link reaches the reading button on the full page", async () => {
  vi.spyOn(offlineService, "offlineStudyEnabled").mockReturnValue(true);
  vi.spyOn(offlineService, "offlineContentReadiness").mockResolvedValue([{ materialId: "mat-saved", readiness: { state: "notPrepared" } }]);
  await open("#read-pdf-text");
  const button = await screen.findByRole("button", { name: "Read this PDF's text" });
  await waitFor(() => expect(document.activeElement).toBe(button));
  expect(button.closest("#read-pdf-text")).toBeTruthy();
});
