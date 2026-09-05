/**
 * Lesson preparation.
 *
 * Readiness is reported as real, named items — "3 of 4 ready", each one
 * listed — never as an invented percentage. The user can always see exactly
 * what is outstanding.
 */
import { todayIso } from "@/lib/dates";
import type {
  IsoDate,
  NextAction,
  PrepItem,
  Question,
  ScheduleEvent,
} from "@/domain/types";
import { isOpen } from "./actions";

export interface PreparationLine {
  id: string;
  label: string;
  done: boolean;
  /** Where the line came from, so the UI can link back to it. */
  source: "checklist" | "action" | "question";
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
 * Combine a lesson's checklist, its related actions, and any unasked
 * questions into one honest readiness picture.
 */
export function lessonPreparation(
  event: ScheduleEvent,
  sources: {
    prepItems: PrepItem[];
    actions: NextAction[];
    questions: Question[];
  },
): PreparationState {
  const lines: PreparationLine[] = [];

  for (const item of sources.prepItems.filter((p) => p.eventId === event.id)) {
    lines.push({ id: item.id, label: item.title, done: item.done, source: "checklist" });
  }

  for (const action of sources.actions.filter(
    (a) => a.relatedType === "event" && a.relatedId === event.id,
  )) {
    lines.push({
      id: action.id,
      label: action.title,
      done: !isOpen(action),
      source: "action",
    });
  }

  for (const question of sources.questions.filter((q) => q.eventId === event.id)) {
    lines.push({
      id: question.id,
      label: `Ask: ${question.text}`,
      done: question.status === "asked" || question.status === "answered",
      source: "question",
    });
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

/** The next lesson or event still ahead of us. */
export function nextEvent(
  events: ScheduleEvent[],
  today: IsoDate = todayIso(),
): ScheduleEvent | null {
  return (
    events
      .filter((event) => event.date >= today && event.status === "scheduled")
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.startTime ?? "").localeCompare(b.startTime ?? "");
      })[0] ?? null
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
