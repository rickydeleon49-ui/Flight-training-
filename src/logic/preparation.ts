/**
 * Lesson preparation.
 *
 * Readiness is reported as real, named items — "3 of 4 ready", each one
 * listed — never as an invented percentage. The user can always see exactly
 * what is outstanding.
 */
import { todayIso } from "@/lib/dates";
import type { IsoDate, PrepItem, Question, ScheduleEvent } from "@/domain/types";

export interface PreparationLine {
  id: string;
  label: string;
  done: boolean;
  /** Where the line came from, so the UI can link back to it. */
  source: "checklist" | "question" | "homework";
  assignmentId?: string;
}

export interface PreparationState {
  lines: PreparationLine[];
  completed: number;
  total: number;
  /** True only when there is something to prepare and it is all done. */
  ready: boolean;
  outstanding: PreparationLine[];
}

/**
 * A lesson's readiness: its preparation checklist, plus any questions saved
 * to ask at that lesson.
 *
 * Actions linked to the lesson are deliberately not included. They already
 * appear on Today's Flight Plan, and showing the same item in two places on
 * one screen makes the dashboard harder to trust.
 */
export function lessonPreparation(
  event: ScheduleEvent,
  sources: {
    prepItems: PrepItem[];
    questions: Question[];
    homework?: readonly import("@/domain/homework").HomeworkSnapshot[];
  },
): PreparationState {
  const lines: PreparationLine[] = [];

  for (const item of sources.prepItems.filter((p) => p.eventId === event.id)) {
    lines.push({ id: item.id, label: item.title, done: item.done, source: "checklist" });
  }

  for (const question of sources.questions.filter((q) => q.eventId === event.id)) {
    lines.push({
      id: question.id,
      label: `Ask: ${question.text}`,
      done: question.status === "asked" || question.status === "answered",
      source: "question",
    });
  }

  for (const hw of sources.homework ?? []) {
    if (hw.assignment.archived === 1) continue;
    if (hw.assignment.lesson_id === event.id || hw.assignment.source_lesson_id === event.id) {
      const active = hw.activities.filter((a) => !a.record.removed_at);
      for (const a of active) {
        lines.push({
          id: a.record.id,
          label: a.record.title,
          done: a.record.state === "completed",
          source: "homework",
          assignmentId: hw.assignment.id,
        });
      }
    }
  }

  const completed = lines.filter((line) => line.done).length;
  return {
    lines,
    completed,
    total: lines.length,
    ready: lines.length > 0 && completed === lines.length,
    outstanding: lines.filter((line) => !line.done),
  };
}

const bySoonest = (a: ScheduleEvent, b: ScheduleEvent): number => {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return (a.startTime ?? "").localeCompare(b.startTime ?? "");
};

/** The next scheduled item of any kind still ahead of us. */
export function nextEvent(
  events: ScheduleEvent[],
  today: IsoDate = todayIso(),
): ScheduleEvent | null {
  return (
    events
      .filter((event) => event.date >= today && event.status === "scheduled")
      .sort(bySoonest)[0] ?? null
  );
}

/**
 * The next flight lesson specifically.
 *
 * The Next Flight card is about flying, so ground school or a medical
 * appointment must not take its place — those belong to the Schedule.
 */
export function nextLesson(
  events: ScheduleEvent[],
  today: IsoDate = todayIso(),
): ScheduleEvent | null {
  return (
    events
      .filter(
        (event) =>
          event.eventType === "flight_lesson" &&
          event.date >= today &&
          event.status === "scheduled",
      )
      .sort(bySoonest)[0] ?? null
  );
}

/** Lessons that have happened but have no debrief written yet. */
export function lessonsAwaitingDebrief(
  events: ScheduleEvent[],
  journalEventIds: Set<string>,
  today: IsoDate = todayIso(),
): ScheduleEvent[] {
  return events
    .filter(
      (event) =>
        event.eventType === "flight_lesson" &&
        event.date <= today &&
        event.status !== "cancelled" &&
        !journalEventIds.has(event.id),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}
