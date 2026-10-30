// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { FlightDeck } from "./FlightDeck";
import { expectNoA11yViolations } from "@/testing/a11y";
import { PilotToolkit } from "@/pages/PilotToolkit/PilotToolkit";
import { ActionRow } from "@/components/actions/ActionRow";
import { makeAction, makeEvent, makeJournalEntry, makeMaterial, makePrepItem, makeQuestion } from "@/testing/factories";
import type { HomeworkSnapshot } from "@/domain/homework";

let appData: AppData;
let repositoriesMock: unknown = null;

vi.mock("@/state/AppDataContext", async (importOriginal) => ({
  ...await importOriginal<object>(),
  useAppData: () => ({
    data: appData,
    status: "ready",
    dataRevision: 1,
    repositories: repositoriesMock,
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
  repositoriesMock = null;
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

  it("toolkit_reminders_opens_homework_for_bound_action", async () => {
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

    render(h(MemoryRouter, null, h(PilotToolkit)));
    fireEvent.click(screen.getByRole("tab", { name: "Reminders" }));

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
    await expectNoA11yViolations(document.body);

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

  it("surfaces ACS material coverage disclosure collapsed by default and handles study focus presence and absence", async () => {
    // 1. When material has ACS tags and is in Study Focus
    const acsMaterial = makeMaterial({
      id: "mat-acs-1",
      title: "Navigation Log Prep",
      reviewStatus: "needs_review",
      tags: ["PA.I.A.K1"],
    });

    appData.materials = [acsMaterial];
    appData.actions = [];

    render(h(MemoryRouter, null, h(FlightDeck)));

    // Study focus card should be visible
    expect(await screen.findByText("Study focus")).toBeTruthy();
    expect(screen.getByText("Navigation Log Prep")).toBeTruthy();

    // ACS Area Material Coverage panel should be visible
    expect(screen.getByText("ACS Area Material Coverage")).toBeTruthy();
    const summaryHeading = screen.getByText("See counts by ACS area");
    expect(summaryHeading).toBeTruthy();

    const details = document.querySelector("details.acs-area-material-coverage-details") as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);

    // Opening disclosure shows details
    fireEvent.click(summaryHeading);
    expect(details.open).toBe(true);
    expect(screen.getByTestId("acs-coverage-explanation")).toBeTruthy();
    expect(screen.getByTestId("acs-coverage-area-I")).toBeTruthy();

    cleanup();

    // 2. When there is NO material selected for Study Focus (e.g. material is reference_only or actions exist with no study focus)
    const refMaterial = makeMaterial({
      id: "mat-ref-1",
      title: "Airplane Flying Handbook",
      reviewStatus: "reference_only",
      tags: ["PA.I.A.K1"],
    });
    const regularAction = makeAction({
      id: "act-1",
      title: "Organize headset bag",
      dueDate: "2026-10-21",
    });

    appData.materials = [refMaterial];
    appData.actions = [regularAction];

    render(h(MemoryRouter, null, h(FlightDeck)));

    // Study focus is absent
    expect(await screen.findByText("Today's plan")).toBeTruthy();
    expect(screen.queryByText("Study focus")).toBeNull();

    // But ACS Area Material Coverage panel is still visible and collapsed by default
    expect(screen.getByText("ACS Area Material Coverage")).toBeTruthy();
    const detailsNoFocus = document.querySelector("details.acs-area-material-coverage-details") as HTMLDetailsElement;
    expect(detailsNoFocus).toBeTruthy();
    expect(detailsNoFocus.open).toBe(false);

    // Opening it still reveals the coverage data
    const summaryNoFocus = screen.getByText("See counts by ACS area");
    fireEvent.click(summaryNoFocus);
    expect(detailsNoFocus.open).toBe(true);
    expect(screen.getByTestId("acs-coverage-area-I")).toBeTruthy();
  });

  describe("NextFlightCard preparation navigation and preservation", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const makeHwSnapshot = (
      assignmentId: string,
      lessonId: string,
      activityId: string,
      activityTitle: string,
      state: "upcoming" | "in_progress" | "completed" = "completed",
    ): HomeworkSnapshot => ({
      version: 1,
      runs: [],
      activities: [
        {
          record: {
            id: activityId,
            assignment_id: assignmentId,
            position: 0,
            kind: "read",
            title: activityTitle,
            body: "",
            material_id: null,
            source_material_id: null,
            source_revision: null,
            card_set_id: null,
            test_version_id: null,
            source_test_version_id: null,
            page_start: null,
            page_end: null,
            state,
            cycle: 1,
            revision: 1,
            created_at: "2026-10-18T10:00:00.000Z",
            updated_at: "2026-10-18T10:00:00.000Z",
            completed_at: state === "completed" ? "2026-10-20T10:15:00.000Z" : null,
            removed_at: null,
          },
          source: null,
          evidence: null,
        },
      ],
      assignment: {
        id: assignmentId,
        title: "Lesson Homework",
        instructions: "",
        school: null,
        instructor: null,
        lesson_id: lessonId,
        source_lesson_id: null,
        due_date: "2026-10-21",
        state: "upcoming",
        revision: 1,
        action_id: null,
        archived: 0,
        created_at: "2026-10-18T10:00:00.000Z",
        updated_at: "2026-10-18T10:00:00.000Z",
        completed_at: null,
      },
    });

    it("renders empty / no-lesson state intact when there are no scheduled events", () => {
      appData.events = [];
      appData.actions = [makeAction({ id: "act-1", title: "Existing task", dueDate: "2026-10-20" })];

      render(h(MemoryRouter, null, h(FlightDeck)));

      expect(screen.getByText("Next flight")).toBeTruthy();
      expect(screen.getByText("Nothing scheduled yet.")).toBeTruthy();
      const openScheduleLink = screen.getByRole("link", { name: "Open Schedule" });
      expect(openScheduleLink.getAttribute("href")).toBe("/schedule");
    });

    it("renders empty preparation state intact when next lesson has zero prep items", () => {
      const event = makeEvent({
        id: "evt-next",
        title: "Solo Cross-Country Flight",
        date: "2026-10-22",
        status: "scheduled",
      });
      appData.events = [event];

      render(h(MemoryRouter, null, h(FlightDeck)));

      expect(screen.getByText("Solo Cross-Country Flight")).toBeTruthy();
      expect(
        screen.getByText(
          "No preparation listed yet. Add checklist items to this lesson so you know what to get ready.",
        ),
      ).toBeTruthy();
    });

    it("verifies all three prep routes, URL encoding, status/count preservation, exclusion of unrelated/past/cancelled lessons, and non-mutating click navigation", () => {
      const activeLesson = makeEvent({
        id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
        title: "Towered Airport Operations",
        date: "2026-10-21",
        startTime: "09:00",
        status: "scheduled",
      });
      const pastLesson = makeEvent({
        id: "c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f",
        title: "Past Lesson",
        date: "2026-10-10",
        status: "scheduled",
      });
      const cancelledLesson = makeEvent({
        id: "d4e5f6a7-b8c9-4d0e-9f1a-3b4c5d6e7f8a",
        title: "Cancelled Lesson",
        date: "2026-10-21",
        status: "cancelled",
      });
      const laterLesson = makeEvent({
        id: "e5f6a7b8-c9d0-4e1f-a2b3-4c5d6e7f8a9b",
        title: "Later Lesson",
        date: "2026-10-25",
        status: "scheduled",
      });

      appData.events = [pastLesson, cancelledLesson, activeLesson, laterLesson];

      // Checklist items
      const prep1 = makePrepItem({
        id: "prep-chk-1",
        eventId: activeLesson.id,
        title: "Preflight weather briefing",
        done: false,
      });
      const prep2 = makePrepItem({
        id: "prep-chk-2",
        eventId: activeLesson.id,
        title: "Weight and balance calculation",
        done: true,
      });
      const prepUnrelated = makePrepItem({
        id: "prep-chk-unrelated",
        eventId: laterLesson.id,
        title: "Later lesson checklist",
        done: false,
      });
      const prepCancelled = makePrepItem({
        id: "prep-chk-cancelled",
        eventId: cancelledLesson.id,
        title: "Cancelled lesson checklist",
        done: false,
      });
      appData.prepItems = [prep1, prep2, prepUnrelated, prepCancelled];

      // Questions (including special characters in text question ID for URL encoding)
      const q1 = makeQuestion({
        id: "q-standard/101?test=true&space=yes",
        eventId: activeLesson.id,
        text: "Class Delta entry requirements?",
        status: "to_ask",
      });
      const q2 = makeQuestion({
        id: "q-asked-2",
        eventId: activeLesson.id,
        text: "Light gun signals review",
        status: "asked",
      });
      const qUnrelated = makeQuestion({
        id: "q-unrelated",
        eventId: laterLesson.id,
        text: "Unrelated question",
        status: "to_ask",
      });
      appData.questions = [q1, q2, qUnrelated];

      // Homework snapshots with canonical {record, source, evidence} entry structures and UUIDs
      const activeAssignmentId = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";
      const activeActivityId = "f1e2d3c4-b5a6-4f7e-8d9c-0b1a2f3e4d5c";
      const unrelatedAssignmentId = "11223344-5566-4778-8899-aabbccddeeff";
      const unrelatedActivityId = "99887766-5544-4332-8211-00ffeeddccbb";

      const hwSnapshot = makeHwSnapshot(
        activeAssignmentId,
        activeLesson.id,
        activeActivityId,
        "Radio communication drill",
        "completed",
      );
      const hwUnrelated = makeHwSnapshot(
        unrelatedAssignmentId,
        laterLesson.id,
        unrelatedActivityId,
        "Unrelated homework activity",
        "upcoming",
      );
      appData.homework = [hwSnapshot, hwUnrelated];

      let currentLocation = "";
      function LocationProbe() {
        const location = useLocation();
        currentLocation = location.pathname + location.search;
        return null;
      }

      render(
        h(
          MemoryRouter,
          { initialEntries: ["/"] },
          h(LocationProbe),
          h(FlightDeck),
        ),
      );

      // Enclosing card for Next flight
      const nextFlightHeading = screen.getByRole("heading", { name: "Next flight" });
      const nextFlightCard = nextFlightHeading.closest("section.card");
      expect(nextFlightCard).toBeTruthy();
      const card = within(nextFlightCard as HTMLElement);

      // Verify active lesson rendered and unrelated excluded within card
      expect(card.getByText("Towered Airport Operations")).toBeTruthy();
      expect(card.queryByText("Later Lesson")).toBeNull();
      expect(card.queryByText("Past Lesson")).toBeNull();
      expect(card.queryByText("Cancelled Lesson")).toBeNull();
      expect(card.queryByText("Later lesson checklist")).toBeNull();
      expect(card.queryByText("Cancelled lesson checklist")).toBeNull();
      expect(card.queryByText("Unrelated question")).toBeNull();
      expect(card.queryByText("Unrelated homework activity")).toBeNull();

      // Counts: 3 completed of 5 total (prep2, q2, and hw activity are complete; prep1 and q1 are outstanding)
      expect(card.getByText("3 of 5 ready")).toBeTruthy();

      // Verify checklist link route and accessible name
      const chkLink1 = card.getByRole("link", { name: "Preflight weather briefing" });
      expect(chkLink1.getAttribute("href")).toBe(`/schedule/${activeLesson.id}`);

      const chkLink2 = card.getByRole("link", { name: "Weight and balance calculation" });
      expect(chkLink2.getAttribute("href")).toBe(`/schedule/${activeLesson.id}`);

      // Verify question link route with encodeURIComponent and accessible name
      const qLink1 = card.getByRole("link", { name: "Ask: Class Delta entry requirements?" });
      expect(qLink1.getAttribute("href")).toBe(
        `/questions?question=${encodeURIComponent("q-standard/101?test=true&space=yes")}`,
      );

      const qLink2 = card.getByRole("link", { name: "Ask: Light gun signals review" });
      expect(qLink2.getAttribute("href")).toBe(`/questions?question=q-asked-2`);

      // Verify homework link retains exact assignment and activity link
      const hwLink = card.getByRole("link", { name: "Radio communication drill" });
      expect(hwLink.getAttribute("href")).toBe(
        `/study/homework/${activeAssignmentId}?activity=${activeActivityId}`,
      );

      // Verify Complete / Incomplete indicator texts are preserved next to items
      const completeBadges = card.getAllByText("Complete");
      expect(completeBadges.length).toBe(3);
      const incompleteBadges = card.getAllByText("Incomplete");
      expect(incompleteBadges.length).toBe(2);

      // Verify click navigation navigates without mutating data
      fireEvent.click(qLink1);
      expect(currentLocation).toBe(
        `/questions?question=${encodeURIComponent("q-standard/101?test=true&space=yes")}`,
      );
      // Ensure data was NOT mutated
      expect(prep1.done).toBe(false);
      expect(q1.status).toBe("to_ask");

      fireEvent.click(chkLink1);
      expect(currentLocation).toBe(`/schedule/${activeLesson.id}`);
      expect(prep1.done).toBe(false);

      fireEvent.click(hwLink);
      expect(currentLocation).toBe(
        `/study/homework/${activeAssignmentId}?activity=${activeActivityId}`,
      );
    });
  });

  describe("FlightDeck flight hours singular/plural captions", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
      appData.actions = [
        makeAction({
          id: "act-default",
          title: "Preflight planning",
          dueDate: "2026-10-25",
        }),
      ];
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("renders null for flight hours card when there are 0 logged flights", () => {
      appData.journalEntries = [];
      render(h(MemoryRouter, null, h(FlightDeck)));
      expect(screen.queryByText("Flight hours")).toBeNull();
    });

    it("displays singular '1 flight' and 'across 1 flight in 30 days' when exactly 1 flight exists in 30 days", () => {
      appData.journalEntries = [
        makeJournalEntry({
          id: "j-1",
          date: "2026-10-20",
          totalTime: 1.5,
          aircraftType: "C172",
        }),
      ];
      render(h(MemoryRouter, null, h(FlightDeck)));

      expect(screen.getByText("Flight hours")).toBeTruthy();
      expect(screen.getByText("1 flight")).toBeTruthy();
      expect(screen.queryByText("1 flights")).toBeNull();
      expect(screen.getByText("across 1 flight in 30 days")).toBeTruthy();
      expect(screen.queryByText("across 1 flights in 30 days")).toBeNull();
    });

    it("displays plural '2 flights' and 'across 2 flights in 30 days' when 2 flights exist in 30 days", () => {
      appData.journalEntries = [
        makeJournalEntry({
          id: "j-1",
          date: "2026-10-18",
          totalTime: 1.2,
          aircraftType: "C172",
        }),
        makeJournalEntry({
          id: "j-2",
          date: "2026-10-20",
          totalTime: 1.8,
          aircraftType: "C172",
        }),
      ];
      render(h(MemoryRouter, null, h(FlightDeck)));

      expect(screen.getByText("Flight hours")).toBeTruthy();
      expect(screen.getByText("2 flights")).toBeTruthy();
      expect(screen.getByText("across 2 flights in 30 days")).toBeTruthy();
    });

    it("displays 'across 0 flights in 30 days' when flights exist only outside the last 30 days", () => {
      appData.journalEntries = [
        makeJournalEntry({
          id: "j-old",
          date: "2026-08-01",
          totalTime: 2.0,
          aircraftType: "C172",
        }),
      ];
      render(h(MemoryRouter, null, h(FlightDeck)));

      expect(screen.getByText("Flight hours")).toBeTruthy();
      expect(screen.getByText("1 flight")).toBeTruthy();
      expect(screen.getByText("across 0 flights in 30 days")).toBeTruthy();
    });
  });
});

describe("FlightDeck practice-test line", () => {
  const attempt = (id: string, completedAt: string, scorePercent: number) => ({
    id,
    versionId: "v-1",
    sourceMaterialId: "mat-1",
    sourceMaterialTitle: "Weather",
    startedAt: completedAt,
    completedAt,
    status: "completed" as const,
    revision: 1,
    totalQuestions: 10,
    answeredCount: 10,
    correctCount: Math.round(scorePercent / 10),
    incorrectCount: 10 - Math.round(scorePercent / 10),
    dontKnowCount: 0,
    scorePercent,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00"));
    appData.materials = [makeMaterial({ id: "mat-1", title: "Weather" })];
    appData.practiceTests = [
      {
        sourceMaterialId: "mat-1",
        title: "Weather check",
        questions: [],
        provider: "local",
        model: "",
        generatedAt: "2026-10-01T10:00:00Z",
        updatedAt: "2026-10-01T10:00:00Z",
      } as unknown as AppData["practiceTests"][number],
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows her recent average and links to the Study Library", async () => {
    repositoriesMock = {
      practiceSessions: {
        getRecentCompletedAttempts: vi.fn().mockResolvedValue([
          attempt("a6", "2026-10-19T15:00:00", 90),
          attempt("a5", "2026-10-18T15:00:00", 80),
          attempt("a4", "2026-10-17T15:00:00", 80),
          attempt("a3", "2026-10-16T15:00:00", 70),
          attempt("a2", "2026-10-15T15:00:00", 70),
          attempt("a1", "2026-10-14T15:00:00", 60),
        ]),
      },
    };
    render(h(MemoryRouter, null, h(FlightDeck)));

    const link = await screen.findByRole("link", {
      name: "Practice tests: 78% over your last 5 (up from 60%).",
    });
    expect(link.getAttribute("href")).toBe("/study");
  });

  it("gently nudges when she has fewer than three recent attempts", async () => {
    repositoriesMock = {
      practiceSessions: {
        getRecentCompletedAttempts: vi.fn().mockResolvedValue([
          attempt("a1", "2026-10-19T15:00:00", 90),
        ]),
      },
    };
    render(h(MemoryRouter, null, h(FlightDeck)));

    const link = await screen.findByRole("link", {
      name: "Take a practice test to see how you're doing.",
    });
    expect(link.getAttribute("href")).toBe("/study");
    expect(screen.queryByText(/over your last/)).toBeNull();
  });
});
