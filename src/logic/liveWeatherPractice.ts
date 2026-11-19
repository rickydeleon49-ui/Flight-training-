import type { PersonalMinimums } from "@/domain/types";
import { compareToMinimums, minimumsSummary, type MinimumsComparison, type TodayConditions } from "./personalMinimums";
import type { WeatherReport } from "./weather";

/** An observation older than this is called stale (same 90 minutes as the "Older observation" label). */
export const STALE_MINUTES = 90;

export type LiveField = "ceiling" | "visibility" | "wind";

export interface LivePractice {
  ceilingFt?: number;
  /** True only when the report clearly shows no broken/overcast layer (e.g. CLR, SKC, FEW/SCT only). */
  noCeiling?: boolean;
  visibilitySm?: number;
  /** Gust speed when gusts are reported, otherwise the steady wind. */
  windKt?: number;
  observedAt: number | null;
  /** Whole minutes since the observation; null when the time is missing or in the future. */
  ageMinutes: number | null;
  /** True when older than 90 minutes, or when the age cannot be worked out. */
  stale: boolean;
  /** Fields the report did not give in a form we can read. Never treated as inside minimums. */
  unknown: LiveField[];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function readVisibility(v: unknown): number | undefined {
  if (isNum(v)) return v;
  if (typeof v !== "string") return undefined;
  // A leading "M" means below that value (e.g. M1/4 = less than 1/4 SM): count it just under the value.
  const below = /^M/.test(v.trim());
  const text = below ? v.trim().slice(1) : v.trim();
  const m = /^(?:(\d+) )?(\d+)\/(\d+)\+?$|^(\d+(?:\.\d+)?)\+?$/.exec(text);
  if (!m) return undefined;
  const n = m[4] !== undefined ? Number(m[4]) : Number(m[3]) === 0 ? undefined : Number(m[1] ?? 0) + Number(m[2]) / Number(m[3]);
  if (n === undefined) return undefined;
  return below ? (n > 0 ? n - 0.001 : undefined) : n;
}

/** Numbers for the minimums comparison, read from the decoded report conditions. */
export function practiceFromLiveReport(report: WeatherReport, now: number): LivePractice {
  const c = report.conditions ?? {};
  const unknown: LiveField[] = [];
  const out: LivePractice = { observedAt: null, ageMinutes: null, stale: true, unknown };

  // Ceiling: lowest BKN/OVC base or vertical visibility. A layer without a base is unknown.
  if (Array.isArray(c.clouds) || isNum(c.vertVis)) {
    const bases: number[] = [];
    let bad = !Array.isArray(c.clouds) && !isNum(c.vertVis);
    if (Array.isArray(c.clouds)) for (const layer of c.clouds) {
      const l = (layer && typeof layer === "object" ? layer : {}) as Record<string, unknown>;
      if (l.cover === "BKN" || l.cover === "OVC") { if (isNum(l.base)) bases.push(l.base); else bad = true; }
      else if (l.cover === "VV") { if (isNum(l.base)) bases.push(l.base); else bad = true; }
      else if (!["CLR", "SKC", "FEW", "SCT"].includes(l.cover as string)) bad = true;
    }
    if (isNum(c.vertVis)) bases.push(c.vertVis);
    // An empty sky list or an unreadable vertical visibility (VV///) must never read as "no ceiling".
    const noLayers = Array.isArray(c.clouds) && c.clouds.length === 0 && !isNum(c.vertVis);
    if (noLayers || /(?:^|\s)VV\/\/\/(?:\s|$)/.test(report.raw ?? "")) bad = true;
    if (bases.length) out.ceilingFt = Math.min(...bases);
    else if (bad) unknown.push("ceiling");
    else out.noCeiling = true;
  } else unknown.push("ceiling");

  const vis = readVisibility(c.visib);
  if (vis === undefined) unknown.push("visibility"); else out.visibilitySm = vis;

  if (isNum(c.wspd)) out.windKt = isNum(c.wgst) && c.wgst >= c.wspd ? c.wgst : c.wspd;
  else unknown.push("wind");

  if (typeof report.reportTime === "number" && Number.isFinite(report.reportTime) && report.reportTime <= now) {
    out.observedAt = report.reportTime;
    out.ageMinutes = Math.floor((now - report.reportTime) / 60_000);
    out.stale = out.ageMinutes > STALE_MINUTES;
  } else if (typeof report.reportTime === "number" && Number.isFinite(report.reportTime)) out.observedAt = report.reportTime;
  return out;
}

export interface LiveComparison {
  comparison: MinimumsComparison;
  /** One plain line per field that could not be read. */
  cantTell: string[];
  summary: string | null;
}

const CANT_TELL: Record<LiveField, string> = {
  ceiling: "Can't tell the ceiling from this report, so it isn't compared with your minimum.",
  visibility: "Can't tell the visibility from this report, so it isn't compared with your minimum.",
  wind: "Can't tell the wind from this report, so it isn't compared with your maximum.",
};

/** Compares a live observation with saved minimums. Unreadable fields are named, never counted as inside. */
export function compareLiveToMinimums(minimums: PersonalMinimums | undefined, live: LivePractice): LiveComparison {
  const today: TodayConditions = { ceilingFt: live.ceilingFt, visibilitySm: live.visibilitySm, windKt: live.windKt };
  const comparison = compareToMinimums(minimums, today);
  // No broken/overcast layer is above any ceiling minimum.
  if (live.noCeiling && minimums?.ceilingFt !== undefined) comparison.ceilingFt = "inside";
  const key = { ceiling: "ceilingFt", visibility: "visibilitySm", wind: "windKt" } as const;
  const cantTell = live.unknown.filter((f) => minimums?.[key[f]] !== undefined).map((f) => CANT_TELL[f]);
  let summary = minimumsSummary(comparison);
  if (cantTell.length && !Object.values(comparison).includes("outside")) {
    summary = "Part of this report couldn't be read, so it isn't fully compared with your minimums. Check the original report with your instructor.";
  }
  return { comparison, cantTell, summary };
}
