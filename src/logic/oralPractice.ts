/**
 * Oral-question practice (ORAL-01b/01c). Pure helpers: nothing here stores anything.
 * Her answer and the ticked points live only in the open practice dialog.
 */
export const ORAL_MAX_POINTS = 12;
export const ORAL_MAX_SCENARIO = 4000;
export const ORAL_MAX_ASSUMPTIONS = 2000;
export const ORAL_MAX_POINT = 500;
export const ORAL_MAX_ANSWER = 20000;

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
  /** The points she ticked "I covered this" for. */
  coveredPoints: string[];
}

/** Plain text she can edit, for a note or a question to her instructor. */
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
  const short = first.length > 60 ? `${first.slice(0, 57)}…` : first;
  return { title: `Oral question: ${short}`, body: oralPlainText(text) };
}

export function oralQuestionText(text: OralText): string {
  return `Oral question I practised. Could we talk it through?\n\n${oralPlainText(text)}`;
}
