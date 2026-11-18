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
  const f = fuelForTime(leg.gph, (leg.distanceNm / w.groundSpeed) * 60);
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

/** Grade one typed box. `scale` widens the tolerance (a totals box adds up several legs); `howText` replaces the usual hint. */
export function gradeNavLogBox(field: NavLogField, text: string, want: number, leg: NavLogLeg, scale = 1, howText?: string): NavLogGrade {
  if (text.trim() === "") return { status: "empty", message: "" };
  const typed = Number(text);
  const say = sayNavLog(field, want);
  const how = howText ?? navLogHow(field, leg);
  if (!Number.isFinite(typed)) return { status: "wrong", message: `Not quite. Type a number. ${how}` };
  let diff = Math.abs(typed - want);
  if (CIRCULAR[field]) diff = Math.abs((((typed - want) % 360) + 540) % 360 - 180);
  if (diff <= STEP[field] / 2 + 1e-9) return { status: "right", message: `Right: ${say}` };
  if (diff <= TOL[field] * scale + 1e-9) return { status: "close", message: `Close: answer is ${say}.` };
  return { status: "wrong", message: `Not quite. ${how} Answer: ${say}.` };
}

// ---- Diversion practice ----

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Quick time estimate tip for a diversion. */
export const DIVERSION_TIP = "Quick time estimate: time in minutes = distance ÷ GS × 60. At 100 kt that is 10 NM in about 6 minutes.";

export type NavLogDiversion = { leg: NavLogLeg; fuelOnBoard: number };
export type NavLogDiversionSolution = { th: number; mh: number; gs: number; ete: number; fuelUsed: number; fuelLeft: number };

/** A fictional diversion: a short leg to an alternate, plus the fuel on board at the point of diversion. */
export function generateDiversion(seed: number): NavLogDiversion {
  const r = rng(seed);
  const leg = { ...legFrom(r), distanceNm: int(r, 10, 40) };
  const s = solveLeg(leg);
  const used = s ? s.fuel : 0;
  return { leg, fuelOnBoard: round1(used + int(r, 20, 60) / 10) };
}

export function solveDiversion(d: NavLogDiversion): NavLogDiversionSolution | null {
  const s = solveLeg(d.leg);
  if (!s) return null;
  return { th: s.th, mh: s.mh, gs: s.gs, ete: s.ete, fuelUsed: s.fuel, fuelLeft: round1(d.fuelOnBoard - s.fuel) };
}

// ---- Fuel reserve practice ----

export type NavLogReserveScenario = { legs: NavLogLeg[]; fuelOnBoard: number; night: boolean; gph: number };
export type NavLogReserveSolution = {
  fuelUsed: number;
  fuelLeft: number;
  reserveMinutes: 30 | 45;
  /** Gallons: GPH x 0.5 by day, x 0.75 at night. */
  reserveGallons: number;
  covers: boolean;
};

/** Reserve in gallons at normal cruise: 30 minutes by day, 45 at night (14 CFR 91.151, VFR). */
export function reserveFor(gph: number, night: boolean): { minutes: 30 | 45; gallons: number } {
  return { minutes: night ? 45 : 30, gallons: round1(gph * (night ? 0.75 : 0.5)) };
}

/** A 2-3 leg trip with one burn rate; about half the seeds fall short of the reserve. */
export function generateReserveScenario(seed: number): NavLogReserveScenario {
  const r = rng(seed);
  const n = int(r, 2, 3);
  const gph = int(r, 14, 24) / 2;
  const legs = Array.from({ length: n }, () => ({ ...legFrom(r), gph }));
  const night = r() < 0.5;
  const short = r() < 0.5;
  const used = navLogTotals(legs).fuel;
  const reserve = reserveFor(gph, night).gallons;
  const margin = short ? -int(r, 5, 25) / 10 : int(r, 5, 40) / 10;
  return { legs, fuelOnBoard: round1(used + reserve + margin), night, gph };
}

export function solveReserve(sc: NavLogReserveScenario): NavLogReserveSolution {
  const fuelUsed = navLogTotals(sc.legs).fuel;
  const fuelLeft = round1(sc.fuelOnBoard - fuelUsed);
  const res = reserveFor(sc.gph, sc.night);
  return { fuelUsed, fuelLeft, reserveMinutes: res.minutes, reserveGallons: res.gallons, covers: fuelLeft >= res.gallons };
}

/** The plain-words result line for the reserve check. */
export function reserveSentence(sol: NavLogReserveSolution, night: boolean): string {
  const name = `${sol.reserveMinutes}-minute ${night ? "night" : "day"} reserve (14 CFR 91.151)`;
  return sol.covers
    ? `Your fuel left, ${sol.fuelLeft} gal, covers the ${name}.`
    : `Your fuel left, ${sol.fuelLeft} gal, is less than the ${name}. Talk through fuel planning with your instructor.`;
}
