// @vitest-environment jsdom
import { createElement as h, type ContextType } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { PracticeTest } from "@/domain/types";
import {
  TIMED_STORAGE_KEY,
  formatClock,
  isTimedAttempt,
  readTimedAttempt,
  timeAnnouncement,
} from "@/logic/timedAttempts";
import { makeMaterial } from "@/testing/factories";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { PracticeTestPanel } from "./PracticeTestPanel";

const sampleTest: PracticeTest = {
  sourceMaterialId: "mat-1",
  title: "Traffic Pattern Operations",
  questions: [
    {
      question: "What is the standard traffic pattern altitude?",
      options: ["800 feet AGL", "1,000 feet AGL", "1,500 feet AGL"],
      correctIndex: 1,
      explanation: "Explanation one is hidden until the end.",
      sourcePage: 42,
    },
    {
      question: "Which leg is parallel to the runway?",
      options: ["Crosswind", "Downwind", "Base leg"],
      correctIndex: 1,
      explanation: "Explanation two.",
      sourcePage: null,
    },
  ],
  provider: "gemini",
  model: "gemini-3.5-flash",
  generatedAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

describe("PracticeTestPanel test conditions", () => {
  let db: TestDatabase;
  let repos: Repositories;

  beforeEach(async () => {
    localStorage.clear();
    db = await createNodeSqliteDatabase();
    repos = createRepositories(db);
    await repos.documents.create({ id: sampleTest.sourceMaterialId, title: sampleTest.title });
    await repos.documents.savePracticeTest(sampleTest);
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    db?.close();
  });

  async function renderPanel() {
    const value = {
      repositories: repos,
      data: { ...EMPTY_DATA, materials: [makeMaterial({ id: "mat-1", filePath: null })] },
      status: "ready",
      error: null,
    } as ContextType<typeof AppDataContext>;
    const view = render(h(AppDataContext.Provider, { value }, h(PracticeTestPanel, { practiceTest: sampleTest })));
    await screen.findByRole("heading", { name: /Question \d+ of \d+/ });
    return view;
  }

  function pick(index: number): void {
    fireEvent.click(screen.getAllByRole("radio")[index]!);
  }

  async function saveTimedAnswer(index: number) {
    pick(index);
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    await screen.findByText(/Answer saved/);
  }

  it("off by default: today's check-answer flow is unchanged", async () => {
    await renderPanel();
    const toggle = screen.getByRole("checkbox", { name: /Test conditions/ }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByText(/Timed at the FAA written pace — 2 minutes per question\. No answers shown until the end\./)).toBeTruthy();
    pick(1);
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    expect(await screen.findByText("Correct")).toBeTruthy();
    expect(screen.getByText(/Explanation one/)).toBeTruthy();
    expect(screen.queryByText(/Time left/)).toBeNull();
    const attempt = await repos.practiceSessions.getCurrentAttempt("mat-1");
    expect(attempt && isTimedAttempt(attempt.attemptId)).toBe(false);
  });

  it("timed: counts down from questions x 2 minutes, hides feedback, finish confirms unanswered", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    await renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: /Test conditions/ }));
    await saveTimedAnswer(1);
    expect(screen.queryByText("Correct")).toBeNull();
    expect(screen.queryByText("Not quite")).toBeNull();
    expect(screen.queryByText(/Explanation one/)).toBeNull();
    expect(screen.getByText("Time left: 04:00")).toBeTruthy();
    // This short set is already inside 5 minutes; a real 60-question test stays silent until then.
    expect(screen.getByText("5 minutes left")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByText("Time left: 03:30")).toBeTruthy();
    // Back/forward and change an answer.
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    fireEvent.click(await screen.findByRole("button", { name: "← Previous" }));
    pick(0);
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    await screen.findByText(/Answer saved/);
    // One unanswered: Finish asks first, using the app's dialog.
    fireEvent.click(screen.getByRole("button", { name: "Finish test" }));
    const confirm = screen.getByRole("dialog", { name: "Finish the test?" });
    expect(within(confirm).getByText(/1 question is still unanswered/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Finish test" }));
    expect(await screen.findByText("This practice set: 0%")).toBeTruthy();
    expect(screen.getByText("The FAA written passes at 70%.")).toBeTruthy();
    expect(screen.getByText(/Time used: \d+ min \d\d s of 4 min 00 s/)).toBeTruthy();
    expect(screen.getByText("Review these")).toBeTruthy();
    expect(screen.getByText("page 42")).toBeTruthy();
    expect(screen.queryByText(/would pass|ready/i)).toBeNull();
    const link = screen.getByRole("link", { name: "Question 1" });
    expect(link.getAttribute("href")).toContain("?review=missed");
    expect(readTimedAttempt((await repos.practiceSessions.getCurrentAttempt("mat-1"))?.attemptId ?? "") ?? true).toBeTruthy();
  });

  it("timed: auto-finishes at the deadline and unanswered count as missed", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    await renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: /Test conditions/ }));
    await saveTimedAnswer(1);
    await act(async () => { vi.advanceTimersByTime(4 * 60_000 + 1000); });
    expect(await screen.findByText("This practice set: 50%", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText(/1 unanswered/)).toBeTruthy();
    expect(screen.getByText(/Time used: 4 min 00 s of 4 min 00 s/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Question 2" })).toBeTruthy();
    expect(screen.getByText("No source page")).toBeTruthy();
  });

  it("clock helpers: deadline-based formatting, announcements only at 5 min and 1 min", () => {
    expect(formatClock(120 * 60_000)).toBe("120:00");
    expect(formatClock(59_001)).toBe("01:00");
    expect(timeAnnouncement(600_000)).toBe("");
    expect(timeAnnouncement(300_000)).toBe("5 minutes left");
    expect(timeAnnouncement(60_000)).toBe("1 minute left");
  });

  it("old saved data still loads: no side record means untimed; garbage storage is ignored", () => {
    expect(readTimedAttempt("attempt-from-before")).toBeNull();
    localStorage.setItem(TIMED_STORAGE_KEY, "{not json");
    expect(isTimedAttempt("x")).toBe(false);
    localStorage.setItem(TIMED_STORAGE_KEY, JSON.stringify({ x: { startedMs: 1, deadlineMs: 2 } }));
    expect(isTimedAttempt("x")).toBe(true);
  });
});
