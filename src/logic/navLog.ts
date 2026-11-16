/** Study-aid navigation log: one leg chained from the E6B pieces. Practice numbers, not for flight. */
import { E6B_TOLERANCE, fuelForTime, trueToMagnetic, windTriangle } from "@/logic/e6b";

export type NavLogLeg = {
  /** True course, 1-360. */
  tc: number;
  distanceNm: number;
  tas: number;
  windDir: number;
  windSpeed: number;
  variation: number;
  side: "E" | "W";
  /** Signed, from the compass card. */
  deviation: number;
  gph: number;
};

export type NavLogSolution = {
  /** Signed: positive = right. */
  wca: number;
  th: number;
  mh: number;
  ch: number;
  gs: number;
  /** Whole minutes. */
  ete: number;
  /** Gallons, one decimal. */
  fuel: number;
};

export type NavLogField = keyof NavLogSolution;
export const NAV_LOG_FIELDS: NavLogField[] = ["wca", "th", "mh", "ch", "gs", "ete", "fuel"];

/** Compass headings run 1-360; 0 is written as 360. */
export const normalizeHeading = (d: number): number => {
  const r = Math.round(((d % 360) + 360) % 360) % 360;
  return r === 0 ? 360 : r;
};

/** WCA -> TH -> MH -> CH -> GS -> ETE -> fuel. Null if the numbers cannot be flown. */
export function solveLeg(leg: NavLogLeg): NavLogSolution | null {
  const w = windTriangle(leg.tc, leg.tas, leg.windDir, leg.windSpeed);
  if (!w.ok) return null;
  const th = normalizeHeading(leg.tc + w.wcaDegrees);
  const m = trueToMagnetic(th, leg.variation, leg.side);
  if (!m.ok) return null;
  const mh = normalizeHeading(m.magneticHeading);
  const ch = normalizeHeading(mh + leg.deviation);
  const ete = Math.round((leg.distanceNm / w.groundSpeed) * 60);
  const f = fuelForTime(leg.gph, ete);
  if (!f.ok) return null;
  return { wca: w.wcaDegrees, th, mh, ch, gs: w.groundSpeed, ete, fuel: f.fuelGallons };
}

export type NavLogTotals = { distanceNm: number; ete: number; fuel: number };

export function navLogTotals(legs: NavLogLeg[]): NavLogTotals {
  let distanceNm = 0;
  let ete = 0;
  let fuel = 0;
  for (const leg of legs) {
    const s = solveLeg(leg);
    distanceNm += leg.distanceNm;
    if (s) {
      ete += s.ete;
      fuel += s.fuel;
    }
  }
  return { distanceNm, ete, fuel: Math.round(fuel * 10) / 10 };
}

// ---- Seeded practice generator ----

/** Small deterministic generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function legFrom(r: () => number): NavLogLeg {
  const variation = int(r, 0, 20);
  return {
    tc: int(r, 1, 360),
    distanceNm: int(r, 20, 80),
    tas: int(r, 90, 130),
    windDir: int(r, 1, 360),
    windSpeed: int(r, 0, 30),
    variation,
    side: variation === 0 || r() < 0.5 ? "E" : "W",
    deviation: int(r, -4, 4),
    gph: int(r, 14, 24) / 2,
  };
}

/** A fictional practice leg; the same seed always gives the same leg. */
export function generateLeg(seed: number): NavLogLeg {
  return legFrom(rng(seed));
}

/** 2 to 4 fictional legs for the whole-trip table. */
export function generateTrip(seed: number, count = 3): NavLogLeg[] {
  const r = rng(seed);
  const n = Math.min(4, Math.max(2, Math.round(count)));
  return Array.from({ length: n }, () => legFrom(r));
}

// ---- Grading ----

export type NavLogGrade = { status: "right" | "close" | "wrong" | "empty"; message: string };

const pad3 = (n: number) => String(n).padStart(3, "0");

const TOL: Record<NavLogField, number> = {
  wca: E6B_TOLERANCE.degrees,
  th: E6B_TOLERANCE.degrees,
  mh: E6B_TOLERANCE.degrees,
  ch: E6B_TOLERANCE.degrees,
  gs: E6B_TOLERANCE.knots,
  ete: E6B_TOLERANCE.minutes,
  fuel: E6B_TOLERANCE.gallons,
};

const CIRCULAR: Record<NavLogField, boolean> = { wca: false, th: true, mh: true, ch: true, gs: false, ete: false, fuel: false };
const STEP: Record<NavLogField, number> = { wca: 1, th: 1, mh: 1, ch: 1, gs: 1, ete: 1, fuel: 0.1 };

export function sayNavLog(field: NavLogField, n: number): string {
  if (field === "wca") return n === 0 ? "0°" : `${Math.abs(n)}° ${n > 0 ? "right" : "left"}`;
  if (field === "th" || field === "mh" || field === "ch") return `${pad3(n)}°`;
  if (field === "gs") return `${n} kt`;
  if (field === "ete") return `${n} minutes`;
  return `${n} gallons`;
}

/** One-line "how" for a box. */
export function navLogHow(field: NavLogField, leg: NavLogLeg): string {
  switch (field) {
    case "wca":
      return "Point into the wind: right (+) if it comes from the right of your course, left (-) if from the left.";
    case "th":
      return "TH = TC + WCA (add right, subtract left).";
    case "mh":
      return leg.side === "E" ? "MH = TH − east variation (east is least)." : "MH = TH + west variation (west is best).";
    case "ch":
      return "CH = MH + deviation (use the sign from your compass card).";
    case "gs":
      return "GS comes from the wind triangle: a headwind slows you, a tailwind speeds you up.";
    case "ete":
      return "ETE = distance ÷ GS × 60.";
    default:
      return "Fuel = burn (GPH) × ETE in hours.";
  }
}

/** Grade one typed box. `scale` widens the tolerance (a totals box adds up several legs). */
export function gradeNavLogBox(field: NavLogField, text: string, want: number, leg: NavLogLeg, scale = 1): NavLogGrade {
  if (text.trim() === "") return { status: "empty", message: "" };
  const typed = Number(text);
  const say = sayNavLog(field, want);
  const how = navLogHow(field, leg);
  if (!Number.isFinite(typed)) return { status: "wrong", message: `Not quite. Type a number. ${how}` };
  let diff = Math.abs(typed - want);
  if (CIRCULAR[field]) diff = Math.abs((((typed - want) % 360) + 540) % 360 - 180);
  if (diff <= STEP[field] / 2 + 1e-9) return { status: "right", message: `Right: ${say}` };
  if (diff <= TOL[field] * scale + 1e-9) return { status: "close", message: `Close: answer is ${say}.` };
  return { status: "wrong", message: `Not quite. ${how} Answer: ${say}.` };
}
