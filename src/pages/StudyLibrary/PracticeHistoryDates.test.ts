// @vitest-environment jsdom
/**
 * Completed practice attempts show a real date on every history view: the
 * group list, the attempts for one record and the review of one attempt.
 * Installed verification on 2026-10-11 (PR #142) saw "Completed undefined,
 * undefined NaN" because completion timestamps went straight into the
 * calendar-day formatter. Real repositories over node:sqlite; jsdom only.
 */
import { createElement as h, type ContextType } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { formatLongDate, localDayOf } from "@/lib/dates";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { PracticeHistory } from "./PracticeHistory";

let db: TestDatabase;
let repos: Repositories;

beforeEach(async () => {
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
});

afterEach(() => {
  cleanup();
  db.close();
});

function show(route: string) {
  const value = {
    repositories: repos,
    data: EMPTY_DATA,
    status: "ready",
    error: null,
  } as ContextType<typeof AppDataContext>;
  return render(
    h(
      AppDataContext.Provider,
      { value },
      h(
        MemoryRouter,
        { initialEntries: [route] },
        h(
          Routes,
          null,
          h(Route, { path: "/study/history", element: h(PracticeHistory) }),
          h(Route, { path: "/study/history/:historyKey", element: h(PracticeHistory) }),
          h(Route, { path: "/study/history/:historyKey/:attemptId", element: h(PracticeHistory) }),
        ),
      ),
    ),
  );
}

/** One completed attempt through the real session transaction, then its stored completion time replaced. */
async function completedAttempt(completedAt: string) {
  await repos.documents.create({ id: "m1", title: "Airspace basics" });
  await repos.documents.savePracticeTest({
    sourceMaterialId: "m1",
    title: "Airspace basics",
    model: "synthetic",
    questions: [
      { question: "Class B?", options: ["Yes", "No"], correctIndex: 0, explanation: "Synthetic.", sourcePage: null },
      { question: "Class C?", options: ["Yes", "No"], correctIndex: 1, explanation: "Synthetic.", sourcePage: null },
    ],
  });
  const version = (await repos.practiceSessions.getActiveVersion("m1"))!;
  const started = await repos.practiceSessions.saveSessionAction({
    action: "start_or_resume",
    operationId: crypto.randomUUID(),
    materialId: "m1",
    versionId: version.version.id,
  });
  if (!("attemptId" in started) || !("revision" in started)) throw Error("Unexpected start state");
  await repos.practiceSessions.saveSessionAction({
    action: "complete_attempt",
    operationId: crypto.randomUUID(),
    attemptId: started.attemptId,
    expectedRevision: started.revision,
  });
  await db.execute("UPDATE practice_attempts SET completed_at = ? WHERE id = ?", [completedAt, started.attemptId]);
  const [group] = await repos.practiceSessions.getCompletedHistoryGroups();
  return { historyKey: group!.historyKey, attemptId: started.attemptId };
}

async function expectDateOnEveryView(completedAt: string, expected: string) {
  const { historyKey, attemptId } = await completedAttempt(completedAt);
  const key = encodeURIComponent(historyKey);
  const views = [
    { route: "/study/history", ready: "Airspace basics" },
    { route: `/study/history/${key}`, ready: /Score:/ },
    { route: `/study/history/${key}/${attemptId}`, ready: "Review: Airspace basics" },
  ];
  for (const view of views) {
    const { container, unmount } = show(view.route);
    await screen.findAllByText(view.ready);
    expect(await screen.findAllByText(new RegExp(expected)), view.route).not.toHaveLength(0);
    expect(container.textContent, view.route).not.toMatch(/undefined|NaN/);
    unmount();
  }
}

describe("practice history completion dates", () => {
  it("shows the day an attempt was completed, from the timestamp the app writes", async () => {
    const completedAt = "2026-10-03T12:00:00.000Z";
    const expected = `Completed ${formatLongDate(localDayOf(completedAt)!)}`;
    expect(expected).toMatch(/^Completed Saturday, October 3/);
    await expectDateOnEveryView(completedAt, expected);
  });

  it("also reads a restored SQLite-style timestamp", async () => {
    const completedAt = "2026-10-03 12:00:00";
    await expectDateOnEveryView(completedAt, `Completed ${formatLongDate(localDayOf(completedAt)!)}`);
  });

  it("says only 'Completed' for a timestamp it can't read, never a broken date", async () => {
    await expectDateOnEveryView("not a timestamp", "Completed");
  });
});
