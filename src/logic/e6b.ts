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

/** The given numbers of an E6B practice problem, in plain words. */
export function describeE6bPractice(p: E6bPractice): string {
  if (p.mode === "wind") {
    const v = p.values;
    return `Given: true course ${v.course} degrees, true airspeed ${v.tas} kt, wind from ${v.windDir} at ${v.windSpeed} kt, variation ${v.variation} degrees ${v.side === "E" ? "east" : "west"}. Find the wind correction angle, true heading, groundspeed and magnetic heading.`;
  }
  if (p.mode === "tsd") {
    return `Given: ${p.values.distance} nm at ${p.values.speed} kt groundspeed. How long does the trip take?`;
  }
  return `Given: fuel burn ${p.values.burn} gallons per hour for ${p.values.minutes} minutes. How much fuel do you burn?`;
}

// ---- Checking the typed answers (study aid) ----

export type E6bGradeStatus = "right" | "close" | "wrong" | "empty";
export type E6bGrade = { status: E6bGradeStatus; message: string };

/** How far off still counts as "close" on an E6B. */
export const E6B_TOLERANCE = { degrees: 2, knots: 2, minutes: 1, gallons: 0.5 } as const;

export type E6bAnswerId = "wca" | "trueHeading" | "groundSpeed" | "magneticHeading" | "time" | "fuel";
export type E6bAnswerBox = { id: E6bAnswerId; label: string; hasSide?: boolean };
export type E6bExpected = Partial<Record<E6bAnswerId, number>>;
export type E6bEntry = { value: string; side?: "L" | "R" };

const ANSWER_BOXES: Record<E6bPractice["mode"], E6bAnswerBox[]> = {
  wind: [
    { id: "wca", label: "Wind correction angle", hasSide: true },
    { id: "trueHeading", label: "True heading" },
    { id: "groundSpeed", label: "Groundspeed (kt)" },
    { id: "magneticHeading", label: "Magnetic heading" },
  ],
  tsd: [{ id: "time", label: "Trip time (minutes)" }],
  fuel: [{ id: "fuel", label: "Fuel burned (gallons)" }],
};

/** The labelled answer boxes for a practice problem. */
export function e6bAnswerBoxes(p: E6bPractice): E6bAnswerBox[] {
  return ANSWER_BOXES[p.mode];
}

/** Expected answers, from the same arithmetic the trainer uses. Signed WCA: right is positive. */
export function e6bExpected(p: E6bPractice): E6bExpected {
  const n = (v: string) => (v.trim() === "" ? NaN : Number(v));
  if (p.mode === "wind") {
    const v = p.values;
    const w = windTriangle(n(v.course), n(v.tas), n(v.windDir), n(v.windSpeed));
    if (!w.ok) return {};
    const m = trueToMagnetic(w.trueHeading, n(v.variation), v.side);
    return {
      wca: w.wcaDegrees,
      trueHeading: w.trueHeading,
      groundSpeed: w.groundSpeed,
      ...(m.ok ? { magneticHeading: m.magneticHeading } : {}),
    };
  }
  if (p.mode === "tsd") {
    const r = timeSpeedDistance(n(p.values.distance), n(p.values.speed), n(p.values.time));
    return r.ok && r.solved === "time" ? { time: r.timeMinutes } : {};
  }
  const r = fuelForTime(n(p.values.burn), n(p.values.minutes));
  return r.ok ? { fuel: r.fuelGallons } : {};
}

const pad3 = (n: number) => String(n).padStart(3, "0");

type Shape = {
  tol: number;
  circular?: boolean;
  /** Smallest step the expected value is rounded to. */
  step: number;
  say: (n: number) => string;
  closeNote: string;
};

const SHAPES: Record<E6bAnswerId, Shape> = {
  wca: { tol: E6B_TOLERANCE.degrees, step: 1, say: (n) => `${n}°`, closeNote: "Within 2° counts on the E6B." },
  trueHeading: { tol: E6B_TOLERANCE.degrees, circular: true, step: 1, say: (n) => `${pad3(n)}°`, closeNote: "Within 2° counts on the E6B." },
  magneticHeading: { tol: E6B_TOLERANCE.degrees, circular: true, step: 1, say: (n) => `${pad3(n)}°`, closeNote: "Within 2° counts on the E6B." },
  groundSpeed: { tol: E6B_TOLERANCE.knots, step: 1, say: (n) => `${n} kt`, closeNote: "Within 2 kt counts on the E6B." },
  time: { tol: E6B_TOLERANCE.minutes, step: 1, say: (n) => `${n} minutes`, closeNote: "Within 1 minute counts on the E6B." },
  fuel: { tol: E6B_TOLERANCE.gallons, step: 0.1, say: (n) => `${n} gallons`, closeNote: "Within 0.5 gallon counts on the E6B." },
};

function hintFor(id: E6bAnswerId, p: E6bPractice, expected: E6bExpected): string {
  if (id === "wca") {
    const side = (expected.wca ?? 0) >= 0 ? "right" : "left";
    return `Point into the wind. This wind comes from the ${side === "right" ? "right" : "left"} of your course, so the correction is to the ${side}.`;
  }
  if (id === "trueHeading") return "True heading is true course plus the correction angle: add right, subtract left.";
  if (id === "groundSpeed") return "Groundspeed is your speed over the ground. A headwind slows you down and a tailwind speeds you up.";
  if (id === "magneticHeading") {
    const west = p.mode === "wind" && p.values.side === "W";
    return west ? "West is best: add west variation to the true heading." : "East is least: subtract east variation from the true heading.";
  }
  if (id === "time") return "Time in minutes is distance divided by speed, times 60.";
  return "Gallons burned is burn rate times hours. Change the minutes to hours first.";
}

/**
 * Grade one typed answer. Empty is skipped, not wrong. Right = equals the rounded answer;
 * close = within the E6B tolerance; otherwise not quite, with a short hint.
 */
export function gradeE6bAnswer(id: E6bAnswerId, entry: E6bEntry, p: E6bPractice, expected: E6bExpected): E6bGrade {
  const want = expected[id];
  if (want === undefined || entry.value.trim() === "") return { status: "empty", message: "" };
  const typed = Number(entry.value);
  const shape = SHAPES[id];
  const hint = hintFor(id, p, expected);
  if (!Number.isFinite(typed)) return { status: "wrong", message: `Not quite. Type a number. ${hint}` };

  if (id === "wca") {
    const wantSide = want >= 0 ? "R" : "L";
    const wantWord = want === 0 ? "no correction (0°)" : `${Math.abs(want)}° ${wantSide === "R" ? "right" : "left"}`;
    const sideOk = want === 0 || entry.side === wantSide;
    if (!sideOk) {
      return { status: "wrong", message: `Not quite. ${entry.side ? "Check left or right." : "Pick left or right."} ${hint}` };
    }
    const diff = Math.abs(Math.abs(typed) - Math.abs(want));
    if (diff <= 0.5 + 1e-9) return { status: "right", message: `Right: ${wantWord}` };
    if (diff <= shape.tol + 1e-9) return { status: "close", message: `Close: answer is ${wantWord}. ${shape.closeNote}` };
    return { status: "wrong", message: `Not quite. ${hint}` };
  }

  let diff = Math.abs(typed - want);
  if (shape.circular) {
    diff = Math.abs((((typed - want) % 360) + 540) % 360 - 180);
    // 360 and 0 are the same heading
  }
  const say = shape.say(want);
  if (diff <= shape.step / 2 + 1e-9) return { status: "right", message: `Right: ${say}` };
  if (diff <= shape.tol + 1e-9) return { status: "close", message: `Close: answer is ${say}. ${shape.closeNote}` };
  return { status: "wrong", message: `Not quite. ${hint} Answer: ${say}.` };
}

/** "2 right, 1 close, 1 to fix". Empty boxes are left out. */
export function summarizeE6bGrades(grades: E6bGrade[]): string {
  const count = (s: E6bGradeStatus) => grades.filter((g) => g.status === s).length;
  const right = count("right");
  const close = count("close");
  const wrong = count("wrong");
  if (right + close + wrong === 0) return "Type an answer in at least one box, then check.";
  return `${right} right, ${close} close, ${wrong} to fix`;
}
