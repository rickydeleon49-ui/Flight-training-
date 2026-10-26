// @vitest-environment jsdom
import { createElement as h, act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { validateHomeworkSnapshot, type HomeworkOperation, type HomeworkCardRun as HomeworkCardRunType } from "@/domain/homework";
import type { CardReviewRepository } from "@/data/repositories/cardReviewRepository";
import type { CardRating } from "@/domain/types";
import { cardVersion } from "@/logic/cardIdentity";
import { HomeworkCardRun } from "./HomeworkCardRun";

const F = JSON.parse(
  readFileSync("src-tauri/fixtures/homework-validation/cases.json", "utf8"),
) as { operations: Record<string, HomeworkOperation> };

afterEach(cleanup);

async function setup(key = "card_create", empty = false) {
  const snapshot = structuredClone(F.operations[key]!.next),
    entry = snapshot.activities[0]!;
  const current = await cardVersion(entry.record.material_id!, [
    { front: "One", back: "First", sourcePage: null },
    { front: "Two", back: "Second", sourcePage: null },
  ]);
  const getDueQueue = vi.fn(async () =>
    empty ? [] : current.items.map((item) => ({ itemId: item.itemId, ordinal: item.ordinal, kind: "new", dueAt: null })),
  );
  const saveAction = vi.fn(async (_action: import("@/domain/types").CardReviewAction) => ({}));
  const save = vi.fn(async (_op: HomeworkOperation) => {}),
    reload = vi.fn(),
    reopen = vi.fn();
  const repository = {
    getCardReviewSnapshot: async () => ({
      materialId: entry.record.material_id,
      generation: 0,
      current: { status: "ok", ...current },
      states: {},
    }),
    getDueQueue,
    saveAction,
  } as unknown as CardReviewRepository;
  const { unmount } = render(h(HomeworkCardRun, { snapshot, entry, repository, disabled: false, save, reload, reopen }));
  return { snapshot, current, getDueQueue, saveAction, save, reload, reopen, unmount };
}

it("previews and freezes the bounded linked queue before Start", async () => {
  const { save, current } = await setup();
  await screen.findByText("Review 2 linked cards");
  fireEvent.click(screen.getByRole("button", { name: "Start card review" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const op = save.mock.calls[0]![0];
  const run = op.next.runs[0] as HomeworkCardRunType;
  expect(op.changeKind).toBe("start");
  expect(run.scope.item_ids).toEqual(current.items.map((x) => x.itemId));
  expect(run.scope.generation).toBe(0);
  expect(run.ratings).toEqual([]);
});

it("restart resumes the frozen queue even when no cards are due now", async () => {
  await setup("card_partial", true);
  await screen.findByText("Two");
  expect(screen.getByText("1 of 2 linked cards rated")).toBeTruthy();
  expect(screen.queryByText("One")).toBeNull();
  expect(screen.queryByRole("button", { name: "Start card review" })).toBeNull();
});

it("rating has exact homework attribution and unknown retries reuse its operation", async () => {
  const { saveAction, reload, snapshot } = await setup("card_partial");
  saveAction.mockRejectedValueOnce(new Error("synthetic storage failure"));
  fireEvent.click(await screen.findByRole("button", { name: "Show answer" }));
  fireEvent.click(await screen.findByRole("button", { name: "Again" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry rating" }));
  await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(2));
  expect(saveAction.mock.calls[0]).toEqual(saveAction.mock.calls[1]);
  expect(saveAction.mock.calls[0]![0]).toMatchObject({
    homework: {
      assignmentId: snapshot.assignment.id,
      runId: snapshot.runs[0]!.id,
      expectedRevision: 3,
      activityRevision: 1,
      cycle: 1,
    },
  });
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
});

it("empty queues cannot start or complete homework", async () => {
  await setup("card_create", true);
  // The component awaits its snapshot before asking for the queue.
  await screen.findByText("No linked cards are due or new just now.");
  expect((screen.getByRole("button", { name: "Start card review" }) as HTMLButtonElement).disabled).toBe(true);
});

const ratingKeyCases: Array<[string, CardRating]> = [
  ["1", "again"],
  ["2", "hard"],
  ["3", "good"],
  ["4", "easy"],
];

for (const [key, expectedRating] of ratingKeyCases) {
  it(`supports rating via key ${key} mapping to ${expectedRating} with canonical attribution`, async () => {
    const { saveAction, reload, snapshot } = await setup("card_partial");
    await screen.findByText("Two");
    const sessionRegion = screen.getByLabelText(/Card review session/i);

    fireEvent.keyDown(sessionRegion, { key: "Enter" });
    await screen.findByText("Second");

    fireEvent.keyDown(sessionRegion, { key });
    await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(1));

    expect(saveAction.mock.calls[0]![0]).toMatchObject({
      action: "rate",
      rating: expectedRating,
      homework: {
        assignmentId: snapshot.assignment.id,
        runId: snapshot.runs[0]!.id,
        expectedRevision: 3,
        activityRevision: 1,
        cycle: 1,
      },
    });

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
}

it("ignores digit keys 1-4 before card is revealed", async () => {
  const { saveAction } = await setup("card_partial");
  await screen.findByText("Two");
  const sessionRegion = screen.getByLabelText(/Card review session/i);

  // Digits pressed while unrevealed should be ignored
  fireEvent.keyDown(sessionRegion, { key: "1" });
  fireEvent.keyDown(sessionRegion, { key: "2" });
  fireEvent.keyDown(sessionRegion, { key: "3" });
  fireEvent.keyDown(sessionRegion, { key: "4" });

  expect(saveAction).not.toHaveBeenCalled();
  expect(screen.queryByText("Second")).toBeNull();
});

it("ignores disabled shortcuts and disables buttons when disabled is true", async () => {
  const snapshot = structuredClone(F.operations["card_partial"]!.next);
  const entry = snapshot.activities[0]!;
  const current = await cardVersion(entry.record.material_id!, [
    { front: "One", back: "First", sourcePage: null },
    { front: "Two", back: "Second", sourcePage: null },
  ]);
  const saveAction = vi.fn(async () => ({}));
  const repository = {
    getCardReviewSnapshot: async () => ({
      materialId: entry.record.material_id,
      generation: 0,
      current: { status: "ok", ...current },
      states: {},
    }),
    getDueQueue: async () => current.items.map((i) => ({ itemId: i.itemId, ordinal: i.ordinal, kind: "new", dueAt: null })),
    saveAction,
  } as unknown as CardReviewRepository;

  render(
    h(HomeworkCardRun, {
      snapshot,
      entry,
      repository,
      disabled: true,
      save: vi.fn(),
      reload: vi.fn(),
      reopen: vi.fn(),
    }),
  );

  await screen.findByText("Two");
  const sessionRegion = screen.getByLabelText(/Card review session/i);

  fireEvent.keyDown(sessionRegion, { key: "Enter" });
  expect(screen.queryByText("Second")).toBeNull();

  const showBtn = screen.getByRole("button", { name: "Show answer" });
  expect((showBtn as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(showBtn);
  expect(screen.queryByText("Second")).toBeNull();
  expect(saveAction).not.toHaveBeenCalled();
});

it("ignores editable inputs, modifier chords, key repeats, native button Enter/Space, and outside keys", async () => {
  const { saveAction } = await setup("card_partial");
  await screen.findByText("Two");
  const sessionRegion = screen.getByLabelText(/Card review session/i);

  // Key event outside region
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(screen.queryByText("Second")).toBeNull();

  // Reveal the card
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  await screen.findByText("Second");

  // Held-key repeats ignored
  fireEvent.keyDown(sessionRegion, { key: "1", repeat: true });
  expect(saveAction).not.toHaveBeenCalled();

  // Modifier chords ignored (Ctrl, Alt, Meta, Shift)
  fireEvent.keyDown(sessionRegion, { key: "1", ctrlKey: true });
  fireEvent.keyDown(sessionRegion, { key: "1", altKey: true });
  fireEvent.keyDown(sessionRegion, { key: "1", metaKey: true });
  fireEvent.keyDown(sessionRegion, { key: "1", shiftKey: true });
  expect(saveAction).not.toHaveBeenCalled();

  // Typing in contenteditable (including nested content) should not trigger shortcuts
  const ce = document.createElement("div");
  ce.contentEditable = "true";
  const nestedSpan = document.createElement("span");
  nestedSpan.textContent = "nested editable";
  ce.appendChild(nestedSpan);
  sessionRegion.appendChild(ce);
  nestedSpan.focus();
  fireEvent.keyDown(nestedSpan, { key: "1" });
  expect(saveAction).not.toHaveBeenCalled();
  sessionRegion.removeChild(ce);

  // Typing in textarea should not trigger shortcuts
  const textarea = document.createElement("textarea");
  sessionRegion.appendChild(textarea);
  textarea.focus();
  fireEvent.keyDown(textarea, { key: "2" });
  expect(saveAction).not.toHaveBeenCalled();
  sessionRegion.removeChild(textarea);

  // Typing in select should not trigger shortcuts
  const select = document.createElement("select");
  sessionRegion.appendChild(select);
  select.focus();
  fireEvent.keyDown(select, { key: "3" });
  expect(saveAction).not.toHaveBeenCalled();
  sessionRegion.removeChild(select);

  // Typing in an input inside or outside should not trigger shortcuts
  const input = document.createElement("input");
  sessionRegion.appendChild(input);
  input.focus();
  fireEvent.keyDown(input, { key: "1" });
  expect(saveAction).not.toHaveBeenCalled();
  sessionRegion.removeChild(input);

  // Native button Space/Enter should be handled natively without handler double firing
  const againBtn = screen.getByRole("button", { name: "Again" });
  fireEvent.keyDown(againBtn, { key: "Enter" });
  expect(saveAction).not.toHaveBeenCalled();

  // Native link Space/Enter should be handled natively
  const link = document.createElement("a");
  link.href = "#";
  sessionRegion.appendChild(link);
  link.focus();
  fireEvent.keyDown(link, { key: " " });
  expect(saveAction).not.toHaveBeenCalled();
  sessionRegion.removeChild(link);
});

it("prevents duplicate key and click writes while save is pending with deferred promise", async () => {
  let resolveSave!: (value: object) => void;
  const savePromise = new Promise<object>((resolve) => {
    resolveSave = resolve;
  });
  const { saveAction, reload } = await setup("card_partial");
  saveAction.mockReturnValue(savePromise);

  await screen.findByText("Two");
  const sessionRegion = screen.getByLabelText(/Card review session/i);

  // Reveal card
  fireEvent.keyDown(sessionRegion, { key: " " });
  await screen.findByText("Second");

  // First deliberate rating
  fireEvent.keyDown(sessionRegion, { key: "2" }); // Hard
  expect(saveAction).toHaveBeenCalledTimes(1);

  // Status shows saving rating
  const pendingStatus = screen.getByRole("status");
  expect(pendingStatus.textContent).toMatch(/Saving rating/);

  // While pending, secondary key press or button clicks must be prevented
  fireEvent.keyDown(sessionRegion, { key: "2" });
  fireEvent.keyDown(sessionRegion, { key: "3" });
  const easyBtn = screen.getByRole("button", { name: "Easy" });
  expect(easyBtn.hasAttribute("disabled")).toBe(true);
  fireEvent.click(easyBtn);

  expect(saveAction).toHaveBeenCalledTimes(1);

  // Now resolve the deferred promise
  resolveSave({});
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
});

it("on failure keeps alert and same operation Retry without false saved status", async () => {
  const { saveAction, reload } = await setup("card_partial");
  saveAction.mockRejectedValueOnce(new Error("network dropped"));

  await screen.findByText("Two");
  const sessionRegion = screen.getByLabelText(/Card review session/i);

  // Reveal and rate
  fireEvent.keyDown(sessionRegion, { key: "Enter" });
  await screen.findByText("Second");
  fireEvent.keyDown(sessionRegion, { key: "1" }); // Again

  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toMatch(/This rating wasn't confirmed/);

  // Must NOT have affirmative saved role=status
  expect(screen.queryByRole("status")).toBeNull();
  expect(reload).not.toHaveBeenCalled();

  // While uncertain, another rating key from focused region/heading or rating button must be blocked
  const heading = screen.getByRole("heading", { level: 4 });
  heading.focus();
  fireEvent.keyDown(heading, { key: "4" });
  fireEvent.keyDown(sessionRegion, { key: "3" });
  const hardBtn = screen.getByRole("button", { name: "Hard" });
  expect((hardBtn as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(hardBtn);

  // Still exactly 1 saveAction call, 0 reloads, no affirmative saved status
  expect(saveAction).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();

  // Retry uses same operation
  const retryBtn = screen.getByRole("button", { name: "Retry rating" });
  fireEvent.click(retryBtn);

  await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(2));
  expect(saveAction.mock.calls[0]![0]).toEqual(saveAction.mock.calls[1]![0]);
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("ignores late save completion when unmounted before ack, never firing reload or showing stale error", async () => {
  let resolveSaveAction!: (value: object) => void;
  const deferredSave = new Promise<object>((resolve) => {
    resolveSaveAction = resolve;
  });
  const { saveAction, reload, unmount } = await setup("card_partial");
  saveAction.mockReturnValueOnce(deferredSave);

  await screen.findByText("Two");
  const sessionRegion = screen.getByLabelText(/Card review session/i);

  fireEvent.keyDown(sessionRegion, { key: " " });
  await screen.findByText("Second");
  fireEvent.keyDown(sessionRegion, { key: "3" }); // Good

  expect(saveAction).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();

  // Unmount child component before save resolves
  unmount();

  // Resolve save within React act to flush asynchronous effects
  await act(async () => {
    resolveSaveAction({});
    await Promise.resolve();
  });

  // Verify reload callback NEVER fires and no stale errors occur
  expect(reload).not.toHaveBeenCalled();
});

it("transitions focus to heading on confirmed advance, but does not steal focus when user is editing", async () => {
  const startSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_start"]!.next));
  const partialSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_partial"]!.next));
  const entry = startSnapshot.activities[0]!;
  const current = await cardVersion(entry.record.material_id!, [
    { front: "One", back: "First", sourcePage: null },
    { front: "Two", back: "Second", sourcePage: null },
  ]);

  let currentSnapshot = startSnapshot;
  const saveAction = vi.fn(async () => ({}));
  const save = vi.fn(async () => {});
  const reload = vi.fn();
  const reopen = vi.fn();

  const repository = {
    getCardReviewSnapshot: async () => ({
      materialId: entry.record.material_id,
      generation: 0,
      current: { status: "ok", ...current },
      states: {},
    }),
    getDueQueue: async () =>
      current.items.map((i) => ({ itemId: i.itemId, ordinal: i.ordinal, kind: "new", dueAt: null })),
    saveAction,
  } as unknown as CardReviewRepository;

  const { rerender } = render(
    h(HomeworkCardRun, {
      snapshot: currentSnapshot,
      entry,
      repository,
      disabled: false,
      save,
      reload,
      reopen,
    }),
  );

  await screen.findByText("One");
  const sessionRegion = screen.getByLabelText(/Card review session/i);

  // Reveal and rate "One"
  fireEvent.keyDown(sessionRegion, { key: " " });
  await screen.findByText("First");
  fireEvent.keyDown(sessionRegion, { key: "4" }); // Easy
  await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(1));

  // Advance snapshot to card_partial ("Two")
  rerender(
    h(HomeworkCardRun, {
      snapshot: partialSnapshot,
      entry: partialSnapshot.activities[0]!,
      repository,
      disabled: false,
      save,
      reload,
      reopen,
    }),
  );

  await screen.findByText("Two");
  const heading = screen.getByRole("heading", { level: 4 });
  expect(document.activeElement).toBe(heading);

  // Verify non-stealing behavior when user is editing
  const input = document.createElement("input");
  document.body.appendChild(input);
  input.focus();
  expect(document.activeElement).toBe(input);

  rerender(
    h(HomeworkCardRun, {
      snapshot: partialSnapshot,
      entry: partialSnapshot.activities[0]!,
      repository,
      disabled: false,
      save,
      reload,
      reopen,
    }),
  );
  expect(document.activeElement).toBe(input);
  input.remove();
});

it("displays drift state and ignores shortcuts when source changes", async () => {
  const snapshot = structuredClone(F.operations["card_partial"]!.next);
  const entry = snapshot.activities[0]!;
  const current = await cardVersion(entry.record.material_id!, [
    { front: "One", back: "First", sourcePage: null },
  ]);
  const saveAction = vi.fn(async () => ({}));
  // Generation mismatch triggers drift
  const repository = {
    getCardReviewSnapshot: async () => ({
      materialId: entry.record.material_id,
      generation: 99,
      current: { status: "ok", ...current },
      states: {},
    }),
    getDueQueue: async () => [],
    saveAction,
  } as unknown as CardReviewRepository;

  render(
    h(HomeworkCardRun, {
      snapshot,
      entry,
      repository,
      disabled: false,
      save: vi.fn(),
      reload: vi.fn(),
      reopen: vi.fn(),
    }),
  );

  await screen.findByText("This review changed or was reset. Restart it to choose a fresh queue.");
  expect(screen.queryByLabelText(/Card review session/i)).toBeNull();
});

it("displays completed state when run is finished using canonical card_finished", async () => {
  const finishedSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_finished"]!.next));
  const entry = finishedSnapshot.activities[0]!;
  const current = await cardVersion(entry.record.material_id!, [
    { front: "One", back: "First", sourcePage: null },
    { front: "Two", back: "Second", sourcePage: null },
  ]);
  const repository = {
    getCardReviewSnapshot: async () => ({
      materialId: entry.record.material_id,
      generation: 0,
      current: { status: "ok", ...current },
      states: {},
    }),
    getDueQueue: async () => [],
    saveAction: vi.fn(),
  } as unknown as CardReviewRepository;

  render(
    h(HomeworkCardRun, {
      snapshot: finishedSnapshot,
      entry,
      repository,
      disabled: false,
      save: vi.fn(),
      reload: vi.fn(),
      reopen: vi.fn(),
    }),
  );

  await screen.findByText(/Review complete · 2 linked cards rated/);
  expect(screen.queryByLabelText(/Card review session/i)).toBeNull();
  const status = await screen.findByRole("status");
  expect(status.textContent).toMatch(/2 card ratings saved/);
});
