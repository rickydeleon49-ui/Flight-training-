// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { FlightDeck } from "./FlightDeck";
import { ReminderPopup } from "@/components/reminders/ReminderPopup";
import { ActionRow } from "@/components/actions/ActionRow";
import { makeAction } from "@/testing/factories";
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
});
