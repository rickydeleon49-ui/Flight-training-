// @vitest-environment jsdom
/**
 * Tests for CalendarExportDialog (P54-05 Part B).
 *
 * Verifies:
 * - Checklist starts OFF by default; only explicitly chosen checklist is dispatched.
 * - Completed-event calendar action is absent.
 * - Browser limitation clearly explained without dispatching native command.
 * - Accurate duration, timezone, import and cancellation explanations.
 * - Exact filename, kind ("calendar"), and content passed to saveStudyExport.
 * - Same-render duplicate clicks dispatch only once.
 * - Held saves keep controls locked and dialog nondismissible.
 * - Cancel is clean; errors can be retried.
 * - A->B lesson changes and close/reopen reset state.
 * - Stale completions from older sessions cannot update or release locks.
 * - An older operation finishing while a newer session is pending does not release lock.
 */
import { createElement as h, type ContextType } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScheduleEvent } from "@/domain/types";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { makeEvent, makePrepItem } from "@/testing/factories";
import { CALENDAR_DESKTOP_ONLY, CalendarExportDialog } from "./CalendarExportDialog";
import { EventDetail } from "./EventDetail";

let desktop = true;
vi.mock("@/data", async (original) => ({
  ...(await original<typeof import("@/data")>()),
  isTauri: () => desktop,
}));

const saveStudyExport = vi.fn();
vi.mock("@/services/studyExport", async (original) => ({
  ...(await original<typeof import("@/services/studyExport")>()),
  saveStudyExport: (...args: unknown[]) => saveStudyExport(...args),
}));

const { StudyExportError } = await import("@/services/studyExport");

const lessonA = makeEvent({
  id: "lesson-A",
  title: "Slow flight and stalls",
  date: "2026-10-24",
  startTime: "10:00",
  endTime: "11:30",
  status: "scheduled",
  notes: "SENTINEL_LESSON_A_NOTES",
});

const lessonB = makeEvent({
  id: "lesson-B",
  title: "Steep turns",
  date: "2026-10-25",
  startTime: "14:00",
  endTime: null, // start-only
  status: "scheduled",
  notes: "SENTINEL_LESSON_B_NOTES",
});

const prepItemA = makePrepItem({
  id: "prep-1",
  eventId: "lesson-A",
  title: "Weight and balance sheet",
  position: 0,
});

const prepItemB = makePrepItem({
  id: "prep-2",
  eventId: "lesson-B",
  title: "Area navigation chart",
  position: 0,
});

const testData = {
  ...EMPTY_DATA,
  events: [lessonA, lessonB],
  prepItems: [prepItemA, prepItemB],
};

beforeEach(() => {
  desktop = true;
  saveStudyExport.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

function openDialog(props: { open?: boolean; event?: ScheduleEvent } = {}) {
  const value = {
    repositories: null,
    data: testData,
    status: "ready",
    error: null,
    mutate: async () => null,
    deleteWithUndo: () => undefined,
  } as unknown as ContextType<typeof AppDataContext>;

  const currentEvent = props.event ?? lessonA;
  const element = (isOpen: boolean, shown = currentEvent) =>
    h(
      AppDataContext.Provider,
      { value },
      h(CalendarExportDialog, { open: isOpen, event: shown, onClose: () => {} }),
    );

  const view = render(element(props.open ?? true));
  return {
    view,
    rerender: (isOpen: boolean, evt = currentEvent) => view.rerender(element(isOpen, evt)),
    changeLesson: (next = lessonB) => view.rerender(element(true, next)),
  };
}

function heldSave() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  saveStudyExport.mockReturnValueOnce(promise);
  return { resolve, reject, promise };
}

describe("CalendarExportDialog - User experience and explanations", () => {
  it("starts with preparation checklist off by default", () => {
    openDialog();
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(screen.getByText(/Checklist option starts off/)).toBeTruthy();
  });

  it("explains calendar file nature, import, timezone, and duration accurately", () => {
    openDialog({ event: lessonA });
    // Plain language explanations
    expect(
      screen.getByText(/This saves one calendar file; it does not connect to or synchronize a calendar account/),
    ).toBeTruthy();
    expect(screen.getByText(/Re-import may duplicate rather than update an event/)).toBeTruthy();
    expect(
      screen.getByText(/Times are floating local times: a calendar using another timezone may interpret the same clock time differently/),
    ).toBeTruthy();
    expect(screen.getByText(/Scheduled from 10:00 AM to 11:30 AM/)).toBeTruthy();
  });

  it("explains one-hour default rollover for start-only events", () => {
    openDialog({ event: lessonB });
    expect(
      screen.getByText(
        /A start without an end receives the approved one-hour duration, including rollover into the next day/,
      ),
    ).toBeTruthy();
  });

  it("explains all-day event when there is no start or end time", () => {
    const allDayEvent = makeEvent({ ...lessonA, startTime: null, endTime: null });
    openDialog({ event: allDayEvent });
    expect(screen.getByText(/This is an all-day event/)).toBeTruthy();
  });

  it("explains cancellation behavior for cancelled and rescheduled events", () => {
    const cancelledEvent = makeEvent({ ...lessonA, status: "cancelled" });
    const { rerender } = openDialog({ event: cancelledEvent });
    expect(
      screen.getByText(
        /This lesson is cancelled \(exported as cancelled\)\. A cancelled file may not remove an existing calendar entry\./,
      ),
    ).toBeTruthy();

    const rescheduledEvent = makeEvent({ ...lessonA, status: "rescheduled" });
    rerender(true, rescheduledEvent);
    expect(
      screen.getByText(
        /This lesson was rescheduled \(exported as cancelled\)\. A cancelled file may not remove an existing calendar entry\. The replacement lesson needs its own file\./,
      ),
    ).toBeTruthy();
  });

  it("shows browser mode limitation without dispatching native command", () => {
    desktop = false;
    openDialog();
    expect(screen.getByText(CALENDAR_DESKTOP_ONLY)).toBeTruthy();
    const saveButton = screen.getByRole("button", { name: "Save calendar file…" });
    expect(saveButton.hasAttribute("disabled")).toBe(true);

    fireEvent.click(saveButton);
    expect(saveStudyExport).not.toHaveBeenCalled();
  });
});

describe("CalendarExportDialog - Save lifecycle & session isolation", () => {
  it("dispatches exact filename, kind 'calendar', and content without checklist when unticked", async () => {
    saveStudyExport.mockResolvedValue({ fileName: "Lesson.ics", byteLength: 500 });
    openDialog({ event: lessonA });

    fireEvent.click(screen.getByRole("button", { name: "Save calendar file…" }));
    expect((await screen.findByRole("status")).textContent).toBe("Saved “Lesson.ics”.");

    expect(saveStudyExport).toHaveBeenCalledTimes(1);
    const [kind, filename, content] = saveStudyExport.mock.calls[0] as [string, string, string];
    expect(kind).toBe("calendar");
    expect(filename).toBe("Lesson 2026-10-24 Slow flight and stalls.ics");
    expect(content).toContain("BEGIN:VCALENDAR");
    expect(content).toContain("SUMMARY:Slow flight and stalls");
    expect(content).not.toContain("Weight and balance sheet");
    expect(content).not.toContain("SENTINEL_LESSON_A_NOTES");
  });

  it("includes checklist item titles when explicitly ticked", async () => {
    saveStudyExport.mockResolvedValue({ fileName: "Lesson.ics", byteLength: 500 });
    openDialog({ event: lessonA });

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save calendar file…" }));
    expect((await screen.findByRole("status")).textContent).toBe("Saved “Lesson.ics”.");

    const [, , content] = saveStudyExport.mock.calls[0] as [string, string, string];
    const unfolded = content.replace(/\r\n[ \t]/g, "");
    expect(unfolded).toContain("Preparation checklist:");
    expect(unfolded).toContain("Weight and balance sheet");
    expect(content).not.toContain("SENTINEL_LESSON_A_NOTES");
  });

  it("dispatches one save for duplicate clicks in the same render", async () => {
    const held = heldSave();
    openDialog({ event: lessonA });
    const button = screen.getByRole("button", { name: "Save calendar file…" });

    act(() => {
      button.click();
      button.click();
    });
    expect(saveStudyExport).toHaveBeenCalledTimes(1);

    await act(async () => {
      held.resolve(null);
      await held.promise;
    });
  });

  it("locks controls and keeps choices fixed while save is pending", async () => {
    const held = heldSave();
    openDialog({ event: lessonA });

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save calendar file…" }));

    // While pending
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);

    await act(async () => {
      held.resolve(null);
      await held.promise;
    });

    expect(checkbox.disabled).toBe(false);
  });

  it("handles cancellation without error and lets user retry", async () => {
    saveStudyExport.mockResolvedValueOnce(null);
    openDialog({ event: lessonA });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save calendar file…" }));
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    // User can retry
    saveStudyExport.mockResolvedValueOnce({ fileName: "Retry.ics", byteLength: 500 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save calendar file…" }));
    });
    expect((await screen.findByRole("status")).textContent).toContain("Retry.ics");
  });

  it("explains refusal/failure and allows successful retry", async () => {
    saveStudyExport.mockRejectedValueOnce(new StudyExportError("too_large"));
    saveStudyExport.mockResolvedValueOnce({ fileName: "Retry.ics", byteLength: 500 });
    openDialog({ event: lessonA });

    fireEvent.click(screen.getByRole("button", { name: "Save calendar file…" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This export is too large to save. Choose fewer parts.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save calendar file…" }));
    expect((await screen.findByRole("status")).textContent).toContain("Retry.ics");
    expect(saveStudyExport).toHaveBeenCalledTimes(2);
  });

  it("resets choices on close and reopen", () => {
    const { rerender } = openDialog({ event: lessonA });
    fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);

    rerender(false);
    rerender(true);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("BRIEF-R1 equivalent: a choice made for lesson A is not carried to lesson B", async () => {
    saveStudyExport.mockResolvedValue({ fileName: "B.ics", byteLength: 500 });
    const { changeLesson } = openDialog({ event: lessonA });

    // Tick checklist on Lesson A
    fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);

    // Switch to Lesson B
    changeLesson(lessonB);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);

    // Save Lesson B
    fireEvent.click(screen.getByRole("button", { name: "Save calendar file…" }));
    await screen.findByRole("status");

    const [, filename, content] = saveStudyExport.mock.calls[0] as [string, string, string];
    expect(filename).toBe("Lesson 2026-10-25 Steep turns.ics");
    // Does NOT contain Lesson A's prep item or checklist section
    expect(content).not.toContain("Weight and balance sheet");
    expect(content).not.toContain("Area navigation chart");
    expect(content).not.toContain("Preparation checklist:");
  });

  it.each(["resolves", "rejects"] as const)(
    "BRIEF-R2 equivalent: when old lesson's save %s after lesson change, new lesson shows nothing",
    async (outcome) => {
      let finish!: (val: unknown) => void;
      let fail!: (err: unknown) => void;
      const pending = new Promise((res, rej) => {
        finish = res;
        fail = rej;
      });
      saveStudyExport.mockReturnValueOnce(pending);

      const { changeLesson } = openDialog({ event: lessonA });
      fireEvent.click(screen.getByRole("button", { name: "Save calendar file…" }));

      // Switch to Lesson B while save is pending
      changeLesson(lessonB);
      expect(screen.getByRole("button", { name: "Save calendar file…" }).hasAttribute("disabled")).toBe(false);

      // Now old save completes
      await act(async () => {
        if (outcome === "resolves") finish({ fileName: "OLD-LESSON.ics", byteLength: 500 });
        else fail(new StudyExportError("write_failed"));
        await pending.catch(() => undefined);
      });

      // Lesson B does not display old result
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("older save finishing while newer session's save is pending does not release lock", async () => {
    let finishA!: (val: unknown) => void;
    const pendingA = new Promise((res) => (finishA = res));
    saveStudyExport.mockReturnValueOnce(pendingA);

    const { changeLesson } = openDialog({ event: lessonA });
    fireEvent.click(screen.getByRole("button", { name: "Save calendar file…" }));

    // Switch to Lesson B
    changeLesson(lessonB);

    // Start save on Lesson B
    let finishB!: (val: unknown) => void;
    const pendingB = new Promise((res) => (finishB = res));
    saveStudyExport.mockReturnValueOnce(pendingB);
    fireEvent.click(screen.getByRole("button", { name: "Save calendar file…" }));

    // Both saves have been called once each
    expect(saveStudyExport).toHaveBeenCalledTimes(2);

    // While B is pending, save button is disabled
    expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);

    // Now A finishes
    await act(async () => {
      finishA({ fileName: "A.ics", byteLength: 500 });
      await pendingA;
    });

    // Lesson B must still be locked/saving!
    expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);

    // Attempting a third click on Lesson B while pending is ignored
    const button = screen.getByRole("button", { name: "Saving…" });
    act(() => {
      button.click();
    });
    expect(saveStudyExport).toHaveBeenCalledTimes(2);

    // Now B finishes
    await act(async () => {
      finishB({ fileName: "B.ics", byteLength: 500 });
      await pendingB;
    });

    // B displays B's status
    expect((await screen.findByRole("status")).textContent).toBe("Saved “B.ics”.");
  });
});

describe("EventDetail - Add to calendar button presence", () => {
  function renderDetail(event: ScheduleEvent) {
    const value = {
      repositories: null,
      data: { ...EMPTY_DATA, events: [event] },
      status: "ready",
      error: null,
      mutate: async () => null,
      deleteWithUndo: () => undefined,
    } as unknown as ContextType<typeof AppDataContext>;

    render(
      h(
        AppDataContext.Provider,
        { value },
        h(
          MemoryRouter,
          { initialEntries: [`/schedule/${event.id}`] },
          h(Routes, null, h(Route, { path: "/schedule/:eventId", element: h(EventDetail) })),
        ),
      ),
    );
  }

  it("renders 'Add to calendar…' button for scheduled event", () => {
    renderDetail(makeEvent({ id: "e1", status: "scheduled" }));
    expect(screen.getByRole("button", { name: "Add to calendar…" })).toBeTruthy();
  });

  it("renders 'Add to calendar…' button for cancelled and rescheduled events", () => {
    renderDetail(makeEvent({ id: "e2", status: "cancelled" }));
    expect(screen.getByRole("button", { name: "Add to calendar…" })).toBeTruthy();

    cleanup();
    renderDetail(makeEvent({ id: "e3", status: "rescheduled" }));
    expect(screen.getByRole("button", { name: "Add to calendar…" })).toBeTruthy();
  });

  it("does NOT render 'Add to calendar…' button for completed event", () => {
    renderDetail(makeEvent({ id: "e4", status: "completed" }));
    expect(screen.queryByRole("button", { name: /Add to calendar/ })).toBeNull();
  });
});
