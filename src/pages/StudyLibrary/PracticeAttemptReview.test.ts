// @vitest-environment jsdom
/**
 * Focused review of missed or skipped questions for one completed practice
 * attempt: the completion link from the panel, the All questions / Missed or
 * skipped controls in history, frozen content and route/read races. Real
 * AppDataProvider over a disposable node:sqlite file; records are created only
 * through the existing repositories. jsdom only, not installed-app evidence.
 */
import { createElement as h, useLayoutEffect } from "react";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { PracticeAttempt, PracticeTest, PracticeTestItem } from "@/domain/types";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { PracticeHistory } from "./PracticeHistory";
import { PracticeTestPanel } from "./PracticeTestPanel";

let testDb: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(testDb),
  isTauri: () => false,
}));

let appCtx: ReturnType<typeof useAppData>;
let navigateTo: (path: string) => void;
let onLayoutRoute: ((location: ReturnType<typeof useLocation>) => void) | null = null;

function Probe() {
  appCtx = useAppData();
  navigateTo = useNavigate();
  const location = useLocation();
  useLayoutEffect(() => {
    onLayoutRoute?.(location);
  }, [location]);
  return null;
}

let tempDir: string;
let repos: Repositories;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "flight-training-focused-review-"));
  testDb = await createNodeSqliteDatabase(join(tempDir, "test.db"));
  repos = createRepositories(testDb);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  onLayoutRoute = null;
  testDb?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function HistoryRoutes() {
  const { status } = useAppData();
  if (status !== "ready") return null;
  return h(
    Routes,
    null,
    h(Route, { path: "/", element: h("p", null, "Home") }),
    h(Route, { path: "/study/history", element: h(PracticeHistory) }),
    h(Route, { path: "/study/history/:historyKey", element: h(PracticeHistory) }),
    h(Route, { path: "/study/history/:historyKey/:attemptId", element: h(PracticeHistory) }),
  );
}

async function renderHistory(path: string) {
  const view = render(
    h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Probe), h(HistoryRoutes))),
  );
  await waitFor(() => expect(appCtx.status).toBe("ready"));
  return view;
}

async function renderPanel(test: PracticeTest) {
  function Ready() {
    const { status } = useAppData();
    return status === "ready" ? h(PracticeTestPanel, { practiceTest: test }) : null;
  }
  render(h(AppDataProvider, null, h(MemoryRouter, null, h(Probe), h(Ready))));
  await waitFor(() => expect(appCtx.status).toBe("ready"));
}

/** Four questions; question n has explanation "Why n" and source page 10 + n. */
async function seed(id: string, prefix: string): Promise<PracticeTest> {
  return seedWithCount(id, prefix, 4);
}

async function seedWithCount(id: string, prefix: string, count: number): Promise<PracticeTest> {
  await repos.documents.create({ id, title: `${prefix} material` });
  await repos.documents.savePracticeTest({
    provider: "gemini",
    sourceMaterialId: id,
    title: `${prefix} material`,
    model: "synthetic",
    questions: Array.from({ length: count }, (_, i) => i + 1).map((n) => ({
      question: `${prefix} question ${n}?`,
      options: [`${prefix} ${n} right`, `${prefix} ${n} wrong`],
      correctIndex: 0,
      explanation: `${prefix} why ${n}`,
      sourcePage: 10 + n,
    })),
  });
  return (await repos.documents.listPracticeTests()).find((t) => t.sourceMaterialId === id)!;
}

type Answer = "correct" | "incorrect" | "dont_know" | "skip";

/** Answers through the real session transaction; returns the version's own identity. */
async function answer(materialId: string, answers: Answer[]) {
  const active = (await repos.practiceSessions.getActiveVersion(materialId))!;
  const started = await repos.practiceSessions.saveSessionAction({
    action: "start_or_resume",
    operationId: crypto.randomUUID(),
    materialId,
    versionId: active.version.id,
  });
  if (!("attemptId" in started) || !("revision" in started)) throw Error("Unexpected start");
  let revision = started.revision;
  for (const [i, kind] of answers.entries()) {
    if (kind === "skip") continue;
    const state = await repos.practiceSessions.saveSessionAction({
      action: "record_response",
      operationId: crypto.randomUUID(),
      attemptId: started.attemptId,
      itemId: active.items[i]!.id,
      expectedRevision: revision,
      selectedIndex: kind === "dont_know" ? null : kind === "correct" ? 0 : 1,
      isDontKnow: kind === "dont_know",
    });
    revision = (state as { revision: number }).revision;
  }
  return { attemptId: started.attemptId, revision, version: active.version };
}

async function completeAttempt(materialId: string, answers: Answer[]) {
  const { attemptId, revision, version } = await answer(materialId, answers);
  await repos.practiceSessions.saveSessionAction({
    action: "complete_attempt",
    operationId: crypto.randomUUID(),
    attemptId,
    expectedRevision: revision,
  });
  return { attemptId, historyKey: version.historyKey, versionId: version.id };
}

function reviewPath(historyKey: string, attemptId: string, query = "") {
  return `/study/history/${encodeURIComponent(historyKey)}/${encodeURIComponent(attemptId)}${query}`;
}

function questionHeadings(): string[] {
  return screen.queryAllByText(/^Question \d+ of \d+$/).map((el) => el.textContent ?? "");
}

function pressed(name: string) {
  return screen.getByRole("button", { name }).getAttribute("aria-pressed");
}

async function storedState() {
  return {
    attempts: await testDb.select("SELECT * FROM practice_attempts ORDER BY id"),
    responses: await testDb.select("SELECT * FROM practice_responses ORDER BY id"),
    versions: await testDb.select("SELECT * FROM practice_test_versions ORDER BY id"),
    items: await testDb.select("SELECT * FROM practice_test_items ORDER BY id"),
    sessionOperations: await testDb.select("SELECT * FROM practice_session_operations ORDER BY operation_id"),
    saveOperations: await testDb.select("SELECT * FROM practice_save_operations ORDER BY operation_id"),
  };
}

describe("completion link to the exact attempt's focused review", () => {
  it("appears only after acknowledged completion and targets that attempt with encoded identifiers", async () => {
    // Practice identifiers are limited to [A-Za-z0-9_.-]; the pure path test
    // covers encoding of characters these routes cannot store.
    const materialId = "Mat.1_panel-x";
    const test = await seed(materialId, "Panel");
    // Q1 correct, Q2 incorrect, Q3 don't know, Q4 unanswered.
    const { attemptId } = await answer(materialId, ["correct", "incorrect", "dont_know", "skip"]);
    const historyKey = (await repos.practiceSessions.getActiveVersion(materialId))!.version.historyKey;

    await renderPanel(test);
    const sessions = appCtx.repositories!.practiceSessions;
    const save = sessions.saveSessionAction.bind(sessions);
    let failNext = true;
    const spy = vi.spyOn(sessions, "saveSessionAction").mockImplementation(async (action) => {
      if (action.action === "complete_attempt" && failNext) {
        failNext = false;
        throw new Error("Storage did not answer.");
      }
      return save(action);
    });

    // Resumes at the unanswered question; open an answered one to reach completion.
    fireEvent.click(await screen.findByRole("button", { name: "Question 1, correct" }));
    fireEvent.click(await screen.findByRole("button", { name: /Complete test now/ }));

    // Unknown outcome: no result view and no review link stand in for success.
    await screen.findByText("Storage did not answer.");
    expect(screen.queryByRole("link", { name: "Review missed or skipped questions" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    const link = await screen.findByRole("link", { name: "Review missed or skipped questions" });
    expect(link.getAttribute("href")).toBe(
      `#/study/history/${encodeURIComponent(historyKey)}/${encodeURIComponent(attemptId)}?review=missed`,
    );
    expect(spy.mock.calls.filter(([a]) => a.action === "complete_attempt")).toHaveLength(2);
    const [completed] = await testDb.select<{ id: string; status: string }>(
      "SELECT id, status FROM practice_attempts",
    );
    expect(completed).toEqual({ id: attemptId, status: "completed" });

    // Starting a retake takes the link away until that is settled.
    let releaseRetake!: () => void;
    const retakeHeld = new Promise<void>((r) => (releaseRetake = r));
    spy.mockImplementation(async (action) => {
      if (action.action === "retake_attempt") await retakeHeld;
      return save(action);
    });
    fireEvent.click(screen.getByRole("button", { name: "Retake this test" }));
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Review missed or skipped questions" })).toBeNull(),
    );
    await act(async () => {
      releaseRetake();
      await retakeHeld;
    });
    cleanup();

    // Following the link opens the focused review of that same attempt.
    await renderHistory(link.getAttribute("href")!.slice(1));
    await screen.findByText("Review: Panel material");
    expect(pressed("Missed or skipped")).toBe("true");
    expect(pressed("All questions")).toBe("false");
    expect(questionHeadings()).toEqual(["Question 2 of 4", "Question 3 of 4", "Question 4 of 4"]);
  });
});

describe("All questions / Missed or skipped in a completed attempt", () => {
  it("focuses on incorrect, don't-know and unanswered questions with frozen order, numbers, explanations and sources", async () => {
    await seed("m1", "Mixed");
    // Q1 incorrect, Q2 correct, Q3 unanswered, Q4 don't know.
    const { historyKey, attemptId } = await completeAttempt("m1", [
      "incorrect",
      "correct",
      "skip",
      "dont_know",
    ]);
    const before = await storedState();

    await renderHistory(reviewPath(historyKey, attemptId, "?review=missed"));
    await screen.findByText("Review: Mixed material");
    const sessions = appCtx.repositories!.practiceSessions;
    const save = vi.spyOn(sessions, "saveSessionAction");
    const reads = vi.spyOn(sessions, "getItems");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(questionHeadings()).toEqual(["Question 1 of 4", "Question 3 of 4", "Question 4 of 4"]);
    expect(screen.getByText("Incorrect")).toBeTruthy();
    expect(screen.getByText("Unanswered")).toBeTruthy();
    expect(screen.getByText("Marked as don't know")).toBeTruthy();
    expect(screen.queryByText("Correct")).toBeNull();
    expect(screen.queryByText("Mixed question 2?")).toBeNull();
    for (const n of [1, 3, 4]) {
      expect(screen.getByText(`Mixed question ${n}?`)).toBeTruthy();
      expect(screen.getByText(`Mixed why ${n}`)).toBeTruthy();
      expect(screen.getByText(`Source p. ${10 + n}`)).toBeTruthy();
    }
    expect(screen.getByText("(Your choice)")).toBeTruthy();
    expect(screen.getAllByText("(Correct answer)")).toHaveLength(3);
    // The overall immutable result is unchanged by the focused view.
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByText("1 correct")).toBeTruthy();
    expect(screen.getByText("1 incorrect")).toBeTruthy();
    expect(screen.getByText("1 don't know")).toBeTruthy();
    expect(screen.getByText("1 unanswered")).toBeTruthy();

    // Keyboard reachable native buttons in a labelled group.
    const group = screen.getByRole("group", { name: "Questions to review" });
    const allButton = screen.getByRole("button", { name: "All questions" });
    expect(group.contains(allButton)).toBe(true);
    expect(allButton.tagName).toBe("BUTTON");
    allButton.focus();
    expect(document.activeElement).toBe(allButton);
    fireEvent.click(allButton);

    expect(pressed("All questions")).toBe("true");
    expect(pressed("Missed or skipped")).toBe("false");
    expect(questionHeadings()).toEqual([
      "Question 1 of 4",
      "Question 2 of 4",
      "Question 3 of 4",
      "Question 4 of 4",
    ]);
    expect(screen.getByText("Correct")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Missed or skipped" }));
    expect(pressed("Missed or skipped")).toBe("true");
    expect(questionHeadings()).toHaveLength(3);
    expect(screen.getByText("25%")).toBeTruthy();

    // Switching views reads nothing again, writes nothing and calls no provider.
    expect(reads).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await storedState()).toEqual(before);
  });

  it("keeps ordinary attempt links and unknown query values on All questions", async () => {
    await seed("m1", "Plain");
    const { historyKey, attemptId } = await completeAttempt("m1", ["incorrect", "correct", "skip", "skip"]);

    await renderHistory(`/study/history/${encodeURIComponent(historyKey)}`);
    fireEvent.click(await screen.findByRole("link", { name: "Review attempt" }));
    await screen.findByText("Review: Plain material");
    expect(pressed("All questions")).toBe("true");
    expect(questionHeadings()).toHaveLength(4);
    cleanup();

    for (const query of ["?review=everything", "?review=MISSED", "?review="]) {
      await renderHistory(reviewPath(historyKey, attemptId, query));
      await screen.findByText("Review: Plain material");
      expect(pressed("All questions"), query).toBe("true");
      expect(questionHeadings(), query).toHaveLength(4);
      cleanup();
    }
  });

  it("shows a clear empty focused view for an all-correct attempt, with a way back to All questions", async () => {
    await seed("m1", "Perfect");
    const { historyKey, attemptId } = await completeAttempt("m1", [
      "correct",
      "correct",
      "correct",
      "correct",
    ]);

    await renderHistory(reviewPath(historyKey, attemptId, "?review=missed"));
    await screen.findByText("Nothing missed or skipped");
    expect(questionHeadings()).toEqual([]);
    expect(screen.getByText("100%")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show all questions" }));
    expect(pressed("All questions")).toBe("true");
    expect(questionHeadings()).toHaveLength(4);
    expect(screen.queryByText("Nothing missed or skipped")).toBeNull();
  });

  it("still reviews the frozen questions after the test is replaced and the source deleted", async () => {
    await seed("m1", "Frozen");
    const { historyKey, attemptId } = await completeAttempt("m1", ["correct", "dont_know", "skip", "incorrect"]);
    await repos.documents.savePracticeTest({
      provider: "gemini",
      sourceMaterialId: "m1",
      title: "Replacement",
      model: "synthetic",
      questions: [
        { question: "Replacement question?", options: ["A", "B"], correctIndex: 1, explanation: "New why", sourcePage: 99 },
      ],
    });
    await repos.documents.remove("m1");

    await renderHistory(reviewPath(historyKey, attemptId, "?review=missed"));
    await screen.findByText("Review: Frozen material");
    expect(questionHeadings()).toEqual(["Question 2 of 4", "Question 3 of 4", "Question 4 of 4"]);
    expect(screen.getByText("Frozen why 2")).toBeTruthy();
    expect(screen.getByText("Source p. 14")).toBeTruthy();
    expect(screen.queryByText("Replacement question?")).toBeNull();
    expect(screen.queryByText("New why")).toBeNull();
  });

  it("never shows a delayed earlier attempt's questions or selection after the route changes", async () => {
    await seed("ma", "Alpha");
    await seed("mb", "Bravo");
    const a = await completeAttempt("ma", ["incorrect", "correct", "correct", "correct"]);
    const b = await completeAttempt("mb", ["correct", "incorrect", "correct", "correct"]);

    await renderHistory("/");
    await screen.findByText("Home");
    const sessions = appCtx.repositories!.practiceSessions;
    const getItems = sessions.getItems.bind(sessions);
    let releaseAlpha!: () => void;
    const alphaHeld = new Promise<void>((r) => (releaseAlpha = r));
    vi.spyOn(sessions, "getItems").mockImplementation(async (versionId: string): Promise<PracticeTestItem[]> => {
      if (versionId === a.versionId) await alphaHeld;
      return getItems(versionId);
    });

    act(() => navigateTo(reviewPath(a.historyKey, a.attemptId, "?review=missed")));
    await waitFor(() => expect(sessions.getItems).toHaveBeenCalledWith(a.versionId));
    act(() => navigateTo(reviewPath(b.historyKey, b.attemptId)));
    await screen.findByText("Review: Bravo material");
    expect(pressed("All questions")).toBe("true");

    await act(async () => {
      releaseAlpha();
      await alphaHeld;
    });
    expect(screen.getByText("Review: Bravo material")).toBeTruthy();
    expect(screen.queryByText(/Alpha/)).toBeNull();
    expect(pressed("All questions")).toBe("true");
    expect(questionHeadings()).toHaveLength(4);

    // Back to the first attempt: it opens on its own data and its own query.
    act(() => navigateTo(reviewPath(a.historyKey, a.attemptId, "?review=missed")));
    await screen.findByText("Review: Alpha material");
    expect(screen.queryByText(/Bravo/)).toBeNull();
    expect(pressed("Missed or skipped")).toBe("true");
    expect(questionHeadings()).toEqual(["Question 1 of 4"]);
  });
});

describe("Opt-in short saved-attempt mistake review panel (MISTAKES-01b)", () => {
  it("shows opt-in teaser with actual count from mixed outcomes and walks through single-question review", async () => {
    await seed("m-walk", "Walkthrough");
    // Q1 incorrect, Q2 correct, Q3 don't know, Q4 unanswered
    const { historyKey, attemptId } = await completeAttempt("m-walk", [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);

    await renderHistory(reviewPath(historyKey, attemptId));
    await screen.findByText("Review: Walkthrough material");

    const panel = screen.getByRole("region", { name: "Short saved review" });
    const heading = within(panel).getByRole("heading", { name: "Short saved review" });
    expect(heading).toBeTruthy();
    expect(within(panel).getByText(/Review questions you missed or skipped/)).toBeTruthy();
    expect(within(panel).getByText(/historical, read-only review/)).toBeTruthy();

    // 3 eligible questions -> teaser button shows "Review 3 questions"
    const startBtn = within(panel).getByRole("button", { name: "Review 3 questions" });
    expect(startBtn).toBeTruthy();

    // With <= 3 eligible, size choices are NOT shown
    expect(within(panel).queryByRole("group", { name: "Review size" })).toBeNull();

    // Click start to opt in
    fireEvent.click(startBtn);

    // Heading receives focus
    expect(document.activeElement).toBe(heading);

    // Done for now button is visible
    expect(within(panel).getByRole("button", { name: "Done for now" })).toBeTruthy();

    // Review 1 of 3 (Q1, incorrect)
    expect(within(panel).getByText("Review 1 of 3")).toBeTruthy();
    expect(within(panel).getByText("(Question 1 of 4)")).toBeTruthy();
    expect(within(panel).getByText("Incorrect")).toBeTruthy();
    expect(within(panel).getByText("Walkthrough question 1?")).toBeTruthy();

    // Options are unmarked before reveal
    expect(within(panel).queryByText("(Correct answer)")).toBeNull();
    expect(within(panel).queryByText("(Your choice)")).toBeNull();
    expect(panel.querySelectorAll(".practice-option--correct").length).toBe(0);
    expect(panel.querySelectorAll(".practice-option--incorrect").length).toBe(0);

    // Previous is disabled on first item
    expect(within(panel).getByRole("button", { name: "Previous" }).hasAttribute("disabled")).toBe(true);
    const nextBtn = within(panel).getByRole("button", { name: "Next" });
    expect(nextBtn.hasAttribute("disabled")).toBe(false);

    // Reveal toggle: focus button first, click, assert same button identity and activeElement
    const revealBtn = within(panel).getByRole("button", { name: "Show saved answer" });
    revealBtn.focus();
    expect(document.activeElement).toBe(revealBtn);
    fireEvent.click(revealBtn);

    const hideBtn = within(panel).getByRole("button", { name: "Hide saved answer" });
    expect(hideBtn).toBe(revealBtn);
    expect(document.activeElement).toBe(revealBtn);

    // Now options show correct answer and your choice
    expect(within(panel).getByText("(Correct answer)")).toBeTruthy();
    expect(within(panel).getByText("(Your choice)")).toBeTruthy();
    const correctOption = panel.querySelector(".practice-option--correct");
    expect(correctOption).toBeTruthy();
    expect(correctOption?.textContent).toContain("Walkthrough 1 right");
    const incorrectOption = panel.querySelector(".practice-option--incorrect");
    expect(incorrectOption).toBeTruthy();
    expect(incorrectOption?.textContent).toContain("Walkthrough 1 wrong");
    expect(within(panel).getByText("Walkthrough why 1")).toBeTruthy();
    expect(within(panel).getByText("Source p. 11")).toBeTruthy();

    // Click Next: advances to Q3 (don't know) and resets reveal
    fireEvent.click(nextBtn);
    expect(document.activeElement).toBe(heading);
    expect(within(panel).getByText("Review 2 of 3")).toBeTruthy();
    expect(within(panel).getByText("(Question 3 of 4)")).toBeTruthy();
    expect(within(panel).getByText("Marked as don't know")).toBeTruthy();
    expect(within(panel).queryByText("Walkthrough why 1")).toBeNull();
    expect(within(panel).queryByText("(Correct answer)")).toBeNull();
    expect(within(panel).getByRole("button", { name: "Show saved answer" })).toBeTruthy();

    // Reveal Q3 details: focus button first, click
    const revealBtn2 = within(panel).getByRole("button", { name: "Show saved answer" });
    revealBtn2.focus();
    fireEvent.click(revealBtn2);
    expect(within(panel).getByText("Marked as don't know during the test.")).toBeTruthy();
    expect(within(panel).getByText("Walkthrough why 3")).toBeTruthy();

    // Click Next: advances to Q4 (unanswered) and resets reveal
    fireEvent.click(within(panel).getByRole("button", { name: "Next" }));
    expect(within(panel).getByText("Review 3 of 3")).toBeTruthy();
    expect(within(panel).getByText("(Question 4 of 4)")).toBeTruthy();
    expect(within(panel).getByText("Unanswered")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(true);

    // Reveal Q4 details before Previous to verify Previous clears revealed state
    const revealBtn3 = within(panel).getByRole("button", { name: "Show saved answer" });
    revealBtn3.focus();
    fireEvent.click(revealBtn3);
    expect(within(panel).getByText("Unanswered during the test.")).toBeTruthy();
    expect(within(panel).getByText("Walkthrough why 4")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Hide saved answer" })).toBeTruthy();

    // Previous works and resets reveal
    const prevBtn = within(panel).getByRole("button", { name: "Previous" });
    expect(prevBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(prevBtn);
    expect(document.activeElement).toBe(heading);
    expect(within(panel).getByText("Review 2 of 3")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Show saved answer" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Hide saved answer" })).toBeNull();
    expect(within(panel).queryByText("Walkthrough why 4")).toBeNull();
    expect(within(panel).queryByText("Walkthrough why 3")).toBeNull();
    expect(within(panel).queryByText("Unanswered during the test.")).toBeNull();
    expect(within(panel).queryByText("Marked as don't know during the test.")).toBeNull();
    expect(within(panel).queryByText("(Correct answer)")).toBeNull();
    expect(within(panel).queryByText("(Your choice)")).toBeNull();

    // Done for now closes active review back to teaser
    fireEvent.click(within(panel).getByRole("button", { name: "Done for now" }));
    expect(within(panel).getByRole("button", { name: "Review 3 questions" })).toBeTruthy();
    expect(within(panel).queryByText("Review 2 of 3")).toBeNull();
    expect(document.activeElement).toBe(heading);
  });

  it("supports size selection (Up to 3 / Up to 5) when >3 eligible, labels 4 accurately, and leaves all history accessible", async () => {
    await seedWithCount("m-cap6", "CapSix", 6);
    // All 6 missed (incorrect)
    const { historyKey, attemptId } = await completeAttempt("m-cap6", [
      "incorrect",
      "incorrect",
      "incorrect",
      "incorrect",
      "incorrect",
      "incorrect",
    ]);

    await renderHistory(reviewPath(historyKey, attemptId));
    await screen.findByText("Review: CapSix material");

    const panel = screen.getByRole("region", { name: "Short saved review" });
    const sizeGroup = within(panel).getByRole("group", { name: "Review size" });
    expect(sizeGroup).toBeTruthy();

    const upTo3Btn = within(sizeGroup).getByRole("button", { name: "Up to 3" });
    const upTo5Btn = within(sizeGroup).getByRole("button", { name: "Up to 5" });
    expect(upTo3Btn.getAttribute("aria-pressed")).toBe("true");
    expect(upTo5Btn.getAttribute("aria-pressed")).toBe("false");
    expect(within(panel).getByRole("button", { name: "Review 3 questions" })).toBeTruthy();

    // Choose Up to 5
    fireEvent.click(upTo5Btn);
    expect(upTo5Btn.getAttribute("aria-pressed")).toBe("true");
    expect(upTo3Btn.getAttribute("aria-pressed")).toBe("false");
    expect(within(panel).getByRole("button", { name: "Review 5 questions" })).toBeTruthy();

    // Start review with 5 questions
    fireEvent.click(within(panel).getByRole("button", { name: "Review 5 questions" }));
    expect(within(panel).getByText("Review 1 of 5")).toBeTruthy();

    // Full review below still has all questions available!
    const fullReviewHeadings = questionHeadings();
    expect(fullReviewHeadings).toHaveLength(6);
    cleanup();

    // Now test with exactly 4 eligible questions
    await seedWithCount("m-cap4", "CapFour", 5);
    // 4 incorrect, 1 correct -> 4 eligible
    const res4 = await completeAttempt("m-cap4", [
      "incorrect",
      "incorrect",
      "incorrect",
      "incorrect",
      "correct",
    ]);
    await renderHistory(reviewPath(res4.historyKey, res4.attemptId));
    await screen.findByText("Review: CapFour material");

    const panel4 = screen.getByRole("region", { name: "Short saved review" });
    const upTo5Btn4 = within(panel4).getByRole("button", { name: "Up to 5" });
    fireEvent.click(upTo5Btn4);
    // Exactly 4 are eligible, so label is "Review 4 questions"
    expect(within(panel4).getByRole("button", { name: "Review 4 questions" })).toBeTruthy();
  });

  it("reviews the exact frozen old version even after regeneration and source replacement", async () => {
    await seed("m-regen", "Regen");
    const { historyKey, attemptId } = await completeAttempt("m-regen", [
      "incorrect",
      "correct",
      "skip",
      "dont_know",
    ]);

    // Replace material practice test with new version
    await repos.documents.savePracticeTest({
      provider: "gemini",
      sourceMaterialId: "m-regen",
      title: "Replacement Material",
      model: "synthetic",
      questions: [
        {
          question: "Brand new regenerated question?",
          options: ["New A", "New B"],
          correctIndex: 0,
          explanation: "Brand new why",
          sourcePage: 99,
        },
      ],
    });

    await renderHistory(reviewPath(historyKey, attemptId));
    await screen.findByText("Review: Regen material");

    const panel = screen.getByRole("region", { name: "Short saved review" });
    fireEvent.click(within(panel).getByRole("button", { name: "Review 3 questions" }));

    // Reveal answer to inspect exact old options, correct answer, explanation and source page
    const revealBtn = within(panel).getByRole("button", { name: "Show saved answer" });
    revealBtn.focus();
    fireEvent.click(revealBtn);

    // Frozen old question, options, correct answer indicator, explanation and source page
    expect(within(panel).getByText("Regen question 1?")).toBeTruthy();
    expect(within(panel).getByText("Regen 1 right")).toBeTruthy();
    expect(within(panel).getByText("Regen 1 wrong")).toBeTruthy();
    expect(within(panel).getByText("(Correct answer)")).toBeTruthy();
    expect(within(panel).getByText("(Your choice)")).toBeTruthy();

    const correctMarker = within(panel).getByText("(Correct answer)");
    const correctOptionContainer = correctMarker.closest(".practice-option") ?? correctMarker.parentElement!;
    expect(correctOptionContainer.textContent).toContain("Regen 1 right");
    expect(correctOptionContainer.textContent).not.toContain("Regen 1 wrong");

    const yourChoiceMarker = within(panel).getByText("(Your choice)");
    const yourChoiceOptionContainer = yourChoiceMarker.closest(".practice-option") ?? yourChoiceMarker.parentElement!;
    expect(yourChoiceOptionContainer.textContent).toContain("Regen 1 wrong");
    expect(yourChoiceOptionContainer.textContent).not.toContain("Regen 1 right");

    expect(within(panel).getByText("Regen why 1")).toBeTruthy();
    expect(within(panel).getByText("Source p. 11")).toBeTruthy();

    // Brand new regenerated items and details are absent
    expect(within(panel).queryByText("Brand new regenerated question?")).toBeNull();
    expect(within(panel).queryByText("Brand new why")).toBeNull();
    expect(within(panel).queryByText("Source p. 99")).toBeNull();
  });

  it("leaves database state, responses, and operations completely unchanged during review and makes no API/provider calls", async () => {
    await seed("m-db", "ImmutableDB");
    const { historyKey, attemptId } = await completeAttempt("m-db", [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);
    const before = await storedState();

    await renderHistory(reviewPath(historyKey, attemptId));
    await screen.findByText("Review: ImmutableDB material");

    const sessions = appCtx.repositories!.practiceSessions;
    const saveSpy = vi.spyOn(sessions, "saveSessionAction");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const panel = screen.getByRole("region", { name: "Short saved review" });
    // Start review
    fireEvent.click(within(panel).getByRole("button", { name: "Review 3 questions" }));
    // Reveal answer
    const revealBtn = within(panel).getByRole("button", { name: "Show saved answer" });
    revealBtn.focus();
    fireEvent.click(revealBtn);
    // Hide answer
    fireEvent.click(within(panel).getByRole("button", { name: "Hide saved answer" }));
    // Next
    fireEvent.click(within(panel).getByRole("button", { name: "Next" }));
    // Previous
    fireEvent.click(within(panel).getByRole("button", { name: "Previous" }));
    // Click full missed review link
    const fullLink = within(panel).getByRole("link", { name: "Review all missed questions" });
    fireEvent.click(fullLink);
    // Done for now
    fireEvent.click(within(panel).getByRole("button", { name: "Review 3 questions" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Done for now" }));

    expect(saveSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await storedState()).toEqual(before);
  });

  it("hides the panel cleanly for an all-correct attempt", async () => {
    await seed("m-perf", "PerfectTest");
    const { historyKey, attemptId } = await completeAttempt("m-perf", [
      "correct",
      "correct",
      "correct",
      "correct",
    ]);

    await renderHistory(reviewPath(historyKey, attemptId));
    await screen.findByText("Review: PerfectTest material");

    // All correct: panel is quiet and hidden
    expect(screen.queryByRole("region", { name: "Short saved review" })).toBeNull();
  });

  it("shows gentle unavailable message if loaded version mismatches the attempt (defensive transport test)", async () => {
    await seed("m-unavail", "Unavail");
    const res = await completeAttempt("m-unavail", ["incorrect", "correct", "correct", "correct"]);
    await renderHistory("/");
    const sessions = appCtx.repositories!.practiceSessions;
    const originalGetVersion = sessions.getVersion.bind(sessions);
    // Defensive test: impossible version transport response where loaded version ID does not match attempt.versionId
    vi.spyOn(sessions, "getVersion").mockImplementation(async (versionId) => {
      const v = await originalGetVersion(versionId);
      if (!v) return null;
      // Matching historyKey so AttemptReviewPage loads, but mismatched version ID
      return { ...v, id: "mismatched-version-id" };
    });

    act(() => navigateTo(reviewPath(res.historyKey, res.attemptId)));
    await screen.findByText("Review: Unavail material");

    const panel = screen.getByRole("region", { name: "Short saved review" });
    expect(
      within(panel).getByText(
        "Saved review details for missed questions are unavailable for this attempt.",
      ),
    ).toBeTruthy();
  });

  it("full missed review link uses helper path and closes local active review even when query already missed", async () => {
    await seed("m-link", "LinkTest");
    const { historyKey, attemptId } = await completeAttempt("m-link", [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);

    // Render directly on ?review=missed
    await renderHistory(reviewPath(historyKey, attemptId, "?review=missed"));
    await screen.findByText("Review: LinkTest material");

    const panel = screen.getByRole("region", { name: "Short saved review" });
    fireEvent.click(within(panel).getByRole("button", { name: "Review 3 questions" }));
    expect(within(panel).getByText("Review 1 of 3")).toBeTruthy();

    // Click "Review all missed questions"
    const fullLink = within(panel).getByRole("link", { name: "Review all missed questions" });
    fireEvent.click(fullLink);

    // Active review is closed back to teaser
    expect(within(panel).getByRole("button", { name: "Review 3 questions" })).toBeTruthy();
    expect(within(panel).queryByText("Review 1 of 3")).toBeNull();
  });

  it("resets active review and does not leak state across different completed attempts", async () => {
    await seedWithCount("m-ctx1", "CtxOne", 6);
    await seedWithCount("m-ctx2", "CtxTwo", 4);

    const att1 = await completeAttempt("m-ctx1", [
      "incorrect",
      "incorrect",
      "incorrect",
      "incorrect",
      "incorrect",
      "incorrect",
    ]);
    const att2 = await completeAttempt("m-ctx2", [
      "incorrect",
      "incorrect",
      "incorrect",
      "correct",
    ]);

    await renderHistory(reviewPath(att1.historyKey, att1.attemptId));
    await screen.findByText("Review: CtxOne material");

    const panel1 = screen.getByRole("region", { name: "Short saved review" });
    // Select Up to 5 on attempt 1
    fireEvent.click(within(panel1).getByRole("button", { name: "Up to 5" }));
    fireEvent.click(within(panel1).getByRole("button", { name: "Review 5 questions" }));
    expect(within(panel1).getByText("Review 1 of 5")).toBeTruthy();

    // Advance to question 2 and reveal
    fireEvent.click(within(panel1).getByRole("button", { name: "Next" }));
    expect(within(panel1).getByText("Review 2 of 5")).toBeTruthy();
    expect(within(panel1).getByText("CtxOne question 2?")).toBeTruthy();
    const revealBtn = within(panel1).getByRole("button", { name: "Show saved answer" });
    revealBtn.focus();
    fireEvent.click(revealBtn);
    expect(within(panel1).getByText("CtxOne why 2")).toBeTruthy();

    // Navigate to attempt 2
    act(() => navigateTo(reviewPath(att2.historyKey, att2.attemptId)));
    await screen.findByText("Review: CtxTwo material");

    const panel2 = screen.getByRole("region", { name: "Short saved review" });
    // Attempt 2 panel must be reset to teaser mode, default limit 3, no leaked active/revealed state
    expect(within(panel2).queryByText(/Review \d+ of \d+/)).toBeNull();
    expect(within(panel2).queryByText("CtxOne question 2?")).toBeNull();
    expect(within(panel2).queryByText("CtxOne why 2")).toBeNull();
    expect(within(panel2).getByRole("button", { name: "Review 3 questions" })).toBeTruthy();

    // Start review on attempt 2: starts fresh at 1 of 3, unrevealed
    fireEvent.click(within(panel2).getByRole("button", { name: "Review 3 questions" }));
    expect(within(panel2).getByText("Review 1 of 3")).toBeTruthy();
    expect(within(panel2).getByText("CtxTwo question 1?")).toBeTruthy();
    expect(within(panel2).getByRole("button", { name: "Show saved answer" })).toBeTruthy();
    expect(within(panel2).queryByText("CtxTwo why 1")).toBeNull();
  });

  it("handles missing or erased attempts gracefully and preserves frozen review after source material deletion", async () => {
    // Missing attempt
    await renderHistory("/");
    act(() => navigateTo(reviewPath("missing-key", "missing-attempt")));
    await screen.findByText("Could not load attempt review");
    expect(screen.getByText("Practice attempt not found.")).toBeTruthy();
    cleanup();

    // Erased attempt: actual real SQLite erasure through repos.practiceSessions.eraseHistory
    await seed("m-erase", "ErasedAttempt");
    const resErase = await completeAttempt("m-erase", ["incorrect", "correct", "correct", "correct"]);
    await renderHistory(reviewPath(resErase.historyKey, resErase.attemptId));
    await screen.findByText("Review: ErasedAttempt material");
    expect(screen.getByRole("region", { name: "Short saved review" })).toBeTruthy();
    expect(screen.getByText("ErasedAttempt question 1?")).toBeTruthy();

    // Navigate away / unmount
    act(() => navigateTo("/"));
    await screen.findByText("Home");
    cleanup();

    // Erase through existing SQLite repository API on fictional seeded completed attempt
    await repos.practiceSessions.eraseHistory({
      action: "erase_history",
      operationId: crypto.randomUUID(),
      historyKey: resErase.historyKey,
    });

    // Revisit exact old route: assert attempt not found and panel/question absent; real stored history not resurrected
    await renderHistory(reviewPath(resErase.historyKey, resErase.attemptId));
    await screen.findByText("Could not load attempt review");
    expect(screen.getByText("Practice attempt not found.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Short saved review" })).toBeNull();
    expect(screen.queryByText("ErasedAttempt question 1?")).toBeNull();
    cleanup();

    // Source material deleted: version and attempt remain in SQLite, review works normally
    await seed("m-del", "DeletedSource");
    const resDel = await completeAttempt("m-del", ["incorrect", "correct", "correct", "correct"]);
    await repos.documents.remove("m-del");

    await renderHistory(reviewPath(resDel.historyKey, resDel.attemptId));
    await screen.findByText("Review: DeletedSource material");
    const panelDel = screen.getByRole("region", { name: "Short saved review" });
    expect(within(panelDel).getByRole("button", { name: "Review 1 question" })).toBeTruthy();
  });

  it("guards against delimiter collision between opaque paired IDs via pre-effect layout commit check", async () => {
    // Real valid seeded attempt in SQLite
    await seed("m-col-real", "Collision");
    const real = await completeAttempt("m-col-real", ["incorrect", "correct", "correct", "correct"]);
    const realAttempt = (await repos.practiceSessions.getAttempt(real.attemptId))!;
    const realVersion = (await repos.practiceSessions.getVersion(real.versionId))!;
    const realItems = await repos.practiceSessions.getItems(real.versionId);
    const realResponses = await repos.practiceSessions.getResponses(real.attemptId);

    await renderHistory("/");
    const sessions = appCtx.repositories!.practiceSessions;

    let resolveSecondAttempt!: (val: PracticeAttempt | null) => void;
    const secondAttemptDeferred = new Promise<PracticeAttempt | null>((resolve) => {
      resolveSecondAttempt = resolve;
    });

    // Explicitly labelled opaque-ID transport stand-in over otherwise real valid seeded attempt/version/items/responses.
    // Never persist forbidden opaque IDs to SQLite.
    const detachedItems: PracticeTestItem[] = realItems.map((item) => ({
      ...item,
      versionId: "ver-col-c",
    }));
    const detachedResponses = realResponses.map((resp) => ({
      ...resp,
      attemptId: "c",
    }));

    vi.spyOn(sessions, "getAttempt").mockImplementation(async (id: string) => {
      if (id === "c") {
        return { ...realAttempt, id: "c", versionId: "ver-col-c" };
      }
      if (id === "b|c") {
        return secondAttemptDeferred;
      }
      return null;
    });

    vi.spyOn(sessions, "getVersion").mockImplementation(async (versionId: string) => {
      if (versionId === "ver-col-c") {
        return { ...realVersion, id: "ver-col-c", historyKey: "a|b" };
      }
      return null;
    });

    vi.spyOn(sessions, "getItems").mockImplementation(async (versionId: string) => {
      if (versionId === "ver-col-c") {
        return detachedItems;
      }
      return [];
    });

    vi.spyOn(sessions, "getResponses").mockImplementation(async (attemptId: string) => {
      if (attemptId === "c") {
        return detachedResponses;
      }
      return [];
    });

    // 1. Render first completed tuple (historyKey="a|b", attemptId="c")
    act(() => navigateTo(reviewPath("a|b", "c")));
    await screen.findByText("Review: Collision material");
    expect(screen.getByText("Collision question 1?")).toBeTruthy();
    const firstPanel = screen.getByRole("region", { name: "Short saved review" });
    expect(firstPanel).toBeTruthy();
    expect(within(firstPanel).getByRole("button", { name: "Review 1 question" })).toBeTruthy();
    expect(
      within(firstPanel).queryByText(
        "Saved review details for missed questions are unavailable for this attempt.",
      ),
    ).toBeNull();

    // 2. Layout observer in Probe captures DOM commit synchronously BEFORE passive useEffect runs
    let capturedOnSecondRouteCommit = false;
    let oldQuestionPresentOnSecondRouteCommit = true;
    let panelPresentOnSecondRouteCommit = true;
    onLayoutRoute = (loc) => {
      if (loc.pathname === reviewPath("a", "b|c")) {
        capturedOnSecondRouteCommit = true;
        oldQuestionPresentOnSecondRouteCommit =
          document.body.textContent?.includes("Collision question 1?") ?? false;
        panelPresentOnSecondRouteCommit =
          document.body.querySelector(".practice-mistake-followup") !== null;
      }
    };

    // 3. Navigate to second tuple (historyKey="a", attemptId="b|c") with deferred getAttempt
    act(() => navigateTo(reviewPath("a", "b|c")));

    // 4. Assert DOM state at second-route commit before passive load:
    // With JSON tuple routeKey, route 2 does not match route 1, so old question and followup panel
    // are absent during second route commit.
    // Delimiter `${historyKey}|${attemptId}` would produce identical "a|b|c" key for both tuples and fail this check.
    expect(capturedOnSecondRouteCommit).toBe(true);
    expect(oldQuestionPresentOnSecondRouteCommit).toBe(false);
    expect(panelPresentOnSecondRouteCommit).toBe(false);

    // 5. Resolve deferred second attempt as missing
    await act(async () => {
      resolveSecondAttempt(null);
      await secondAttemptDeferred;
    });
    await screen.findByText("Could not load attempt review");
  });
});
