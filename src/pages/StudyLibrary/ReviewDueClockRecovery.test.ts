// @vitest-environment jsdom
/**
 * Review due follows the computer's local day after a time-zone change. The
 * real Study Library, router, AppDataProvider and a disposable node:sqlite
 * database with a saved day-ladder card; injected clock and zone; focus and
 * visibility are ordinary browser events. No provider or network.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { CardItemAction, CardRating, LibraryReviewDueInput } from "@/domain/types";
import * as localDay from "@/logic/localDay";
import * as documentService from "@/services/documents";
import * as geminiService from "@/services/gemini";
import { AppDataProvider } from "@/state/AppDataContext";

import { StudyLibrary } from "./StudyLibrary";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const T0 = "2026-10-06T15:00:00.000Z"; // 10:00 in Chicago, 05:00 on 7 October in Kiritimati
const CHICAGO = "America/Chicago";
const KIRITIMATI = "Pacific/Kiritimati";
const CHICAGO_END = "2026-10-07T05:00:00.000Z";
const KIRITIMATI_END = "2026-10-07T10:00:00.000Z";
// "Good" on a new card seven hours before T0: due 2026-10-07T08:00Z, after
// Chicago's day ends and before Kiritimati's.
const RATED_AT = at(T0, -7 * HOUR);
const cards = (label: string, n: number) => Array.from({ length: n }, (_, i) => ({ front: `${label} question ${i}`, back: `${label} answer ${i}`, sourcePage: null }));

let zone: string;
let visibility: DocumentVisibilityState;
let unhandled: unknown[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
let fetchSpy: ReturnType<typeof vi.fn>;
let dueInputs: LibraryReviewDueInput[];

async function material(id: string, title: string, n: number) {
  await createRepositories(db).documents.create({ id, title, topic: "weather" as never, priority: "later" as never });
  await db.execute("UPDATE study_materials SET updated_at = ? WHERE id = ?", [T0, id]);
  await db.execute(
    `INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
     VALUES (?, 'Synthetic guide', 'A synthetic summary.', '[]', ?, '', 'import', '', ?, ?)`,
    [id, JSON.stringify(cards(title, n)), T0, T0],
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

/** One day-ladder card that is due only in Kiritimati at T0, and one far-off card. */
async function savedLibrary() {
  await material("weather", "Weather basics", 1);
  await rate("weather", 0, "good", RATED_AT);
  await material("airspace", "Airspace", 1);
  await rate("airspace", 0, "easy", RATED_AT); // due in three days in every zone
}

/** Every stored review instant, state and event, for before/after comparison. */
const storedReviews = async () => ({
  states: await db.select("SELECT * FROM card_review_state ORDER BY item_id"),
  events: await db.select("SELECT * FROM card_review_events ORDER BY rowid"),
  materials: await db.select("SELECT id, updated_at FROM study_materials ORDER BY id"),
});

/** The Review due tab's own reads (the binder stream uses a different limit). */
function recordDueReads(hold?: (input: LibraryReviewDueInput) => Promise<void> | undefined) {
  const real = db.readLibraryReviewDue!.bind(db);
  vi.spyOn(db, "readLibraryReviewDue").mockImplementation(async (input) => {
    if (input.limit === 50) dueInputs.push(structuredClone(input));
    const waiting = hold?.(input);
    if (waiting) await waiting;
    return real(input);
  });
}

function renderDue() {
  return render(
    h(
      AppDataProvider,
      null,
      h(MemoryRouter, { initialEntries: ["/study?tab=due"] }, h(Routes, null, h(Route, { path: "/study", element: h(StudyLibrary) }))),
    ),
  );
}

const dueList = () => screen.findByRole("list", { name: "Materials with cards to review" });
const titles = (list: HTMLElement) => within(list).getAllByRole("listitem").map((li) => li.querySelector(".strong")?.textContent);
const focusWindow = () => act(async () => void fireEvent.focus(window));
const setVisibility = (next: DocumentVisibilityState) =>
  act(async () => {
    visibility = next;
    fireEvent(document, new Event("visibilitychange"));
  });

beforeEach(async () => {
  unhandled = [];
  dueInputs = [];
  zone = CHICAGO;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  process.on("unhandledRejection", onUnhandled);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  vi.spyOn(localDay, "currentTimeZone").mockImplementation(() => zone);
  fetchSpy = vi.fn(() => Promise.reject(new Error("network is not allowed in this test")));
  vi.stubGlobal("fetch", fetchSpy);
  localStorage.clear();
  sessionStorage.clear(); // remembered Review due filters
  db = await createNodeSqliteDatabase();
  await createRepositories(db).app.set("airline_starter_pack", "skipped-for-test");
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: false, model: "", choice: "standard" });
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(geminiService, "generateStudyAid").mockRejectedValue(new Error("Gemini must not be called"));
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(false);
});

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(geminiService.generateStudyAid).not.toHaveBeenCalled();
  process.off("unhandledRejection", onUnhandled);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (document as { visibilityState?: unknown }).visibilityState;
  db.close();
  expect(unhandled).toEqual([]);
  expect(fetchSpy).not.toHaveBeenCalled();
});

describe("Review due after a time-zone change", () => {
  it("moving east makes the saved card due on focus, and All caught up disappears", async () => {
    await savedLibrary();
    recordDueReads();
    const stored = await storedReviews();
    renderDue();
    expect(await screen.findByText("All caught up!")).toBeTruthy();
    expect(screen.getByText(/Last check looked at 2 materials and 2 cards; every material/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Materials with cards to review" })).toBeNull();
    expect(dueInputs).toHaveLength(1);
    expect(dueInputs[0]).toMatchObject({ nowUtc: T0, nextLocalMidnightUtc: CHICAGO_END });

    fireEvent.click(screen.getByRole("button", { name: "Due today" }));
    expect(await screen.findByText("All caught up!")).toBeTruthy();
    expect(dueInputs).toHaveLength(2);

    vi.setSystemTime(new Date(at(T0, 60_000)));
    zone = KIRITIMATI;
    await focusWindow();
    const list = await dueList();
    expect(titles(list)).toEqual(["Weather basics"]);
    expect(within(list).getByText("1 card due today")).toBeTruthy();
    expect(screen.queryByText("All caught up!")).toBeNull();
    expect(screen.getByText(/Last check looked at 2 materials and 2 cards; every material/)).toBeTruthy();
    expect(dueInputs).toHaveLength(3);
    expect(dueInputs[2]).toMatchObject({
      nowUtc: at(T0, 60_000),
      nextLocalMidnightUtc: KIRITIMATI_END,
      statusFilter: "due_today",
      topic: null,
      cursor: null,
    });
    expect(await storedReviews()).toEqual(stored);
  });

  it("moving west returns the card to later on becoming visible, and All caught up comes back", async () => {
    zone = KIRITIMATI;
    await savedLibrary();
    recordDueReads();
    const stored = await storedReviews();
    renderDue();
    expect(titles(await dueList())).toEqual(["Weather basics"]);
    expect(screen.queryByText("All caught up!")).toBeNull();

    zone = CHICAGO;
    await setVisibility("hidden");
    expect(dueInputs).toHaveLength(1); // hiding alone reads nothing
    await setVisibility("visible");
    expect(await screen.findByText("All caught up!")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Materials with cards to review" })).toBeNull();
    expect(dueInputs).toHaveLength(2);
    expect(dueInputs[1]).toMatchObject({ nextLocalMidnightUtc: CHICAGO_END, statusFilter: "all", cursor: null });
    expect(await storedReviews()).toEqual(stored);
  });

  it("focus and visibility with the same local day keep the list and read nothing", async () => {
    zone = KIRITIMATI;
    await savedLibrary();
    recordDueReads();
    renderDue();
    const list = await dueList();
    vi.setSystemTime(new Date(at(T0, 2 * HOUR)));
    await focusWindow();
    await setVisibility("visible");
    await focusWindow();
    expect(dueInputs).toHaveLength(1);
    expect(screen.getByRole("list", { name: "Materials with cards to review" })).toBe(list);
    expect(titles(list)).toEqual(["Weather basics"]);
  });

  it("a read held from the old zone cannot bring its result back after recovery", async () => {
    zone = KIRITIMATI;
    await savedLibrary();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let holdNext = true;
    recordDueReads((input) => {
      if (input.limit !== 50 || !holdNext) return undefined;
      holdNext = false;
      return held;
    });
    renderDue();
    expect(await screen.findByText("Checking your flashcards…")).toBeTruthy();
    zone = CHICAGO;
    await focusWindow();
    expect(await screen.findByText("All caught up!")).toBeTruthy();
    await act(async () => release());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("list", { name: "Materials with cards to review" })).toBeNull();
    expect(screen.getByText("All caught up!")).toBeTruthy();
    expect(dueInputs.map((input) => input.nextLocalMidnightUtc)).toEqual([KIRITIMATI_END, CHICAGO_END]);
  });

  it("after leaving the tab, focus in a new zone reads nothing for it", async () => {
    await savedLibrary();
    recordDueReads();
    renderDue();
    expect(await screen.findByText("All caught up!")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByRole("heading", { name: "Card review history" })).toBeTruthy();
    zone = KIRITIMATI;
    vi.setSystemTime(new Date(at(T0, DAY)));
    await focusWindow();
    await setVisibility("visible");
    expect(dueInputs).toHaveLength(1);
  });
});
