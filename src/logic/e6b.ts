/** Study-aid E6B arithmetic: wind triangle, time-speed-distance, fuel, true to magnetic. Not for flight planning. */

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const norm360 = (d: number) => ((d % 360) + 360) % 360;
/** Compass headings run 1-360; 0 is written as 360. */
const heading = (d: number) => {
  const r = Math.round(norm360(d)) % 360;
  return r === 0 ? 360 : r;
};

export type E6bFail = { ok: false; error: string };

export type WindTriangle = {
  ok: true;
  /** Signed, whole degrees. Positive = turn right of course, negative = left. */
  wcaDegrees: number;
  trueHeading: number;
  groundSpeed: number;
};

export function windTriangle(
  trueCourse: number,
  tas: number,
  windDirection: number,
  windSpeed: number,
): WindTriangle | E6bFail {
  if (![trueCourse, tas, windDirection, windSpeed].every(finite))
    return { ok: false, error: "Fill in the course, airspeed, wind direction and wind speed." };
  if (trueCourse < 0 || trueCourse > 360 || windDirection < 0 || windDirection > 360)
    return { ok: false, error: "Courses and wind directions run from 0 to 360 degrees." };
  if (tas <= 0) return { ok: false, error: "True airspeed must be more than zero." };
  if (windSpeed < 0) return { ok: false, error: "Wind speed cannot be negative." };
  if (windSpeed >= tas)
    return { ok: false, error: "The wind is as strong as your airspeed, so this course cannot be held." };
  const angle = rad(windDirection - trueCourse);
  const wca = Math.asin((windSpeed * Math.sin(angle)) / tas);
  const gs = tas * Math.cos(wca) - windSpeed * Math.cos(angle);
  if (gs <= 0) return { ok: false, error: "The groundspeed works out to zero or less, so this course cannot be flown." };
  const wcaDeg = deg(wca);
  const rounded = Math.round(wcaDeg) + 0;
  return {
    ok: true,
    wcaDegrees: rounded === 0 ? 0 : rounded,
    trueHeading: heading(trueCourse + wcaDeg),
    groundSpeed: Math.round(gs),
  };
}

export type TsdResult =
  | { ok: true; solved: "distance" | "speed" | "time"; distanceNm: number; speedKt: number; timeMinutes: number }
  | E6bFail;

/** Give any two of distance (nm), speed (kt) and time (minutes); the empty one is solved. Pass NaN for the unknown. */
export function timeSpeedDistance(distanceNm: number, speedKt: number, timeMinutes: number): TsdResult {
  const known = [distanceNm, speedKt, timeMinutes].filter(finite).length;
  if (known < 2) return { ok: false, error: "Fill in any two of distance, speed and time." };
  if (known === 3) return { ok: false, error: "Leave one box empty and I will work it out." };
  if ([distanceNm, speedKt, timeMinutes].some((v) => finite(v) && v <= 0))
    return { ok: false, error: "Use numbers above zero." };
  if (!finite(distanceNm))
    return { ok: true, solved: "distance", distanceNm: Math.round((speedKt * timeMinutes) / 60), speedKt, timeMinutes };
  if (!finite(speedKt))
    return { ok: true, solved: "speed", distanceNm, speedKt: Math.round((distanceNm * 60) / timeMinutes), timeMinutes };
  return { ok: true, solved: "time", distanceNm, speedKt, timeMinutes: Math.round((distanceNm / speedKt) * 60) };
}

export type FuelResult = { ok: true; fuelGallons: number; timeMinutes: number } | E6bFail;

/** Fuel used for a time. Gallons are rounded to one decimal. */
export function fuelForTime(burnGph: number, timeMinutes: number): FuelResult {
  if (!finite(burnGph) || !finite(timeMinutes)) return { ok: false, error: "Fill in the burn rate and the time." };
  if (burnGph <= 0 || timeMinutes <= 0) return { ok: false, error: "Use numbers above zero." };
  return { ok: true, fuelGallons: Math.round(((burnGph * timeMinutes) / 60) * 10) / 10, timeMinutes: Math.round(timeMinutes) };
}

/** How long a fuel amount lasts at a burn rate, in whole minutes. */
export function timeForFuel(burnGph: number, fuelGallons: number): FuelResult {
  if (!finite(burnGph) || !finite(fuelGallons)) return { ok: false, error: "Fill in the burn rate and the fuel." };
  if (burnGph <= 0 || fuelGallons <= 0) return { ok: false, error: "Use numbers above zero." };
  return { ok: true, fuelGallons, timeMinutes: Math.round((fuelGallons / burnGph) * 60) };
}

export type MagneticResult = { ok: true; magneticHeading: number } | E6bFail;

/** East is least, West is best: subtract east variation, add west variation. */
export function trueToMagnetic(trueHeading: number, variation: number, side: "E" | "W"): MagneticResult {
  if (!finite(trueHeading) || !finite(variation)) return { ok: false, error: "Fill in the true heading and the variation." };
  if (trueHeading < 0 || trueHeading > 360) return { ok: false, error: "Headings run from 0 to 360 degrees." };
  if (variation < 0 || variation > 30) return { ok: false, error: "Variation is a small number, 0 to 30 degrees." };
  return { ok: true, magneticHeading: heading(trueHeading + (side === "W" ? variation : -variation)) };
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : `${h} h ${m} min`;
}

export type E6bPractice =
  | { id: string; title: string; mode: "wind"; values: { course: string; tas: string; windDir: string; windSpeed: string; variation: string; side: "E" | "W" }; answer: string }
  | { id: string; title: string; mode: "tsd"; values: { distance: string; speed: string; time: string }; answer: string }
  | { id: string; title: string; mode: "fuel"; values: { burn: string; minutes: string }; answer: string };

export const E6B_PRACTICE: E6bPractice[] = [
  {
    id: "wind",
    title: "E6B 1: Wind triangle",
    mode: "wind",
    values: { course: "90", tas: "100", windDir: "180", windSpeed: "20", variation: "5", side: "E" },
    answer: "Wind correction angle 12 degrees right, true heading 102, groundspeed 98 kt. With 5 degrees east variation, magnetic heading 097.",
  },
  {
    id: "tsd",
    title: "E6B 2: Time, speed, distance",
    mode: "tsd",
    values: { distance: "150", speed: "100", time: "" },
    answer: "150 nm at 100 kt takes 90 minutes (1 h 30 min).",
  },
  {
    id: "fuel",
    title: "E6B 3: Fuel",
    mode: "fuel",
    values: { burn: "8.5", minutes: "150" },
    answer: "8.5 gallons per hour for 2 h 30 min burns 21.3 gallons.",
  },
];
