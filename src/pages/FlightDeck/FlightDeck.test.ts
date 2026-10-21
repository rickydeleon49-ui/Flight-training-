// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { FlightDeck } from "./FlightDeck";
import { ReminderPopup } from "@/components/reminders/ReminderPopup";
import { ActionRow } from "@/components/actions/ActionRow";
import { makeAction, makeEvent, makeMaterial } from "@/testing/factories";
import type { HomeworkSnapshot } from "@/domain/homework";

let appData: AppData;

vi.mock("@/state/AppDataContext", async (importOriginal) => ({
  ...await importOriginal<object>(),
  useAppData: () => ({
    data: appData,
    dataRevision: 1,
    repositories: null,
    refresh: vi.fn(),
    mutate: vi.fn().mockResolvedValue({ ok: true }),
  }),
}));

if (typeof window !== "undefined") {
  (window as unknown as { Notification: unknown }).Notification = class {
    static permission = "granted";
    static requestPermission = vi.fn().mockResolvedValue("granted");
  };
}

beforeEach(() => {
  sessionStorage.clear();
  appData = {
    ...EMPTY_DATA,
    toolkit: {
      ...EMPTY_DATA.toolkit,
      remindersEnabled: true,
      reminderLeadDays: 7,
    },
  };
});

afterEach(cleanup);

describe("FlightDeck and reminders bound homework actions", () => {
  it("homework_action_shows_open_homework_not_generic_controls", async () => {
    const actionId = "act-101";
    const hwId = "hw-202";
    const boundAction = makeAction({
      id: actionId,
      title: "Complete weather preflight reading",
      dueDate: "2026-10-15",
      estimatedMinutes: 45,
    });
    const hwSnapshot: HomeworkSnapshot = {
      version: 1,
      runs: [],
      activities: [],
      assignment: {
        id: hwId,
        title: "Weather assignment",
        instructions: "",
        school: null,
        instructor: null,
        lesson_id: null,
        source_lesson_id: null,
        due_date: "2026-10-15",
        state: "upcoming",
        revision: 1,
        action_id: actionId,
        archived: 0,
        created_at: "2026-10-10T10:00:00.000Z",
        updated_at: "2026-10-10T10:00:00.000Z",
        completed_at: null,
      },
    };

    appData.actions = [boundAction];
    appData.homework = [hwSnapshot];

    render(h(MemoryRouter, null, h(FlightDeck)));

    expect(await screen.findByText("Needs attention")).toBeTruthy();
    expect(screen.getAllByText("Complete weather preflight reading").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Homework overdue").length).toBeGreaterThan(0);

    const openHwLinks = screen.getAllByRole("link", { name: "Open homework" });
    expect(openHwLinks.length).toBeGreaterThan(0);
    expect(openHwLinks[0]?.getAttribute("href")).toBe(`/study/homework/${hwId}`);

    expect(screen.queryByRole("button", { name: "Reschedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    cleanup();

    render(
      h(MemoryRouter, null,
        h(ActionRow, {
          action: boundAction,
          today: "2026-10-21",
          onToggle: vi.fn(),
          onEdit: vi.fn(),
          onReschedule: vi.fn(),
          onDelete: vi.fn(),
        })
      )
    );

    expect(screen.getByRole("link", { name: "Open homework" })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/i })).toBeNull();
  });

  it("reminders_dialog_opens_homework_for_bound_action", async () => {
    const actionId = "act-101";
    const hwId = "hw-202";
    const boundAction = makeAction({
      id: actionId,
      title: "Preflight weather review",
      dueDate: "2026-10-15",
      estimatedMinutes: 30,
    });
    const hwSnapshot: HomeworkSnapshot = {
      version: 1,
      runs: [],
      activities: [],
      assignment: {
        id: hwId,
        title: "Weather assignment",
        instructions: "",
        school: null,
        instructor: null,
        lesson_id: null,
        source_lesson_id: null,
        due_date: "2026-10-15",
        state: "upcoming",
        revision: 1,
        action_id: actionId,
        archived: 0,
        created_at: "2026-10-10T10:00:00.000Z",
        updated_at: "2026-10-10T10:00:00.000Z",
        completed_at: null,
      },
    };

    appData.actions = [boundAction];
    appData.homework = [hwSnapshot];

    render(h(MemoryRouter, null, h(ReminderPopup)));

    expect(await screen.findByText("Training reminders")).toBeTruthy();
    expect(screen.getByText("Homework overdue")).toBeTruthy();
    expect(screen.queryByText("Action overdue")).toBeNull();

    const openHwLinks = screen.getAllByRole("link", { name: "Open homework" });
    expect(openHwLinks.length).toBeGreaterThan(0);
    expect(openHwLinks.some((l) => l.getAttribute("href") === `/study/homework/${hwId}`)).toBe(true);
    expect(screen.queryByRole("link", { name: "Open toolkit" })).toBeNull();
  });

  it("flight_deck_empty_states_consistent_with_recommendations", async () => {
    // When recommendations exist (e.g. study material needing review), but nothing is scheduled for today:
    const material = makeMaterial({
      id: "mat-1",
      title: "Cross-Country Navigation Principles",
      reviewStatus: "needs_review",
    });
    appData.materials = [material];
    appData.actions = [];

    render(h(MemoryRouter, null, h(FlightDeck)));

    expect(await screen.findByText("Recommended for today")).toBeTruthy();

    // Today's plan empty state tells her nothing else is scheduled and references recommendations above
    expect(screen.getByText("Nothing else is scheduled today.")).toBeTruthy();
    expect(screen.queryByText("Nothing is scheduled for today.")).toBeNull();

    // The summary banner at the bottom also references recommendations above rather than saying "Nothing is waiting."
    const bannerItems = screen.getAllByText("Your recommended items are above.");
    expect(bannerItems.length).toBe(2);
    expect(screen.queryByText(/Nothing is waiting/i)).toBeNull();

    cleanup();

    // When no recommendations exist (e.g. only far-future event, no materials/actions):
    appData.materials = [];
    appData.actions = [];
    appData.events = [makeEvent({ id: "evt-1", date: "2026-12-01", title: "Future Solo" })];

    render(h(MemoryRouter, null, h(FlightDeck)));

    expect(await screen.findByText("Nothing is scheduled for today.")).toBeTruthy();
    expect(screen.getByText("A good moment to look at your Flight Path and choose the next step.")).toBeTruthy();
    expect(screen.getByText("Nothing is waiting. A good moment to plan your next step.")).toBeTruthy();
  });

  it("needs_attention_wording_for_homework_items", async () => {
    const action1 = makeAction({
      id: "act-hw-1",
      title: "VOR Orientation exercise",
      dueDate: "2026-10-15",
    });
    const hw1: HomeworkSnapshot = {
      version: 1,
      runs: [],
      activities: [],
      assignment: {
        id: "hw-1",
        title: "VOR Assignment",
        instructions: "",
        school: null,
        instructor: null,
        lesson_id: null,
        source_lesson_id: null,
        due_date: "2026-10-15",
        state: "upcoming",
        revision: 1,
        action_id: "act-hw-1",
        archived: 0,
        created_at: "2026-10-10T10:00:00.000Z",
        updated_at: "2026-10-10T10:00:00.000Z",
        completed_at: null,
      },
    };

    // Case A: 1 overdue item, and it is homework-bound
    appData.actions = [action1];
    appData.homework = [hw1];

    render(h(MemoryRouter, null, h(FlightDeck)));

    expect(await screen.findByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("This homework is past its due date. Open it to keep going.")).toBeTruthy();
    expect(screen.queryByText(/This didn['’]t get finished/)).toBeNull();

    expect(screen.getByText("1 homework item is waiting. Open it to keep going.")).toBeTruthy();
    expect(screen.queryByText("1 item is waiting. Choose a realistic new time for one of them.")).toBeNull();

    cleanup();

    // Case B: 2 overdue items, and both are homework-bound
    const action2 = makeAction({
      id: "act-hw-2",
      title: "Weight and Balance calculations",
      dueDate: "2026-10-16",
    });
    const hw2: HomeworkSnapshot = {
      version: 1,
      runs: [],
      activities: [],
      assignment: {
        id: "hw-2",
        title: "W&B Assignment",
        instructions: "",
        school: null,
        instructor: null,
        lesson_id: null,
        source_lesson_id: null,
        due_date: "2026-10-16",
        state: "upcoming",
        revision: 1,
        action_id: "act-hw-2",
        archived: 0,
        created_at: "2026-10-10T10:00:00.000Z",
        updated_at: "2026-10-10T10:00:00.000Z",
        completed_at: null,
      },
    };

    appData.actions = [action1, action2];
    appData.homework = [hw1, hw2];

    render(h(MemoryRouter, null, h(FlightDeck)));

    expect(await screen.findByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("This homework is past its due date. Open it to keep going.")).toBeTruthy();
    expect(screen.getByText("2 homework items are waiting. Open them to keep going.")).toBeTruthy();

    cleanup();

    // Case C: Mixed or regular overdue actions (not all homework-bound)
    const regularAction = makeAction({
      id: "act-regular",
      title: "Call examiner",
      dueDate: "2026-10-17",
    });

    appData.actions = [regularAction];
    appData.homework = [];

    render(h(MemoryRouter, null, h(FlightDeck)));

    expect(await screen.findByText("Needs attention")).toBeTruthy();
    expect(screen.getByText(/This didn['’]t get finished\. Choose a realistic new time, or mark it done\./)).toBeTruthy();
    expect(screen.queryByText("This homework is past its due date. Open it to keep going.")).toBeNull();
    expect(screen.getByText("1 item is waiting. Choose a realistic new time for one of them.")).toBeTruthy();
  });
});
