// @vitest-environment jsdom
/**
 * M2-4 / C2 in the real Study Library: tabs synchronized with the address,
 * Review due opening a focused C1 session, History with read-only card
 * inspection, binder indicators, Retry, StrictMode and unmount ownership,
 * and content drift. Real router, AppDataProvider, MaterialDetail and a
 * disposable node:sqlite database; injected clock and zone; no provider or
 * network.
 */
import { createElement as h, StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { CardItemAction, CardRating, LibraryRecentReviewsInput, LibraryReviewDueInput } from "@/domain/types";
import * as localDay from "@/logic/localDay";
import * as documentService from "@/services/documents";
import * as geminiService from "@/services/gemini";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

import { MaterialDetail } from "./MaterialDetail";
import { PracticeHistory } from "./PracticeHistory";
import { StudyLibrary } from "./StudyLibrary";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

const T0 = "2026-10-06T15:00:00.000Z"; // 10:00 in Chicago
const ZONE = "America/Chicago";
const DAY = 86_400_000;
const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const cards = (label: string, n: number) => Array.from({ length: n }, (_, i) => ({ front: `${label} question ${i}`, back: `${label} answer ${i}`, sourcePage: null }));

let unhandled: unknown[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
let fetchSpy: ReturnType<typeof vi.fn>;
let navigate: NavigateFunction;
let location: ReturnType<typeof useLocation>;
let appMutate: ReturnType<typeof useAppData>["mutate"];

function Probe() {
  navigate = useNavigate();
  location = useLocation();
  appMutate = useAppData().mutate;
  return null;
}

async function material(id: string, title: string, set: unknown, o: { topic?: string; priority?: string; updatedAt?: string } = {}) {
  await createRepositories(db).documents.create({ id, title, topic: (o.topic ?? "general") as never, priority: (o.priority ?? "later") as never });
  await db.execute("UPDATE study_materials SET updated_at = ? WHERE id = ?", [o.updatedAt ?? T0, id]);
  await db.execute(
    `INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
     VALUES (?, 'Synthetic guide', 'A synthetic summary.', '[]', ?, '', 'import', '', ?, ?)`,
    [id, typeof set === "string" ? set : JSON.stringify(set), T0, T0],
  );
}

async function rate(id: string, ordinal: number, rating: CardRating, when: string) {
  vi.setSystemTime(new Date(when));
  const reviews = createRepositories(db).cardReviews;
  const snap = await reviews.getCardReviewSnapshot(id);
  if (snap.current.status !== "ok") throw new Error("no cards");
  const item = snap.current.items[ordinal]!;
  await reviews.saveAction({
    action: "rate",
    rating,
    operationId: crypto.randomUUID(),
    materialId: id,
    versionContentHash: snap.current.contentHash,
    itemId: item.itemId,
    expectedGeneration: snap.generation,
    expectedRevision: snap.states[item.itemId]?.revision ?? 0,
  } as CardItemAction);
  vi.setSystemTime(new Date(T0));
}

function renderApp(path: string, strict = false) {
  const tree = h(
    AppDataProvider,
    null,
    h(
      MemoryRouter,
      { initialEntries: [path] },
      h(Probe),
      h(
        Routes,
        null,
        h(Route, { path: "/study", element: h(StudyLibrary) }),
        h(Route, { path: "/study/history", element: h(PracticeHistory) }),
        h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }),
      ),
    ),
  );
  return render(strict ? h(StrictMode, null, tree) : tree);
}

const dueList = () => screen.findByRole("list", { name: "Materials with cards to review" });

beforeEach(async () => {
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  vi.spyOn(localDay, "currentTimeZone").mockReturnValue(ZONE);
  fetchSpy = vi.fn(() => Promise.reject(new Error("network is not allowed in this test")));
  vi.stubGlobal("fetch", fetchSpy);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  await createRepositories(db).app.set("airline_starter_pack", "skipped-for-test");
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: false, model: "" });
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(geminiService, "generateStudyAid").mockRejectedValue(new Error("Gemini must not be called"));
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(false);
});

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.off("unhandledRejection", onUnhandled);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.close();
  expect(unhandled).toEqual([]);
  expect(fetchSpy).not.toHaveBeenCalled();
});

describe("C2 independent source diagnostics", () => {
  it("[C2SRC-R1 due] same-count same-timestamp replacement invalidates loaded counts", async () => {
    await material("m1", "Weather basics", cards("Old", 2));
    await rate("m1", 0, "good", at(T0, -2 * DAY));
    renderApp("/study?tab=due");
    expect(await screen.findByText("1 card due today · 1 new card")).toBeTruthy();
    await act(async () => {
      await appMutate((repos) => repos.documents.saveAiStudySet({
        sourceMaterialId: "m1", title: "Replacement", summary: "", sections: [],
        flashcards: cards("Different", 2), sourceNotes: "", model: "synthetic",
      }));
    });
    const actual = await createRepositories(db).cardLibrary.readReviewDue({
      nowUtc: T0, nextLocalMidnightUtc: localDay.nextLocalMidnightUtc(T0, ZONE), statusFilter: "all", limit: 50,
    });
    expect(actual.materials[0]?.newCount).toBe(2);
    expect(await screen.findByText("2 new cards")).toBeTruthy();
  });
  it("[C2SRC-R1 history] same-count same-timestamp replacement invalidates provenance", async () => {
    await material("m1", "Weather basics", cards("Old", 2));
    await rate("m1", 0, "good", at(T0, -DAY));
    renderApp("/study?tab=history");
    await screen.findByRole("list", { name: "Card ratings" });
    expect(screen.queryByText("Earlier version of these cards")).toBeNull();
    await act(async () => {
      await appMutate((repos) => repos.documents.saveAiStudySet({
        sourceMaterialId: "m1", title: "Replacement", summary: "", sections: [],
        flashcards: cards("Different", 2), sourceNotes: "", model: "synthetic",
      }));
    });
    expect(await screen.findByText("Earlier version of these cards")).toBeTruthy();
  });
  it("[C2SRC-R2] an inspection opened during version checking reconciles with its completed result", async () => {
    await material("a", "First", cards("A", 2));
    await material("b", "Second", cards("B", 2));
    await rate("a", 0, "good", at(T0, -2 * DAY));
    await rate("b", 0, "good", at(T0, -DAY));
    const real = db.readLibraryRecentReviews!.bind(db);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(db, "readLibraryRecentReviews").mockImplementation(async (input) => {
      if (input.enrichmentOnly) { await held; return real(input); }
      return real({ ...input, maxBatchCardsBudget: 501 });
    });
    renderApp("/study?tab=history");
    await screen.findByText("Not checked against the current cards yet");
    // Both clicks target visible, enabled controls before the modal opens.
    fireEvent.click(screen.getByRole("button", { name: "Check versions" }));
    fireEvent.click(screen.getByRole("button", { name: "View card: A question 0" }));
    const dialog = await screen.findByRole("dialog", { name: "Card as you reviewed it" });
    expect(within(dialog).getByText("Not checked against the current cards yet")).toBeTruthy();
    await act(async () => { release(); });
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Card ratings", hidden: true })).queryByText("Not checked against the current cards yet")).toBeNull());
    // Closing the stale inspection or reconciling its event by ID is acceptable.
    const live = screen.queryByRole("dialog", { name: "Card as you reviewed it" });
    if (live) expect(within(live).queryByText("Not checked against the current cards yet")).toBeNull();
  });
});
