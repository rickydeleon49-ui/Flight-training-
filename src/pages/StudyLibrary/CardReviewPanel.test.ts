// @vitest-environment jsdom
/**
 * M2-3 C1: card reviews in the real MaterialDetail, inside AppDataProvider
 * over a disposable node:sqlite database with the real atomic transaction.
 * An injected clock (fake `Date` only) and a fixed IANA zone. No real
 * profile, provider, Gemini call or network.
 */
import { createElement as h, StrictMode } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlValue } from "@/data/db";
import { createRepositories } from "@/data/repositories";
import type { CardReviewRepository } from "@/data/repositories/cardReviewRepository";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { CardRecentReview, CardReviewAction, CardReviewSnapshot } from "@/domain/types";
import * as localDay from "@/logic/localDay";
import * as documentService from "@/services/documents";
import * as geminiService from "@/services/gemini";
import { AppDataProvider } from "@/state/AppDataContext";

import { MaterialDetail } from "./MaterialDetail";
import { CardReviewPanel } from "./CardReviewPanel";
import { acknowledgeInSession, createReviewSession, summarizeCards, useCardReview } from "./useCardReview";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

const M = "card-material";
const TITLE = "Synthetic airspace letters";
const T0 = "2026-10-06T15:00:00.000Z"; // 10:00 in Chicago
const ZONE = "America/Chicago";
const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const CARDS = [
  { front: "Synthetic card one: which letter follows A?", back: "B", sourcePage: 1 },
  { front: "Synthetic card two: which letter follows B?", back: "C", sourcePage: 2 },
  { front: "Synthetic card three: which letter follows C?", back: "D", sourcePage: null },
];

let unhandled: unknown[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
let fetchSpy: ReturnType<typeof vi.fn>;

async function seed(cards: unknown = CARDS) {
  const repos = createRepositories(db);
  await repos.documents.create({ id: M, title: TITLE });
  await db.execute(
    `INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
     VALUES (?, 'Synthetic guide', 'A synthetic summary.', '[]', ?, '', 'import', '', ?, ?)`,
    [M, typeof cards === "string" ? cards : JSON.stringify(cards), T0, T0],
  );
}

async function counts() {
  const [row] = await db.select<Record<string, number>>(
    `SELECT (SELECT COUNT(*) FROM card_review_events) AS events, (SELECT COUNT(*) FROM card_review_state) AS states,
            (SELECT COUNT(*) FROM card_review_operations) AS receipts, (SELECT COALESCE(MAX(generation), 0) FROM card_review_generations) AS generation,
            (SELECT COUNT(*) FROM practice_attempts) AS attempts`,
  );
  return { ...row };
}

function renderDetail(startCardReview = false) {
  return render(
    h(
      AppDataProvider,
      null,
      h(
        MemoryRouter,
        { initialEntries: [{ pathname: `/study/${M}`, state: startCardReview ? { startCardReview: true } : null }] },
        h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) })),
      ),
    ),
  );
}

const reviewHeading = () => screen.findByRole("heading", { level: 3, name: /new card|due|caught up|Nothing to review/ });
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const sessionRegion = () => within(screen.getByLabelText(/^Card review session/));

/** Wrap the real atomic write so a test can hold, fail or observe it. */
function interceptWrites(decide: (action: CardReviewAction, real: () => Promise<unknown>) => Promise<unknown>) {
  const real = db.saveCardReviewAtomically!.bind(db);
  const calls: CardReviewAction[] = [];
  const spy = vi.spyOn(db, "saveCardReviewAtomically").mockImplementation(((action: CardReviewAction) => {
    calls.push(structuredClone(action));
    return decide(action, () => real(action));
  }) as typeof real);
  return { calls, spy };
}

function interceptSelects(decide: (sql: string) => Promise<unknown> | undefined) {
  const real = db.select.bind(db);
  return vi.spyOn(db, "select").mockImplementation((async (sql: string, params: SqlValue[] = []) => {
    return decide(sql) ?? real(sql, params);
  }) as typeof db.select);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openSession() {
  await waitFor(() => expect(button("Review cards").hasAttribute("disabled")).toBe(false));
  fireEvent.click(button("Review cards"));
  return screen.findByRole("button", { name: "Show answer" });
}

async function revealAndRate(rating: "Again" | "Hard" | "Good" | "Easy") {
  fireEvent.click(await screen.findByRole("button", { name: "Show answer" }));
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${rating}: again in`) }));
}

beforeEach(async () => {
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  vi.spyOn(localDay, "currentTimeZone").mockReturnValue(ZONE);
  fetchSpy = vi.fn(() => Promise.reject(new Error("network is not allowed in this test")));
  vi.stubGlobal("fetch", fetchSpy);
  db = await createNodeSqliteDatabase();
  await createRepositories(db).app.set("airline_starter_pack", "skipped-for-test");
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: false, model: "", choice: "standard" });
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(geminiService, "generateStudyAid").mockRejectedValue(new Error("Gemini must not be called"));
  vi.spyOn(geminiService, "generatePracticeTest").mockRejectedValue(new Error("Gemini must not be called"));
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
});

describe("card reviews in MaterialDetail", () => {
  it.each([true, false])("scrolls to and focuses the first card only when opened from Review due (reduced motion %s)", async (reducedMotion) => {
    await seed();
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scroll });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reducedMotion })));

    const entryView = renderDetail(true);
    const showAnswer = await screen.findByRole("button", { name: "Show answer" });
    const session = screen.getByLabelText(/^Card review session/);
    const heading = within(session).getByRole("heading", { name: "Card 1 of 3 · new" });
    await waitFor(() => {
      expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
      expect(document.activeElement).toBe(heading);
    });
    expect(showAnswer).toBeTruthy();
    entryView.unmount();

    scroll.mockClear();
    const ordinaryView = renderDetail();
    await reviewHeading();
    await openSession();
    expect(scroll).not.toHaveBeenCalled();
    ordinaryView.unmount();
  });

  it.each([false, true])("STUDENT-1: rating after a long Explain this answer reveals the next heading (reduced motion %s)", async (reduced) => {
    await seed();
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scroll });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced })));
    vi.spyOn(geminiService, "watchAskGeminiProgress").mockResolvedValue(() => {});
    const answer = "A long synthetic card explanation. ".repeat(200);
    vi.spyOn(geminiService, "askGemini").mockResolvedValue({ answer, model: "gemini-3.5-flash", sourcePages: [] });
    renderDetail();
    await reviewHeading();
    await openSession();
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(button("Show answer"));
    fireEvent.click(button("Explain this"));
    fireEvent.change(screen.getByRole("textbox", { name: "Ask a question" }), { target: { value: "Explain?" } });
    fireEvent.click(button("Ask"));
    await screen.findByText(answer.trim());
    scroll.mockClear();
    fireEvent.click(button(/^Good: again in/));
    const heading = await screen.findByRole("heading", { name: "Card 2 of 3 · new" });
    expect(document.activeElement).toBe(heading);
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "start", behavior: reduced ? "auto" : "smooth" });
    expect(screen.queryByText(answer.trim())).toBeNull();
    fireEvent.keyDown(heading, { key: " " });
    expect(sessionRegion().getByText("C")).toBeTruthy();
  });

  it("updates the shortcut hint after reveal and restores it for the next card", async () => {
    await seed();
    renderDetail();
    await reviewHeading();
    await openSession();
    expect(sessionRegion().getByText("Space or Enter shows the answer.")).toBeTruthy();
    expect(button("Show answer").nextElementSibling).toBe(sessionRegion().getByText("Space or Enter shows the answer."));
    fireEvent.click(button("Show answer"));
    expect(sessionRegion().queryByText("Space or Enter shows the answer.")).toBeNull();
    expect(sessionRegion().getByText("1–4 rate it.")).toBeTruthy();
    expect(sessionRegion().getByRole("group", { name: "Rate this card" }).nextElementSibling).toBe(sessionRegion().getByText("1–4 rate it."));
    fireEvent.click(button(/^Good: again in/));
    await screen.findByText(/^Card 2 of 3 · new/);
    expect(sessionRegion().getByText("Space or Enter shows the answer.")).toBeTruthy();
    expect(sessionRegion().queryByText("1–4 rate it.")).toBeNull();
  });

  it("separates the dangerous reset action from the session controls and still confirms", async () => {
    await seed();
    renderDetail();
    await reviewHeading();
    await openSession();
    const reset = button("Reset card reviews");
    expect(reset.classList.contains("button--danger")).toBe(true);
    expect(reset.parentElement?.className).toBe("card-review__reset");
    expect(sessionRegion().queryByRole("button", { name: "Reset card reviews" })).toBeNull();
    fireEvent.click(reset);
    const dialog = await screen.findByRole("dialog", { name: `Reset card reviews for “${TITLE}”?` });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(sessionRegion().getByRole("button", { name: "Show answer" })).toBeTruthy();
  });

  it("full session with keyboard, then done-for-now; no Gemini, network or practice write", async () => {
    await seed();
    renderDetail();
    expect((await reviewHeading()).textContent).toBe("3 new cards · none due");
    expect(screen.getByText("Card 1 of 3")).toBeTruthy(); // the browse carousel stays
    await openSession();
    expect(sessionRegion().getByText(/^Card 1 of 3 · new/)).toBeTruthy();

    // Card 1: Again (mouse).
    fireEvent.click(button("Show answer"));
    expect(await screen.findByText("Your rating only decides when this card comes back. It isn't a score.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /^Again: again in 10 minutes/ }));
    expect(await screen.findByText("Saved: back in 10 minutes")).toBeTruthy();
    expect(await screen.findByText(/^Card 2 of 3/)).toBeTruthy();

    // Card 2: Space reveals, 3 rates Good.
    const session = screen.getByLabelText(/Card review session/);
    fireEvent.keyDown(session, { key: " " });
    expect(await screen.findByText("C")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Good: again in 1 day" })).toBeTruthy();
    fireEvent.keyDown(session, { key: "3" });
    expect(await screen.findByText("Saved: back tomorrow")).toBeTruthy();

    // Card 3: Enter reveals, 4 rates Easy.
    const third = await screen.findByLabelText(/Card 3 of 3/);
    fireEvent.keyDown(third, { key: "Enter" });
    await screen.findByText("D");
    fireEvent.keyDown(third, { key: "4" });
    expect(await screen.findByText("Done for now · 1 card back in 10 minutes · next review tomorrow")).toBeTruthy();

    expect(await counts()).toMatchObject({ events: 3, states: 3, receipts: 3, attempts: 0 });
    expect(geminiService.generateStudyAid).not.toHaveBeenCalled();
    expect(geminiService.generatePracticeTest).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(button("Close review"));
    expect((await reviewHeading()).textContent).toBe("All caught up. Next review: in 10 minutes.");
    expect(screen.getByRole("heading", { name: "Recent reviews" })).toBeTruthy();
  });

  it("the Again card returns at minute ten, and day cards return the next local day, due cards first", async () => {
    await seed();
    const view = renderDetail();
    await reviewHeading();
    await openSession();
    await revealAndRate("Again");
    await screen.findByText(/^Card 2 of 3/);
    await revealAndRate("Good");
    await screen.findByText(/^Card 3 of 3/);
    fireEvent.click(button("Done for now"));
    view.unmount();

    vi.setSystemTime(new Date(at(T0, 9 * MINUTE)));
    const nine = renderDetail();
    expect((await reviewHeading()).textContent).toBe("1 new card · none due");
    nine.unmount();

    vi.setSystemTime(new Date(at(T0, 10 * MINUTE)));
    const ten = renderDetail();
    expect((await reviewHeading()).textContent).toBe("1 new card · 1 card due");
    ten.unmount();

    // 09:00 the next morning in Chicago: the Good card is due too, before the new one.
    vi.setSystemTime(new Date("2026-10-07T14:00:00.000Z"));
    renderDetail();
    expect((await reviewHeading()).textContent).toBe("1 new card · 2 cards due");
    await openSession();
    expect(sessionRegion().getByText(/^Card 1 of 3$/)).toBeTruthy();
    expect(sessionRegion().getByText(CARDS[0]!.front)).toBeTruthy();
  });

  it("a second click while a rating is in flight sends nothing more", async () => {
    await seed();
    const hold = deferred<unknown>();
    const { calls } = interceptWrites((_action, real) => hold.promise.then(real));
    renderDetail();
    await reviewHeading();
    await openSession();
    fireEvent.click(button("Show answer"));
    const good = await screen.findByRole("button", { name: /^Good: again in/ });
    fireEvent.click(good);
    fireEvent.click(good);
    fireEvent.click(screen.getByRole("button", { name: /^Easy: again in/ }));
    expect(calls).toHaveLength(1);
    await act(async () => hold.resolve(undefined));
    await screen.findByText("Saved: back tomorrow");
    expect(calls).toHaveLength(1);
    expect(await counts()).toMatchObject({ events: 1 });
  });

  it("a lost acknowledgement offers Try again with the same request, counted once", async () => {
    await seed();
    let first = true;
    const { calls } = interceptWrites(async (_action, real) => {
      const result = await real();
      if (first) {
        first = false;
        throw new Error("synthetic lost acknowledgement /private/raw SQLITE_IOERR");
      }
      return result;
    });
    renderDetail();
    await reviewHeading();
    await openSession();
    await revealAndRate("Good");
    expect(await screen.findByText(/We couldn't confirm that rating\. Try again resends the same rating; it won't be counted twice\./)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/SQLITE|private\/raw|synthetic lost/);
    expect(sessionRegion().getByText(/^Card 1 of 3/)).toBeTruthy(); // not advanced on an unconfirmed result
    expect(screen.getByRole("button", { name: /^Easy: again in/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(button("Try again"));
    expect(await screen.findByText("Saved: back tomorrow")).toBeTruthy();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(await counts()).toMatchObject({ events: 1, receipts: 1 });
    expect(await screen.findByText(/^Card 2 of 3/)).toBeTruthy();
  });

  it("acknowledged, then refresh fails: the confirmation shows and conflicting actions stay locked until a read succeeds", async () => {
    await seed();
    renderDetail();
    await reviewHeading();
    await openSession();
    let failReads = false;
    interceptSelects((sql) => (failReads && sql.includes("SELECT generation FROM card_review_generations WHERE source_material_id") ? Promise.reject(new Error("synthetic read failure")) : undefined));
    interceptWrites(async (_action, real) => {
      const result = await real();
      failReads = true;
      return result;
    });
    await revealAndRate("Good");
    expect(await screen.findByText("Saved: back tomorrow")).toBeTruthy();
    expect(await screen.findByText(/rating and other changes are paused until they are/)).toBeTruthy();
    expect(sessionRegion().getByText(/^Card 1 of 3/)).toBeTruthy();
    for (const name of [/^Again: again in/, /^Good: again in/, /More options for card/, /^Reset card reviews$/]) {
      expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
    }
    expect(await counts()).toMatchObject({ events: 1 });
    failReads = false;
    fireEvent.click(button("Retry card reviews"));
    expect(await screen.findByText(/^Card 2 of 3/)).toBeTruthy();
    await waitFor(() => expect(button("Reset card reviews").hasAttribute("disabled")).toBe(false));
  });

  it("Reset: confirmation with Cancel focused, locked while pending, unknown outcome resolved by Try again", async () => {
    await seed();
    const hold = deferred<unknown>();
    let attempt = 0;
    const { calls } = interceptWrites(async (action, real) => {
      if (action.action !== "reset") return real();
      attempt += 1;
      if (attempt === 1) {
        await hold.promise;
        throw new Error("synthetic transport failure");
      }
      return real();
    });
    renderDetail();
    await reviewHeading();
    await openSession();
    await revealAndRate("Good");
    await screen.findByText("Saved: back tomorrow");
    fireEvent.click(button("Done for now"));
    await waitFor(() => expect(button("Reset card reviews").hasAttribute("disabled")).toBe(false));
    fireEvent.click(button("Reset card reviews"));

    const dialog = await screen.findByRole("dialog", { name: `Reset card reviews for “${TITLE}”?` });
    expect(
      within(dialog).getByText(
        "This removes the review schedule and rating history for this material’s cards. Your saved cards, study guide and practice tests stay. Backups you’ve already made are not changed.",
      ),
    ).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Reset reviews" }));
    expect(await within(dialog).findByRole("button", { name: "Resetting…" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Resetting…" }));
    expect(calls.filter((c) => c.action === "reset")).toHaveLength(1);

    await act(async () => hold.resolve(undefined));
    expect(await within(dialog).findByText(/We couldn’t confirm the reset\./)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect((await counts()).generation).toBe(0);

    // Check again only reads: no write, and absence is not taken as success.
    fireEvent.click(within(dialog).getByRole("button", { name: "Check again" }));
    expect(await within(dialog).findByText(/The reset isn't confirmed yet\./)).toBeTruthy();
    expect(calls.filter((c) => c.action === "reset")).toHaveLength(1);

    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/Card reviews for this material were reset\./)).toBeTruthy();
    const resets = calls.filter((c) => c.action === "reset");
    expect(resets).toHaveLength(2);
    expect(resets[1]).toEqual(resets[0]);
    expect(await counts()).toMatchObject({ generation: 1, events: 0, states: 0 });
    await waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "3 new cards · none due" })).toBeTruthy());
  });

  it("Reset: a committed reset whose acknowledgement was lost is confirmed by Check again, never sent twice", async () => {
    await seed();
    const { calls } = interceptWrites(async (action, real) => {
      const result = await real();
      if (action.action === "reset") throw new Error("synthetic lost acknowledgement");
      return result;
    });
    renderDetail();
    await reviewHeading();
    fireEvent.click(button("Reset card reviews"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset reviews" }));
    await within(dialog).findByText(/We couldn’t confirm the reset\./);
    fireEvent.click(within(dialog).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/Card reviews for this material were reset\./)).toBeTruthy();
    expect(calls.filter((c) => c.action === "reset")).toHaveLength(1);
    expect((await counts()).generation).toBe(1);
  });

  it("a rating prepared before a reset made elsewhere is refused as stale, with read-only Refresh", async () => {
    await seed();
    renderDetail();
    await reviewHeading();
    await openSession();
    fireEvent.click(button("Show answer"));
    await createRepositories(db).cardReviews.saveAction({ action: "reset", operationId: crypto.randomUUID(), materialId: M, expectedGeneration: 0 });
    fireEvent.click(await screen.findByRole("button", { name: /^Good: again in/ }));
    expect(await screen.findByText("These cards changed since you opened them.")).toBeTruthy();
    expect(await counts()).toMatchObject({ events: 0, generation: 1 });
    const writes = vi.spyOn(db, "saveCardReviewAtomically");
    fireEvent.click(button("Refresh"));
    expect((await reviewHeading()).textContent).toBe("3 new cards · none due");
    expect(writes).not.toHaveBeenCalled();
  });

  it("a never-rated card can be paused and flagged from the browse card, listed, and resumed", async () => {
    await seed();
    renderDetail();
    await reviewHeading();
    fireEvent.click(button(`More options for card: ${CARDS[0]!.front}`));
    fireEvent.click(button("Pause this card (not now)"));
    expect(await screen.findByText("Paused. It stays out of reviews until you resume it.")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Paused and flagged cards" })).toBeTruthy();
    expect((await reviewHeading()).textContent).toBe("2 new cards · none due");
    expect(await counts()).toMatchObject({ events: 0, states: 1 });
    fireEvent.click(await screen.findByRole("button", { name: `Resume card: ${CARDS[0]!.front}` }));
    await waitFor(async () => expect((await reviewHeading()).textContent).toBe("3 new cards · none due"));
  });

  it("all cards paused or flagged, damaged cards, no cards, and a read failure each show their own state", async () => {
    await seed();
    const repo = createRepositories(db).cardReviews;
    for (const [ordinal, kind] of [[0, "suspend"], [1, "flag"], [2, "suspend"]] as const) {
      const snapshot = await repo.getCardReviewSnapshot(M);
      if (snapshot.current.status !== "ok") throw new Error("expected cards");
      const item = snapshot.current.items[ordinal]!;
      await repo.saveAction({
        operationId: crypto.randomUUID(),
        materialId: M,
        versionContentHash: snapshot.current.contentHash,
        itemId: item.itemId,
        expectedGeneration: 0,
        expectedRevision: 0,
        ...(kind === "flag" ? { action: "flag" as const, reason: "unclear" as const } : { action: "suspend" as const }),
      });
    }
    const paused = renderDetail();
    expect((await reviewHeading()).textContent).toBe("Nothing to review — all cards are paused or flagged.");
    expect(button("Review cards").hasAttribute("disabled")).toBe(true);
    paused.unmount();

    await db.execute("UPDATE ai_study_sets SET flashcards_json = ? WHERE source_material_id = ?", [
      JSON.stringify([{ front: "   ", back: "B", sourcePage: null }]),
      M,
    ]);
    const damaged = renderDetail();
    expect(
      await screen.findByText(
        "These saved cards can't be reviewed because they're damaged. Your study guide is still here. Regenerating or re-importing creates a fresh set.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review cards" })).toBeNull();
    damaged.unmount();

    await db.execute("UPDATE ai_study_sets SET flashcards_json = '[]' WHERE source_material_id = ?", [M]);
    const none = renderDetail();
    await screen.findByRole("heading", { name: "Synthetic guide" });
    await waitFor(() => expect(screen.queryByText(/Card reviews|Loading card reviews/)).toBeNull());
    none.unmount();

    await db.execute("UPDATE ai_study_sets SET flashcards_json = ? WHERE source_material_id = ?", [JSON.stringify(CARDS), M]);
    let fail = true;
    interceptSelects((sql) => (fail && sql.includes("SELECT generation FROM card_review_generations WHERE source_material_id") ? Promise.reject(new Error("synthetic SQLITE_IOERR /private")) : undefined));
    renderDetail();
    expect(await screen.findByText("Card reviews couldn't be loaded just now. Your cards are still here to browse.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/SQLITE|\/private/);
    fail = false;
    fireEvent.click(button("Retry card reviews"));
    expect(await reviewHeading()).toBeTruthy();
  });

  it("the delete-material confirmation names the card review history", async () => {
    await seed();
    renderDetail();
    await reviewHeading();
    fireEvent.click(button("Delete"));
    expect(await screen.findByText(/This also removes its card review history\./)).toBeTruthy();
  });

  it("C1-R1 CardReviewPanel same-material contentKey lifecycle resets start state and remains reviewable", async () => {
    await seed();
    const repo = createRepositories(db).cardReviews;
    const realDueQueue = repo.getDueQueue.bind(repo);
    const queueHold = deferred<any>();
    let heldQueueCalled = false;
    vi.spyOn(repo, "getDueQueue").mockImplementation(async (input) => {
      if (!heldQueueCalled) {
        heldQueueCalled = true;
        return queueHold.promise;
      }
      return realDueQueue(input);
    });

    const { rerender } = render(
      h(CardReviewPanel, {
        materialId: M,
        materialTitle: TITLE,
        repository: repo,
        contentKey: "v1",
      }),
    );
    await reviewHeading();
    const reviewBtn = button("Review cards");
    expect(reviewBtn.hasAttribute("disabled")).toBe(false);

    // Click Review cards -> enters starting state and reaches held getDueQueue
    fireEvent.click(reviewBtn);
    await waitFor(() => expect(heldQueueCalled).toBe(true));
    expect(screen.getByRole("button", { name: "Opening…" }).hasAttribute("disabled")).toBe(true);

    // Rerender with contentKey="v2"
    rerender(
      h(CardReviewPanel, {
        materialId: M,
        materialTitle: TITLE,
        repository: repo,
        contentKey: "v2",
      }),
    );
    await reviewHeading();

    // Resolve old queue from v1
    await act(async () => queueHold.resolve([]));

    // Button is back to "Review cards" and enabled
    await waitFor(() => expect(screen.getByRole("button", { name: "Review cards" }).hasAttribute("disabled")).toBe(false));

    // Can start review session cleanly on v2
    fireEvent.click(screen.getByRole("button", { name: "Review cards" }));
    expect(await screen.findByRole("button", { name: "Show answer" })).toBeTruthy();
  });

  it("C1-R2 real-provider/disposable-SQLite UI reset while page response is held keeps erased rows absent in DB and UI", async () => {
    await seed();
    const repo = createRepositories(db).cardReviews;
    const snapshot = await repo.getCardReviewSnapshot(M);
    const current = snapshot.current;
    if (current.status !== "ok") throw new Error("cards not ready");

    // Materialize version and card_items with a first action
    await repo.saveAction({
      operationId: crypto.randomUUID(),
      materialId: M,
      versionContentHash: current.contentHash,
      itemId: current.items[0]!.itemId,
      expectedGeneration: 0,
      expectedRevision: 0,
      action: "rate",
      rating: "good",
    });

    // Seed 20 additional events so total events = 21 (page 1 has 20, page 2 has 1)
    for (let i = 1; i <= 20; i++) {
      const ts = new Date(Date.parse(T0) + i * 1000).toISOString();
      await db.execute(
        `INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
         VALUES (?, ?, 0, 'good', ?, 'simple-v1', '{}', '{}')`,
        [`event-${i}`, current.items[0]!.itemId, ts],
      );
    }

    // Intercept db.select for recent reviews with cursor so page 2 request is held
    const page2Hold = deferred<any>();
    let heldCalled = false;
    const realSelect = db.select.bind(db);
    vi.spyOn(db, "select").mockImplementation((async (sql: string, params: SqlValue[] = []) => {
      if (sql.includes("card_review_events") && sql.includes("e.reviewed_at < ?")) {
        heldCalled = true;
        return page2Hold.promise;
      }
      return realSelect(sql, params);
    }) as typeof db.select);

    renderDetail();
    await reviewHeading();
    expect(await screen.findByRole("heading", { name: "Recent reviews" })).toBeTruthy();

    // Click Show more reviews
    const showMore = screen.getByRole("button", { name: "Show more reviews" });
    fireEvent.click(showMore);
    await waitFor(() => expect(heldCalled).toBe(true));
    expect(showMore.hasAttribute("disabled")).toBe(true);

    // Trigger reset dialog and confirm reset
    fireEvent.click(button("Reset card reviews"));
    const dialog = await screen.findByRole("dialog", { name: `Reset card reviews for “${TITLE}”?` });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset reviews" }));

    // The notice precedes refresh completion, and an open fallback modal hides
    // background headings. Wait for the dialog AND authoritative refresh first.
    await screen.findByText(/Card reviews for this material were reset/);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(button("Reset card reviews")).toHaveProperty("disabled", false));
    expect(screen.queryByRole("heading", { name: "Recent reviews", hidden: true })).toBeNull();

    // Now resolve the held page 2 response with synthetic erased event
    await act(async () => {
      page2Hold.resolve([
        {
          id: "erased-event-resurrect",
          item_id: current.items[0]!.itemId,
          rating: "good",
          reviewed_at: T0,
          front: "Synthetic card one",
          version_id: current.versionId,
        },
      ]);
    });

    // UI check: erased events must NOT resurface
    expect(screen.queryByRole("heading", { name: "Recent reviews" })).toBeNull();
    expect(screen.queryByText(/erased-event-resurrect/)).toBeNull();

    // DB check: events table must have 0 rows for this material
    const [eventCount] = await db.select<{ count: number }>(
      `SELECT COUNT(*) AS count FROM card_review_events e
       JOIN card_items i ON i.id = e.item_id
       JOIN card_versions v ON v.id = i.version_id
       WHERE v.source_material_id = ?`,
      [M],
    );
    expect(eventCount?.count).toBe(0);

    // Zero Gemini or network calls
    expect(geminiService.generateStudyAid).not.toHaveBeenCalled();
    expect(geminiService.generatePracticeTest).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("session and summary helpers", () => {
  it("session membership counts unique presented cards; a replayed acknowledgement does not advance twice", () => {
    let session = createReviewSession([
      { itemId: "a", kind: "new", dueAt: null, ordinal: 0 },
      { itemId: "b", kind: "new", dueAt: null, ordinal: 1 },
      { itemId: "c", kind: "new", dueAt: null, ordinal: 2 },
    ]);
    session = acknowledgeInSession(session, "a");
    session = acknowledgeInSession(session, "a");
    expect([session.completed.size, session.position]).toEqual([1, 1]);
    session = acknowledgeInSession(session, "c");
    expect(session.position).toBe(1);
  });

  it("the summary mirrors the due rules: exact Again instants and the exclusive local boundary", () => {
    const snapshot = {
      materialId: M,
      generation: 0,
      current: {
        status: "ok" as const,
        versionId: "v",
        contentHash: "h",
        items: ["a", "b", "c", "d"].map((itemId, ordinal) => ({ itemId, ordinal, front: itemId, back: itemId, sourcePage: null })),
      },
      states: {
        a: { revision: 1, step: -1, dueAt: at(T0, 10 * MINUTE), lastReviewedAt: T0, reps: 1, lapses: 0, suspended: false, flag: null },
        b: { revision: 1, step: 0, dueAt: "2026-10-07T05:00:00.000Z", lastReviewedAt: at("2026-10-07T05:00:00.000Z", -DAY), reps: 1, lapses: 0, suspended: false, flag: null },
        c: { revision: 1, step: -1, dueAt: null, lastReviewedAt: null, reps: 0, lapses: 0, suspended: true, flag: null },
      },
    };
    const boundary = "2026-10-07T05:00:00.000Z";
    expect(summarizeCards(snapshot, at(T0, 9 * MINUTE), boundary)).toMatchObject({ dueNow: 0, newCount: 1, againLater: { count: 1 }, nextDayAt: boundary });
    expect(summarizeCards(snapshot, at(T0, 10 * MINUTE), boundary)).toMatchObject({ dueNow: 1, newCount: 1 });
    expect(summarizeCards(snapshot, at(T0, 10 * MINUTE), at(boundary, 1)).dueNow).toBe(2);
  });
});

function heldPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mockSnapshot = (materialId: string): CardReviewSnapshot => ({
  materialId,
  generation: 0,
  current: {
    status: "ok",
    versionId: materialId,
    contentHash: materialId,
    items: [{ itemId: materialId, ordinal: 0, front: "Synthetic question", back: "Synthetic answer", sourcePage: null }],
  },
  states: {},
});

const hookClock = { now: () => "2026-10-07T10:00:00.000Z", timeZone: () => "UTC", newOperationId: () => crypto.randomUUID() };

function mockRepository() {
  return {
    getCardReviewSnapshot: vi.fn(async (id: string) => mockSnapshot(id)),
    getDueQueue: vi.fn(async () => []),
    getRecentReviews: vi.fn(
      async (_materialId: string, _cursor?: { id: string; reviewedAt: string } | null) => ({
        rows: [] as CardRecentReview[],
        next: null as { id: string; reviewedAt: string } | null,
      }),
    ),
    saveAction: vi.fn(),
    getOperationStatus: vi.fn(),
  } satisfies CardReviewRepository;
}

describe("Codex independent C1 navigation and paging diagnostics", () => {
  it("control: an ordinary session start settles and unlocks", async () => {
    const repo = mockRepository();
    const hook = renderHook(() => useCardReview("A", repo, { clock: hookClock }));
    await waitFor(() => expect(hook.result.current.read.phase).toBe("ready"));
    await act(async () => { await hook.result.current.startSession(); });
    expect(hook.result.current.starting).toBe(false);
    expect(repo.getDueQueue).toHaveBeenCalledTimes(1);
  });

  it("control: one history request appends the next page once", async () => {
    const repo = mockRepository();
    const old = { id: "event-0", itemId: "A", front: "Synthetic question", rating: "good" as const, reviewedAt: "2026-10-07T10:00:00.000Z", earlierVersion: false };
    repo.getRecentReviews.mockResolvedValueOnce({ rows: [old], next: { id: old.id, reviewedAt: old.reviewedAt } });
    const hook = renderHook(() => useCardReview("A", repo, { clock: hookClock }));
    await waitFor(() => expect(hook.result.current.recent.rows).toHaveLength(1));
    repo.getRecentReviews.mockResolvedValue({ rows: [{ ...old, id: "event-1" }], next: null });
    await act(async () => { await hook.result.current.loadMoreRecent(); });
    expect(hook.result.current.recent.rows).toHaveLength(2);
  });

  it("[C1-R1] replacing cards while a session queue read is held releases the current material start lock", async () => {
    const repo = mockRepository();
    const queue = heldPromise<[]>();
    repo.getDueQueue.mockImplementationOnce(() => queue.promise);
    const hook = renderHook(({ contentKey }) => useCardReview("A", repo, { clock: hookClock, contentKey }), { initialProps: { contentKey: "v1" } });
    await waitFor(() => expect(hook.result.current.read.phase).toBe("ready"));
    let start!: Promise<void>;
    act(() => { start = hook.result.current.startSession(); });
    await waitFor(() => expect(repo.getDueQueue).toHaveBeenCalledTimes(1));
    hook.rerender({ contentKey: "v2" });
    await waitFor(() => expect(hook.result.current.read.phase === "ready" && hook.result.current.read.snapshot.materialId).toBe("A"));
    await act(async () => { queue.resolve([]); await start; });
    expect(hook.result.current.starting).toBe(false);
    await act(async () => { await hook.result.current.startSession(); });
    expect(repo.getDueQueue).toHaveBeenCalledTimes(2);
  });

  it("[C1-R1] two synchronous starts allocate only one session queue read", async () => {
    const repo = mockRepository();
    const queue = heldPromise<[]>();
    repo.getDueQueue.mockImplementation(() => queue.promise);
    const hook = renderHook(() => useCardReview("A", repo, { clock: hookClock }));
    await waitFor(() => expect(hook.result.current.read.phase).toBe("ready"));
    let one!: Promise<void>, two!: Promise<void>;
    act(() => { one = hook.result.current.startSession(); two = hook.result.current.startSession(); });
    await waitFor(() => expect(repo.getDueQueue.mock.calls.length).toBeGreaterThan(0));
    await act(async () => { queue.resolve([]); await Promise.all([one, two]); });
    expect(repo.getDueQueue).toHaveBeenCalledTimes(1);
  });

  it("[C1-R1] held old success/rejection/finally while a newer start is pending does not clear newer lock or publish obsolete state", async () => {
    const repo = mockRepository();
    const queue1 = heldPromise<[]>();
    const queue2 = heldPromise<[]>();
    repo.getDueQueue.mockImplementationOnce(() => queue1.promise);
    repo.getDueQueue.mockImplementationOnce(() => queue2.promise);

    const hook = renderHook(({ contentKey }) => useCardReview("A", repo, { clock: hookClock, contentKey }), {
      initialProps: { contentKey: "v1" },
    });
    await waitFor(() => expect(hook.result.current.read.phase).toBe("ready"));

    let start1!: Promise<void>;
    act(() => { start1 = hook.result.current.startSession(); });
    await waitFor(() => expect(repo.getDueQueue).toHaveBeenCalledTimes(1));

    // Rerender with v2 to bump generation
    hook.rerender({ contentKey: "v2" });
    await waitFor(() => expect(hook.result.current.read.phase === "ready" && !hook.result.current.starting).toBe(true));

    let start2!: Promise<void>;
    act(() => { start2 = hook.result.current.startSession(); });
    await waitFor(() => expect(repo.getDueQueue).toHaveBeenCalledTimes(2));
    expect(hook.result.current.starting).toBe(true);

    // Resolve old start 1: its finally must not clear start 2's lock
    await act(async () => {
      queue1.resolve([]);
      await start1;
    });

    expect(hook.result.current.starting).toBe(true);
    expect(hook.result.current.session).toBeNull();

    // Resolve start 2: now completes and unlocks
    await act(async () => {
      queue2.resolve([]);
      await start2;
    });
    expect(hook.result.current.starting).toBe(false);
    expect(hook.result.current.session).not.toBeNull();
  });

  it("[C1-R1] held old rejection while a newer start is pending does not mark session unavailable or clear lock", async () => {
    const repo = mockRepository();
    const queue1 = heldPromise<[]>();
    const queue2 = heldPromise<[]>();
    repo.getDueQueue.mockImplementationOnce(() => queue1.promise);
    repo.getDueQueue.mockImplementationOnce(() => queue2.promise);

    const hook = renderHook(({ contentKey }) => useCardReview("A", repo, { clock: hookClock, contentKey }), {
      initialProps: { contentKey: "v1" },
    });
    await waitFor(() => expect(hook.result.current.read.phase).toBe("ready"));

    let start1!: Promise<void>;
    act(() => { start1 = hook.result.current.startSession(); });
    await waitFor(() => expect(repo.getDueQueue).toHaveBeenCalledTimes(1));

    hook.rerender({ contentKey: "v2" });
    await waitFor(() => expect(hook.result.current.read.phase === "ready" && !hook.result.current.starting).toBe(true));

    let start2!: Promise<void>;
    act(() => { start2 = hook.result.current.startSession(); });
    await waitFor(() => expect(repo.getDueQueue).toHaveBeenCalledTimes(2));

    // Reject old start 1
    await act(async () => {
      queue1.reject(new Error("old start failed"));
      try { await start1; } catch {}
    });

    expect(hook.result.current.sessionUnavailable).toBe(false);
    expect(hook.result.current.starting).toBe(true);

    // Resolve start 2
    await act(async () => {
      queue2.resolve([]);
      await start2;
    });
    expect(hook.result.current.starting).toBe(false);
    expect(hook.result.current.sessionUnavailable).toBe(false);
    expect(hook.result.current.session).not.toBeNull();
  });

  it("[C1-R1] ending or advancing a session prevents an obsolete start from resurrecting or replacing it", async () => {
    const repo = mockRepository();
    const queue = heldPromise<[]>();
    repo.getDueQueue.mockImplementationOnce(() => queue.promise);

    const hook = renderHook(() => useCardReview("A", repo, { clock: hookClock }));
    await waitFor(() => expect(hook.result.current.read.phase).toBe("ready"));

    let start!: Promise<void>;
    act(() => { start = hook.result.current.startSession(); });
    await waitFor(() => expect(repo.getDueQueue).toHaveBeenCalledTimes(1));

    // End session while start is pending
    act(() => { hook.result.current.endSession(); });
    expect(hook.result.current.session).toBeNull();

    // Old queue resolves
    await act(async () => {
      queue.resolve([]);
      await start;
    });

    expect(hook.result.current.session).toBeNull();
    expect(hook.result.current.starting).toBe(false);
  });

  it("[C1-R1] actual StrictMode mount/cleanup replay settles and unlocks cleanly", async () => {
    const repo = mockRepository();
    const hook = renderHook(() => useCardReview("A", repo, { clock: hookClock }), {
      wrapper: ({ children }) => h(StrictMode, null, children),
    });
    await waitFor(() => expect(hook.result.current.read.phase).toBe("ready"));
    await act(async () => { await hook.result.current.startSession(); });
    expect(hook.result.current.starting).toBe(false);
    expect(hook.result.current.session).not.toBeNull();
    expect(repo.getDueQueue).toHaveBeenCalledTimes(1);
  });

  it("[C1-R2] a history page held before reset cannot resurrect erased history after the acknowledged refresh", async () => {
    const repo = mockRepository();
    const page = heldPromise<{ rows: CardRecentReview[]; next: null }>();
    const old = { id: "old-event", itemId: "A", front: "Synthetic old card", rating: "good" as const, reviewedAt: "2026-10-07T10:00:00.000Z", earlierVersion: false };
    repo.getRecentReviews.mockResolvedValueOnce({ rows: [old], next: { id: old.id, reviewedAt: old.reviewedAt } });
    repo.getRecentReviews.mockImplementationOnce(() => page.promise);
    repo.getRecentReviews.mockResolvedValue({ rows: [], next: null });
    repo.saveAction.mockResolvedValue({ action: "reset", materialId: "A", generation: 1 });
    const hook = renderHook(() => useCardReview("A", repo, { clock: hookClock }));
    await waitFor(() => expect(hook.result.current.recent.rows).toHaveLength(1));
    let loading!: Promise<void>;
    act(() => { loading = hook.result.current.loadMoreRecent(); });
    repo.getCardReviewSnapshot.mockResolvedValue({ ...mockSnapshot("A"), generation: 1 });
    act(() => { hook.result.current.confirmReset(); });
    await waitFor(() => expect(hook.result.current.notice?.kind).toBe("reset-done"));
    await waitFor(() => expect(hook.result.current.recent.rows).toHaveLength(0));
    await act(async () => { page.resolve({ rows: [{ ...old, id: "erased-event" }], next: null }); await loading; });
    expect(hook.result.current.recent.rows).toHaveLength(0);
  });

  it("[C1-R2] two synchronous history requests publish one copy of the next page", async () => {
    const repo = mockRepository();
    const page = heldPromise<{ rows: CardRecentReview[]; next: null }>();
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: "event-" + i, itemId: "A", front: "Synthetic question", rating: "good" as const, reviewedAt: "2026-10-07T10:00:00.000Z", earlierVersion: false }));
    repo.getRecentReviews.mockResolvedValueOnce({ rows, next: { id: "event-19", reviewedAt: rows[0]!.reviewedAt } });
    repo.getRecentReviews.mockImplementation(() => page.promise);
    const hook = renderHook(() => useCardReview("A", repo, { clock: hookClock }));
    await waitFor(() => expect(hook.result.current.recent.rows).toHaveLength(20));
    let one!: Promise<void>, two!: Promise<void>;
    act(() => { one = hook.result.current.loadMoreRecent(); two = hook.result.current.loadMoreRecent(); });
    const last = { ...rows[0]!, id: "event-20" };
    await act(async () => { page.resolve({ rows: [last], next: null }); await Promise.all([one, two]); });
    expect(hook.result.current.recent.rows).toHaveLength(21);
    expect(new Set(hook.result.current.recent.rows.map((r) => r.id)).size).toBe(21);
  });

  it("[C1-R2] held-page success and rejection across reset/first-page refresh change nothing", async () => {
    const repo = mockRepository();
    const page1 = heldPromise<{ rows: CardRecentReview[]; next: null }>();
    const old = { id: "old-1", itemId: "A", front: "Card 1", rating: "good" as const, reviewedAt: "2026-10-07T10:00:00.000Z", earlierVersion: false };
    repo.getRecentReviews.mockResolvedValueOnce({ rows: [old], next: { id: old.id, reviewedAt: old.reviewedAt } });
    repo.getRecentReviews.mockImplementationOnce(() => page1.promise);

    const hook = renderHook(() => useCardReview("A", repo, { clock: hookClock }));
    await waitFor(() => expect(hook.result.current.recent.rows).toHaveLength(1));

    let paging1!: Promise<void>;
    act(() => { paging1 = hook.result.current.loadMoreRecent(); });

    // Trigger first-page refresh
    const fresh = { id: "fresh-1", itemId: "A", front: "Card fresh", rating: "again" as const, reviewedAt: "2026-10-07T10:05:00.000Z", earlierVersion: false };
    repo.getRecentReviews.mockResolvedValueOnce({ rows: [fresh], next: null });
    await act(async () => { hook.result.current.retryReads(); });
    await waitFor(() => expect(hook.result.current.recent.rows[0]?.id).toBe("fresh-1"));

    // Old held page resolves
    await act(async () => {
      page1.resolve({ rows: [{ ...old, id: "late-page-row" }], next: null });
      await paging1;
    });

    // Late page must NOT have appended to refreshed history
    expect(hook.result.current.recent.rows).toHaveLength(1);
    expect(hook.result.current.recent.rows[0]!.id).toBe("fresh-1");
    expect(hook.result.current.recent.failed).toBe(false);

    // Now test held-page rejection across reset
    const page2 = heldPromise<{ rows: CardRecentReview[]; next: null }>();
    repo.getRecentReviews.mockResolvedValueOnce({ rows: [fresh], next: { id: fresh.id, reviewedAt: fresh.reviewedAt } });
    repo.getRecentReviews.mockImplementationOnce(() => page2.promise);
    repo.getRecentReviews.mockResolvedValue({ rows: [], next: null });
    repo.saveAction.mockResolvedValue({ action: "reset", materialId: "A", generation: 1 });

    await act(async () => { hook.result.current.retryReads(); });
    let paging2!: Promise<void>;
    act(() => { paging2 = hook.result.current.loadMoreRecent(); });

    repo.getCardReviewSnapshot.mockResolvedValue({ ...mockSnapshot("A"), generation: 1 });
    act(() => { hook.result.current.confirmReset(); });
    await waitFor(() => expect(hook.result.current.notice?.kind).toBe("reset-done"));

    // Reject the held page
    await act(async () => {
      page2.reject(new Error("late paging error"));
      try { await paging2; } catch {}
    });

    // Rejection in old epoch must NOT set failed: true in new epoch
    expect(hook.result.current.recent.failed).toBe(false);
    expect(hook.result.current.recent.rows).toHaveLength(0);
  });

  it("[C1-R2] late A callbacks during B's page change nothing in B's state or loading", async () => {
    const repo = mockRepository();
    const pageA = heldPromise<{ rows: CardRecentReview[]; next: null }>();
    const rowA = { id: "a-0", itemId: "A", front: "Card A", rating: "good" as const, reviewedAt: "2026-10-07T10:00:00.000Z", earlierVersion: false };
    const rowB = { id: "b-0", itemId: "B", front: "Card B", rating: "good" as const, reviewedAt: "2026-10-07T10:00:00.000Z", earlierVersion: false };
    repo.getRecentReviews.mockImplementation(async (id: string, cursor?: any) => {
      if (id === "A" && cursor) return pageA.promise;
      if (id === "A") return { rows: [rowA], next: { id: rowA.id, reviewedAt: rowA.reviewedAt } };
      if (id === "B") return { rows: [rowB], next: null };
      return { rows: [], next: null };
    });

    const hook = renderHook(({ id }) => useCardReview(id, repo, { clock: hookClock }), { initialProps: { id: "A" } });
    await waitFor(() => expect(hook.result.current.recent.rows).toHaveLength(1));

    let pagingA!: Promise<void>;
    act(() => { pagingA = hook.result.current.loadMoreRecent(); });

    // Switch to material B
    hook.rerender({ id: "B" });
    await waitFor(() => expect(hook.result.current.recent.rows).toHaveLength(1));
    expect(hook.result.current.recent.rows[0]!.id).toBe("b-0");

    // Late A page resolves
    await act(async () => {
      pageA.resolve({ rows: [{ ...rowA, id: "a-1" }], next: null });
      await pagingA;
    });

    // B's rows and loading state are unchanged
    expect(hook.result.current.recent.rows).toHaveLength(1);
    expect(hook.result.current.recent.rows[0]!.id).toBe("b-0");
    expect(hook.result.current.recent.failed).toBe(false);
    expect(hook.result.current.recent.loading).toBe(false);
  });

  it("[C1-R2] a failed page retry retains cursor and succeeds with the same cursor", async () => {
    const repo = mockRepository();
    const old = { id: "event-0", itemId: "A", front: "Synthetic question", rating: "good" as const, reviewedAt: "2026-10-07T10:00:00.000Z", earlierVersion: false };
    const cursor = { id: old.id, reviewedAt: old.reviewedAt };
    repo.getRecentReviews.mockResolvedValueOnce({ rows: [old], next: cursor });
    repo.getRecentReviews.mockRejectedValueOnce(new Error("transient network/disk error"));

    const hook = renderHook(() => useCardReview("A", repo, { clock: hookClock }));
    await waitFor(() => expect(hook.result.current.recent.rows).toHaveLength(1));

    await act(async () => { await hook.result.current.loadMoreRecent(); });
    expect(hook.result.current.recent.failed).toBe(true);
    expect(hook.result.current.recent.loading).toBe(false);
    expect(hook.result.current.recent.next).toEqual(cursor);

    // Retry with same cursor succeeds
    repo.getRecentReviews.mockResolvedValueOnce({ rows: [{ ...old, id: "event-1" }], next: null });
    await act(async () => { await hook.result.current.loadMoreRecent(); });
    expect(hook.result.current.recent.failed).toBe(false);
    expect(hook.result.current.recent.loading).toBe(false);
    expect(hook.result.current.recent.rows).toHaveLength(2);
    expect(hook.result.current.recent.next).toBeNull();
    expect(repo.getRecentReviews).toHaveBeenLastCalledWith("A", cursor);
  });

  it("[C1-R2] repeated end-of-history calls are safe no-ops", async () => {
    const repo = mockRepository();
    const old = { id: "event-0", itemId: "A", front: "Synthetic question", rating: "good" as const, reviewedAt: "2026-10-07T10:00:00.000Z", earlierVersion: false };
    repo.getRecentReviews.mockResolvedValueOnce({ rows: [old], next: null });

    const hook = renderHook(() => useCardReview("A", repo, { clock: hookClock }));
    await waitFor(() => expect(hook.result.current.recent.rows).toHaveLength(1));
    expect(hook.result.current.recent.next).toBeNull();

    await act(async () => {
      await hook.result.current.loadMoreRecent();
      await hook.result.current.loadMoreRecent();
      await hook.result.current.loadMoreRecent();
    });
    expect(repo.getRecentReviews).toHaveBeenCalledTimes(1);
    expect(hook.result.current.recent.rows).toHaveLength(1);
  });
});
