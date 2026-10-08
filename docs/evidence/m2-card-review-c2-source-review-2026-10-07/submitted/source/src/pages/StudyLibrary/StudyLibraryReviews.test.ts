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

describe("Study Library review tabs", () => {
  it("tabs follow the address, Back returns, and practice history keeps its own page", async () => {
    await material("m1", "Weather basics", cards("Weather", 2));
    renderApp("/study");
    expect(await screen.findByRole("tab", { name: "Library", selected: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Review due" }));
    expect(location.search).toBe("?tab=due");
    expect(await screen.findByRole("heading", { name: "Review due" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(location.search).toBe("?tab=history");
    expect(await screen.findByRole("heading", { name: "Card review history" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Practice test history" }).getAttribute("href")).toBe("/study/history");
    act(() => navigate(-1));
    expect(await screen.findByRole("tab", { name: "Review due", selected: true })).toBeTruthy();
    act(() => navigate("/study?tab=bogus"));
    expect(await screen.findByRole("tab", { name: "Library", selected: true })).toBeTruthy();
    act(() => navigate("/study/history"));
    expect((await screen.findAllByRole("heading", { name: /practice/i })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Card review history" })).toBeNull();
  });

  it("Review due ranks discovered materials and opens a focused C1 session for the chosen one", async () => {
    await material("fresh", "Never reviewed", cards("Fresh", 3), { updatedAt: at(T0, -DAY) });
    await material("urgent", "Again today", cards("Urgent", 2), { updatedAt: at(T0, -2 * DAY) });
    await rate("urgent", 0, "again", at(T0, -20 * 60_000));
    renderApp("/study?tab=due");
    const list = await dueList();
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector(".strong")?.textContent)).toEqual(["Again today", "Never reviewed"]);
    expect(within(items[0]!).getByText("1 card to try again · 1 new card")).toBeTruthy();
    expect(within(items[1]!).getByText("3 new cards")).toBeTruthy();
    expect(screen.getByText(/They aren't practice test scores or a measure of exam readiness\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review cards for Never reviewed" }));
    const session = await screen.findByLabelText(/^Card review session/);
    expect(within(session).getByText(/^Card 1 of 3 · new/)).toBeTruthy();
    expect(location.pathname).toBe("/study/fresh");
    expect(location.state).toBeNull(); // the start request is consumed once
    expect(geminiService.generateStudyAid).not.toHaveBeenCalled();
  });

  it("blocked oversize content is shown with its Study link and never claims caught up; a clear library is caught up", async () => {
    await material("big/set", "Huge set", cards("Huge", 1));
    await db.execute(
      `UPDATE ai_study_sets SET flashcards_json = '[{"front":"' || hex(zeroblob(4200000)) || '","back":"B","sourcePage":null}]' WHERE source_material_id = 'big/set'`,
    );
    const view = renderApp("/study?tab=due");
    expect((await screen.findByRole("link", { name: "Open Huge set" })).getAttribute("href")).toBe("/study/big%2Fset");
    expect(screen.queryByText("All caught up!")).toBeNull();
    view.unmount();
    await db.execute("DELETE FROM study_materials WHERE id = 'big/set'");
    await material("done", "Reviewed", cards("Done", 1));
    await rate("done", 0, "easy", T0);
    renderApp("/study?tab=due");
    expect(await screen.findByText("All caught up!")).toBeTruthy();
  }, 60_000);

  it("a failed read shows Retry, which repeats exactly the same read-only request", async () => {
    await material("m1", "Weather basics", cards("Weather", 2));
    const real = db.readLibraryReviewDue!.bind(db);
    const inputs: LibraryReviewDueInput[] = [];
    let fail = true;
    vi.spyOn(db, "readLibraryReviewDue").mockImplementation(async (input) => {
      inputs.push(structuredClone(input));
      if (fail) {
        fail = false;
        throw new Error("synthetic read failure SQLITE_IOERR /private");
      }
      return real(input);
    });
    const writes = vi.spyOn(db, "saveCardReviewAtomically");
    renderApp("/study?tab=due");
    expect(await screen.findByText(/Card reviews couldn’t be read just now/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/SQLITE|\/private/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await dueList();
    // Library binder stream reads too; compare the due tab's own two calls.
    const dueCalls = inputs.filter((i) => i.limit === 50);
    expect(dueCalls).toHaveLength(2);
    expect(dueCalls[1]).toEqual(dueCalls[0]);
    expect(writes).not.toHaveBeenCalled();
  });

  it("StrictMode mounts settle into one list; leaving the tab makes a held read obsolete", async () => {
    await material("m1", "Weather basics", cards("Weather", 2));
    await material("m2", "Airspace", cards("Air", 1));
    const strict = renderApp("/study?tab=due", true);
    const list = await dueList();
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    strict.unmount();

    const real = db.readLibraryReviewDue!.bind(db);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(db, "readLibraryReviewDue").mockImplementation(async (input) => {
      await held;
      return real(input);
    });
    renderApp("/study?tab=due");
    expect(await screen.findByText("Checking your flashcards…")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    await act(async () => release());
    expect(screen.queryByRole("list", { name: "Materials with cards to review" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Review due" }));
    expect(within(await dueList()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("regenerated content invalidates the loaded list and reads it again", async () => {
    await material("m1", "Weather basics", cards("Weather", 2));
    await rate("m1", 0, "good", at(T0, -2 * DAY));
    renderApp("/study?tab=due");
    expect(await screen.findByText("1 card due today · 1 new card")).toBeTruthy();
    vi.setSystemTime(new Date(at(T0, 60_000)));
    await act(async () => {
      await appMutate((repos) =>
        repos.documents.saveAiStudySet({ sourceMaterialId: "m1", title: "Regenerated", summary: "", sections: [], flashcards: cards("Regen", 4), sourceNotes: "", model: "synthetic" }),
      );
    });
    expect(await screen.findByText("4 new cards")).toBeTruthy();
  });
});

describe("Card review history and binder indicators", () => {
  it("lists ratings with earlier-version provenance and a read-only historical card view", async () => {
    await material("m1", "Weather basics", cards("Old", 2));
    await rate("m1", 0, "good", at(T0, -DAY));
    await db.execute("UPDATE ai_study_sets SET flashcards_json = ? WHERE source_material_id = 'm1'", [JSON.stringify(cards("New", 2))]);
    await rate("m1", 1, "again", at(T0, -60_000));
    const writes = vi.spyOn(db, "saveCardReviewAtomically");
    renderApp("/study?tab=history");
    const list = await screen.findByRole("list", { name: "Card ratings" });
    // From here on (history shown, the app's own startup done) nothing may write.
    const executes = vi.spyOn(db, "execute");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Again")).toBeTruthy();
    expect(within(rows[0]!).queryByText("Earlier version of these cards")).toBeNull();
    expect(within(rows[1]!).getByText("Earlier version of these cards")).toBeTruthy();
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "View card: Old question 0" }));
    const dialog = await screen.findByRole("dialog", { name: "Card as you reviewed it" });
    expect(within(dialog).getByText("Old answer 0")).toBeTruthy();
    expect(within(dialog).getByText(/This is a read-only record/)).toBeTruthy();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(writes).not.toHaveBeenCalled();
    expect(executes).not.toHaveBeenCalled();
  });

  it("pending provenance stays unknown until Check versions resolves it, after pagination has ended", async () => {
    await material("a", "First", cards("A", 2));
    await material("b", "Second", cards("B", 2));
    await rate("a", 0, "good", at(T0, -2 * DAY));
    await rate("b", 0, "good", at(T0, -DAY));
    const real = db.readLibraryRecentReviews!.bind(db);
    const inputs: LibraryRecentReviewsInput[] = [];
    vi.spyOn(db, "readLibraryRecentReviews").mockImplementation((input) => {
      inputs.push(input);
      // A tight shared budget on page reads leaves the older material pending.
      return real(input.enrichmentOnly ? input : { ...input, maxBatchCardsBudget: 501 });
    });
    renderApp("/study?tab=history");
    expect(await screen.findByText("Not checked against the current cards yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check versions" }));
    await waitFor(() => expect(screen.queryByText("Not checked against the current cards yet")).toBeNull());
    const enrich = inputs.filter((i) => i.enrichmentOnly);
    expect(enrich).toEqual([expect.objectContaining({ enrichMaterialIds: ["a"], limit: 0 })]);
    expect(screen.getByText(/the last version check read 1 card set/)).toBeTruthy();
  });

  it("binder cards show due and new counts, and Caught up only once every material is checked", async () => {
    await material("due", "Has due", cards("Due", 2));
    await rate("due", 0, "good", at(T0, -2 * DAY));
    await material("new", "All new", cards("New", 3));
    await material("done", "All done", cards("Done", 1));
    await rate("done", 0, "easy", T0);
    renderApp("/study");
    expect(await screen.findByText("1 due · 1 new")).toBeTruthy();
    expect(screen.getByText("3 new")).toBeTruthy();
    expect(screen.getByText("Caught up")).toBeTruthy();
  });
});
