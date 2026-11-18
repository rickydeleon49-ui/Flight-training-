import { normalizedStudyText, prepareStudyEdit, type AuthoringState } from "@/logic/studyAuthoring";

/**
 * Oral-question practice (ORAL-01b/01c). Pure helpers: nothing here stores anything.
 * The student's answer and the ticked points live only in the open practice dialog.
 */
export const ORAL_MAX_POINTS = 12;
export const ORAL_MAX_SCENARIO = 4000;
export const ORAL_MAX_ASSUMPTIONS = 2000;
export const ORAL_MAX_POINT = 500;
export const ORAL_MAX_ANSWER = 20000;
export { ORAL_FOLLOW_UPS_MAX as ORAL_MAX_FOLLOW_UPS, ORAL_FOLLOW_UP_MAX_CHARS as ORAL_MAX_FOLLOW_UP } from "@/data/oralScenarios";
export const ORAL_LONG_ANSWER_WORDS = 120;
export const ORAL_LENGTH_HINT = "Examiners like short answers: state the rule, then one example.";
export const ORAL_REVIEW_SET_TITLE = "Oral practice: missed points";

/** The first `max` characters of `text`, never cutting an emoji or other two-part character in half. */
export function clipText(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

/** A quiet nudge when an answer runs long (over about 120 words). Nothing for short or empty answers. */
export function answerLengthHint(text: string): string | null {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return words > ORAL_LONG_ANSWER_WORDS ? ORAL_LENGTH_HINT : null;
}

/** One review card per point that was not ticked: the scenario plus "Key point?" on the front, the point on the back. */
export function missedPointCards(prompt: string, points: readonly string[], covered: readonly boolean[]): { front: string; back: string }[] {
  const text = prompt.trim();
  // A card front holds 1,000 characters at most; keep "Key point?" and shorten a very long scenario.
  const shown = Array.from(text).length > 960 ? `${clipText(text, 959)}…` : text;
  const front = `${shown} Key point?`;
  return points.flatMap((point, at) => (covered[at] ? [] : [{ front, back: point }]));
}

/**
 * Add the missed-point cards to a set as the student's own cards. A card with the same front
 * (the scenario) and the same back (the point) is already there, so a second run adds nothing.
 */
export async function applyMissedPointCards(state: AuthoringState, cards: readonly { front: string; back: string }[]): Promise<AuthoringState> {
  let next = state;
  for (const card of cards) {
    const same = next.items.some(
      (item) => item.kind === "card" && normalizedStudyText(item.fields[0] ?? "") === normalizedStudyText(card.front) && normalizedStudyText(item.fields[1] ?? "") === normalizedStudyText(card.back),
    );
    if (same) continue;
    next = (await prepareStudyEdit(next, { kind: "add", item: { kind: "card", fields: [card.front, card.back], sourcePage: null }, origin: "user" })).next;
  }
  return next;
}

/** One discussion point per line; blank lines are ignored. */
export function parseOralPoints(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface OralSetupProblem {
  field: "scenario" | "points";
  message: string;
}

export function oralSetupProblem(scenario: string, pointsText: string): OralSetupProblem | null {
  if (!scenario.trim()) return { field: "scenario", message: "Write the scenario first." };
  const points = parseOralPoints(pointsText);
  if (points.length === 0) return { field: "points", message: "Add at least one discussion point." };
  if (points.length > ORAL_MAX_POINTS)
    return { field: "points", message: `Keep it to ${ORAL_MAX_POINTS} points or fewer.` };
  if (points.some((point) => point.length > ORAL_MAX_POINT))
    return { field: "points", message: `Keep each point under ${ORAL_MAX_POINT} characters.` };
  return null;
}

export interface OralText {
  scenario: string;
  assumptions: string;
  answer: string;
  /** The points the student ticked "I covered this" for. */
  coveredPoints: string[];
}

/** Plain text the student can edit, for a note or a question to the student instructor. */
export function oralPlainText({ scenario, assumptions, answer, coveredPoints }: OralText): string {
  const parts = [`Scenario:\n${scenario.trim()}`];
  if (assumptions.trim()) parts.push(`Assumptions:\n${assumptions.trim()}`);
  if (answer.trim()) parts.push(`My answer:\n${answer.trim()}`);
  if (coveredPoints.length > 0)
    parts.push(`Points I said I covered:\n${coveredPoints.map((point) => `- ${point}`).join("\n")}`);
  return parts.join("\n\n");
}

export function oralNoteDraft(text: OralText): { title: string; body: string } {
  const first = text.scenario.trim().split(/\r?\n/)[0] ?? "";
  const short = Array.from(first).length > 60 ? `${clipText(first, 57)}…` : first;
  return { title: `Oral question: ${short}`, body: oralPlainText(text) };
}

export function oralQuestionText(text: OralText): string {
  return `Oral question I practiced. Could we talk it through?\n\n${oralPlainText(text)}`;
}

/** The first line of a scenario, kept short for lists. */
export function oralScenarioTitle(prompt: string): string {
  const first = prompt.trim().split(/\r?\n/)[0] ?? "";
  return first.length > 80 ? `${first.slice(0, 77)}…` : first;
}

export const MOCK_ORAL_MIN = 3;
export const MOCK_ORAL_MAX = 5;

/**
 * Mock oral: pick 3 to 5 saved scenarios, least recently practised first. A scenario never
 * practised comes before any practised one; ties keep the student's own list order (scenarios
 * carry no created time, so list order stands in for "oldest created"). Fewer than 3 gives [].
 * `lastPractised` maps scenario id to the latest finished-answer ISO time.
 */
export function pickMockOral<T extends { id: string }>(
  scenarios: readonly T[],
  lastPractised: ReadonlyMap<string, string>,
): T[] {
  if (scenarios.length < MOCK_ORAL_MIN) return [];
  return scenarios
    .map((scenario, at) => ({ scenario, at, last: lastPractised.get(scenario.id) ?? "" }))
    .sort((a, b) => (a.last < b.last ? -1 : a.last > b.last ? 1 : a.at - b.at))
    .slice(0, MOCK_ORAL_MAX)
    .map((x) => x.scenario);
}
