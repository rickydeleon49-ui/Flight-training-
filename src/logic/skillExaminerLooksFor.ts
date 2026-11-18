/**
 * "What the examiner looks for" on a built-in skill's page: the existing
 * Skills lines (the "S" codes) of the matching FAA-S-ACS-6C task, read from the
 * offline ACS catalogs. Nothing is authored here; each skill only points at the
 * task(s) it matches. Skills without a clear single-task match have no entry.
 */
import { CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES } from "./currentPrivateAirplaneAcsCatalog";

export const ACS_EDITION_LABEL = "FAA-S-ACS-6C";

/** Built-in skill id -> task codes ("Area.Task"). Only the student's ASEL lines are shown. */
export const SKILL_ACS_TASKS: Readonly<Record<string, readonly string[]>> = {
  "builtin.preflight_inspection": ["II.A"],
  "builtin.radio_communications": ["III.A"],
  "builtin.taxiing": ["II.D"],
  "builtin.traffic_pattern": ["III.B"],
  "builtin.normal_takeoff": ["IV.A"],
  "builtin.normal_landing": ["IV.B"],
  "builtin.crosswind_landing": ["IV.B"],
  "builtin.go_around": ["IV.N"],
  "builtin.slow_flight": ["VII.A"],
  "builtin.stalls": ["VII.B", "VII.C"],
  "builtin.steep_turns": ["V.A"],
  "builtin.ground_reference": ["V.B"],
  "builtin.emergency_approach": ["IX.B"],
};

export interface ExaminerTask {
  /** e.g. "Area IV Task A" */
  label: string;
  /** e.g. "PA.IV.A" */
  code: string;
  lines: { code: string; text: string }[];
}

const CLASS_TAG = /\((?:ASEL|AMEL|ASES|AMES)(?:,\s*(?:ASEL|AMEL|ASES|AMES))*\)/g;

/** A line tagged only for other classes (seaplane, multiengine) is not for an ASEL student. */
function forAsel(text: string): boolean {
  const tags = text.match(CLASS_TAG);
  return !tags || tags.some((tag) => tag.includes("ASEL"));
}

export function examinerLooksFor(skillId: string): ExaminerTask[] {
  const tasks = SKILL_ACS_TASKS[skillId] ?? [];
  const result: ExaminerTask[] = [];
  for (const task of tasks) {
    const prefix = `PA.${task}.S`;
    const lines = CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES.filter(
      (entry) => entry.code.startsWith(prefix) && /^\d/.test(entry.code.slice(prefix.length)),
    )
      .filter((entry) => forAsel(entry.description))
      .map((entry) => ({ code: entry.code, text: entry.description }));
    if (!lines.length) continue;
    const [area, letter] = task.split(".");
    result.push({ label: `Area ${area} Task ${letter}`, code: `PA.${task}`, lines });
  }
  return result;
}
