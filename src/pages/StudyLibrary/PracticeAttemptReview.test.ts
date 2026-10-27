// @vitest-environment jsdom
/**
 * Focused review of missed or skipped questions for one completed practice
 * attempt: the completion link from the panel, the All questions / Missed or
 * skipped controls in history, frozen content and route/read races. Real
 * AppDataProvider over a disposable node:sqlite file; records are created only
 * through the existing repositories. jsdom only, not installed-app evidence.
 */
import { createElement as h, StrictMode, useEffect, useLayoutEffect, useState } from "react";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudySetSaveError } from "@/data/persistenceErrors";
import { createRepositories, type Repositories } from "@/data/repositories";
import type { StoredCard, StudySetSaveOperation } from "@/data/studySetTransaction";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { PracticeAttempt, PracticeTest, PracticeTestItem } from "@/domain/types";
import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";
import { currentTimeZone, nextLocalMidnightUtc } from "@/logic/localDay";
import { prepareStudyEdit } from "@/logic/studyAuthoring";
import { authoringStateOf, emptyManualSet, frameOf, nextSetOf } from "@/logic/studySetEditing";
import { Notes } from "@/pages/Notes/Notes";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { PracticeHistory } from "./PracticeHistory";
import { PracticeTestPanel } from "./PracticeTestPanel";
import { StudySetEditor } from "./StudySetEditor";

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
    h(Route, { path: "/notes", element: h(Notes) }),
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

describe("Safe Notes entry from mistake followup panel (MISTAKES-01c)", () => {
  let initialDraft: unknown = null;

  beforeEach(() => {
    initialDraft = readDraft("notes.new");
    clearDraft("notes.new");
  });

  afterEach(() => {
    if (initialDraft !== null) {
      writeDraft("notes.new", initialDraft);
    } else {
      clearDraft("notes.new");
    }
  });

  it("omits Write a note link before opt-in and before reveal, displays it after reveal with exact /notes href and copy, and opens fresh blank composer on click with practice history untouched", async () => {
    await seed("m-notes-entry", "NotesEntry");
    // Q1 incorrect, Q2 correct, Q3 don't know, Q4 unanswered
    const { historyKey, attemptId } = await completeAttempt("m-notes-entry", [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);
    const beforeState = await storedState();

    await renderHistory(reviewPath(historyKey, attemptId));
    await screen.findByText("Review: NotesEntry material");

    const panel = screen.getByRole("region", { name: "Short saved review" });

    // 1. Link is absent before opt-in
    expect(within(panel).queryByRole("link", { name: "Write a note" })).toBeNull();
    expect(within(panel).queryByText(/Write what confused you/)).toBeNull();

    // 2. Opt-in: link is still absent before deliberate reveal
    fireEvent.click(within(panel).getByRole("button", { name: "Review 3 questions" }));
    expect(within(panel).queryByRole("link", { name: "Write a note" })).toBeNull();
    expect(within(panel).queryByText(/Write what confused you/)).toBeNull();

    // 3. Reveal saved answer: link appears in revealed-details only
    const revealBtn = within(panel).getByRole("button", { name: "Show saved answer" });
    fireEvent.click(revealBtn);

    const notesLink = within(panel).getByRole("link", { name: "Write a note" });
    expect(notesLink).toBeTruthy();
    expect(notesLink.getAttribute("href")).toBe("/notes");
    expect(
      within(panel).getByText(
        "Write what confused you in your own words. Notes stay separate from practice history.",
      ),
    ).toBeTruthy();

    // 4. Clicking opens actual composer route, no note created, no private content copied
    type RouteSnapshot = { search: string; state: unknown };
    let capturedNotesRoute: RouteSnapshot | null = null;
    onLayoutRoute = (loc) => {
      if (loc.pathname === "/notes") {
        capturedNotesRoute = { search: loc.search, state: loc.state };
      }
    };

    fireEvent.click(notesLink);
    expect(capturedNotesRoute).toEqual({ search: "", state: null });
    await screen.findByRole("heading", { name: "Write something down" });
    expect(screen.getByRole("heading", { name: "Notes" })).toBeTruthy();

    // No notes created in SQLite or React state
    expect(await testDb.select("SELECT * FROM notes")).toHaveLength(0);
    expect(appCtx.data.notes).toHaveLength(0);

    // Fresh composer is blank: no frozen question, explanation, answers, or IDs copied
    const titleInput = screen.getByLabelText("Title (optional)") as HTMLInputElement;
    const bodyInput = screen.getByLabelText("Note") as HTMLTextAreaElement;
    expect(titleInput.value).toBe("");
    expect(bodyInput.value).toBe("");

    // All 6 practice tables/receipts completely unchanged
    expect(await storedState()).toEqual(beforeState);

    // 5. Explicitly typing and saving creates exact ordinary Note from user text only
    fireEvent.change(titleInput, { target: { value: "My own question reflection" } });
    fireEvent.change(bodyInput, {
      target: { value: "Check private pilot oral exam guide on right-of-way rules." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    await screen.findByText("My own question reflection");
    const savedNotes = await testDb.select<{ id: string; title: string; body: string }>(
      "SELECT id, title, body FROM notes",
    );
    expect(savedNotes).toHaveLength(1);
    const savedNote = savedNotes[0];
    if (!savedNote) throw new Error("Expected saved note");
    expect(savedNote.title).toBe("My own question reflection");
    expect(savedNote.body).toBe(
      "Check private pilot oral exam guide on right-of-way rules.",
    );
    // Verified: no leaked frozen question/answer/explanation or attempt IDs
    expect(savedNote.title).not.toContain("NotesEntry");
    expect(savedNote.title).not.toContain(attemptId);
    expect(savedNote.body).not.toContain("NotesEntry");
    expect(savedNote.body).not.toContain("why");
    expect(savedNote.body).not.toContain(attemptId);
    expect(savedNote.body).not.toContain(historyKey);

    // Practice history and operations remain unchanged after Note creation
    expect(await storedState()).toEqual(beforeState);
  });

  it("preserves unsaved Notes draft through navigation to history, opt-in, reveal, and link re-entry", async () => {
    // 1. Visit Notes first and type unsaved title/body through real inputs / useDraftRecovery
    await renderHistory("/notes");
    await screen.findByRole("heading", { name: "Write something down" });

    const titleInput = screen.getByLabelText("Title (optional)");
    const bodyInput = screen.getByLabelText("Note");
    fireEvent.change(titleInput, { target: { value: "Pre-existing draft title" } });
    fireEvent.change(bodyInput, {
      target: { value: "Pre-existing draft body typed before visiting practice." },
    });

    expect(readDraft("notes.new")).toEqual({
      title: "Pre-existing draft title",
      body: "Pre-existing draft body typed before visiting practice.",
    });
    expect(await testDb.select("SELECT * FROM notes")).toHaveLength(0);

    // 2. Seed and complete attempt, then navigate to practice history review
    await seed("m-draft-pres", "DraftPreserve");
    const { historyKey, attemptId } = await completeAttempt("m-draft-pres", [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);
    const practiceBefore = await storedState();

    act(() => navigateTo(reviewPath(historyKey, attemptId)));
    await screen.findByText("Review: DraftPreserve material");

    // 3. Opt-in and deliberate reveal in the followup panel
    const panel = screen.getByRole("region", { name: "Short saved review" });
    fireEvent.click(within(panel).getByRole("button", { name: "Review 3 questions" }));
    const revealBtn = within(panel).getByRole("button", { name: "Show saved answer" });
    fireEvent.click(revealBtn);

    const notesLink = within(panel).getByRole("link", { name: "Write a note" });
    expect(notesLink.getAttribute("href")).toBe("/notes");

    // 4. Click link back to Notes: recovered draft intact with status banner
    fireEvent.click(notesLink);
    await screen.findByRole("heading", { name: "Write something down" });
    await screen.findByRole("status");
    expect(
      screen.getByText(
        "Picked up where you left off — this is what you had typed but not saved.",
      ),
    ).toBeTruthy();

    const restoredTitle = screen.getByLabelText("Title (optional)") as HTMLInputElement;
    const restoredBody = screen.getByLabelText("Note") as HTMLTextAreaElement;
    expect(restoredTitle.value).toBe("Pre-existing draft title");
    expect(restoredBody.value).toBe(
      "Pre-existing draft body typed before visiting practice.",
    );

    // Note count remains unchanged until save
    expect(await testDb.select("SELECT * FROM notes")).toHaveLength(0);

    // 5. Saving recovered draft persists it and clears the draft
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await screen.findByText("Pre-existing draft title");

    const notesInDb = await testDb.select<{ id: string; title: string; body: string }>(
      "SELECT id, title, body FROM notes",
    );
    expect(notesInDb).toHaveLength(1);
    const firstNoteInDb = notesInDb[0];
    if (!firstNoteInDb) throw new Error("Expected note in db");
    expect(firstNoteInDb.title).toBe("Pre-existing draft title");
    expect(firstNoteInDb.body).toBe(
      "Pre-existing draft body typed before visiting practice.",
    );

    expect(readDraft("notes.new")).toBeNull();
    expect(await storedState()).toEqual(practiceBefore);
  });
});

describe("Safe Make a card entry from mistake followup panel (MISTAKES-01d)", () => {
  async function seedStudySet(
    materialId: string,
    title: string,
    existingCards: Array<{ front: string; back: string; sourcePage?: number | null }>,
  ) {
    const { frame, state } = emptyManualSet(title);
    let curState = state;
    for (const card of existingCards) {
      const editRes = await prepareStudyEdit(curState, {
        kind: "add",
        item: { kind: "card", fields: [card.front, card.back], sourcePage: card.sourcePage ?? null },
        origin: "user",
      });
      curState = editRes.next;
    }
    const op: StudySetSaveOperation = {
      operationId: crypto.randomUUID(),
      materialId,
      reason: "create",
      expected: null,
      next: nextSetOf(frame, curState),
    };
    await repos.documents.saveStudySet(op);
  }

  it("hides Make a card button until reveal, disables it with plain explanation when material is missing or no study set exists, and supports flashcards-only sets", async () => {
    // 1. Material exists, but NO saved study set exists yet
    await seed("m-card-none", "NoSet");
    const attNoSet = await completeAttempt("m-card-none", [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);

    await renderHistory(reviewPath(attNoSet.historyKey, attNoSet.attemptId));
    await screen.findByText("Review: NoSet material");

    const panel = screen.getByRole("region", { name: "Short saved review" });

    // Action is hidden before opt-in and before reveal
    expect(within(panel).queryByRole("button", { name: "Make a card" })).toBeNull();
    expect(within(panel).queryByText(/Make a study guide for this material first/)).toBeNull();

    // Opt-in
    fireEvent.click(within(panel).getByRole("button", { name: "Review 3 questions" }));
    expect(within(panel).queryByRole("button", { name: "Make a card" })).toBeNull();
    expect(within(panel).queryByText(/Make a study guide for this material first/)).toBeNull();

    // Reveal saved answer
    const revealBtn = within(panel).getByRole("button", { name: "Show saved answer" });
    fireEvent.click(revealBtn);

    // Make a card button is present and disabled with plain explanation; Notes link remains available
    const makeCardBtn = within(panel).getByRole("button", { name: "Make a card" });
    expect(makeCardBtn.hasAttribute("disabled")).toBe(true);
    expect(
      within(panel).getByText("Make a study guide for this material first, then you can add cards here."),
    ).toBeTruthy();
    const notesLink = within(panel).getByRole("link", { name: "Write a note" });
    expect(notesLink.getAttribute("href")).toBe("/notes");
    expect(notesLink.hasAttribute("disabled")).toBe(false);

    // Verify keyboard / DOM order: Write a note Link comes before Make a card Button
    expect(
      Boolean(notesLink.compareDocumentPosition(makeCardBtn) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    cleanup();

    // 2. Material is deleted: Make a card is disabled with deleted explanation; Notes remains available
    await seed("m-card-del", "DelMat");
    const attDel = await completeAttempt("m-card-del", [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);
    await repos.documents.remove("m-card-del");

    await renderHistory(reviewPath(attDel.historyKey, attDel.attemptId));
    await screen.findByText("Review: DelMat material");

    const panelDel = screen.getByRole("region", { name: "Short saved review" });
    fireEvent.click(within(panelDel).getByRole("button", { name: "Review 3 questions" }));
    fireEvent.click(within(panelDel).getByRole("button", { name: "Show saved answer" }));

    const makeCardDelBtn = within(panelDel).getByRole("button", { name: "Make a card" });
    expect(makeCardDelBtn.hasAttribute("disabled")).toBe(true);
    expect(
      within(panelDel).getByText("This material was removed, so cards can’t be added here."),
    ).toBeTruthy();
    expect(within(panelDel).getByRole("link", { name: "Write a note" })).toBeTruthy();
    cleanup();

    // 3. Existing flashcards-only study set exists: Make a card is enabled
    await seed("m-card-flash", "FlashSet");
    await seedStudySet("m-card-flash", "FlashSet material", [
      { front: "Existing card front", back: "Existing card back" },
    ]);
    const attFlash = await completeAttempt("m-card-flash", [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);

    await renderHistory(reviewPath(attFlash.historyKey, attFlash.attemptId));
    await screen.findByText("Review: FlashSet material");

    const panelFlash = screen.getByRole("region", { name: "Short saved review" });
    fireEvent.click(within(panelFlash).getByRole("button", { name: "Review 3 questions" }));
    fireEvent.click(within(panelFlash).getByRole("button", { name: "Show saved answer" }));

    const makeCardFlashBtn = within(panelFlash).getByRole("button", { name: "Make a card" });
    expect(makeCardFlashBtn.hasAttribute("disabled")).toBe(false);
    expect(within(panelFlash).queryByText(/Make a study guide for this material first/)).toBeNull();
    expect(within(panelFlash).queryByText(/This material was removed/)).toBeNull();
  });

  it("opens compact add-card dialog with blank fields, no copied attempt content, explicit material title context, and saves exactly one user card with new identity and null source page", async () => {
    await seed("m-card-save", "Airfoil");
    await seedStudySet("m-card-save", "Airfoil material", [
      { front: "Camber line", back: "Mean line between upper and lower surfaces", sourcePage: 12 },
    ]);
    const { historyKey, attemptId } = await completeAttempt("m-card-save", [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);

    // Regenerate current PRACTICE before opening old completed attempt
    await repos.documents.savePracticeTest({
      provider: "gemini",
      sourceMaterialId: "m-card-save",
      title: "Airfoil replacement",
      model: "synthetic",
      questions: [
        {
          question: "Regenerated question?",
          options: ["Regen right", "Regen wrong"],
          correctIndex: 0,
          explanation: "Regen why",
          sourcePage: 99,
        },
      ],
    });

    // Capture 6 practice-table baseline AFTER regeneration
    const practiceBaselineAfterRegen = await storedState();

    // Capture complete study_set_history baseline after regeneration BEFORE UI save
    type StudyHistoryRow = {
      id: string;
      material_id: string;
      kind: string;
      reason: string;
      previous_json: string;
      provider: string;
      created_at: string;
    };
    const historyBaseline = await testDb.select<StudyHistoryRow>(
      "SELECT id, material_id, kind, reason, previous_json, provider, created_at FROM study_set_history WHERE material_id = 'm-card-save' ORDER BY created_at ASC, id ASC",
    );

    // Capture old cards array before write
    const setBefore = (await testDb.select<{ flashcards_json: string }>(
      "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = 'm-card-save'",
    ))[0];
    if (!setBefore) throw new Error("Expected set before write");
    const oldCardsBefore: StoredCard[] = JSON.parse(setBefore.flashcards_json);

    await renderHistory(reviewPath(historyKey, attemptId));
    await screen.findByText("Review: Airfoil material");

    // Assert old frozen question stays while replacement question is not shown
    expect(screen.queryByText("Regenerated question?")).toBeNull();

    // Spy on saveStudySet calling through to real repo, capturing actual committed operationId
    const docsRepo = appCtx.repositories!.documents;
    const realSaveStudySet = docsRepo.saveStudySet.bind(docsRepo);
    let committedOperationId: string | null = null;
    vi.spyOn(docsRepo, "saveStudySet").mockImplementation(async (op) => {
      committedOperationId = op.operationId;
      return realSaveStudySet(op);
    });

    const panel = screen.getByRole("region", { name: "Short saved review" });
    fireEvent.click(within(panel).getByRole("button", { name: "Review 3 questions" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Show saved answer" }));

    // Click Make a card
    const makeCardBtn = within(panel).getByRole("button", { name: "Make a card" });
    fireEvent.click(makeCardBtn);

    // Dialog opens with title "Add a card" and explicit material title description
    await screen.findByRole("heading", { name: "Add a card" });
    expect(screen.getByText("Airfoil material")).toBeTruthy();
    expect(
      screen.getByText(
        "Adding a card starts fresh reviews for this set. Earlier reviews stay saved with the previous version.",
      ),
    ).toBeTruthy();

    // Compact mode: no instructor attribution checkbox, no summary/section/delete/history tools
    expect(screen.queryByText("This came from my instructor")).toBeNull();
    expect(screen.queryByText("Previous versions")).toBeNull();
    expect(screen.queryByText("Add a section")).toBeNull();

    // Await actual Question field after opening (not heading only while opening read is pending)
    const questionInput = (await screen.findByLabelText("Question")) as HTMLTextAreaElement;
    const answerInput = screen.getByLabelText("Answer") as HTMLTextAreaElement;
    const pageInput = screen.getByLabelText("Source page (optional)") as HTMLInputElement;
    expect(questionInput.value).toBe("");
    expect(answerInput.value).toBe("");
    expect(pageInput.value).toBe("");
    expect(questionInput.value).not.toContain("Airfoil question");
    expect(answerInput.value).not.toContain("Airfoil why");
    expect(questionInput.value).not.toContain(attemptId);

    // Type own words and leave optional page blank
    const typedQuestion = "Angle of attack definition";
    const typedAnswer = "Acute angle between chord line and relative wind.";
    fireEvent.change(questionInput, { target: { value: typedQuestion } });
    fireEvent.change(answerInput, {
      target: { value: typedAnswer },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Dialog closes and unmounts on success
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add a card" })).toBeNull());
    expect(committedOperationId).toBeTruthy();
    expect(document.activeElement).toBe(makeCardBtn);

    // Ordinary data refresh does not steal focus
    makeCardBtn.blur();
    expect(document.activeElement).not.toBe(makeCardBtn);
    await act(async () => {
      await appCtx.mutate(async () => ({ ok: true as const }));
    });
    expect(document.activeElement).not.toBe(makeCardBtn);

    // Verify SQLite: exactly ONE card appended, old cards unchanged, null source page, user origin, no PDF provenance
    const studySets = await testDb.select<{ flashcards_json: string }>(
      "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = 'm-card-save'",
    );
    expect(studySets).toHaveLength(1);
    const studySetRow = studySets[0];
    if (!studySetRow) throw new Error("Expected study set");
    const flashcards: StoredCard[] = JSON.parse(studySetRow.flashcards_json);
    expect(flashcards).toHaveLength(oldCardsBefore.length + 1);

    // Deep compare old cards after to before
    expect(flashcards.slice(0, oldCardsBefore.length)).toEqual(oldCardsBefore);

    const newCard = flashcards[flashcards.length - 1];
    if (!newCard) throw new Error("Expected new card");
    expect(newCard.front).toBe(typedQuestion);
    expect(newCard.back).toBe(typedAnswer);
    expect(newCard.sourcePage).toBeNull();
    expect(newCard.origin).toBe("user");
    expect(newCard).not.toHaveProperty("pdfProvenance");
    expect(typeof newCard.itemId).toBe("string");
    expect(newCard.itemId).toBeTruthy();
    const oldItemIds = oldCardsBefore.map((c) => c.itemId).filter(Boolean);
    expect(oldItemIds).not.toContain(newCard.itemId);

    // Verify study_set_history captured edit operation receipt
    const postHistory = await testDb.select<StudyHistoryRow>(
      "SELECT id, material_id, kind, reason, previous_json, provider, created_at FROM study_set_history WHERE material_id = 'm-card-save' ORDER BY created_at ASC, id ASC",
    );
    const baselineIds = new Set(historyBaseline.map((r) => r.id));
    const addedHistory = postHistory.filter((r) => !baselineIds.has(r.id));
    expect(addedHistory).toHaveLength(1);
    const newHistoryRow = addedHistory[0]!;
    expect(newHistoryRow.id).toBe(committedOperationId);
    expect(newHistoryRow.kind).toBe("study_set");
    expect(newHistoryRow.reason).toBe("edit");
    const previousState = JSON.parse(newHistoryRow.previous_json ?? "{}");
    expect(JSON.parse(previousState.flashcards_json)).toEqual(oldCardsBefore);

    // Baseline rows must remain deep-unchanged in posthistory, including practice-kind rows
    const postBaselineRows = postHistory.filter((r) => baselineIds.has(r.id));
    expect(postBaselineRows).toEqual(historyBaseline);
    expect(historyBaseline.some((r) => r.kind === "practice")).toBe(true);

    // All 6 frozen practice tables and receipts are 100% unchanged (explicit new card save affects only current AiStudySet)
    expect(await storedState()).toEqual(practiceBaselineAfterRegen);

    // Frozen practice review score and review entries on page remain unchanged
    expect(screen.getByText("Review: Airfoil material")).toBeTruthy();
    expect(within(panel).getByText("Review 1 of 3")).toBeTruthy();
  });

  it("retains typed fields and same operation on IPC_TRANSPORT_ERROR lost-ack retry, appending exactly one card and receipt", async () => {
    await seed("m-card-retry", "LostAck");
    await seedStudySet("m-card-retry", "LostAck material", [
      { front: "Existing Q", back: "Existing A" },
    ]);
    const { historyKey, attemptId } = await completeAttempt("m-card-retry", [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);
    const practiceBefore = await storedState();

    await renderHistory(reviewPath(historyKey, attemptId));
    await screen.findByText("Review: LostAck material");

    const panel = screen.getByRole("region", { name: "Short saved review" });
    fireEvent.click(within(panel).getByRole("button", { name: "Review 3 questions" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Show saved answer" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Make a card" }));

    await screen.findByRole("heading", { name: "Add a card" });

    // Type fields
    const questionInput = (await screen.findByLabelText("Question")) as HTMLTextAreaElement;
    const answerInput = screen.getByLabelText("Answer") as HTMLTextAreaElement;
    fireEvent.change(questionInput, { target: { value: "Retry front" } });
    fireEvent.change(answerInput, { target: { value: "Retry back" } });

    // Intercept documents.saveStudySet to simulate applied write + lost ack transport error
    const documents = appCtx.repositories!.documents;
    const originalSave = documents.saveStudySet.bind(documents);
    let callCount = 0;
    let firstOpId: string | null = null;
    let secondOpId: string | null = null;

    vi.spyOn(documents, "saveStudySet").mockImplementation(async (op) => {
      callCount++;
      if (callCount === 1) {
        firstOpId = op.operationId;
        // Real write succeeds in SQLite
        await originalSave(op);
        // Lost ack throws typed IPC_TRANSPORT_ERROR
        throw new StudySetSaveError("IPC_TRANSPORT_ERROR");
      }
      secondOpId = op.operationId;
      return originalSave(op);
    });

    // First save click
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Error is displayed; dialog remains open and typed draft stays intact
    await screen.findByText(
      "The app couldn't confirm whether this study set was saved. Try again; a retry is safe.",
    );
    expect(screen.getByRole("heading", { name: "Add a card" })).toBeTruthy();
    expect((screen.getByLabelText("Question") as HTMLTextAreaElement).value).toBe("Retry front");
    expect((screen.getByLabelText("Answer") as HTMLTextAreaElement).value).toBe("Retry back");

    // Click Save again (retry)
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Retry succeeds: dialog closes
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add a card" })).toBeNull());

    // Both calls used the EXACT same operation ID
    expect(callCount).toBe(2);
    expect(firstOpId).toBeTruthy();
    expect(secondOpId).toBe(firstOpId);

    // Database check: exactly ONE new card was appended (total 2 cards, not 3)
    const setRows = await testDb.select<{ flashcards_json: string }>(
      "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = 'm-card-retry'",
    );
    const setRow = setRows[0];
    if (!setRow) throw new Error("Expected set row");
    const cards = JSON.parse(setRow.flashcards_json);
    expect(cards).toHaveLength(2);
    expect(cards[1]?.front).toBe("Retry front");
    expect(cards[1]?.back).toBe("Retry back");

    // History has initial create with NO prior row; one append creates ONE edit row, not 2
    const history = await testDb.select<{ id: string; reason: string; previous_json: string }>(
      "SELECT id, reason, previous_json FROM study_set_history WHERE material_id = 'm-card-retry'",
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe(firstOpId);
    expect(history[0]?.reason).toBe("edit");
    const prevHistory = JSON.parse(history[0]?.previous_json ?? "{}");
    const prevCards = JSON.parse(prevHistory.flashcards_json);
    expect(prevCards).toHaveLength(1);
    expect(prevCards[0]?.front).toBe("Existing Q");
    expect(prevCards[0]?.back).toBe("Existing A");

    expect(await storedState()).toEqual(practiceBefore);
  });

  it("guards busy duplicate click, handles normal Cancel and Escape with focus restoration, and refuses stale currentset", async () => {
    await seed("m-card-guards", "Guards");
    await seedStudySet("m-card-guards", "Guards material", [
      { front: "Guard Q", back: "Guard A" },
    ]);
    const { historyKey, attemptId } = await completeAttempt("m-card-guards", [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);

    await renderHistory(reviewPath(historyKey, attemptId));
    await screen.findByText("Review: Guards material");

    const panel = screen.getByRole("region", { name: "Short saved review" });
    fireEvent.click(within(panel).getByRole("button", { name: "Review 3 questions" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Show saved answer" }));

    const makeCardBtn = within(panel).getByRole("button", { name: "Make a card" });

    // Focus Cancel test
    makeCardBtn.focus();
    expect(document.activeElement).toBe(makeCardBtn);
    fireEvent.click(makeCardBtn);
    await screen.findByRole("heading", { name: "Add a card" });
    await screen.findByLabelText("Question");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add a card" })).toBeNull());
    expect(document.activeElement).toBe(makeCardBtn);

    // Escape test (native showModal cancels via dialog cancel event; jsdom does not translate fireEvent.keyDown(document, Escape) to cancel, so dispatch cancel on actual dialog in unit as native transport stand-in)
    fireEvent.click(makeCardBtn);
    await screen.findByRole("heading", { name: "Add a card" });
    const questionInputEl = (await screen.findByLabelText("Question")) as HTMLTextAreaElement;
    questionInputEl.focus();
    expect(document.activeElement).toBe(questionInputEl);
    const dialogEl = document.querySelector("dialog");
    if (!dialogEl) throw new Error("Expected dialog element");
    fireEvent(dialogEl, new Event("cancel", { bubbles: true, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add a card" })).toBeNull());
    expect(document.activeElement).toBe(makeCardBtn);

    // Busy duplicate click guard
    fireEvent.click(makeCardBtn);
    await screen.findByRole("heading", { name: "Add a card" });
    const busyQ = (await screen.findByLabelText("Question")) as HTMLTextAreaElement;
    const busyA = screen.getByLabelText("Answer") as HTMLTextAreaElement;
    fireEvent.change(busyQ, { target: { value: "Busy Q" } });
    fireEvent.change(busyA, { target: { value: "Busy A" } });

    let releaseSave!: () => void;
    const saveHeld = new Promise<void>((r) => (releaseSave = r));
    const documents = appCtx.repositories!.documents;
    const originalSave = documents.saveStudySet.bind(documents);
    const saveSpy = vi.spyOn(documents, "saveStudySet").mockImplementation(async (op) => {
      await saveHeld;
      return originalSave(op);
    });

    const saveBtn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveBtn);

    // Save button changes to "Saving…" and is disabled
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true),
    );

    // Duplicate click while busy is ignored
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));

    await act(async () => {
      releaseSave();
      await saveHeld;
    });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add a card" })).toBeNull());
    expect(saveSpy).toHaveBeenCalledTimes(1);

    // Stale currentset refusal: valid external CONTENT change through actual
    // readStudySetForEdit + prepareStudyEdit / nextSetOf + saveStudySet, without AppData refresh before trigger
    const editRead = await repos.documents.readStudySetForEdit("m-card-guards");
    if (!editRead) throw new Error("Expected edit read");
    const editPlan = await prepareStudyEdit(authoringStateOf(editRead.set), {
      kind: "add",
      item: { kind: "card", fields: ["External Q", "External A"], sourcePage: null },
      origin: "user",
    });
    const externalOp: StudySetSaveOperation = {
      operationId: crypto.randomUUID(),
      materialId: "m-card-guards",
      reason: "edit",
      expected: editRead.stored,
      next: nextSetOf(frameOf(editRead.set), editPlan.next),
    };
    await repos.documents.saveStudySet(externalOp);

    fireEvent.click(makeCardBtn);
    await screen.findByRole("heading", { name: "Add a card" });
    await screen.findByText(
      "This study set changed since this page was shown. Close this and look at it again.",
    );
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add a card" })).toBeNull());
  });

  it("guards against context change and late old read with no ghost dialog or false write", async () => {
    await seed("m-late-a", "LateAlpha");
    await seedStudySet("m-late-a", "LateAlpha material", [{ front: "A1", back: "B1" }]);
    await seed("m-late-b", "LateBravo");
    await seedStudySet("m-late-b", "LateBravo material", [{ front: "A2", back: "B2" }]);

    const attA = await completeAttempt("m-late-a", [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);
    const attB = await completeAttempt("m-late-b", [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);

    await renderHistory(reviewPath(attA.historyKey, attA.attemptId));
    await screen.findByText("Review: LateAlpha material");

    // Hold readStudySetForEdit on material A
    let releaseReadA!: () => void;
    const readAHeld = new Promise<void>((r) => (releaseReadA = r));
    const documents = appCtx.repositories!.documents;
    const originalRead = documents.readStudySetForEdit.bind(documents);

    vi.spyOn(documents, "readStudySetForEdit").mockImplementation(async (id) => {
      if (id === "m-late-a") {
        await readAHeld;
      }
      return originalRead(id);
    });

    const panelA = screen.getByRole("region", { name: "Short saved review" });
    fireEvent.click(within(panelA).getByRole("button", { name: "Review 3 questions" }));
    fireEvent.click(within(panelA).getByRole("button", { name: "Show saved answer" }));

    // Click Make a card while read is held
    const makeCardBtnA = within(panelA).getByRole("button", { name: "Make a card" });
    makeCardBtnA.focus();
    expect(document.activeElement).toBe(makeCardBtnA);
    fireEvent.click(makeCardBtnA);

    // Navigate to attempt B before read A completes
    act(() => navigateTo(reviewPath(attB.historyKey, attB.attemptId)));
    await screen.findByText("Review: LateBravo material");

    // Now release read A
    await act(async () => {
      releaseReadA();
      await readAHeld;
    });

    // No ghost dialog opened on attempt B
    expect(screen.queryByRole("heading", { name: "Add a card" })).toBeNull();
    // Context change does not steal focus back to unmounted attempt A opener
    expect(document.activeElement).not.toBe(makeCardBtnA);

    // No cards written to either material
    const rowsA = await testDb.select<{ flashcards_json: string }>(
      "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = 'm-late-a'",
    );
    const rowA = rowsA[0];
    if (!rowA) throw new Error("Expected set A");
    expect(JSON.parse(rowA.flashcards_json)).toHaveLength(1);

    const rowsB = await testDb.select<{ flashcards_json: string }>(
      "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = 'm-late-b'",
    );
    const rowB = rowsB[0];
    if (!rowB) throw new Error("Expected set B");
    expect(JSON.parse(rowB.flashcards_json)).toHaveLength(1);
  });

  it("mounts compact subtree in StrictMode under ready AppDataProvider with one read per mounted intent, and typing or ordinary refresh does not reopen or reset draft", async () => {
    await seed("m-card-strict", "StrictMat");
    await seedStudySet("m-card-strict", "StrictMat material", [
      { front: "Strict Q1", back: "Strict A1" },
    ]);

    let readSpy: ReturnType<typeof vi.spyOn> | null = null;
    function StrictCompactHarness({ materialId }: { materialId: string }) {
      const { status, repositories, data, mutate } = useAppData();
      const [mountedIntent, setMountedIntent] = useState(false);

      useEffect(() => {
        if (status === "ready" && repositories && !mountedIntent) {
          if (!readSpy) {
            readSpy = vi.spyOn(repositories.documents, "readStudySetForEdit");
          }
          setMountedIntent(true);
        }
      }, [status, repositories, mountedIntent]);

      if (status !== "ready" || !mountedIntent) return null;

      const material = data.materials.find((m) => m.id === materialId) ?? null;
      const studySet = data.aiStudySets.find((s) => s.sourceMaterialId === materialId) ?? null;
      if (!material || !studySet) return null;

      return h(
        "div",
        null,
        h(
          "button",
          {
            type: "button",
            onClick: () => void mutate(async () => ({ ok: true as const })),
          },
          "Trigger refresh",
        ),
        h(
          StrictMode,
          null,
          h(StudySetEditor, {
            material,
            studySet,
            compact: true,
          }),
        ),
      );
    }

    render(h(AppDataProvider, null, h(StrictCompactHarness, { materialId: "m-card-strict" })));

    // Await ready and compact editor to open
    const questionInput = (await screen.findByLabelText("Question")) as HTMLTextAreaElement;
    const answerInput = screen.getByLabelText("Answer") as HTMLTextAreaElement;

    // In StrictMode development/test, effect replay occurs, but autoOpenedRef ensures exactly ONE read/open
    expect(readSpy).toBeTruthy();
    expect(readSpy).toHaveBeenCalledTimes(1);

    // Type into draft fields
    fireEvent.change(questionInput, { target: { value: "Draft strict Q" } });
    fireEvent.change(answerInput, { target: { value: "Draft strict A" } });
    answerInput.focus();
    expect(document.activeElement).toBe(answerInput);

    // Trigger ordinary AppData refresh
    fireEvent.click(screen.getByRole("button", { name: "Trigger refresh" }));

    // Wait for refresh to settle in AppDataProvider
    await waitFor(() => {
      expect((screen.getByLabelText("Question") as HTMLTextAreaElement).value).toBe("Draft strict Q");
    });

    // Ensure typing / ordinary data refresh does not reopen, reset draft, or steal focus
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Question") as HTMLTextAreaElement).value).toBe("Draft strict Q");
    expect((screen.getByLabelText("Answer") as HTMLTextAreaElement).value).toBe("Draft strict A");
    expect(document.activeElement).toBe(answerInput);
  });

  it("contracts approved C-D3 versioning: rating 2 cards Easy, then adding 1 card via revealed compact UI creates fresh version with 3 new in due queue, 0 rated in current snapshot, and preserves old raw reviews and 6 practice tables deep-unchanged", async () => {
    const matId = "m-card-cd3";
    await seed(matId, "CD3Mat");
    await seedStudySet(matId, "CD3Mat material", [
      { front: "Card 1 Q", back: "Card 1 A" },
      { front: "Card 2 Q", back: "Card 2 A" },
    ]);

    // Rate both existing cards Easy via real repos.cardReviews.getCardReviewSnapshot + saveAction
    const initialSnap = await repos.cardReviews.getCardReviewSnapshot(matId);
    if (initialSnap.current.status !== "ok") throw new Error("Expected ok snapshot");
    expect(initialSnap.current.items).toHaveLength(2);
    const oldVersionId = initialSnap.current.versionId;
    const oldContentHash = initialSnap.current.contentHash;
    const oldItemIds = initialSnap.current.items.map((i) => i.itemId);

    for (const item of initialSnap.current.items) {
      const snap = await repos.cardReviews.getCardReviewSnapshot(matId);
      const rev = snap.states[item.itemId]?.revision ?? 0;
      await repos.cardReviews.saveAction({
        action: "rate",
        operationId: crypto.randomUUID(),
        materialId: matId,
        versionContentHash: snap.current.status === "ok" ? snap.current.contentHash : "",
        itemId: item.itemId,
        expectedGeneration: snap.generation,
        expectedRevision: rev,
        rating: "easy",
      });
    }

    // Verify both are rated in snapshot before adding new card
    const ratedSnap = await repos.cardReviews.getCardReviewSnapshot(matId);
    if (ratedSnap.current.status !== "ok") throw new Error("Expected ok rated snapshot");
    expect(Object.keys(ratedSnap.states)).toHaveLength(2);
    expect(ratedSnap.states[oldItemIds[0]!]?.lastReviewedAt).toBeTruthy();
    expect(ratedSnap.states[oldItemIds[1]!]?.lastReviewedAt).toBeTruthy();

    // Capture OLD raw card review tables before opening old completed review
    const oldRawStates = await testDb.select("SELECT * FROM card_review_state ORDER BY item_id");
    const oldRawEvents = await testDb.select("SELECT * FROM card_review_events ORDER BY id");
    const oldRawOperations = await testDb.select("SELECT * FROM card_review_operations ORDER BY operation_id");
    expect(oldRawStates).toHaveLength(2);
    expect(oldRawEvents).toHaveLength(2);
    expect(oldRawOperations).toHaveLength(2);

    // Complete attempt and capture 6 practice baseline before opening old completed review
    const { historyKey, attemptId } = await completeAttempt(matId, [
      "incorrect",
      "correct",
      "dont_know",
      "skip",
    ]);
    const practiceBaseline = await storedState();

    // Open old completed review
    await renderHistory(reviewPath(historyKey, attemptId));
    await screen.findByText("Review: CD3Mat material");

    // Open revealed Make card
    const panel = screen.getByRole("region", { name: "Short saved review" });
    fireEvent.click(within(panel).getByRole("button", { name: "Review 3 questions" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Show saved answer" }));
    const makeCardBtn = within(panel).getByRole("button", { name: "Make a card" });
    fireEvent.click(makeCardBtn);

    // Assert disclosure BEFORE typing/Save
    await screen.findByRole("heading", { name: "Add a card" });
    const disclosure = screen.getByText(
      "Adding a card starts fresh reviews for this set. Earlier reviews stay saved with the previous version.",
    );
    expect(disclosure).toBeTruthy();

    // Blank fields
    const questionInput = (await screen.findByLabelText("Question")) as HTMLTextAreaElement;
    const answerInput = screen.getByLabelText("Answer") as HTMLTextAreaElement;
    const pageInput = screen.getByLabelText("Source page (optional)") as HTMLInputElement;
    expect(questionInput.value).toBe("");
    expect(answerInput.value).toBe("");
    expect(pageInput.value).toBe("");

    // Type 1 new own-word card / noPage
    fireEvent.change(questionInput, { target: { value: "New own-word card 3 Q" } });
    fireEvent.change(answerInput, { target: { value: "New own-word card 3 A" } });
    expect(pageInput.value).toBe("");

    // Explicit Save
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add a card" })).toBeNull());

    // Actual current version hash / IDs changed
    const currentSnap = await repos.cardReviews.getCardReviewSnapshot(matId);
    if (currentSnap.current.status !== "ok") throw new Error("Expected ok current snapshot");
    expect(currentSnap.current.contentHash).not.toBe(oldContentHash);
    expect(currentSnap.current.versionId).not.toBe(oldVersionId);
    expect(currentSnap.current.items).toHaveLength(3);
    const newItemIds = currentSnap.current.items.map((i) => i.itemId);
    for (const oldId of oldItemIds) {
      expect(newItemIds).not.toContain(oldId);
    }

    // Snapshot current rated states 0 under approved C-D3
    expect(Object.keys(currentSnap.states)).toHaveLength(0);

    // getDueQueue returns 3 new under APPROVED C-D3
    const nowUtc = new Date().toISOString();
    const nextLocalMidnight = nextLocalMidnightUtc(nowUtc, currentTimeZone());
    const queue = await repos.cardReviews.getDueQueue({
      materialId: matId,
      currentVersionId: currentSnap.current.versionId,
      currentItemIds: newItemIds,
      nowUtc,
      nextLocalMidnightUtc: nextLocalMidnight,
    });
    expect(queue).toHaveLength(3);
    expect(queue.filter((q) => q.kind === "new")).toHaveLength(3);
    expect(queue.filter((q) => q.kind === "due")).toHaveLength(0);
    expect(queue.filter((q) => q.kind === "again")).toHaveLength(0);
    expect(queue.every((q) => q.kind === "new" && q.dueAt === null)).toBe(true);

    // Old raw states/events/receipts deep UNCHANGED, no fake events
    const postRawStates = await testDb.select("SELECT * FROM card_review_state ORDER BY item_id");
    expect(postRawStates).toEqual(oldRawStates);
    const postRawEvents = await testDb.select("SELECT * FROM card_review_events ORDER BY id");
    expect(postRawEvents).toEqual(oldRawEvents);
    const postRawOperations = await testDb.select("SELECT * FROM card_review_operations ORDER BY operation_id");
    expect(postRawOperations).toEqual(oldRawOperations);

    // Practice baseline unchanged
    expect(await storedState()).toEqual(practiceBaseline);

    // Old cards deep unchanged / new user / null page
    const studySets = await testDb.select<{ flashcards_json: string }>(
      "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?",
      [matId],
    );
    const flashcards: StoredCard[] = JSON.parse(studySets[0]!.flashcards_json);
    expect(flashcards).toHaveLength(3);
    expect(flashcards[0]?.front).toBe("Card 1 Q");
    expect(flashcards[0]?.back).toBe("Card 1 A");
    expect(flashcards[0]?.sourcePage).toBeNull();
    expect(flashcards[0]?.origin).toBe("user");
    expect(flashcards[1]?.front).toBe("Card 2 Q");
    expect(flashcards[1]?.back).toBe("Card 2 A");
    expect(flashcards[1]?.sourcePage).toBeNull();
    expect(flashcards[1]?.origin).toBe("user");
    expect(flashcards[2]?.front).toBe("New own-word card 3 Q");
    expect(flashcards[2]?.back).toBe("New own-word card 3 A");
    expect(flashcards[2]?.sourcePage).toBeNull();
    expect(flashcards[2]?.origin).toBe("user");
  });
});
