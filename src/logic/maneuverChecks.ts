import type { ManeuverCheck, ManeuverCheckRating } from "@/domain/types";

import { CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_A_CODES } from "./currentAcsAreaVTaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_B_CODES } from "./currentAcsAreaVTaskBCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_A_CODES } from "./currentAcsAreaVIITaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_B_CODES } from "./currentAcsAreaVIITaskBCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_C_CODES } from "./currentAcsAreaVIITaskCCatalog";

export const MANEUVER_CHECK_CAP = 200;
export const MANEUVER_NOTE_MAX = 200;
export const MANEUVER_RATINGS: readonly ManeuverCheckRating[] = ["Within", "Close", "Not yet"];
export const MANEUVER_FOOTER = "Your own view. Your instructor decides.";

export interface ManeuverTolerance {
  /** Catalog skill code the line comes from, for example "PA.V.A.S5". */
  code: string;
  label: string;
  /** Exact wording as it appears inside that catalog skill line. */
  text: string;
}

export interface ManeuverDef {
  /** ACS task code, for example "PA.V.A". */
  task: string;
  title: string;
  tolerances: readonly ManeuverTolerance[];
}

/** Every `text` below must appear inside the catalog line named by `code` (a test checks this). */
export const MANEUVERS: readonly ManeuverDef[] = [
  {
    task: "PA.V.A",
    title: "Steep turns",
    tolerances: [
      { code: "PA.V.A.S5", label: "Altitude", text: "altitude ±100 feet" },
      { code: "PA.V.A.S5", label: "Airspeed", text: "airspeed ±10 knots" },
      { code: "PA.V.A.S5", label: "Bank", text: "bank ±5°" },
      { code: "PA.V.A.S5", label: "Roll out on entry heading", text: "entry heading ±10°" },
    ],
  },
  {
    task: "PA.V.B",
    title: "Ground reference maneuvers",
    tolerances: [
      { code: "PA.V.B.S7", label: "Altitude", text: "altitude ±100 feet" },
      { code: "PA.V.B.S7", label: "Airspeed", text: "airspeed ±10 knots" },
    ],
  },
  {
    task: "PA.VII.A",
    title: "Maneuvering during slow flight",
    tolerances: [
      { code: "PA.VII.A.S5", label: "Altitude", text: "altitude, ±100 feet" },
      { code: "PA.VII.A.S5", label: "Heading", text: "heading, ±10°" },
      { code: "PA.VII.A.S5", label: "Airspeed", text: "airspeed, +10/-0 knots" },
      { code: "PA.VII.A.S5", label: "Angle of bank", text: "angle of bank, ±10°" },
    ],
  },
  {
    task: "PA.VII.B",
    title: "Power-off stalls",
    tolerances: [
      { code: "PA.VII.B.S6", label: "Heading, straight flight", text: "heading ±10° if in straight flight" },
      { code: "PA.VII.B.S6", label: "Bank, turning flight", text: "angle of bank not to exceed 20°, ±10°" },
    ],
  },
  {
    task: "PA.VII.C",
    title: "Power-on stalls",
    tolerances: [
      { code: "PA.VII.C.S6", label: "Heading, straight flight", text: "heading, ±10° if in straight flight" },
      { code: "PA.VII.C.S6", label: "Bank, turning flight", text: "angle of bank not to exceed 20°, ±10°" },
    ],
  },
];

const CATALOGS = [
  ...CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_B_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_B_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_C_CODES,
];

/** The full ACS skill line for a code, or undefined. */
export function catalogLine(code: string): string | undefined {
  return CATALOGS.find((e) => e.code === code)?.description;
}

/** "Altitude ±100 feet" style line shown to the student. */
export function toleranceLine(t: ManeuverTolerance): string {
  const bare = t.text.replace(/^(altitude|airspeed|bank|angle of bank|heading|entry heading),? /i, "");
  return `${t.label} ${bare}`;
}

/** Counts of each rating in one saved check. */
export function checkCounts(check: ManeuverCheck): Record<ManeuverCheckRating, number> {
  const out: Record<ManeuverCheckRating, number> = { Within: 0, Close: 0, "Not yet": 0 };
  for (const i of check.items) out[i.rating] += 1;
  return out;
}

/** The newest `limit` checks for one maneuver, newest first. */
export function recentChecks(checks: readonly ManeuverCheck[], task: string, limit = 3): ManeuverCheck[] {
  return checks.filter((c) => c.task === task).slice(-limit).reverse();
}

export function normalizeManeuverChecks(value: unknown): ManeuverCheck[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: ManeuverCheck[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.task !== "string" || !c.task) continue;
    if (typeof c.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(c.date)) continue;
    if (!Array.isArray(c.items)) continue;
    const items: ManeuverCheck["items"] = [];
    for (const it of c.items) {
      if (!it || typeof it !== "object") continue;
      const i = it as Record<string, unknown>;
      if (typeof i.code !== "string" || !i.code || typeof i.label !== "string" || !i.label) continue;
      if (!MANEUVER_RATINGS.includes(i.rating as ManeuverCheckRating)) continue;
      items.push({ code: i.code, label: i.label, rating: i.rating as ManeuverCheckRating });
    }
    if (!items.length) continue;
    const note = typeof c.note === "string" ? c.note.trim().slice(0, MANEUVER_NOTE_MAX) : "";
    out.push({ task: c.task, date: c.date, items, ...(note ? { note } : {}) });
  }
  return out.length ? out.slice(-MANEUVER_CHECK_CAP) : undefined;
}
