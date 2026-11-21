// Weight and balance practice math. A study aid only: no aircraft data is
// shipped; the student types in numbers from the airplane's own POH.

import type { MyAirplane } from "@/domain/types";

export type { MyAirplane };

export const AVGAS_LB_PER_GAL = 6;

export type WbRowKey = "empty" | "front" | "rear" | "fuel" | "baggage";

export interface WbRowInput {
  /** Pounds, or gallons for the fuel row. Typed text. */
  amount: string;
  /** Arm in inches. Typed text. */
  arm: string;
}

export interface WbInput {
  rows: Record<WbRowKey, WbRowInput>;
  maxGross: string;
  forwardLimit: string;
  aftLimit: string;
}

export interface WbRowResult {
  key: WbRowKey;
  weight: number;
  arm: number;
  moment: number;
}

export type WbOutcome =
  | {
      ok: true;
      rows: WbRowResult[];
      totalWeight: number;
      totalMoment: number;
      cg: number;
      /** Sentences about each limit that was entered. */
      verdict: string;
      withinLimits: boolean;
      limitsEntered: boolean;
    }
  | { ok: false; error: string };

export const WB_ROW_LABELS: Record<WbRowKey, string> = {
  empty: "Basic empty weight",
  front: "Pilot and front seat",
  rear: "Rear seats",
  fuel: "Fuel (gallons)",
  baggage: "Baggage",
};

export const WB_ROW_KEYS: WbRowKey[] = ["empty", "front", "rear", "fuel", "baggage"];

export const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function num(text: string): number {
  const t = text.trim();
  return t === "" ? NaN : Number(t);
}

export function emptyWbInput(): WbInput {
  const row = () => ({ amount: "", arm: "" });
  return {
    rows: { empty: row(), front: row(), rear: row(), fuel: row(), baggage: row() },
    maxGross: "",
    forwardLimit: "",
    aftLimit: "",
  };
}

export const MY_AIRPLANE_NAME_MAX = 40;

const MY_AIRPLANE_NUMBERS = [
  "emptyWeight", "emptyArm", "maxGross", "frontArm", "rearArm", "fuelArm", "baggageArm", "forwardLimit", "aftLimit",
] as const;

/** Repair a stored value. Anything that is not a full, sensible set of numbers becomes undefined. */
export function normalizeMyAirplane(value: unknown): MyAirplane | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const out = {} as Record<(typeof MY_AIRPLANE_NUMBERS)[number], number>;
  for (const k of MY_AIRPLANE_NUMBERS) {
    const n = v[k];
    if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
    out[k] = n;
  }
  if (!(out.emptyWeight > 0) || !(out.maxGross > 0)) return undefined;
  if (!(out.forwardLimit < out.aftLimit)) return undefined;
  const name = typeof v.name === "string" ? v.name.trim().slice(0, MY_AIRPLANE_NAME_MAX).trim() : "";
  return { ...(name ? { name } : {}), ...(out as Omit<MyAirplane, "name">) };
}

/** Read the typed POH boxes (and an optional name) into a saveable airplane, or say what is missing. */
export function myAirplaneFromInput(input: WbInput, name = ""): MyAirplane | { error: string } {
  const fields: Array<[string, string, string]> = [
    ["emptyWeight", input.rows.empty.amount, "Basic empty weight"],
    ["emptyArm", input.rows.empty.arm, "Basic empty weight arm"],
    ["maxGross", input.maxGross, "Max gross weight"],
    ["frontArm", input.rows.front.arm, "Front seat arm"],
    ["rearArm", input.rows.rear.arm, "Rear seats arm"],
    ["fuelArm", input.rows.fuel.arm, "Fuel arm"],
    ["baggageArm", input.rows.baggage.arm, "Baggage arm"],
    ["forwardLimit", input.forwardLimit, "Forward CG limit"],
    ["aftLimit", input.aftLimit, "Aft CG limit"],
  ];
  const raw: Record<string, unknown> = {};
  for (const [key, text, label] of fields) {
    const n = num(text);
    if (!Number.isFinite(n)) return { error: `${label}: enter a number from your POH.` };
    raw[key] = n;
  }
  if (!((raw.emptyWeight as number) > 0)) return { error: "Basic empty weight: enter a number above zero." };
  if (!((raw.maxGross as number) > 0)) return { error: "Max gross weight: enter a number above zero." };
  if (!((raw.forwardLimit as number) < (raw.aftLimit as number))) {
    return { error: "Forward CG limit must be less than the aft CG limit." };
  }
  if (name.trim().length > MY_AIRPLANE_NAME_MAX) {
    return { error: `Airplane name: use ${MY_AIRPLANE_NAME_MAX} characters or fewer.` };
  }
  const airplane = normalizeMyAirplane({ ...raw, name });
  return airplane ?? { error: "Check your POH numbers." };
}

/** Fill the POH boxes from a saved airplane. People, fuel and baggage amounts stay as typed. */
export function applyMyAirplane(input: WbInput, a: MyAirplane): WbInput {
  const s = String;
  return {
    rows: {
      empty: { amount: s(a.emptyWeight), arm: s(a.emptyArm) },
      front: { ...input.rows.front, arm: s(a.frontArm) },
      rear: { ...input.rows.rear, arm: s(a.rearArm) },
      fuel: { ...input.rows.fuel, arm: s(a.fuelArm) },
      baggage: { ...input.rows.baggage, arm: s(a.baggageArm) },
    },
    maxGross: s(a.maxGross),
    forwardLimit: s(a.forwardLimit),
    aftLimit: s(a.aftLimit),
  };
}

export function calculateWeightBalance(input: WbInput): WbOutcome {
  const rows: WbRowResult[] = [];
  for (const key of WB_ROW_KEYS) {
    const { amount, arm: armText } = input.rows[key];
    const blank = amount.trim() === "" && armText.trim() === "";
    if (blank && key !== "empty") continue; // optional rows may stay empty
    const raw = num(amount);
    const arm = num(armText);
    const label = WB_ROW_LABELS[key];
    if (!Number.isFinite(raw) || !Number.isFinite(arm)) {
      return { ok: false, error: `${label}: enter a number for both weight and arm.` };
    }
    if (raw < 0) return { ok: false, error: `${label}: weight cannot be negative.` };
    const weight = key === "fuel" ? raw * AVGAS_LB_PER_GAL : raw;
    rows.push({ key, weight, arm, moment: weight * arm });
  }
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);
  const totalMoment = rows.reduce((s, r) => s + r.moment, 0);
  if (!(totalWeight > 0)) return { ok: false, error: "Total weight must be more than zero." };
  const cg = totalMoment / totalWeight;

  const limit = (text: string, label: string) => {
    if (text.trim() === "") return null;
    const v = num(text);
    return Number.isFinite(v) ? v : (`${label}: enter a number or leave it blank.` as const);
  };
  const maxGross = limit(input.maxGross, "Max gross weight");
  const fwd = limit(input.forwardLimit, "Forward CG limit");
  const aft = limit(input.aftLimit, "Aft CG limit");
  for (const l of [maxGross, fwd, aft]) if (typeof l === "string") return { ok: false, error: l };
  if (typeof maxGross === "number" && maxGross <= 0) {
    return { ok: false, error: "Max gross weight: enter a number above zero or leave it blank." };
  }

  const tw = round1(totalWeight);
  const tcg = round2(cg);
  const problems: string[] = [];
  if (typeof maxGross === "number" && totalWeight > maxGross) {
    problems.push(`Over max gross weight by ${round1(totalWeight - maxGross)} lb.`);
  }
  if (typeof fwd === "number" && cg < fwd) {
    problems.push(`CG is ${round2(fwd - cg)} in ahead of the forward limit.`);
  }
  if (typeof aft === "number" && cg > aft) {
    problems.push(`CG is ${round2(cg - aft)} in behind the aft limit.`);
  }
  const limitsEntered = [maxGross, fwd, aft].some((l) => typeof l === "number");
  const withinLimits = problems.length === 0;
  const verdict = !limitsEntered
    ? "No limits entered, so nothing was checked."
    : withinLimits
      ? "Within the limits you entered."
      : problems.join(" ");
  return {
    ok: true,
    rows: rows.map((r) => ({ ...r, weight: round1(r.weight), moment: round1(r.moment) })),
    totalWeight: tw,
    totalMoment: round1(totalMoment),
    cg: tcg,
    verdict,
    withinLimits,
    limitsEntered,
  };
}

export interface WbPractice {
  id: string;
  title: string;
  input: WbInput;
  /** Hand-worked answer text shown on "Show answer". */
  answer: string;
}

function mk(
  vals: [string, string][],
  limits: [string, string, string],
): WbInput {
  const keys = WB_ROW_KEYS;
  const input = emptyWbInput();
  keys.forEach((k, i) => {
    input.rows[k] = { amount: vals[i]![0], arm: vals[i]![1] };
  });
  [input.maxGross, input.forwardLimit, input.aftLimit] = limits;
  return input;
}

export const WB_PRACTICE: WbPractice[] = [
  {
    id: "within",
    title: "Problem 1: a normal load",
    input: mk([["1500", "85"], ["340", "85"], ["", ""], ["30", "95"], ["50", "140"]], ["2300", "84", "93"]),
    answer: "Total weight 2070 lb, total moment 180500, CG 87.20 in. Within the limits you entered.",
  },
  {
    id: "gross",
    title: "Problem 2: too heavy",
    input: mk([["1600", "86"], ["380", "85"], ["340", "121"], ["40", "95"], ["100", "140"]], ["2550", "84", "95"]),
    answer: "Total weight 2660 lb, total moment 247840, CG 93.17 in. Over max gross weight by 110 lb.",
  },
  {
    id: "aft",
    title: "Problem 3: CG too far back",
    input: mk([["1450", "84"], ["170", "85"], ["", ""], ["20", "95"], ["120", "140"]], ["2300", "84", "87.5"]),
    answer: "Total weight 1860 lb, total moment 164450, CG 88.41 in. CG is 0.91 in behind the aft limit.",
  },
];

/** The given numbers of a practice problem, in plain words. */
export function describeWbPractice(input: WbInput): string {
  const parts: string[] = [];
  for (const key of WB_ROW_KEYS) {
    const { amount, arm } = input.rows[key];
    if (amount.trim() === "" && arm.trim() === "") continue;
    const name = WB_ROW_LABELS[key].replace(" (gallons)", "");
    parts.push(`${name} ${amount}${key === "fuel" ? " gal" : " lb"} at arm ${arm} in`);
  }
  const limits: string[] = [];
  if (input.maxGross.trim()) limits.push(`max gross ${input.maxGross} lb`);
  if (input.forwardLimit.trim()) limits.push(`forward CG limit ${input.forwardLimit} in`);
  if (input.aftLimit.trim()) limits.push(`aft CG limit ${input.aftLimit} in`);
  return `Given: ${parts.join("; ")}.${limits.length ? ` Limits: ${limits.join(", ")}.` : ""} Is the airplane within limits?`;
}
