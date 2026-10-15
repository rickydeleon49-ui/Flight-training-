// @vitest-environment jsdom
/**
 * A saved Again card becomes reviewable while its material stays open. The
 * real CardReviewPanel over the real card review repository and atomic
 * writer on a disposable node:sqlite database; fake `Date` and timers, a
 * fixed IANA zone; focus and visibility are ordinary browser events. No
 * navigation, input or data publication moves the clock. No real profile,
 * provider or network.
 */
import { createElement as h, StrictMode } from "react";
import { setTimeout as realDelay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlValue } from "@/data/db";
import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { CardItemAction, CardRating, CardReviewAction } from "@/domain/types";
import * as localDay from "@/logic/localDay";

import { CardReviewPanel } from "./CardReviewPanel";

let db: TestDatabase;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const T0 = "2026-10-06T15:00:00.000Z"; // 10:00 in Chicago
const ZONE = "America/Chicago";
const DUE = at(T0, 10 * MINUTE); // "Again" at T0
const cards = (label: string) =>
  [1, 2, 3].map((n) => ({ front: `${label} card ${n}: which letter follows ${n}?`, back: `${label} answer ${n}`, sourcePage: null }));

let visibility: DocumentVisibilityState;
let unhandled: unknown[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
let fetchSpy: ReturnType<typeof vi.fn>;
let selects: string[];
let writes: CardReviewAction[];
/** The next write is sent but its outcome is lost, as if the connection dropped. */
let failNextWrite: boolean;

async function material(id: string, label = "Synthetic") {
  await createRepositories(db).documents.create({ id, title: `${label} letters` });
  await db.execute(
    `INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
     VALUES (?, 'Synthetic guide', 'A synthetic summary.', '[]', ?, '', 'import', '', ?, ?)`,
    [id, JSON.stringify(cards(label)), T0, T0],
  );
}

/** One item action through the production writer at `when`. */
async function act_(id: string, ordinal: number, when: string, kind: { action: "rate"; rating: CardRating } | { action: "suspend" } | { action: "flag"; reason: "unclear" }) {
  vi.setSystemTime(new Date(when));
  const reviews = createRepositories(db).cardReviews;
  const snap = await reviews.getCardReviewSnapshot(id);
  if (snap.current.status !== "ok") throw new Error("no cards");
  const item = snap.current.items[ordinal]!;
  await reviews.saveAction({
    operationId: crypto.randomUUID(),
    materialId: id,
    versionContentHash: snap.current.contentHash,
    itemId: item.itemId,
    expectedGeneration: snap.generation,
    expectedRevision: snap.states[item.itemId]?.revision ?? 0,
    ...kind,
  } as CardItemAction);
}
const rate = (id: string, ordinal: number, rating: CardRating, when = T0) => act_(id, ordinal, when, { action: "rate", rating });

/** Card 1 Again at T0 (due at T0 + 10 min); cards 2 and 3 Good (due tomorrow). Nothing is new. */
async function savedAgainMaterial(id = "m1") {
  await material(id);
  await rate(id, 0, "again");
  await rate(id, 1, "good");
  await rate(id, 2, "good");
}

const stored = async () => ({
  states: await db.select("SELECT * FROM card_review_state ORDER BY item_id"),
  events: await db.select("SELECT * FROM card_review_events ORDER BY rowid"),
  receipts: await db.select("SELECT * FROM card_review_operations ORDER BY rowid"),
});

/** Count every read and write the panel makes from now on. */
function observe() {
  selects = [];
  writes = [];
  const realSelect = db.select.bind(db);
  vi.spyOn(db, "select").mockImplementation((async (sql: string, params: SqlValue[] = []) => {
    selects.push(sql);
    return realSelect(sql, params);
  }) as typeof db.select);
  const realSave = db.saveCardReviewAtomically!.bind(db);
  return vi.spyOn(db, "saveCardReviewAtomically").mockImplementation(((action: CardReviewAction) => {
    writes.push(structuredClone(action));
    if (failNextWrite) {
      failNextWrite = false;
      return Promise.reject(new Error("connection lost"));
    }
    return realSave(action);
  }) as typeof realSave);
}

function panel(materialId = "m1", strict = false) {
  const element = h(CardReviewPanel, { materialId, materialTitle: "Synthetic letters", repository: createRepositories(db).cardReviews });
  return strict ? h(StrictMode, null, element) : element;
}

/** Wait for observable completion of real crypto/SQLite work, without moving the review clock. */
async function settle(check: () => void = () => {
  expect(screen.queryByText("Loading card reviews…")).toBeNull();
  expect(screen.getByRole("heading", { level: 3 })).toBeTruthy();
}) {
  const deadline = performance.now() + 2_000;
  for (;;) {
    // Fake review timers cannot complete crypto.subtle's real worker work.
    // Yield the real event loop; success is an asserted UI state, never a tick count.
    await act(async () => { await realDelay(1); });
    try { check(); return; }
    catch (error) { if (performance.now() >= deadline) throw error; }
  }
}
const sessionReady = (position: string) => () => {
  expect(screen.getByText(new RegExp(`^Card ${position}(?: · new)?$`))).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show answer" }).hasAttribute("disabled")).toBe(false);
};
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const heading = () => screen.getByRole("heading", { level: 3 }).textContent;
const reviewDisabled = () => screen.getByRole("button", { name: "Review cards" }).hasAttribute("disabled");
const focusWindow = () => act(async () => void fireEvent.focus(window));
const setVisibility = (next: DocumentVisibilityState) =>
  act(async () => {
    visibility = next;
    fireEvent(document, new Event("visibilitychange"));
  });

beforeEach(async () => {
  unhandled = [];
  failNextWrite = false;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  process.on("unhandledRejection", onUnhandled);
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(T0));
  vi.spyOn(localDay, "currentTimeZone").mockReturnValue(ZONE);
  fetchSpy = vi.fn(() => Promise.reject(new Error("network is not allowed in this test")));
  vi.stubGlobal("fetch", fetchSpy);
  db = await createNodeSqliteDatabase();
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.off("unhandledRejection", onUnhandled);
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (document as { visibilityState?: unknown }).visibilityState;
  db.close();
  expect(unhandled).toEqual([]);
});

describe("relearning readiness while a material stays open", () => {
  it("waits for delayed real digest completion without advancing the review clock", async () => {
    await savedAgainMaterial();
    const now = at(T0, MINUTE);
    vi.setSystemTime(new Date(now));
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (...args) => {
      await realDelay(25);
      return digest(...args);
    });
    render(panel());
    await settle();
    expect(heading()).toBe("All caught up. Next review: in 9 minutes.");
    expect(new Date().toISOString()).toBe(now);
    await advance(9 * MINUTE);
    fireEvent.click(screen.getByRole("button", { name: "Review cards" }));
    await settle(sessionReady("1 of 1"));
    expect(new Date().toISOString()).toBe(DUE);
  });

  it("reaching the saved Again instant enables Review cards, and starting selects the now-due card", async () => {
    await savedAgainMaterial();
    vi.setSystemTime(new Date(at(T0, MINUTE)));
    const before = await stored();
    observe();
    render(panel());
    await settle();
    expect(heading()).toBe("All caught up. Next review: in 9 minutes.");
    expect(reviewDisabled()).toBe(true);
    const initialReads = selects.length;

    await advance(9 * MINUTE - 1); // one millisecond before the instant: no countdown renders
    expect(heading()).toBe("All caught up. Next review: in 9 minutes.");
    expect(reviewDisabled()).toBe(true);

    await advance(1); // the instant itself
    expect(new Date().toISOString()).toBe(DUE);
    expect(heading()).toBe("1 card due");
    expect(reviewDisabled()).toBe(false);
    expect(selects).toHaveLength(initialReads); // the clock read nothing
    expect(writes).toEqual([]);
    expect(screen.queryByRole("button", { name: "Show answer" })).toBeNull(); // never started by itself
    expect(await stored()).toEqual(before);

    const beforeStart = selects.length;
    fireEvent.click(screen.getByRole("button", { name: "Review cards" }));
    await settle(sessionReady("1 of 1"));
    expect(selects.length).toBeGreaterThan(beforeStart); // the deliberate start reads fresh
    expect(screen.getByText(/^Card 1 of 1$/)).toBeTruthy();
    expect(screen.getByText("Synthetic card 1: which letter follows 1?", { selector: ".flashcard span" })).toBeTruthy();
    expect(await stored()).toEqual(before);
  });

  it("a delayed timer is reconciled on return to a visible window", async () => {
    await savedAgainMaterial();
    vi.setSystemTime(new Date(at(T0, MINUTE)));
    const before = await stored();
    observe();
    render(panel());
    await settle();
    expect(reviewDisabled()).toBe(true);
    const reads = selects.length;

    vi.setSystemTime(new Date(at(T0, 30 * MINUTE))); // slept: the clock moved, the timer did not fire
    await setVisibility("hidden");
    expect(reviewDisabled()).toBe(true); // hiding alone changes nothing
    await setVisibility("visible");
    expect(heading()).toBe("1 card due");
    expect(reviewDisabled()).toBe(false);
    expect(selects).toHaveLength(reads);
    expect(writes).toEqual([]);
    expect(await stored()).toEqual(before);
  });

  it("focus follows the clock forward and back, and the timer is re-armed after it moved back", async () => {
    await savedAgainMaterial();
    vi.setSystemTime(new Date(at(T0, MINUTE)));
    observe();
    render(panel());
    await settle();
    const reads = selects.length;

    vi.setSystemTime(new Date(at(T0, 12 * MINUTE)));
    await focusWindow();
    expect(heading()).toBe("1 card due");
    expect(reviewDisabled()).toBe(false);

    vi.setSystemTime(new Date(at(T0, 2 * MINUTE))); // the clock was corrected backwards
    await focusWindow();
    expect(heading()).toBe("All caught up. Next review: in 8 minutes.");
    expect(reviewDisabled()).toBe(true);
    for (let i = 0; i < 4; i += 1) await focusWindow(); // repeated events add no timers
    await advance(8 * MINUTE - 1);
    expect(reviewDisabled()).toBe(true);
    await advance(1);
    expect(heading()).toBe("1 card due");
    expect(reviewDisabled()).toBe(false);
    expect(selects).toHaveLength(reads);
  });

  it("successive Again instants each update the summary, with nothing in between", async () => {
    await material("m1");
    await rate("m1", 0, "again"); // due T0 + 10 min
    await rate("m1", 1, "again", at(T0, 3 * MINUTE)); // due T0 + 13 min
    await rate("m1", 2, "good", at(T0, 3 * MINUTE));
    vi.setSystemTime(new Date(at(T0, 4 * MINUTE)));
    const before = await stored();
    observe();
    render(panel());
    await settle();
    const reads = selects.length;
    expect(heading()).toBe("All caught up. Next review: in 6 minutes.");
    await advance(6 * MINUTE);
    expect(heading()).toBe("1 card due");
    await advance(3 * MINUTE - 1);
    expect(heading()).toBe("1 card due");
    await advance(1);
    expect(heading()).toBe("2 cards due");
    expect(selects).toHaveLength(reads);
    expect(await stored()).toEqual(before);
  });

  it("paused and flagged Again cards stay out when their instant passes", async () => {
    await material("m1");
    await rate("m1", 0, "again");
    await act_("m1", 0, at(T0, 1_000), { action: "suspend" });
    await rate("m1", 1, "again");
    await act_("m1", 1, at(T0, 1_000), { action: "flag", reason: "unclear" });
    await rate("m1", 2, "good");
    vi.setSystemTime(new Date(at(T0, MINUTE)));
    const before = await stored();
    observe();
    render(panel());
    await settle();
    const reads = selects.length;
    const caughtUp = heading();
    expect(caughtUp).toMatch(/^All caught up\. Next review: /);
    expect(reviewDisabled()).toBe(true);
    await advance(30 * MINUTE);
    await focusWindow();
    expect(heading()).toBe(caughtUp);
    expect(reviewDisabled()).toBe(true);
    expect(selects).toHaveLength(reads);
    expect(await stored()).toEqual(before);
  });

  it("an open session, revealed answer and unconfirmed rating survive the instant; Try again resends the same rating", async () => {
    await material("m1");
    observe();
    render(panel());
    await settle();
    expect(heading()).toBe("3 new cards · none due");
    fireEvent.click(screen.getByRole("button", { name: "Review cards" }));
    await settle(sessionReady("1 of 3"));
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: /^Again: again in 10 minutes/ }));
    await settle(sessionReady("2 of 3"));
    expect(screen.getByText(/^Card 2 of 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    failNextWrite = true;
    fireEvent.click(screen.getByRole("button", { name: /^Good: again in/ }));
    await settle(() => { expect(screen.getByText(/We couldn't confirm that rating/)).toBeTruthy(); });
    expect(screen.getByText(/We couldn't confirm that rating/)).toBeTruthy();
    const unconfirmed = writes.at(-1)!;
    const writeCount = writes.length;
    const before = await stored();
    const reads = selects.length; // after the test's own reads of stored rows
    expect(screen.getAllByRole("listitem")).toHaveLength(1); // one recent review
    expect(heading()).toBe("2 new cards · none due"); // card 2's rating is not confirmed

    await advance(10 * MINUTE);
    await focusWindow();
    await setVisibility("visible");
    expect(heading()).toBe("2 new cards · 1 card due");
    expect(screen.getByText(/^Card 2 of 3/)).toBeTruthy(); // same membership and position
    expect(screen.getByText("Synthetic answer 2")).toBeTruthy(); // still revealed
    expect(screen.getByText(/We couldn't confirm that rating/)).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(writes).toHaveLength(writeCount);
    expect(selects).toHaveLength(reads);
    expect(await stored()).toEqual(before);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle(sessionReady("3 of 3"));
    expect(writes.at(-1)!.operationId).toBe(unconfirmed.operationId);
    expect(screen.getByText(/^Card 3 of 3/)).toBeTruthy();
  });

  it("switching material and unmounting leave no wakeup behind", async () => {
    await savedAgainMaterial("m1");
    await material("m2", "Second");
    await rate("m2", 0, "good");
    await rate("m2", 1, "good");
    await rate("m2", 2, "good");
    vi.setSystemTime(new Date(at(T0, MINUTE)));
    observe();
    const view = render(panel("m1"));
    await settle();
    expect(reviewDisabled()).toBe(true);
    view.rerender(panel("m2"));
    await settle();
    const second = heading();
    expect(second).toMatch(/^All caught up\. Next review: /);
    const reads = selects.length;
    await advance(30 * MINUTE);
    expect(heading()).toBe(second);
    expect(reviewDisabled()).toBe(true);
    expect(selects).toHaveLength(reads);
    view.unmount();
    await advance(DAY);
    expect(selects).toHaveLength(reads);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("works the same under StrictMode", async () => {
    await savedAgainMaterial();
    vi.setSystemTime(new Date(at(T0, MINUTE)));
    observe();
    render(panel("m1", true));
    await settle();
    expect(reviewDisabled()).toBe(true);
    await advance(9 * MINUTE);
    expect(heading()).toBe("1 card due");
    expect(reviewDisabled()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(writes).toEqual([]);
  });
});
