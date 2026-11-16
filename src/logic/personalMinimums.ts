import type { PersonalMinimums } from "@/domain/types";

export type MinimumVerdict = "inside" | "outside";

export interface TodayConditions {
  ceilingFt?: number;
  visibilitySm?: number;
  windKt?: number;
  crosswindKt?: number;
}

export type MinimumsComparison = Partial<Record<keyof TodayConditions, MinimumVerdict>>;

const NUMERIC_KEYS = ["ceilingFt", "visibilitySm", "windKt", "crosswindKt"] as const;

/** A finite number of zero or more, or undefined. */
function cleanNumber(value: unknown): number | undefined {
  if (value === "" || value == null || typeof value === "boolean") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Keeps good stored minimums; returns undefined when nothing usable is saved. */
export function normalizePersonalMinimums(value: unknown): PersonalMinimums | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const out: PersonalMinimums = {};
  for (const key of NUMERIC_KEYS) {
    const n = cleanNumber(v[key]);
    if (n !== undefined) out[key] = n;
  }
  if (typeof v.note === "string") {
    const note = v.note.trim().slice(0, 140);
    if (note) out.note = note;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Compares today's conditions with the saved minimums. Equal to the limit is
 * inside. Ceiling and visibility: lower than the minimum is outside. Wind and
 * crosswind: higher than the maximum is outside. A missing minimum or a
 * missing input gives no entry.
 */
export function compareToMinimums(
  minimums: PersonalMinimums | undefined,
  today: TodayConditions,
): MinimumsComparison {
  const result: MinimumsComparison = {};
  if (!minimums) return result;
  for (const key of ["ceilingFt", "visibilitySm"] as const) {
    const min = minimums[key];
    const now = today[key];
    if (min !== undefined && now !== undefined) result[key] = now < min ? "outside" : "inside";
  }
  for (const key of ["windKt", "crosswindKt"] as const) {
    const max = minimums[key];
    const now = today[key];
    if (max !== undefined && now !== undefined) result[key] = now > max ? "outside" : "inside";
  }
  return result;
}

/** Wording for the overall result; never says go, safe or OK. Null when nothing was compared. */
export function minimumsSummary(comparison: MinimumsComparison): string | null {
  const verdicts = Object.values(comparison);
  if (verdicts.length === 0) return null;
  if (verdicts.includes("outside")) return "Outside your minimum — talk with your instructor.";
  return "Inside the minimums you saved. You and your instructor still make the call.";
}

/** "Your minimums: ceiling 3,000 ft · vis 5 SM · wind 15 kt · crosswind 8 kt" or null. */
export function minimumsLine(m: PersonalMinimums | undefined): string | null {
  if (!m) return null;
  const parts: string[] = [];
  if (m.ceilingFt !== undefined) parts.push(`ceiling ${m.ceilingFt.toLocaleString("en-US")} ft`);
  if (m.visibilitySm !== undefined) parts.push(`vis ${m.visibilitySm} SM`);
  if (m.windKt !== undefined) parts.push(`wind ${m.windKt} kt`);
  if (m.crosswindKt !== undefined) parts.push(`crosswind ${m.crosswindKt} kt`);
  if (m.note) parts.push(m.note);
  return parts.length ? `Your minimums: ${parts.join(" · ")}` : null;
}
