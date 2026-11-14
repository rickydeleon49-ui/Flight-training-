// Weight and balance practice math. A study aid only: no aircraft data is
// shipped; the student types in numbers from her own POH.

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
    answer: "Total weight 2070.0 lb, total moment 180500.0, CG 87.20 in. Within the limits you entered.",
  },
  {
    id: "gross",
    title: "Problem 2: too heavy",
    input: mk([["1600", "86"], ["380", "85"], ["340", "121"], ["40", "95"], ["100", "140"]], ["2550", "84", "95"]),
    answer: "Total weight 2660.0 lb, total moment 247840.0, CG 93.17 in. Over max gross weight by 110.0 lb.",
  },
  {
    id: "aft",
    title: "Problem 3: CG too far back",
    input: mk([["1450", "84"], ["170", "85"], ["", ""], ["20", "95"], ["120", "140"]], ["2300", "84", "87.5"]),
    answer: "Total weight 1860.0 lb, total moment 164450.0, CG 88.41 in. CG is 0.91 in behind the aft limit.",
  },
];
