/**
 * ORAL-01d: her finished oral answers, each frozen to the scenario version she
 * answered (schema 32). Native twin of the codec: `decode_covered` in
 * `src-tauri/src/oral_scenarios.rs`. Answers live only in her database and
 * complete backups; no export, packet or handout reads this table.
 */
import { ORAL_MAX_ANSWER } from "@/logic/oralPractice";

export interface OralAnswer {
  id: string;
  scenarioId: string;
  versionId: string;
  versionNumber: number;
  /** Discussion points from this answer's frozen scenario version. */
  points: string[];
  answer: string;
  /** Indexes of the points she ticked in that frozen version. */
  covered: number[];
  finishedAt: string;
}

/** The one ticks codec: sorted, unique point indexes below `pointCount`. */
export function validOralCovered(value: unknown, pointCount: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((n, i) => Number.isSafeInteger(n) && n >= 0 && n < pointCount && (i === 0 || n > (value[i - 1] as number)))
  );
}
export function encodeOralCovered(covered: number[], pointCount: number): string {
  if (!validOralCovered(covered, pointCount)) throw new Error("Invalid ticked points.");
  return JSON.stringify(covered);
}
/** Decodes only the exact encoding `encodeOralCovered` writes. */
export function decodeOralCovered(raw: unknown, pointCount: number): number[] {
  if (typeof raw !== "string") throw new Error("Invalid ticked points.");
  const parsed: unknown = JSON.parse(raw);
  if (!validOralCovered(parsed, pointCount) || JSON.stringify(parsed) !== raw) throw new Error("Invalid ticked points.");
  return parsed;
}

/** Ticked flags (one per point) to the stored index list. */
export const coveredIndexes = (ticked: boolean[]): number[] => ticked.flatMap((on, at) => (on ? [at] : []));

export const validOralAnswerText = (answer: unknown): answer is string =>
  typeof answer === "string" && Array.from(answer).length <= ORAL_MAX_ANSWER;

/** The first non-empty line, for the "Earlier answers" list. */
export function oralAnswerFirstLine(answer: string): string {
  const line = answer.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}
