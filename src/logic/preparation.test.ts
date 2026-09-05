import { describe, expect, it } from "vitest";

import { makeAction, makeEvent, makePrepItem, makeQuestion } from "@/testing/factories";
import { lessonPreparation, lessonsAwaitingDebrief, nextEvent } from "./preparation";

const TODAY = "2026-09-05";

describe("lessonPreparation", () => {
  const event = makeEvent({ id: "lesson-1" });

  it("counts real items rather than reporting a percentage", () => {
    const state = lessonPreparation(event, {
      prepItems: [
        makePrepItem({ eventId: "lesson-1", title: "Weather review", done: true }),
        makePrepItem({ eventId: "lesson-1", title: "Landing notes", done: false }),
        makePrepItem({ eventId: "lesson-1", title: "Equipment check", done: true }),
      ],
      actions: [],
      questions: [],
    });

    expect(state.total).toBe(3);
    expect(state.completed).toBe(2);
    expect(state.ready).toBe(false);
    expect(state.outstanding.map((line) => line.label)).toEqual(["Landing notes"]);
  });

  it("folds in related actions and unasked questions", () => {
    const state = lessonPreparation(event, {
      prepItems: [makePrepItem({ eventId: "lesson-1", done: true })],
      actions: [
        makeAction({ relatedType: "event", relatedId: "lesson-1", title: "Review notes" }),
        makeAction({ relatedType: "event", relatedId: "other-lesson" }),
      ],
      questions: [
        makeQuestion({ eventId: "lesson-1", text: "Rudder timing?", status: "to_ask" }),
        makeQuestion({ eventId: "lesson-1", status: "answered" }),
      ],
    });

    expect(state.total).toBe(4);
    expect(state.completed).toBe(2);
    expect(state.lines.map((l) => l.source)).toEqual([
      "checklist", "action", "question", "question",
    ]);
  });

  it("is not 'ready' when there is nothing to prepare", () => {
    // An empty checklist is not the same as being prepared.
    const state = lessonPreparation(event, { prepItems: [], actions: [], questions: [] });
    expect(state.total).toBe(0);
    expect(state.ready).toBe(false);
  });

  it("is ready once every item is done", () => {
    const state = lessonPreparation(event, {
      prepItems: [makePrepItem({ eventId: "lesson-1", done: true })],
      actions: [],
      questions: [],
    });
    expect(state.ready).toBe(true);
    expect(state.outstanding).toHaveLength(0);
  });

  it("ignores items belonging to other lessons", () => {
    const state = lessonPreparation(event, {
      prepItems: [makePrepItem({ eventId: "another-lesson" })],
      actions: [],
      questions: [],
    });
    expect(state.total).toBe(0);
  });
});

describe("nextEvent", () => {
  it("picks the soonest scheduled event, earliest time first", () => {
    const later = makeEvent({ id: "later", date: "2026-09-06", startTime: "14:00" });
    const earlier = makeEvent({ id: "earlier", date: "2026-09-06", startTime: "08:00" });
    const nextWeek = makeEvent({ id: "next-week", date: "2026-09-12" });
    expect(nextEvent([nextWeek, later, earlier], TODAY)?.id).toBe("earlier");
  });

  it("includes today and skips cancelled events", () => {
    const cancelled = makeEvent({ id: "cancelled", date: TODAY, status: "cancelled" });
    const today = makeEvent({ id: "today", date: TODAY });
    expect(nextEvent([cancelled, today], TODAY)?.id).toBe("today");
  });

  it("returns null when the schedule is empty", () => {
    expect(nextEvent([], TODAY)).toBeNull();
  });
});

describe("lessonsAwaitingDebrief", () => {
  it("finds past lessons with no journal entry", () => {
    const flown = makeEvent({ id: "flown", date: "2026-09-03" });
    const written = makeEvent({ id: "written", date: "2026-09-02" });
    const upcoming = makeEvent({ id: "upcoming", date: "2026-09-20" });

    const waiting = lessonsAwaitingDebrief(
      [flown, written, upcoming],
      new Set(["written"]),
      TODAY,
    );
    expect(waiting.map((e) => e.id)).toEqual(["flown"]);
  });

  it("only considers flight lessons", () => {
    const study = makeEvent({ date: "2026-09-01", eventType: "study_session" });
    expect(lessonsAwaitingDebrief([study], new Set(), TODAY)).toHaveLength(0);
  });
});
