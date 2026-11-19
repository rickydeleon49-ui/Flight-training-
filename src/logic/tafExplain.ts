/** Small plain-words TAF decoder for study. Builds on the METAR decoder; never guesses. */
import { explainMetar, type FlightCategory, type MetarToken } from "./metarExplain";

export type TafPeriod = {
  /** Short heading such as "Starting conditions" or "Temporary (TEMPO)". */
  label: string;
  /** What the change group means, in plain words. */
  meaning: string;
  tokens: MetarToken[];
  category: FlightCategory | null;
  categoryNote: string;
};
export type TafExplanation = {
  header: MetarToken[];
  periods: TafPeriod[];
};

const ordinal = (n: number) => {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
};
const hhmm = (hh: string, mm = "00") => (hh === "24" ? "2400 (end of the day)" : `${hh}${mm}`);
const dayHour = (dd: string, hh: string, mm = "00") => `the ${ordinal(Number(dd))} at ${hhmm(hh, mm)} Zulu`;

const VALIDITY = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/;
const validityText = (m: RegExpExecArray) =>
  `from ${dayHour(m[1]!, m[2]!)} until ${dayHour(m[3]!, m[4]!)}`;

/** Looks like a TAF (starts with the TAF word, optionally after whitespace). */
export function looksLikeTaf(input: string): boolean {
  if (/^\s*(?:METAR|SPECI)\b/i.test(input)) return false;
  return /^\s*TAF\b/i.test(input) || /(?:^|\s)\d{4}\/\d{4}(?:\s|=|$)/.test(input) || /(?:^|\s)(?:FM\d{6}|PROB(?:30|40))(?:\s|=|$)/i.test(input);
}

type Group = { label: string; meaning: string; words: string[] };

/** Explain a TAF. Input may span several lines; the "=" end mark is ignored. */
export function explainTaf(input: string): TafExplanation {
  const words = input.replace(/=/g, " ").trim().split(/\s+/).filter(Boolean).map((w) => w.toUpperCase());
  const header: MetarToken[] = [];
  const groups: Group[] = [];
  let current: Group | null = null;
  let sawStation = false;
  let sawIssue = false;
  let sawValidity = false;

  for (let i = 0; i < words.length; i++) {
    const raw = words[i]!;
    let m: RegExpExecArray | null;

    // Change groups start a new period.
    if ((m = /^FM(\d{2})(\d{2})(\d{2})$/.exec(raw))) {
      current = {
        label: "From (FM)",
        meaning: `A rapid, complete change starting ${dayHour(m[1]!, m[2]!, m[3]!)}. These conditions replace what came before`,
        words: [],
      };
      groups.push(current);
      continue;
    }
    const isProb = /^PROB(30|40)$/.exec(raw);
    if (raw === "BECMG" || raw === "TEMPO" || isProb) {
      let label: string;
      let lead: string;
      if (raw === "BECMG") {
        label = "Becoming (BECMG)";
        lead = "Conditions change gradually";
      } else if (raw === "TEMPO") {
        label = "Temporary (TEMPO)";
        lead = "Short-lived changes that come and go";
      } else {
        const chance = isProb![1]!;
        const withTempo = words[i + 1] === "TEMPO";
        if (withTempo) i++;
        label = `${chance}% chance${withTempo ? ", temporary" : ""} (PROB${chance}${withTempo ? " TEMPO" : ""})`;
        lead = `A ${chance} percent chance of ${withTempo ? "short-lived changes" : "different conditions"}`;
      }
      const v = VALIDITY.exec(words[i + 1] ?? "");
      if (v) i++;
      current = { label, meaning: `${lead}${v ? ` ${validityText(v)}` : ""}`, words: [] };
      groups.push(current);
      continue;
    }

    if (!current) {
      if (raw === "TAF") { header.push({ raw, meaning: "Terminal aerodrome forecast" }); continue; }
      if (raw === "AMD") { header.push({ raw, meaning: "Amended forecast" }); continue; }
      if (raw === "COR") { header.push({ raw, meaning: "Corrected forecast" }); continue; }
      if (!sawStation && /^[A-Z][A-Z0-9]{3}$/.test(raw)) {
        sawStation = true;
        header.push({ raw, meaning: `Station ${raw}` });
        continue;
      }
      if (!sawIssue && (m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(raw))) {
        sawIssue = true;
        header.push({ raw, meaning: `Issued on ${dayHour(m[1]!, m[2]!, m[3]!)}` });
        continue;
      }
      if (!sawValidity && (m = VALIDITY.exec(raw))) {
        sawValidity = true;
        header.push({ raw, meaning: `Forecast is valid ${validityText(m)}` });
        continue;
      }
      current = { label: "Starting conditions", meaning: "What the forecast expects at the start", words: [] };
      groups.push(current);
    }
    current.words.push(raw);
  }

  return { header, periods: groups.map(describeGroup) };
}

function describeGroup(g: Group): TafPeriod {
  const tokens: MetarToken[] = [];
  const special: MetarToken[] = [];
  const rest: string[] = [];
  let cavok = false;
  for (const w of g.words) {
    let m: RegExpExecArray | null;
    if (w === "NSW") special.push({ raw: w, meaning: "No significant weather" });
    else if (w === "CAVOK") {
      cavok = true;
      special.push({ raw: w, meaning: "Ceiling and visibility OK: visibility 10 km or more, no clouds below 5,000 ft, no significant weather" });
    } else if ((m = /^WS(\d{3})\/(\d{3})(\d{2,3})KT$/.exec(w))) {
      special.push({ raw: w, meaning: `Wind shear at ${Number(m[1]) * 100} ft: wind from ${m[2]} degrees at ${Number(m[3])} knots` });
    } else if ((m = /^T([XN])(M)?(\d{2})\/(\d{2})(\d{2})Z$/.exec(w))) {
      special.push({
        raw: w,
        meaning: `Expected ${m[1] === "X" ? "highest" : "lowest"} temperature ${m[2] ? "-" : ""}${Number(m[3])} C on ${dayHour(m[4]!, m[5]!)}`,
      });
    } else rest.push(w);
  }
  let category: FlightCategory | null = null;
  let categoryNote = "No ceiling or visibility given in this part, so no category hint.";
  if (rest.length) {
    // The METAR decoder expects a station and time first; give it neutral ones and drop them again.
    const r = explainMetar(`METAR XXXX 010000Z ${rest.join(" ")}`);
    tokens.push(...r.tokens.slice(3));
    category = r.category;
    categoryNote = r.categoryNote;
  }
  if (cavok && category === null) {
    category = "VFR";
    categoryNote = "VFR: ceiling and visibility at or above VFR values. A study hint only.";
  } else if (category !== null && g.label !== "Starting conditions" && !g.label.startsWith("From")) {
    categoryNote += " This group only changes part of the forecast.";
  }
  tokens.push(...special);
  return { label: g.label, meaning: g.meaning, tokens, category, categoryNote };
}
