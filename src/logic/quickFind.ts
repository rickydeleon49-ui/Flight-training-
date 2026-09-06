/**
 * One search box over the whole training record.
 *
 * Ten sections is a lot of clicking when she only wants the handout from
 * Tuesday. Quick Find matches across every record that has somewhere to go,
 * plus the sections themselves, and ranks so that what she typed the start
 * of comes first.
 */
import {
  EVENT_TYPE_LABELS,
  MATERIAL_TYPE_LABELS,
  TOPIC_LABELS,
} from "@/domain/types";
import { formatLongDate } from "@/lib/dates";
import { noteHeading } from "@/logic/notes";
import type { AppData } from "@/state/AppDataContext";

export type QuickFindSection =
  | "Flight Deck"
  | "Flight Path"
  | "Study Library"
  | "Schedule"
  | "Flight Log"
  | "Questions"
  | "Notes"
  | "Finances"
  | "Pilot Toolkit"
  | "Settings"
  | "Go to";

export interface QuickFindResult {
  key: string;
  /** What she is looking for. */
  label: string;
  /** Enough context to tell two similar titles apart. */
  detail: string;
  section: QuickFindSection;
  /** Route to open when chosen. */
  to: string;
}

interface Candidate extends QuickFindResult {
  /** Extra text that can match without being shown. */
  haystack: string;
}

/** The sections themselves, so typing "fin" reaches Finances. */
const DESTINATIONS: Array<{ label: string; to: string; detail: string }> = [
  { label: "Flight Deck", to: "/", detail: "Today at a glance" },
  { label: "Flight Path", to: "/flight-path", detail: "Milestones and goals" },
  { label: "Study Library", to: "/study", detail: "Materials and notes" },
  { label: "Schedule", to: "/schedule", detail: "Lessons and events" },
  { label: "Flight Log", to: "/journal", detail: "Flights and reflections" },
  { label: "Questions", to: "/questions", detail: "To ask your instructor" },
  { label: "Notes", to: "/notes", detail: "Anything you wrote down" },
  { label: "Finances", to: "/finances", detail: "Spending and funds" },
  { label: "Pilot Toolkit", to: "/toolkit", detail: "Checkride readiness" },
  { label: "Settings", to: "/settings", detail: "Profile and preferences" },
];

/**
 * Lower is better. A title starting with the query beats a word inside it,
 * which beats a match somewhere in the record's other text.
 */
function rank(candidate: Candidate, query: string): number | null {
  const label = candidate.label.toLowerCase();
  if (label.startsWith(query)) return 0;
  if (new RegExp(`\\b${escapeForRegExp(query)}`).test(label)) return 1;
  if (label.includes(query)) return 2;
  if (candidate.haystack.toLowerCase().includes(query)) return 3;
  return null;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCandidates(data: AppData, today: string): Candidate[] {
  const candidates: Candidate[] = [];
  const push = (
    key: string,
    section: QuickFindSection,
    label: string,
    detail: string,
    to: string,
    haystack = "",
  ) => {
    if (!label.trim()) return;
    candidates.push({ key, section, label: label.trim(), detail, to, haystack });
  };

  for (const material of data.materials) {
    push(
      `material:${material.id}`,
      "Study Library",
      material.title,
      `${MATERIAL_TYPE_LABELS[material.materialType]} · ${TOPIC_LABELS[material.topic]}`,
      `/study/${material.id}`,
      [material.notes, material.originalFileName ?? "", ...material.tags].join(" "),
    );
  }

  for (const event of data.events) {
    push(
      `event:${event.id}`,
      "Schedule",
      event.title,
      `${EVENT_TYPE_LABELS[event.eventType]} · ${formatLongDate(event.date, today)}`,
      `/schedule/${event.id}`,
      [event.location, event.instructor, event.notes].join(" "),
    );
  }

  for (const entry of data.journalEntries) {
    push(
      `journal:${entry.id}`,
      "Flight Log",
      entry.title || `Flight on ${entry.date}`,
      formatLongDate(entry.date, today),
      `/journal/${entry.id}`,
      [entry.aircraftId, entry.departureAirport, entry.arrivalAirport, entry.instructorName].join(" "),
    );
  }

  for (const goal of data.goals) {
    push(
      `goal:${goal.id}`,
      "Flight Path",
      goal.title,
      "Goal",
      "/flight-path",
      [goal.description, goal.notes].join(" "),
    );
  }

  for (const milestone of data.milestones) {
    push(`milestone:${milestone.id}`, "Flight Path", milestone.title, "Milestone", "/flight-path",
      milestone.description);
  }

  for (const question of data.questions) {
    push(
      `question:${question.id}`,
      "Questions",
      question.text,
      question.status === "answered" ? "Answered" : "To ask",
      "/questions",
      question.answer,
    );
  }

  for (const note of data.notes) {
    push(
      `note:${note.id}`,
      "Notes",
      noteHeading(note),
      note.pinned ? "Pinned note" : "Note",
      "/notes",
      note.body,
    );
  }

  for (const destination of DESTINATIONS) {
    push(`page:${destination.to}`, "Go to", destination.label, destination.detail, destination.to);
  }

  return candidates;
}

/**
 * Matches for `query`, best first. An empty query returns the sections, so
 * opening Quick Find is useful before typing anything.
 */
export function quickFind(data: AppData, query: string, today: string, limit = 12): QuickFindResult[] {
  const trimmed = query.trim().toLowerCase();

  if (!trimmed) {
    return DESTINATIONS.map(({ label, to, detail }) => ({
      key: `page:${to}`,
      label,
      detail,
      section: "Go to" as const,
      to,
    }));
  }

  const scored: Array<{ candidate: Candidate; score: number }> = [];
  for (const candidate of buildCandidates(data, today)) {
    const score = rank(candidate, trimmed);
    if (score !== null) scored.push({ candidate, score });
  }

  scored.sort((a, b) => a.score - b.score || a.candidate.label.localeCompare(b.candidate.label));

  return scored.slice(0, limit).map(({ candidate }) => ({
    key: candidate.key,
    label: candidate.label,
    detail: candidate.detail,
    section: candidate.section,
    to: candidate.to,
  }));
}
