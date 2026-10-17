/**
 * A printable lesson brief (P54-05 part A).
 *
 * One page to read before a lesson, built only from what the lesson already
 * shows: its details, the preparation checklist and questions to ask (with
 * the same done/outstanding state as the lesson screen), the titles of the
 * reading attached to it, and any follow-ups she ticks.
 *
 * Follow-ups are never included automatically. The candidates are, in order:
 * - the lines of "questions for next time" from her most recent journal
 *   entry dated before this lesson (latest date, then latest written);
 * - open questions (to ask or revisit) saved with another lesson or a
 *   material that belongs to this lesson's goal, oldest first.
 * A candidate whose wording repeats one already listed (or a question already
 * on this lesson's checklist) is offered once.
 *
 * Never included: lesson notes, journal reflections, finances, medical or
 * toolkit records, material notes or file paths, and other lessons' details.
 * The page is escaped text under the handout's Content-Security-Policy: it
 * cannot run or load anything.
 */
import {
  EVENT_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  MATERIAL_TYPE_LABELS,
  TOPIC_LABELS,
  type JournalEntry,
  type PrepItem,
  type Question,
  type ScheduleEvent,
  type StudyMaterial,
} from "@/domain/types";
import { formatLongDate, formatTime } from "@/lib/dates";
import { lessonPreparation, type PreparationLine } from "@/logic/preparation";
import { exportFileName } from "@/logic/studyExport";
import { escapeHtml, PRINT_STYLE } from "@/logic/studyHandout";

export interface BriefSources {
  events: ScheduleEvent[];
  prepItems: PrepItem[];
  questions: Question[];
  materials: StudyMaterial[];
  journalEntries: JournalEntry[];
}

export interface FollowUpCandidate {
  /** Stable within one brief: the source record and, for journal lines, the line. */
  id: string;
  /** Her own wording, unchanged apart from surrounding whitespace. */
  text: string;
  /** Where it came from, shown beside the choice and in the brief. */
  from: string;
}

export interface LessonBrief {
  title: string;
  facts: { label: string; value: string }[];
  preparation: PreparationLine[];
  completed: number;
  materials: { title: string; type: string; topic: string }[];
  followUps: FollowUpCandidate[];
}

const OPEN_STATUSES = new Set<Question["status"]>(["to_ask", "revisit"]);

/** A date with its year always shown: a printed page outlives "this year". */
const printedDate = (date: string) => formatLongDate(date, "0000-01-01");

function sameWords(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function newestEarlierEntry(event: ScheduleEvent, entries: JournalEntry[]): JournalEntry | null {
  const earlier = entries.filter((entry) => entry.eventId !== event.id && entry.date < event.date);
  earlier.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return earlier[0] ?? null;
}

function followUpCandidates(event: ScheduleEvent, sources: BriefSources): FollowUpCandidate[] {
  const candidates: FollowUpCandidate[] = [];
  const entry = newestEarlierEntry(event, sources.journalEntries);
  if (entry) {
    entry.questionsForNextTime
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .forEach((line, index) => {
        candidates.push({ id: `journal:${entry.id}:${index}`, text: line, from: `Journal, ${printedDate(entry.date)}` });
      });
  }

  if (event.goalId) {
    const goalLessons = new Map(sources.events.filter((other) => other.goalId === event.goalId && other.id !== event.id).map((other) => [other.id, other]));
    const goalMaterials = new Map(sources.materials.filter((material) => material.goalId === event.goalId).map((material) => [material.id, material]));
    const open = sources.questions
      .filter((question) => OPEN_STATUSES.has(question.status) && question.eventId !== event.id)
      .filter((question) => (question.eventId && goalLessons.has(question.eventId)) || (question.materialId && goalMaterials.has(question.materialId)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const question of open) {
      const lesson = question.eventId ? goalLessons.get(question.eventId) : undefined;
      const material = question.materialId ? goalMaterials.get(question.materialId) : undefined;
      const from = lesson ? `Question saved for “${lesson.title}”` : `Question about “${material?.title ?? ""}”`;
      candidates.push({ id: `question:${question.id}`, text: question.text.trim(), from });
    }
  }

  // Offered once: drop repeats of an earlier candidate or of this lesson's own questions.
  const seen = new Set(sources.questions.filter((question) => question.eventId === event.id).map((question) => sameWords(question.text)));
  return candidates.filter((candidate) => {
    const key = sameWords(candidate.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Everything the brief can show for one lesson. Follow-ups are only candidates. */
export function lessonBrief(event: ScheduleEvent, sources: BriefSources): LessonBrief {
  const facts: { label: string; value: string }[] = [
    { label: "Type", value: EVENT_TYPE_LABELS[event.eventType] },
    { label: "Date", value: printedDate(event.date) },
  ];
  if (event.startTime) {
    facts.push({ label: "Time", value: event.endTime ? `${formatTime(event.startTime)}–${formatTime(event.endTime)}` : formatTime(event.startTime) });
  }
  if (event.location.trim()) facts.push({ label: "Location", value: event.location.trim() });
  if (event.instructor.trim()) facts.push({ label: "Instructor", value: event.instructor.trim() });
  if (event.status !== "scheduled") facts.push({ label: "Status", value: EVENT_STATUS_LABELS[event.status] });

  const preparation = lessonPreparation(event, { prepItems: sources.prepItems, questions: sources.questions });
  const materials = event.materialIds
    .map((id) => sources.materials.find((material) => material.id === id))
    .filter((material): material is StudyMaterial => material !== undefined)
    .map((material) => ({ title: material.title, type: MATERIAL_TYPE_LABELS[material.materialType], topic: TOPIC_LABELS[material.topic] }));

  return {
    title: event.title.trim() || "Lesson",
    facts,
    preparation: preparation.lines,
    completed: preparation.completed,
    materials,
    followUps: followUpCandidates(event, sources),
  };
}

/** The suggested file name for a saved brief. */
export function briefFileName(event: ScheduleEvent): string {
  return exportFileName(`Lesson brief ${event.date} ${event.title}`, "html");
}

function text(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

/** The printable page: exactly the brief's sections and the ticked follow-ups. */
export function buildBriefHtml(brief: LessonBrief, chosen: ReadonlySet<string>, createdAt: Date): string {
  const facts = brief.facts.map((fact) => `<tr><th scope="row">${escapeHtml(fact.label)}</th><td>${text(fact.value)}</td></tr>`).join("");

  const ready = brief.preparation.length
    ? `<p class="meta">${brief.completed} of ${brief.preparation.length} ready</p><ul class="brief-lines">${brief.preparation
        .map((line) => `<li><strong>${line.done ? "Done" : "To do"}:</strong> ${text(line.label)}</li>`)
        .join("")}</ul>`
    : `<p>Nothing to prepare is listed for this lesson.</p>`;

  const reading = brief.materials.length
    ? `<ul>${brief.materials.map((m) => `<li>${text(m.title)} <span class="ref">(${escapeHtml(m.type)} · ${escapeHtml(m.topic)})</span></li>`).join("")}</ul>`
    : `<p>No reading is attached to this lesson.</p>`;

  const picked = brief.followUps.filter((candidate) => chosen.has(candidate.id));
  const followUps = picked.length
    ? `<section><h2>Follow-ups</h2><ul>${picked.map((c) => `<li>${text(c.text)} <span class="ref">(${escapeHtml(c.from)})</span></li>`).join("")}</ul></section>`
    : "";

  const date = createdAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(`Lesson brief: ${brief.title}`)}</title>
<style>${PRINT_STYLE}
.facts th { width: 8rem; background: none; border: none; padding-left: 0; color: #57606a; font-weight: 500; }
.facts td { border: none; }
.brief-lines { list-style: none; padding-left: 0; }</style>
</head>
<body>
<header>
<h1>${text(brief.title)}</h1>
<p class="meta">Lesson brief from Her Flight Deck · ${escapeHtml(date)}</p>
<table class="facts"><tbody>${facts}</tbody></table>
</header>
<section><h2>Get ready</h2>${ready}</section>
<section><h2>Read before</h2>${reading}</section>
${followUps}
</body>
</html>
`;
}
