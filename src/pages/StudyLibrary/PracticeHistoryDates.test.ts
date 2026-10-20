// @vitest-environment jsdom
/**
 * Completed practice attempts show a real date on every history view: the
 * group list, the attempts for one record and the review of one attempt.
 * Installed verification on 2026-10-11 (PR #142) saw "Completed undefined,
 * undefined NaN" because completion timestamps went straight into the
 * calendar-day formatter. Real repositories over node:sqlite; jsdom only.
 *
 * Each block runs in a named time zone with the clock frozen in 2026, so the
 * expected days are literal and no year suffix appears whenever this runs.
 */
import { createElement as h, type ContextType } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
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

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T12:00:00.000Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

/**
 * Runs the enclosing describe block in `zone`, then puts process.env.TZ back
 * exactly as it was: the same value, or no variable at all when none was set.
 */
function inTimeZone(zone: string) {
  let hadTz = false;
  let originalTz: string | undefined;
  beforeAll(() => {
    hadTz = "TZ" in process.env;
    originalTz = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (hadTz) process.env.TZ = originalTz;
    else delete process.env.TZ;
  });
}

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
    provider: "gemini",
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

/** The completion line, alone or followed by the attempt's " • n answered". */
const completionLine = (text: string) => new RegExp(`^${text}(?: •|$)`);

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
    expect(await screen.findAllByText(completionLine(expected)), view.route).not.toHaveLength(0);
    expect(container.textContent, view.route).not.toMatch(/undefined|NaN/);
    unmount();
  }
}

describe("practice history completion dates in UTC", () => {
  inTimeZone("UTC");

  it("shows the day an attempt was completed, from the timestamp the app writes", async () => {
    await expectDateOnEveryView("2026-10-03T12:00:00.000Z", "Completed Saturday, October 3");
  });

  it("also reads a restored SQLite-style timestamp", async () => {
    await expectDateOnEveryView("2026-10-03 12:00:00", "Completed Saturday, October 3");
  });

  it("says only 'Completed' for a timestamp it can't read, never a broken date", async () => {
    await expectDateOnEveryView("not a timestamp", "Completed");
  });
});

// UTC+14: noon UTC on October 3 is already Sunday, October 4 locally.
describe("practice history completion dates in Pacific/Kiritimati", () => {
  inTimeZone("Pacific/Kiritimati");

  it("shows the following local day for an instant past local midnight", async () => {
    await expectDateOnEveryView("2026-10-03T12:00:00.000Z", "Completed Sunday, October 4");
  });

  it("shows the following local day for a restored SQLite-style timestamp", async () => {
    await expectDateOnEveryView("2026-10-03 10:00:00", "Completed Sunday, October 4");
  });
});

// UTC-7 in October: 9:30 PM Friday in California is 04:30 Saturday in UTC.
describe("practice history completion dates in America/Los_Angeles", () => {
  inTimeZone("America/Los_Angeles");

  it("shows the previous local day for an evening completion", async () => {
    await expectDateOnEveryView("2026-10-03T04:30:00.000Z", "Completed Friday, October 2");
  });

  it("shows the previous local day for a restored SQLite-style timestamp", async () => {
    await expectDateOnEveryView("2026-10-03 04:30:00", "Completed Friday, October 2");
  });

  it("says only 'Completed' for a timestamp it can't read, never a broken date", async () => {
    await expectDateOnEveryView("not a timestamp", "Completed");
  });
});
