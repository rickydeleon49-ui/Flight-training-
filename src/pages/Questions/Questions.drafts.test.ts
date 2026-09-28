// @vitest-environment jsdom
/**
 * Unsaved answers and paging on the Questions page, through the real page,
 * AppDataProvider and SQLite. Order is deterministic: rows are listed newest
 * first by `created_at`, and fixtures set it explicitly.
 *
 * Rules under test:
 * - An unsaved answer belongs to its question id and survives the row leaving
 *   the visible page (a new question, a filter change, paging).
 * - Nothing is saved automatically. Save stores that one question's answer
 *   and clears only its draft; a failed save keeps the draft.
 * - Cancel deliberately discards that question's unsaved answer.
 * - A question that no longer exists has no editor, so nothing can be written
 *   through a stale draft.
 * - Every real filter change starts again from one page.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlValue } from "@/data/db";
import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

import { QUESTION_PAGE_SIZE, Questions } from "./Questions";

/**
 * Seeding and rendering hundreds of questions takes about 2.3 s on its own,
 * but over the 5 s default when the whole suite runs files in parallel.
 * A longer limit for these long-list tests only; no assertion is relaxed.
 */
const LONG_LIST_TIMEOUT_MS = 20_000;

let base: TestDatabase;
let db: TestDatabase;
let repos: Repositories;
let failNextQuestionUpdate = false;
let updateQuestionGate: { promise: Promise<void>; resolve: () => void } | null = null;
let updateQuestionCalls = 0;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  return null;
}
function Ready() {
  return useAppData().status === "ready" ? h(Questions) : null;
}
async function open() {
  render(h(AppDataProvider, null, h(MemoryRouter, null, h(Probe), h(Ready))));
  await waitFor(() => expect(context.status).toBe("ready"));
  await screen.findByRole("heading", { name: "Questions" });
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  failNextQuestionUpdate = false;
  updateQuestionGate = null;
  updateQuestionCalls = 0;
  base = await createNodeSqliteDatabase();
  db = {
    ...base,
    async execute(sql: string, params?: SqlValue[]) {
      if (sql.trimStart().startsWith("UPDATE questions")) {
        updateQuestionCalls++;
        if (updateQuestionGate) {
          await updateQuestionGate.promise;
        }
        if (failNextQuestionUpdate) {
          failNextQuestionUpdate = false;
          throw new Error("disk I/O error");
        }
      }
      return base.execute(sql, params);
    },
    close: () => base.close(),
  };
  repos = createRepositories(base);
  await repos.app.set("airline_starter_pack", "skipped-for-tests");
});
afterEach(() => {
  cleanup();
  base.close();
});

/** `count` questions; q-0 is the oldest. Even ones are unanswered. */
async function seed(count: number, answered: (i: number) => boolean = (i) => i % 2 === 1) {
  for (let i = 0; i < count; i++) {
    const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
    await base.execute(
      `INSERT INTO questions (id, text, topic, status, answer, created_at, updated_at)
       VALUES (?, ?, 'general', ?, ?, ?, ?)`,
      [`q-${i}`, `Question ${i}`, answered(i) ? "answered" : "to_ask", answered(i) ? `Saved answer ${i}` : "", stamp, stamp],
    );
  }
}

const rowFor = (text: string) =>
  screen.queryAllByText(text, { selector: ".question-row__text" })[0]?.closest(".question-row") as HTMLElement | undefined;
const rows = () => document.querySelectorAll(".question-row").length;

function startAnswer(text: string, typed: string) {
  const row = rowFor(text)!;
  fireEvent.click(within(row).getByRole("button", { name: /Add answer|Edit answer/ }));
  fireEvent.change(within(row).getByLabelText("Answer"), { target: { value: typed } });
}
const draftIn = (text: string) =>
  (rowFor(text) ? within(rowFor(text)!).queryByLabelText("Answer") as HTMLTextAreaElement | null : null)?.value;

describe("unsaved answers on the Questions page", () => {
  it("keep a draft when a new question pushes its row off the page, and restore it after Show more", async () => {
    await seed(QUESTION_PAGE_SIZE + 1); // q-100 newest … q-1 is the 100th row, q-0 the 101st
    await open();
    expect(rowFor("Question 1")).toBeTruthy();
    expect(rowFor("Question 0")).toBeUndefined();

    startAnswer("Question 1", "Unsaved: hold 10 degrees of bank");

    // A new question through the page's own form (normal mutation + refresh).
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Brand new question" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    });
    await screen.findByText("Brand new question");
    expect(rowFor("Question 1")).toBeUndefined(); // displaced to row 101

    fireEvent.click(screen.getByRole("button", { name: /more questions/ }));
    expect(draftIn("Question 1")).toBe("Unsaved: hold 10 degrees of bank");
    // Nothing was saved automatically.
    expect((await repos.questions.get("q-1"))?.answer).toBe("Saved answer 1");
  }, LONG_LIST_TIMEOUT_MS);

  it("keep a draft across filter changes and paging", async () => {
    await seed(250);
    await open();
    startAnswer("Question 248", "Draft across filters");

    fireEvent.click(screen.getByRole("button", { name: "Answered" }));
    expect(rowFor("Question 248")).toBeUndefined(); // unanswered: filtered out
    fireEvent.click(screen.getByRole("button", { name: "Everything" }));
    expect(draftIn("Question 248")).toBe("Draft across filters");

    fireEvent.click(screen.getByRole("button", { name: /more questions/ }));
    fireEvent.click(screen.getByRole("button", { name: "To Ask" }));
    expect(draftIn("Question 248")).toBe("Draft across filters");
  }, LONG_LIST_TIMEOUT_MS);

  it("keeps several drafts apart, and saving one clears only that one", async () => {
    await seed(5);
    await open();
    startAnswer("Question 4", "Answer for four");
    startAnswer("Question 2", "Answer for two");
    expect(draftIn("Question 4")).toBe("Answer for four");
    expect(draftIn("Question 2")).toBe("Answer for two");

    await act(async () => {
      fireEvent.click(within(rowFor("Question 4")!).getByRole("button", { name: "Save answer" }));
    });
    await waitFor(async () => expect((await repos.questions.get("q-4"))?.answer).toBe("Answer for four"));
    expect(draftIn("Question 4")).toBeUndefined();
    expect(within(rowFor("Question 4")!).getByText("Answer for four")).toBeTruthy();
    expect(draftIn("Question 2")).toBe("Answer for two");
    expect((await repos.questions.get("q-2"))?.answer).toBe("");
  });

  function createGate() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, resolve: release };
  }

  it("disables conflicting controls during delayed save, and preserves new typing typed while pending", async () => {
    await seed(3);
    await open();
    startAnswer("Question 2", "Submitted answer");

    const gate = createGate();
    updateQuestionGate = gate;

    const row = rowFor("Question 2")!;
    fireEvent.click(within(row).getByRole("button", { name: "Save answer" }));

    // Conflicting controls are disabled during save
    expect((within(row).getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(row).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(row).getByLabelText("Answer") as HTMLTextAreaElement).disabled).toBe(true);
    expect((within(row).getByLabelText(/Status for: Question 2/) as HTMLSelectElement).disabled).toBe(true);
    expect((within(row).getByRole("button", { name: /Delete question: Question 2/ }) as HTMLButtonElement).disabled).toBe(true);

    // New typing entered while pending (e.g. via change event) is preserved by revision ownership
    fireEvent.change(within(row).getByLabelText("Answer"), {
      target: { value: "Newer answer" },
    });

    await act(async () => {
      gate.resolve();
    });

    await waitFor(async () => expect((await repos.questions.get("q-2"))?.answer).toBe("Submitted answer"));
    // Newer draft was not wiped out by the old completion
    expect(draftIn("Question 2")).toBe("Newer answer");
  });

  it("an old completion cannot clear a newer editing session", async () => {
    await seed(3);
    await open();
    startAnswer("Question 2", "Session 1 answer");

    const gate = createGate();
    updateQuestionGate = gate;

    const row = rowFor("Question 2")!;
    fireEvent.click(within(row).getByRole("button", { name: "Save answer" }));

    // While save 1 is in-flight, a new editing session begins with different text
    fireEvent.change(within(row).getByLabelText("Answer"), {
      target: { value: "Session 2 answer" },
    });

    // Release save 1
    await act(async () => {
      gate.resolve();
    });

    await waitFor(async () => expect((await repos.questions.get("q-2"))?.answer).toBe("Session 1 answer"));
    // Save 1 completion must not clear the newer session
    expect(draftIn("Question 2")).toBe("Session 2 answer");

    // Now save session 2
    updateQuestionGate = null;
    await act(async () => {
      fireEvent.click(within(rowFor("Question 2")!).getByRole("button", { name: "Save answer" }));
    });
    await waitFor(async () => expect((await repos.questions.get("q-2"))?.answer).toBe("Session 2 answer"));
    expect(draftIn("Question 2")).toBeUndefined();
  });

  it("duplicate clicks within one React batch produce only one submission, and later edit/save works", async () => {
    await seed(3);
    await open();
    startAnswer("Question 2", "Single submission");

    const gate = createGate();
    updateQuestionGate = gate;

    const row = rowFor("Question 2")!;
    const saveButton = within(row).getByRole("button", { name: "Save answer" });

    // Call Save button twice within one React batch while the first update is blocked
    act(() => {
      fireEvent.click(saveButton);
      fireEvent.click(saveButton);
    });

    // Exactly one database update occurs
    await act(async () => {
      gate.resolve();
    });

    await waitFor(async () => expect((await repos.questions.get("q-2"))?.answer).toBe("Single submission"));
    expect(updateQuestionCalls).toBe(1);

    // A completed save releases the guard and permits a deliberate later edit/save
    updateQuestionGate = null;
    startAnswer("Question 2", "Deliberate second edit");
    await act(async () => {
      fireEvent.click(within(rowFor("Question 2")!).getByRole("button", { name: "Save answer" }));
    });
    await waitFor(async () => expect((await repos.questions.get("q-2"))?.answer).toBe("Deliberate second edit"));
    expect(updateQuestionCalls).toBe(2);
    expect(draftIn("Question 2")).toBeUndefined();
  });

  it("pending ownership survives filtering away and back", async () => {
    await seed(3);
    await open();
    startAnswer("Question 2", "Draft across filter during save");

    const gate = createGate();
    updateQuestionGate = gate;

    const row = rowFor("Question 2")!;
    fireEvent.click(within(row).getByRole("button", { name: "Save answer" }));
    expect((within(row).getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);

    // Switch filter: Question 2 is "to_ask", so Answered filters it out
    fireEvent.click(screen.getByRole("button", { name: "Answered" }));
    expect(rowFor("Question 2")).toBeUndefined();

    // Switch back to Everything: row remounts
    fireEvent.click(screen.getByRole("button", { name: "Everything" }));
    const remountedRow = rowFor("Question 2")!;
    expect(remountedRow).toBeTruthy();

    // Pending ownership was preserved: controls remain in saving state
    expect((within(remountedRow).getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(remountedRow).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(remountedRow).getByLabelText("Answer") as HTMLTextAreaElement).disabled).toBe(true);

    // Release save
    await act(async () => {
      gate.resolve();
    });

    await waitFor(async () => expect((await repos.questions.get("q-2"))?.answer).toBe("Draft across filter during save"));
    expect(draftIn("Question 2")).toBeUndefined();
    expect(within(rowFor("Question 2")!).getByText("Draft across filter during save")).toBeTruthy();
  });

  it("delayed failure preserves input and permits retry", async () => {
    await seed(3);
    await open();
    startAnswer("Question 2", "Retry after failure");

    failNextQuestionUpdate = true;
    const gate = createGate();
    updateQuestionGate = gate;

    const row = rowFor("Question 2")!;
    const saveButton = within(row).getByRole("button", { name: "Save answer" });
    act(() => {
      fireEvent.click(saveButton);
      fireEvent.click(saveButton);
    });
    expect((within(row).getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      gate.resolve();
    });

    await waitFor(() => expect(context.lastError).toBeTruthy());
    // Only one update attempt was made before failure
    expect(updateQuestionCalls).toBe(1);
    // Draft is preserved
    expect(draftIn("Question 2")).toBe("Retry after failure");
    expect((await repos.questions.get("q-2"))?.answer).toBe("");

    // Controls re-enabled and guard released
    const retryRow = rowFor("Question 2")!;
    const retrySave = within(retryRow).getByRole("button", { name: "Save answer" }) as HTMLButtonElement;
    expect(retrySave.disabled).toBe(false);

    // Retry succeeds
    updateQuestionGate = null;
    await act(async () => {
      fireEvent.click(retrySave);
    });
    await waitFor(async () => expect((await repos.questions.get("q-2"))?.answer).toBe("Retry after failure"));
    expect(updateQuestionCalls).toBe(2);
    expect(draftIn("Question 2")).toBeUndefined();
  });

  it("another question's draft remains unaffected during a delayed save", async () => {
    await seed(3);
    await open();
    startAnswer("Question 2", "Answer for two");
    startAnswer("Question 1", "Answer for one");

    const gate = createGate();
    updateQuestionGate = gate;

    // Start saving Question 2
    fireEvent.click(within(rowFor("Question 2")!).getByRole("button", { name: "Save answer" }));
    expect((within(rowFor("Question 2")!).getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);

    // Question 1 remains independently editable and functional
    const row1 = rowFor("Question 1")!;
    expect((within(row1).getByRole("button", { name: "Save answer" }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(row1).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(row1).getByLabelText("Answer") as HTMLTextAreaElement).disabled).toBe(false);

    // Edit Question 1 while Question 2 is saving
    fireEvent.change(within(row1).getByLabelText("Answer"), { target: { value: "Answer for one edited" } });
    expect(draftIn("Question 1")).toBe("Answer for one edited");

    // Release Question 2
    await act(async () => {
      gate.resolve();
    });

    await waitFor(async () => expect((await repos.questions.get("q-2"))?.answer).toBe("Answer for two"));
    expect(draftIn("Question 2")).toBeUndefined();

    // Question 1's draft was unaffected
    expect(draftIn("Question 1")).toBe("Answer for one edited");

    // Now save Question 1
    updateQuestionGate = null;
    await act(async () => {
      fireEvent.click(within(rowFor("Question 1")!).getByRole("button", { name: "Save answer" }));
    });
    await waitFor(async () => expect((await repos.questions.get("q-1"))?.answer).toBe("Answer for one edited"));
    expect(draftIn("Question 1")).toBeUndefined();
  });

  it("keeps the draft when saving fails", async () => {
    await seed(3);
    await open();
    startAnswer("Question 2", "Keep me after a failure");
    failNextQuestionUpdate = true;
    await act(async () => {
      fireEvent.click(within(rowFor("Question 2")!).getByRole("button", { name: "Save answer" }));
    });
    await waitFor(() => expect(context.lastError).toBeTruthy());
    expect(draftIn("Question 2")).toBe("Keep me after a failure");
    expect((await repos.questions.get("q-2"))?.answer).toBe("");
  });

  it("discards only that question's draft on Cancel, and reopening starts from the saved answer", async () => {
    await seed(4);
    await open();
    startAnswer("Question 3", "Replacement I changed my mind about");
    startAnswer("Question 2", "Other draft");
    fireEvent.click(within(rowFor("Question 3")!).getByRole("button", { name: "Cancel" }));
    expect(draftIn("Question 3")).toBeUndefined();
    expect(within(rowFor("Question 3")!).getByText("Saved answer 3")).toBeTruthy();
    fireEvent.click(within(rowFor("Question 3")!).getByRole("button", { name: "Edit answer" }));
    expect(draftIn("Question 3")).toBe("Saved answer 3");
    expect(draftIn("Question 2")).toBe("Other draft");
  });

  it("leaves no editor that can write anywhere once its question is deleted", async () => {
    await seed(3);
    await open();
    startAnswer("Question 2", "Draft for a question about to go");
    await repos.questions.remove("q-2");
    await act(async () => {
      await context.refresh();
    });
    expect(rowFor("Question 2")).toBeUndefined();
    expect(screen.queryAllByLabelText("Answer")).toHaveLength(0);
    // Other questions are untouched, and a new answer elsewhere saves only there.
    startAnswer("Question 1", "Answer for one");
    await act(async () => {
      fireEvent.click(within(rowFor("Question 1")!).getByRole("button", { name: "Save answer" }));
    });
    await waitFor(async () => expect((await repos.questions.get("q-1"))?.answer).toBe("Answer for one"));
    expect((await repos.questions.get("q-0"))?.answer).toBe("");
    expect((await repos.questions.list()).map((q) => q.id).sort()).toEqual(["q-0", "q-1"]);
  });
});

describe("paging resets on every real filter change", () => {
  it("returns to one page when switching away and back, before and after expanding the other filter", async () => {
    await seed(250); // 125 answered
    await open();

    fireEvent.click(screen.getByRole("button", { name: "Show 100 more questions" }));
    expect(rows()).toBe(200);
    fireEvent.click(screen.getByRole("button", { name: "Answered" }));
    expect(rows()).toBe(QUESTION_PAGE_SIZE);
    fireEvent.click(screen.getByRole("button", { name: "Everything" }));
    expect(rows()).toBe(QUESTION_PAGE_SIZE);

    fireEvent.click(screen.getByRole("button", { name: "Answered" }));
    fireEvent.click(screen.getByRole("button", { name: "Show 25 more questions" }));
    expect(rows()).toBe(125);
    fireEvent.click(screen.getByRole("button", { name: "Everything" }));
    expect(rows()).toBe(QUESTION_PAGE_SIZE);
    fireEvent.click(screen.getByRole("button", { name: "Answered" }));
    expect(rows()).toBe(QUESTION_PAGE_SIZE);
    expect(screen.getByText(`Showing ${QUESTION_PAGE_SIZE} of 125 questions`)).toBeTruthy();
  }, LONG_LIST_TIMEOUT_MS);

  it("does not reset when the same filter is chosen again", async () => {
    await seed(250);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Show 100 more questions" }));
    fireEvent.click(screen.getByRole("button", { name: "Everything" }));
    expect(rows()).toBe(200);
  }, LONG_LIST_TIMEOUT_MS);
});
