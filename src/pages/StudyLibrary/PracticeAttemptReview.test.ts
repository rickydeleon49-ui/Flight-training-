// @vitest-environment jsdom
/**
 * Focused review of missed or skipped questions for one completed practice
 * attempt: the completion link from the panel, the All questions / Missed or
 * skipped controls in history, frozen content and route/read races. Real
 * AppDataProvider over a disposable node:sqlite file; records are created only
 * through the existing repositories. jsdom only, not installed-app evidence.
 */
import { createElement as h } from "react";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { PracticeTest, PracticeTestItem } from "@/domain/types";
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
function Probe() {
  appCtx = useAppData();
  navigateTo = useNavigate();
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
  await repos.documents.create({ id, title: `${prefix} material` });
  await repos.documents.savePracticeTest({
    sourceMaterialId: id,
    title: `${prefix} material`,
    model: "synthetic",
    questions: [1, 2, 3, 4].map((n) => ({
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
    fireEvent.click(await screen.findByRole("button", { name: "Question 1 (Answered)" }));
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
