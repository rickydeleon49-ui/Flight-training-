/** Small plain-words PIREP (UA/UUA) decoder for study. Never guesses: unknown fields say so. */
import { COVER, NOT_EXPLAINED, weatherMeaning, type MetarToken } from "./metarExplain";

export type PirepExplanation = { tokens: MetarToken[] };

const feet = (n: number) => `${n.toLocaleString("en-US")} ft`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A pilot report: "UA /OV" or "UUA /OV", or a station code followed by UA/UUA. */
export function looksLikePirep(text: string): boolean {
  return /\b(?:UUA|UA)\s*\/\s*OV\b/i.test(text) || /^\s*[A-Z][A-Z0-9]{2,3}\s+(?:UUA|UA)\b/i.test(text);
}

const INTENSITY: Record<string, string> = {
  NEG: "none", TRACE: "trace", LGT: "light", MOD: "moderate", SEV: "severe", EXTRM: "extreme",
};
const FREQUENCY: Record<string, string> = { OCNL: "occasional", CONT: "continuous", INTMT: "intermittent" };
const TB_TYPE: Record<string, string> = { CHOP: "chop", CAT: "clear-air" };
const IC_TYPE: Record<string, string> = { RIME: "rime ice", MXD: "mixed ice", CLR: "clear ice" };

/** Turbulence or icing: intensity (or a range such as LGT-MOD), frequency, type and altitude words. */
function hazard(kind: "TB" | "IC", value: string): string {
  const allowed = kind === "TB" ? new Set(["NEG", "LGT", "MOD", "SEV", "EXTRM"]) : new Set(["NEG", "TRACE", "LGT", "MOD", "SEV"]);
  const types = kind === "TB" ? TB_TYPE : IC_TYPE;
  const words: string[] = [];
  const levels: string[] = [];
  const unknown: string[] = [];
  let neg = false;
  const parts = value.split(/\s+/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const w = parts[i]!;
    let m: RegExpExecArray | null;
    if (w === "NEG") neg = true;
    else if (allowed.has(w)) words.push(INTENSITY[w]!);
    else if ((m = /^([A-Z]+)-([A-Z]+)$/.exec(w)) && allowed.has(m[1]!) && allowed.has(m[2]!) && m[1] !== "NEG" && m[2] !== "NEG") {
      words.push(`${INTENSITY[m[1]!]} to ${INTENSITY[m[2]!]}`);
    } else if (FREQUENCY[w]) words.push(FREQUENCY[w]!);
    else if (types[w]) words.push(types[w]!);
    else if ((m = /^(\d{3})(?:-(\d{3}))?$/.exec(w))) {
      levels.push(m[2] ? `${(Number(m[1]) * 100).toLocaleString("en-US")} to ${feet(Number(m[2]) * 100)}` : feet(Number(m[1]) * 100));
    } else if ((w === "BLO" || w === "ABV") && /^\d{3}$/.test(parts[i + 1] ?? "")) {
      levels.push(`${w === "BLO" ? "below" : "above"} ${feet(Number(parts[i + 1]) * 100)}`);
      i++;
    } else unknown.push(`${w}: ${NOT_EXPLAINED}`);
  }
  const label = kind === "TB" ? "turbulence" : "icing";
  const body = neg && !words.length ? `No ${label} reported` : cap(`${words.join(" ")} ${label}`.trim());
  const at = levels.length ? ` at ${levels.join(" and ")}` : "";
  return `${body}${at}${unknown.length ? ` (${unknown.join("; ")})` : ""}`;
}

function sky(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      let m: RegExpExecArray | null;
      if (w === "SKC" || w === "CLR") return `${w}: ${w === "SKC" ? "Sky clear" : "Clear"}`;
      if ((m = /^(FEW|SCT|BKN|OVC)(\d{3})?(?:-TOP(\d{3}|UNKN))?$/.exec(w))) {
        const base = m[2] ? `base ${feet(Number(m[2]) * 100)}` : "base not given";
        const top = m[3] === undefined ? "" : m[3] === "UNKN" ? ", top unknown" : `, top ${feet(Number(m[3]) * 100)}`;
        return `${w}: ${cap(COVER[m[1]!]!)}, ${base}${top} (heights above sea level)`;
      }
      return `${w}: ${NOT_EXPLAINED}`;
    })
    .join("; ");
}

function weather(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const m = /^FV(\d+)SM$/.exec(w);
      if (m) return `${w}: Flight visibility ${Number(m[1])} statute ${Number(m[1]) === 1 ? "mile" : "miles"}`;
      const wx = weatherMeaning(w);
      return `${w}: ${wx ?? NOT_EXPLAINED}`;
    })
    .join("; ");
}

function fieldMeaning(key: string, value: string): string | null {
  let m: RegExpExecArray | null;
  switch (key) {
    case "OV":
      if ((m = /^([A-Z][A-Z0-9]{2,3})(\d{3})(\d{3})$/.exec(value))) {
        return `Location: ${Number(m[3])} nautical miles from ${m[1]} on the ${m[2]}° radial`;
      }
      if (/^[A-Z][A-Z0-9]{2,3}$/.test(value)) return `Location: over ${value}`;
      return null;
    case "TM":
      return (m = /^([01]\d|2[0-3])([0-5]\d)$/.exec(value)) ? `Time ${m[1]}${m[2]} Zulu (UTC)` : null;
    case "FL":
      if (value === "UNKN") return "Altitude not known";
      return /^\d{3}$/.test(value) ? `Altitude ${feet(Number(value) * 100)} MSL (in hundreds of feet)` : null;
    case "TP":
      if (value === "UNKN") return "Aircraft type not known";
      return /^[A-Z0-9-]{2,6}$/.test(value) ? `Aircraft type ${value}` : null;
    case "SK":
      return value ? sky(value) : null;
    case "WX":
      return value ? weather(value) : null;
    case "TA":
      return (m = /^(?:M|-)?(\d{1,2})$/.exec(value))
        ? `Outside air temperature ${/^(M|-)/.test(value) ? "-" : ""}${Number(m[1])} °C`
        : null;
    case "WV":
      return (m = /^(\d{3})(\d{2,3})(?:KT)?$/.exec(value)) ? `Wind from ${m[1]}° at ${Number(m[2])} kt` : null;
    case "TB":
    case "IC":
      return value ? hazard(key, value) : null;
    case "RM":
      return value ? `Remarks: ${value}` : null;
    default:
      return null;
  }
}

/** Explain a PIREP. Fields are separated by "/"; the remarks (RM) field keeps any "/" it contains. */
export function explainPirep(input: string): PirepExplanation {
  const text = input.replace(/=/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  const tokens: MetarToken[] = [];
  const firstSlash = text.indexOf("/");
  const head = (firstSlash < 0 ? text : text.slice(0, firstSlash)).trim();
  for (const w of head.split(" ").filter(Boolean)) {
    if (w === "UA") tokens.push({ raw: w, meaning: "Routine pilot report" });
    else if (w === "UUA") tokens.push({ raw: w, meaning: "Urgent pilot report" });
    else if (/^[A-Z][A-Z0-9]{2,3}$/.test(w) && tokens.length === 0) tokens.push({ raw: w, meaning: `Station ${w}` });
    else tokens.push({ raw: w, meaning: NOT_EXPLAINED });
  }
  if (firstSlash < 0) return { tokens };
  const rest = text.slice(firstSlash + 1);
  const fields: string[] = [];
  let remaining = rest;
  while (remaining) {
    if (/^\s*RM\b/.test(remaining)) { fields.push(remaining.trim()); break; }
    const cut = remaining.indexOf("/");
    fields.push((cut < 0 ? remaining : remaining.slice(0, cut)).trim());
    remaining = cut < 0 ? "" : remaining.slice(cut + 1);
  }
  for (const field of fields.filter(Boolean)) {
    const fm = /^([A-Z]{2})\s*(.*)$/.exec(field);
    const key = fm?.[1] ?? "";
    const value = fm?.[2]?.trim() ?? "";
    tokens.push({ raw: field, meaning: fieldMeaning(key, value) ?? NOT_EXPLAINED });
  }
  return { tokens };
}
