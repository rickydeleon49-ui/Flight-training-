// @vitest-environment jsdom
/**
 * M2 PR2 finish corrections (M2UI-R5–R9) permanent regressions.
 *
 * Each case drives the real panel/history components against a disposable
 * Node SQLite database with deferred promises for event races. These are
 * synthetic checks, not installed-app or VoiceOver certification.
 */
import { createElement as h, type ContextType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type {
  PracticeCompletedResult,
  PracticeSessionAction,
  PracticeSessionState,
  PracticeTest,
} from "@/domain/types";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { PracticeHistory } from "./PracticeHistory";
import { PracticeTestPanel } from "./PracticeTestPanel";

let db: TestDatabase;
let repos: Repositories;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
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
  db.close();
});

function wrap(child: ReturnType<typeof h>, route = "/") {
  const value = {
    repositories: repos,
    data: EMPTY_DATA,
    status: "ready",
    error: null,
  } as ContextType<typeof AppDataContext>;
  return h(
    AppDataContext.Provider,
    { value },
    h(MemoryRouter, { initialEntries: [route] }, child),
  );
}

async function seed(id: string): Promise<PracticeTest> {
  await repos.documents.create({ id, title: `Material ${id}` });
  await repos.documents.savePracticeTest({
    sourceMaterialId: id,
    title: id,
    model: "synthetic",
    questions: [
      {
        question: `Frozen ${id} question 1`,
        options: ["First", "Second"],
        correctIndex: 0,
        explanation: `Confirmed ${id} explanation`,
        sourcePage: null,
      },
      {
        question: `Frozen ${id} question 2`,
        options: ["Third", "Fourth"],
        correctIndex: 1,
        explanation: "Second explanation",
        sourcePage: null,
      },
    ],
  });
  return (await repos.documents.listPracticeTests()).find((t) => t.sourceMaterialId === id)!;
}

async function start(id: string) {
  const version = (await repos.practiceSessions.getActiveVersion(id))!;
  return repos.practiceSessions.saveSessionAction({
    action: "start_or_resume",
    operationId: crypto.randomUUID(),
    materialId: id,
    versionId: version.version.id,
  });
}

async function complete(id: string) {
  const state = await start(id);
  if (!("attemptId" in state) || !("revision" in state)) throw Error("Unexpected state");
  return repos.practiceSessions.saveSessionAction({
    action: "complete_attempt",
    operationId: crypto.randomUUID(),
    attemptId: state.attemptId,
    expectedRevision: state.revision,
  });
}

async function abandon(id: string) {
  const state = (await repos.practiceSessions.getCurrentAttempt(id))!;
  return repos.practiceSessions.saveSessionAction({
    action: "abandon_attempt",
    operationId: crypto.randomUUID(),
    attemptId: state.attemptId,
    expectedRevision: state.revision,
  });
}

async function panel(test: PracticeTest) {
  const load = vi.spyOn(repos.practiceSessions, "getCurrentAttempt");
  const view = render(wrap(h(PracticeTestPanel, { practiceTest: test })));
  await waitFor(() => expect(load).toHaveBeenCalledWith(test.sourceMaterialId));
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

async function answerConfirmed() {
  fireEvent.click(screen.getAllByRole("radio")[0]!);
  await waitFor(async () =>
    expect(await db.select("SELECT id FROM practice_responses")).toHaveLength(1),
  );
  await act(async () => {
    await Promise.resolve();
  });
}

function history(route: string) {
  return render(
    wrap(
      h(
        Routes,
        null,
        h(Route, { path: "/study/history/:historyKey", element: h(PracticeHistory) }),
      ),
      route,
    ),
  );
}

/** History routes with a group index and explicit links, for navigation races. */
function historyWithLinks(links: { label: string; to: string }[], route: string) {
  return render(
    wrap(
      h(
        "div",
        null,
        links.map((link) => h(Link, { key: link.to, to: link.to }, link.label)),
        h(
          Routes,
          null,
          h(Route, { path: "/study/history", element: h("p", null, "History index") }),
          h(Route, { path: "/study/history/:historyKey", element: h(PracticeHistory) }),
          h(Route, { path: "/study/history/:historyKey/:attemptId", element: h(PracticeHistory) }),
        ),
      ),
      route,
    ),
  );
}

async function openErase() {
  fireEvent.click(await screen.findByRole("button", { name: "Erase practice history" }));
  return screen.findByRole("button", { name: "Erase history" });
}

async function responseRows(materialId: string) {
  return db.select<{ source_material_id: string }>(
    "SELECT a.source_material_id FROM practice_responses r JOIN practice_attempts a ON r.attempt_id=a.id WHERE a.source_material_id = ?",
    [materialId],
  );
}

describe("M2UI-R5: every edit waits for the whole authoritative read", () => {
  it("[R5] initial current-attempt read keeps all answer controls blocked", async () => {
    const test = await seed("initial-held");
    const read = repos.practiceSessions.getCurrentAttempt.bind(repos.practiceSessions);
    const gate = deferred<PracticeSessionState | null>();
    const currentRead = vi
      .spyOn(repos.practiceSessions, "getCurrentAttempt")
      .mockImplementation(() => gate.promise);
    render(wrap(h(PracticeTestPanel, { practiceTest: test })));
    await waitFor(() => expect(currentRead).toHaveBeenCalledWith("initial-held"));
    const enabled = screen.queryAllByRole("radio").some((r) => !r.hasAttribute("disabled"));
    gate.resolve(await read("initial-held"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(enabled).toBe(false);
  });

  it("[R5] a retry load stays blocked while its read is held", async () => {
    const test = await seed("retry-held");
    const activeRead = repos.practiceSessions.getActiveVersion.bind(repos.practiceSessions);
    const attemptRead = repos.practiceSessions.getCurrentAttempt.bind(repos.practiceSessions);
    const gate = deferred<PracticeSessionState | null>();
    let attemptCalls = 0;
    let rejectInitial = true;
    vi.spyOn(repos.practiceSessions, "getActiveVersion").mockImplementation(async (id) => {
      if (rejectInitial) {
        rejectInitial = false;
        throw Error("Synthetic initial rejection");
      }
      return activeRead(id);
    });
    vi.spyOn(repos.practiceSessions, "getCurrentAttempt").mockImplementation((id) => {
      attemptCalls += 1;
      return attemptCalls === 2 ? gate.promise : attemptRead(id);
    });

    render(wrap(h(PracticeTestPanel, { practiceTest: test })));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(attemptCalls).toBe(2));

    expect(screen.queryAllByRole("radio").some((r) => !r.hasAttribute("disabled"))).toBe(false);
    expect(screen.getByText("Loading practice test…")).toBeTruthy();

    gate.resolve(await attemptRead("retry-held"));
    await screen.findByText("Question 1 of 2");
    expect(screen.getAllByRole("radio")[0]!.hasAttribute("disabled")).toBe(false);
  });

  it("[R5] a rejected retry load stays non-editable with read recovery visible", async () => {
    const test = await seed("retry-rejected");
    vi.spyOn(repos.practiceSessions, "getActiveVersion").mockRejectedValue(
      Error("Synthetic retry rejection"),
    );
    render(wrap(h(PracticeTestPanel, { practiceTest: test })));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByText("Synthetic retry rejection");

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "Retry" }).length).toBeGreaterThan(0);
  });

  it("[R5] an obsolete initial read cannot overwrite the newer material phase", async () => {
    const a = await seed("stale-A");
    const b = await seed("stale-B");
    await start("stale-A");
    const read = repos.practiceSessions.getCurrentAttempt.bind(repos.practiceSessions);
    const gate = deferred<PracticeSessionState | null>();
    let first = true;
    vi.spyOn(repos.practiceSessions, "getCurrentAttempt").mockImplementation((id) => {
      if (first) {
        first = false;
        return gate.promise;
      }
      return read(id);
    });

    const view = render(wrap(h(PracticeTestPanel, { practiceTest: a })));
    view.rerender(wrap(h(PracticeTestPanel, { practiceTest: b })));
    await screen.findByText("Frozen stale-B question 1");

    // Material A's attempt was in progress on A's version; adopting it now
    // would retarget B's editing onto A.
    gate.resolve(await read("stale-A"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Frozen stale-B question 1")).toBeTruthy();

    await answerConfirmed();
    expect(await responseRows("stale-B")).toHaveLength(1);
    expect(await responseRows("stale-A")).toHaveLength(0);
  });

  it("[R5] no active version settles non-editable instead of falling back to legacy props", async () => {
    const test = await seed("no-version");
    vi.spyOn(repos.practiceSessions, "getActiveVersion").mockResolvedValue(null);
    render(wrap(h(PracticeTestPanel, { practiceTest: test })));
    await screen.findByText(/No saved practice test is available/);

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText(`Frozen no-version question 1`)).toBeNull();
  });
});

describe("M2UI-R6: one unresolved intent locks every conflicting action", () => {
  it("[R6] failed changed answer does not mix draft selection with saved correctness", async () => {
    await panel(await seed("change-refused"));
    await answerConfirmed();
    await screen.findByRole("button", { name: "Change answer" });
    fireEvent.click(screen.getByRole("button", { name: "Change answer" }));
    vi.spyOn(repos.practiceSessions, "saveSessionAction").mockRejectedValue(
      Error("Synthetic changed-answer refusal"),
    );
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Synthetic changed-answer refusal");
    const stored = (await repos.practiceSessions.getCurrentAttempt("change-refused"))!;
    expect({
      draftChecked: screen.getAllByRole("radio")[1]!.getAttribute("aria-checked"),
      feedbackVisible: !!screen.queryByRole("region", { name: "Question result" }),
      storedChoice: stored.responses[0]?.selectedIndex,
    }).toEqual({ draftChecked: "true", feedbackVisible: false, storedChoice: 0 });
  });

  it("[R6] uncertain completion blocks fresh completion identity", async () => {
    await panel(await seed("complete-identity"));
    await answerConfirmed();
    const actions: PracticeSessionAction[] = [];
    vi.spyOn(repos.practiceSessions, "saveSessionAction").mockImplementation(async (action) => {
      actions.push(action);
      throw Error("Synthetic unknown completion");
    });
    fireEvent.click(screen.getByRole("button", { name: /Complete test now/ }));
    await screen.findByText("Synthetic unknown completion");
    const completeButton = screen.getByRole("button", { name: /Complete test now/ });
    const enabled = !completeButton.hasAttribute("disabled");
    fireEvent.click(completeButton);
    await act(async () => {
      await Promise.resolve();
    });
    expect({ enabled, calls: actions.length }).toEqual({ enabled: false, calls: 1 });
  });

  it("[R6] Retry replays the exact payload once and accepts no fresh mutation", async () => {
    await panel(await seed("retry-identity"));
    const save = repos.practiceSessions.saveSessionAction.bind(repos.practiceSessions);
    const actions: PracticeSessionAction[] = [];
    let lostAcknowledgement = true;
    vi.spyOn(repos.practiceSessions, "saveSessionAction").mockImplementation(async (action) => {
      actions.push(action);
      const result = await save(action);
      if (action.action === "record_response" && lostAcknowledgement) {
        lostAcknowledgement = false;
        throw Error("Synthetic lost response acknowledgement");
      }
      return result;
    });

    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await screen.findByText("Synthetic lost response acknowledgement");

    // Ordinary inputs cannot allocate or replace the pending payload.
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await act(async () => {
      await Promise.resolve();
    });
    const responses = actions.filter((a) => a.action === "record_response");
    expect(responses).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Correct");
    const replayed = actions.filter((a) => a.action === "record_response");
    expect(replayed).toHaveLength(2);
    expect(replayed[1]).toEqual(replayed[0]);

    const receipts = await db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM practice_session_operations WHERE operation_id = ?",
      [replayed[0]!.operationId],
    );
    const rows = await db.select("SELECT id FROM practice_responses");
    expect({ receiptCount: receipts[0]?.n, responseRows: rows.length }).toEqual({
      receiptCount: 1,
      responseRows: 1,
    });
  });

  it("[R6] Retry refresh performs reads only and never resends the acknowledged write", async () => {
    await panel(await seed("retry-read-only"));
    const save = repos.practiceSessions.saveSessionAction.bind(repos.practiceSessions);
    const read = createRepositories(db).practiceSessions.getCurrentAttempt;
    const sent: string[] = [];
    let failNextRead = false;
    vi.spyOn(repos.practiceSessions, "getCurrentAttempt").mockImplementation(async (id) => {
      if (failNextRead) {
        failNextRead = false;
        throw Error("Synthetic refresh rejection");
      }
      return read(id);
    });
    vi.spyOn(repos.practiceSessions, "saveSessionAction").mockImplementation(async (action) => {
      sent.push(action.action);
      const result = await save(action);
      if (action.action === "record_response") failNextRead = true;
      return result;
    });

    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await screen.findByText(/refreshing status failed/);
    const writesBeforeRetry = sent.length;

    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await screen.findByRole("button", { name: "Change answer" });

    expect({ writesBeforeRetry, writesAfterRetry: sent.length }).toEqual({
      writesBeforeRetry: 2,
      writesAfterRetry: 2,
    });
    expect(sent).toEqual(["start_or_resume", "record_response"]);
    // The acknowledged answer is now authoritative, so feedback is honest.
    expect(screen.getByText("Correct")).toBeTruthy();
  });

  it("[R6] a refused start keeps its identity and still applies the held answer on Retry", async () => {
    await panel(await seed("start-retry"));
    const save = repos.practiceSessions.saveSessionAction.bind(repos.practiceSessions);
    const actions: PracticeSessionAction[] = [];
    let refuseStart = true;
    vi.spyOn(repos.practiceSessions, "saveSessionAction").mockImplementation(async (action) => {
      actions.push(action);
      if (action.action === "start_or_resume" && refuseStart) {
        refuseStart = false;
        throw Error("Synthetic start refusal");
      }
      return save(action);
    });

    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Synthetic start refusal");

    expect(await db.select("SELECT id FROM practice_attempts")).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "Question result" })).toBeNull();
    expect(screen.getAllByRole("radio")[1]!.getAttribute("aria-checked")).toBe("true");

    // A fresh answer click cannot allocate a second start.
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(actions.filter((a) => a.action === "start_or_resume")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(async () =>
      expect(await db.select("SELECT id FROM practice_responses")).toHaveLength(1),
    );
    const starts = actions.filter((a) => a.action === "start_or_resume");
    expect(starts[1]!.operationId).toBe(starts[0]!.operationId);
    // The held answer was not lost: it is saved against the acknowledged attempt.
    // Choice 1 is the wrong answer for this frozen question, and it stays the
    // saved one after the start retry.
    expect(screen.getByText("Not quite")).toBeTruthy();
  });
});

describe("M2UI-R7: recovery stays reachable from the result view", () => {
  it("[R7] failed retake from result exposes same-ID retry in result view", async () => {
    await panel(await seed("retake-refused"));
    await answerConfirmed();
    fireEvent.click(screen.getByRole("button", { name: /Complete test now/ }));
    await screen.findByText("Practice test complete");
    vi.spyOn(repos.practiceSessions, "saveSessionAction").mockRejectedValue(
      Error("Synthetic retake refusal"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retake this test" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect({
      alert: !!screen.queryByText("Synthetic retake refusal"),
      retry: !!screen.queryByRole("button", { name: "Retry" }),
    }).toEqual({ alert: true, retry: true });
  });

  it("[R7] a committed retake with a lost acknowledgement replays and reconciles", async () => {
    await panel(await seed("retake-lost"));
    await answerConfirmed();
    fireEvent.click(screen.getByRole("button", { name: /Complete test now/ }));
    await screen.findByText("Practice test complete");

    const save = repos.practiceSessions.saveSessionAction.bind(repos.practiceSessions);
    const actions: PracticeSessionAction[] = [];
    let lostAcknowledgement = true;
    vi.spyOn(repos.practiceSessions, "saveSessionAction").mockImplementation(async (action) => {
      actions.push(action);
      const result = await save(action);
      if (action.action === "retake_attempt" && lostAcknowledgement) {
        lostAcknowledgement = false;
        throw Error("Synthetic lost retake acknowledgement");
      }
      return result;
    });

    fireEvent.click(screen.getByRole("button", { name: "Retake this test" }));
    await screen.findByText("Synthetic lost retake acknowledgement");

    // The immutable completed score is preserved and a fresh retake is blocked.
    expect(screen.getByText("Practice test complete")).toBeTruthy();
    expect(screen.getByText("1 of 2 correct")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retake this test" }).hasAttribute("disabled")).toBe(
      true,
    );

    // The retake did commit underneath the lost acknowledgement.
    expect(await db.select("SELECT id FROM practice_attempts")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Question 1 of 2");

    const retakes = actions.filter((a) => a.action === "retake_attempt");
    expect(retakes).toHaveLength(2);
    expect(retakes[1]).toEqual(retakes[0]);
    expect(await db.select("SELECT id FROM practice_attempts")).toHaveLength(2);
    // Editing unlocked only against the reconciled current attempt, which has
    // no responses: nothing from the completed attempt is carried over.
    expect(
      screen.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false"),
    ).toBe(true);
    expect(screen.queryByText("Practice test complete")).toBeNull();
  });

  it("[R7] the completion callback and displayed score follow the acknowledged result", async () => {
    const test = await seed("complete-callback");
    const results: PracticeCompletedResult[] = [];
    const load = vi.spyOn(repos.practiceSessions, "getCurrentAttempt");
    render(
      wrap(
        h(PracticeTestPanel, {
          practiceTest: test,
          onComplete: (result) => results.push(result),
        }),
      ),
    );
    await waitFor(() => expect(load).toHaveBeenCalledWith("complete-callback"));
    await act(async () => {
      await Promise.resolve();
    });
    await answerConfirmed();

    // Bind the real mutation before any mock replaces it on the same object.
    const save = repos.practiceSessions.saveSessionAction.bind(repos.practiceSessions);

    // A refused completion calls nothing back and shows no score.
    vi.spyOn(repos.practiceSessions, "saveSessionAction").mockRejectedValue(
      Error("Synthetic completion refusal"),
    );
    fireEvent.click(screen.getByRole("button", { name: /Complete test now/ }));
    await act(async () => {
      await Promise.resolve();
    });
    const unfinished = (await repos.practiceSessions.getCurrentAttempt("complete-callback"))!;
    expect({
      callbacks: results.length,
      completedVisible: !!screen.queryByText("Practice test complete"),
      storedStatus: unfinished.status,
    }).toEqual({ callbacks: 0, completedVisible: false, storedStatus: "in_progress" });

    // The same identity completes on retry; the callback and the rendered score
    // are the persisted result, with no invented score or timestamp.
    vi.spyOn(repos.practiceSessions, "saveSessionAction").mockImplementation((action) =>
      save(action),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Practice test complete");

    const row = (await db.select<{
      id: string;
      completed_at: string;
      score_percent: number;
      correct_count: number;
      total_questions: number;
    }>(
      "SELECT id, completed_at, score_percent, correct_count, total_questions FROM practice_attempts WHERE source_material_id = ?",
      ["complete-callback"],
    ))[0]!;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      attemptId: row.id,
      status: "completed",
      completedAt: row.completed_at,
      scorePercent: row.score_percent,
      correctCount: row.correct_count,
      totalQuestions: row.total_questions,
    });
    expect(screen.getByText(`${row.correct_count} of ${row.total_questions} correct`)).toBeTruthy();
    expect(
      screen.getByText(`Practice result from your material (${row.score_percent}%). Not an official FAA knowledge test score or certification of flight readiness.`),
    ).toBeTruthy();
  });
});

describe("M2UI-R8: null and replaced state reconcile in one place", () => {
  it("[R8] acknowledged response followed by null refresh clears the old attempt", async () => {
    await panel(await seed("null-refresh"));
    await answerConfirmed();
    const existing = (await repos.practiceSessions.getCurrentAttempt("null-refresh"))!;
    await screen.findByRole("button", { name: "Change answer" });
    const save = repos.practiceSessions.saveSessionAction.bind(repos.practiceSessions);
    vi.spyOn(repos.practiceSessions, "saveSessionAction").mockImplementation(async (action) => {
      const result = await save(action);
      if (action.action === "record_response") {
        await save({
          action: "abandon_attempt",
          operationId: crypto.randomUUID(),
          attemptId: existing.attemptId,
          expectedRevision: existing.revision + 1,
        });
      }
      return result;
    });
    fireEvent.click(screen.getByRole("button", { name: "Change answer" }));
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await waitFor(async () =>
      expect(await repos.practiceSessions.getCurrentAttempt("null-refresh")).toBeNull(),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect({
      staleFeedback: !!screen.queryByRole("region", { name: "Question result" }),
      staleAbandon: !!screen.queryByRole("button", { name: "Abandon attempt" }),
    }).toEqual({ staleFeedback: false, staleAbandon: false });
  });

  it("[R8] a null current attempt through Retry refresh clears the obsolete attempt", async () => {
    await panel(await seed("null-retry"));
    await answerConfirmed();
    const existing = (await repos.practiceSessions.getCurrentAttempt("null-retry"))!;
    await screen.findByRole("button", { name: "Change answer" });
    expect(existing.attemptId).toBeTruthy();

    const read = createRepositories(db).practiceSessions.getCurrentAttempt;
    let rejectNext = true;
    let eraseNext = false;
    vi.spyOn(repos.practiceSessions, "getCurrentAttempt").mockImplementation(async (id) => {
      if (rejectNext) {
        rejectNext = false;
        throw Error("Synthetic refresh rejection");
      }
      if (eraseNext) return null;
      return read(id);
    });

    // The answer commits, then its refresh fails: acknowledged but unconfirmed.
    fireEvent.click(screen.getByRole("button", { name: "Change answer" }));
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText(/refreshing status failed/);

    // The attempt is really closed now, so the retry read must report null.
    const latest = (await read("null-retry"))!;
    await repos.practiceSessions.saveSessionAction({
      action: "abandon_attempt",
      operationId: crypto.randomUUID(),
      attemptId: latest.attemptId,
      expectedRevision: latest.revision,
    });
    eraseNext = true;

    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Abandon attempt" })).toBeNull(),
    );

    expect({
      refreshError: !!screen.queryByText(/refreshing status failed/),
      staleFeedback: !!screen.queryByRole("region", { name: "Question result" }),
      staleAbandon: !!screen.queryByRole("button", { name: "Abandon attempt" }),
    }).toEqual({ refreshError: false, staleFeedback: false, staleAbandon: false });
    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
  });

  it("[R8] a settled conflict refresh with no current attempt clears the stale one", async () => {
    await panel(await seed("conflict-null"));
    await answerConfirmed();
    await screen.findByRole("button", { name: "Change answer" });

    // Externally the attempt is abandoned, so the next response conflicts.
    await abandon("conflict-null");

    fireEvent.click(screen.getByRole("button", { name: "Change answer" }));
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText(/choose the action again/);
    // The reconcile read that follows the refusal is what clears the stale attempt.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Abandon attempt" })).toBeNull(),
    );

    expect({
      staleFeedback: !!screen.queryByRole("region", { name: "Question result" }),
      staleAbandon: !!screen.queryByRole("button", { name: "Abandon attempt" }),
      storedAttempt: await repos.practiceSessions.getCurrentAttempt("conflict-null"),
    }).toEqual({ staleFeedback: false, staleAbandon: false, storedAttempt: null });
    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
  });

  it("[R8] Abandon never keeps pointing at the attempt it closed", async () => {
    await panel(await seed("abandon-null"));
    await answerConfirmed();
    fireEvent.click(await screen.findByRole("button", { name: "Abandon attempt" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Abandon attempt" })[1]!);

    // The confirmation dialog is dismissed on click, so settle on the real
    // outcome instead of on text that was already on screen.
    await waitFor(async () => {
      expect(await repos.practiceSessions.getCurrentAttempt("abandon-null")).toBeNull();
      expect(screen.queryByRole("button", { name: "Abandon attempt" })).toBeNull();
    });
    expect(screen.queryByRole("region", { name: "Question result" })).toBeNull();
    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
  });
});

describe("M2UI-R9: erasure identity, lock and route generation", () => {
  it("[R9] rapid confirmation uses a synchronous lock and one erase identity", async () => {
    await seed("erase-double");
    await complete("erase-double");
    const erase = repos.practiceSessions.eraseHistory.bind(repos.practiceSessions);
    const gate = deferred<void>();
    const actions: unknown[] = [];
    vi.spyOn(repos.practiceSessions, "eraseHistory").mockImplementation(async (action) => {
      actions.push(action);
      await gate.promise;
      return erase(action);
    });
    history("/study/history/erase-double");
    const confirm = await openErase();
    act(() => {
      confirm.click();
      confirm.click();
    });
    const count = actions.length;
    gate.resolve();
    await waitFor(async () =>
      expect(await repos.practiceSessions.getCompletedHistory("erase-double")).toHaveLength(0),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(count).toBe(1);
  });

  it("[R9] an erase acknowledgement from group A cannot navigate away from group B", async () => {
    await seed("erase-A");
    await seed("erase-B");
    await complete("erase-A");
    await complete("erase-B");
    const erase = repos.practiceSessions.eraseHistory.bind(repos.practiceSessions);
    const gate = deferred<void>();
    vi.spyOn(repos.practiceSessions, "eraseHistory").mockImplementation(async (action) => {
      await gate.promise;
      return erase(action);
    });
    historyWithLinks([{ label: "Switch group", to: "/study/history/erase-B" }], "/study/history/erase-A");
    fireEvent.click(await openErase());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("link", { name: "Switch group" }));
    await screen.findByRole("heading", { name: "Material erase-B" });
    gate.resolve();
    await waitFor(async () =>
      expect(await repos.practiceSessions.getCompletedHistory("erase-A")).toHaveLength(0),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("heading", { name: "Material erase-B" })).not.toBeNull();
    expect(screen.queryByText("History index")).toBeNull();
  });

  it("[R9] changing only history key revalidates attempt membership", async () => {
    await seed("review-A");
    await seed("review-B");
    const result = await complete("review-A");
    if (!("attemptId" in result)) throw Error("Unexpected result");
    historyWithLinks(
      [{ label: "Switch group", to: `/study/history/review-B/${result.attemptId}` }],
      `/study/history/review-A/${result.attemptId}`,
    );
    await screen.findByText("Frozen review-A question 1");
    fireEvent.click(screen.getByRole("link", { name: "Switch group" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.queryByText("Practice attempt does not belong to this study material."),
    ).not.toBeNull();
  });

  it("[R9] returning to a group cannot revive an obsolete erasure acknowledgement", async () => {
    await seed("gen-A");
    await seed("gen-B");
    await complete("gen-A");
    await complete("gen-B");
    const erase = repos.practiceSessions.eraseHistory.bind(repos.practiceSessions);
    const gate = deferred<void>();
    const actions: { operationId: string; historyKey: string }[] = [];
    vi.spyOn(repos.practiceSessions, "eraseHistory").mockImplementation(async (action) => {
      actions.push({ operationId: action.operationId, historyKey: action.historyKey });
      await gate.promise;
      return erase(action);
    });
    historyWithLinks(
      [
        { label: "Switch group", to: "/study/history/gen-B" },
        { label: "Back to A", to: "/study/history/gen-A" },
      ],
      "/study/history/gen-A",
    );
    fireEvent.click(await openErase());
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    // Both the pending confirmation and the page's own trigger stay inert.
    for (const pending of screen.getAllByRole("button", { name: "Erasing…" })) {
      expect(pending.hasAttribute("disabled")).toBe(true);
    }

    fireEvent.click(screen.getByRole("link", { name: "Switch group" }));
    await screen.findByRole("heading", { name: "Material gen-B" });
    fireEvent.click(screen.getByRole("link", { name: "Back to A" }));
    await screen.findByRole("heading", { name: "Material gen-A" });

    gate.resolve();
    await waitFor(async () =>
      expect(await repos.practiceSessions.getCompletedHistory("gen-A")).toHaveLength(0),
    );
    await act(async () => {
      await Promise.resolve();
    });

    // The stale acknowledgement neither navigates away from A nor reports an
    // error there, but the storage work it completed is real.
    expect(actions).toEqual([{ operationId: actions[0]!.operationId, historyKey: "gen-A" }]);
    expect(screen.queryByRole("heading", { name: "Material gen-A" })).not.toBeNull();
    expect(screen.queryByText("History index")).toBeNull();
    const remaining = await db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM practice_attempts",
    );
    expect(remaining[0]?.n).toBe(1);
  });

  it("[R9] leaving the view does not cancel committed erasure work or update a dead page", async () => {
    await seed("erase-unmount");
    await complete("erase-unmount");
    const erase = repos.practiceSessions.eraseHistory.bind(repos.practiceSessions);
    const gate = deferred<void>();
    vi.spyOn(repos.practiceSessions, "eraseHistory").mockImplementation(async (action) => {
      await gate.promise;
      return erase(action);
    });
    const view = history("/study/history/erase-unmount");
    fireEvent.click(await openErase());
    view.unmount();
    gate.resolve();
    await waitFor(async () =>
      expect(await repos.practiceSessions.getCompletedHistory("erase-unmount")).toHaveLength(0),
    );
    const remaining = await db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM practice_attempts",
    );
    expect(remaining[0]?.n).toBe(0);
  });

  it("[R9] a new route key never reinterprets the pending erasure confirmation", async () => {
    await seed("bind-A");
    await seed("bind-B");
    await complete("bind-A");
    await complete("bind-B");
    const erase = repos.practiceSessions.eraseHistory.bind(repos.practiceSessions);
    const gate = deferred<void>();
    const keys: string[] = [];
    vi.spyOn(repos.practiceSessions, "eraseHistory").mockImplementation(async (action) => {
      keys.push(action.historyKey);
      await gate.promise;
      return erase(action);
    });
    historyWithLinks([{ label: "Switch group", to: "/study/history/bind-B" }], "/study/history/bind-A");
    fireEvent.click(await openErase());
    fireEvent.click(screen.getByRole("link", { name: "Switch group" }));
    await screen.findByRole("heading", { name: "Material bind-B" });
    // B offers its own confirmation, still bound to the key on screen.
    fireEvent.click(await screen.findByRole("button", { name: "Erase practice history" }));
    const confirmB = await screen.findByRole("button", { name: "Erase history" });
    expect(confirmB.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmB);
    expect(keys).toEqual(["bind-A", "bind-B"]);
    gate.resolve();
    await waitFor(async () => {
      const rows = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM practice_attempts");
      expect(rows[0]?.n).toBe(0);
    });
  });
});
