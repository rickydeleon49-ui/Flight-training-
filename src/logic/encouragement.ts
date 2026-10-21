/**
 * Contextual encouragement.
 *
 * Every message here is derived from real application state — there are no
 * motivational quotes and no invented praise. When there is genuinely
 * nothing to say, this returns null and the dashboard shows nothing.
 */
import { daysBetween } from "@/lib/dates";
import type { IsoDate } from "@/domain/types";

export interface EncouragementInput {
  today: IsoDate;
  /** Days until the next lesson, or null when nothing is scheduled. */
  nextLessonDate: IsoDate | null;
  nextLessonTitle: string | null;
  outstandingPrepCount: number;
  overdueCount: number;
  completedThisWeek: number;
  openActionCount: number;
  hasAnyData: boolean;
  hasRecommendations?: boolean;
  allWaitingAreHomework?: boolean;
}

/** Timing wording for a lesson within the coming week. */
function describeLessonTiming(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function encouragementMessage(input: EncouragementInput): string | null {
  if (!input.hasAnyData) return null;

  const daysToLesson =
    input.nextLessonDate === null ? null : daysBetween(input.today, input.nextLessonDate);

  // Closest to the lesson and still something to do — the most useful nudge.
  if (daysToLesson !== null && daysToLesson >= 0 && daysToLesson <= 7) {
    if (input.outstandingPrepCount > 0) {
      const item = input.outstandingPrepCount === 1 ? "item" : "items";
      const verb = input.outstandingPrepCount === 1 ? "remains" : "remain";
      return `Your next lesson is ${describeLessonTiming(daysToLesson)}. ${
        input.outstandingPrepCount
      } preparation ${item} ${verb}.`;
    }
    if (input.nextLessonTitle) {
      return `You are prepared for ${input.nextLessonTitle}.`;
    }
  }

  // Real progress is worth naming.
  if (input.completedThisWeek >= 3) {
    return `You finished ${input.completedThisWeek} things this week. That is real progress.`;
  }

  // Overdue work is acknowledged without blame, and paired with a way out.
  if (input.overdueCount > 0) {
    if (input.allWaitingAreHomework) {
      const item = input.overdueCount === 1 ? "homework item is" : "homework items are";
      return `${input.overdueCount} ${item} waiting. Open ${input.overdueCount === 1 ? "it" : "them"} to keep going.`;
    }
    const item = input.overdueCount === 1 ? "item is" : "items are";
    return `${input.overdueCount} ${item} waiting. Choose a realistic new time for one of them.`;
  }

  if (input.completedThisWeek > 0) {
    return `You finished ${input.completedThisWeek} ${
      input.completedThisWeek === 1 ? "thing" : "things"
    } this week.`;
  }

  if (input.openActionCount === 0) {
    if (input.hasRecommendations) {
      return "Your recommended items are above.";
    }
    return "Nothing is waiting. A good moment to plan your next step.";
  }

  return null;
}
