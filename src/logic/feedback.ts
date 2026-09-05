/**
 * Instructor feedback across the whole journal.
 *
 * Spec section 22 asks that feedback be preserved and revisitable over time.
 * Individual entries already store it; this collects it into one chronology
 * so a recurring note ("look further down the runway") is visible as a
 * pattern rather than buried in one debrief.
 *
 * This is storage and organization only — it deliberately does not try to
 * infer themes, which the spec puts beyond the first release.
 */
import type { Goal, IsoDate, JournalEntry, ScheduleEvent } from "@/domain/types";

export interface FeedbackNote {
  /** The journal entry this came from. */
  entryId: string;
  date: IsoDate;
  text: string;
  /** What the entry was called, for context in the list. */
  title: string;
  goalId: string | null;
  goalTitle: string | null;
  eventId: string | null;
  confidence: number | null;
}

export function collectFeedback(
  entries: JournalEntry[],
  events: ScheduleEvent[],
  goals: Goal[],
): FeedbackNote[] {
  return entries
    .filter((entry) => entry.instructorFeedback.trim().length > 0)
    .map((entry) => {
      const event = events.find((candidate) => candidate.id === entry.eventId);
      const goal = goals.find((candidate) => candidate.id === entry.goalId);
      return {
        entryId: entry.id,
        date: entry.date,
        text: entry.instructorFeedback.trim(),
        title: entry.title || event?.title || "Lesson debrief",
        goalId: entry.goalId,
        goalTitle: goal?.title ?? null,
        eventId: entry.eventId,
        confidence: entry.confidence,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** The goals that actually have feedback attached, for filtering. */
export function goalsWithFeedback(notes: FeedbackNote[]): Array<{ id: string; title: string }> {
  const seen = new Map<string, string>();
  for (const note of notes) {
    if (note.goalId && note.goalTitle) seen.set(note.goalId, note.goalTitle);
  }
  return [...seen].map(([id, title]) => ({ id, title }));
}
