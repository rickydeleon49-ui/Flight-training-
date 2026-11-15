/** Small plain-words METAR decoder for study. Never guesses: unknown groups say so. */

export type MetarToken = { raw: string; meaning: string };
export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR";
export type MetarExplanation = {
  tokens: MetarToken[];
  category: FlightCategory | null;
  categoryNote: string;
};

export const NOT_EXPLAINED = "Not explained here";

const INTENSITY: Record<string, string> = { "-": "light", "+": "heavy", VC: "in the vicinity:" };
const DESCRIPTOR: Record<string, string> = {
  MI: "shallow", BC: "patches of", PR: "partial", DR: "low drifting", BL: "blowing",
  SH: "showers of", TS: "thunderstorm with", FZ: "freezing",
};
const PHENOMENON: Record<string, string> = {
  DZ: "drizzle", RA: "rain", SN: "snow", SG: "snow grains", IC: "ice crystals", PL: "ice pellets",
  GR: "hail", GS: "small hail or snow pellets", UP: "unknown precipitation",
  BR: "mist", FG: "fog", FU: "smoke", VA: "volcanic ash", DU: "widespread dust", SA: "sand",
  HZ: "haze", PY: "spray", PO: "dust or sand whirls", SQ: "squalls", FC: "funnel cloud or tornado",
  SS: "sandstorm", DS: "duststorm",
};
const COVER: Record<string, string> = {
  FEW: "few clouds (1 to 2 eighths of the sky)",
  SCT: "scattered clouds (3 to 4 eighths)",
  BKN: "broken clouds (5 to 7 eighths), a ceiling",
  OVC: "overcast (sky fully covered), a ceiling",
};

const feet = (n: number) => `${n.toLocaleString("en-US")} ft`;

function windMeaning(m: RegExpExecArray): string {
  const [, dir, spd, , gust] = m;
  if (dir === "000" && Number(spd) === 0) return "Calm wind";
  const speed = `${Number(spd)} knots`;
  const g = gust ? `, gusting ${Number(gust)} knots` : "";
  if (dir === "VRB") return `Wind variable in direction at ${speed}${g}`;
  return `Wind from ${dir} degrees at ${speed}${g}`;
}

function parseFraction(text: string): number | null {
  const m = /^(?:(\d+) )?(\d+)\/(\d+)$|^(\d+)$/.exec(text);
  if (!m) return null;
  if (m[4] !== undefined) return Number(m[4]);
  if (Number(m[3]) === 0) return null;
  return Number(m[1] ?? 0) + Number(m[2]) / Number(m[3]);
}

function weatherMeaning(raw: string): string | null {
  let rest = raw;
  const parts: string[] = [];
  const plus = /^(\+|-|VC)/.exec(rest);
  if (plus) { parts.push(INTENSITY[plus[1]!]!); rest = rest.slice(plus[1]!.length); }
  if (!rest || rest.length % 2) return null;
  let sawPhenomenon = false;
  for (let i = 0; i < rest.length; i += 2) {
    const code = rest.slice(i, i + 2);
    if (DESCRIPTOR[code]) {
      if (sawPhenomenon) return null;
      parts.push(DESCRIPTOR[code]);
    } else if (PHENOMENON[code]) {
      sawPhenomenon = true;
      parts.push(PHENOMENON[code]);
    } else return null;
  }
  if (!sawPhenomenon && !(rest === "TS" || rest === "SH")) return null;
  const text = parts.join(" ").replace(/:\s/, ": ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}


/** Explain a METAR/SPECI report. Input may span several lines; the "=" end mark is ignored. */
export function explainMetar(input: string): MetarExplanation {
  const words = input.replace(/=/g, " ").trim().split(/\s+/).filter(Boolean);
  const tokens: MetarToken[] = [];
  const ceilings: number[] = [];
  let visibility: number | null = null;
  let inRemarks = false;
  let sawType = false;
  let sawStation = false;
  let sawTime = false;
  let pendingVisWhole: string | null = null;

  const push = (raw: string, meaning: string) => tokens.push({ raw, meaning });

  for (let i = 0; i < words.length; i++) {
    const raw = (words[i] ?? "").toUpperCase();
    let m: RegExpExecArray | null;

    if (inRemarks) {
      if (raw === "AO1") push(raw, "Automated station without a precipitation sensor");
      else if (raw === "AO2") push(raw, "Automated station with a precipitation sensor");
      else if ((m = /^SLP(\d{3})$/.exec(raw))) {
        const n = Number(m[1]);
        const hpa = (n < 500 ? 1000 + n / 10 : 900 + n / 10).toFixed(1);
        push(raw, `Sea-level pressure ${hpa} hPa`);
      } else if ((m = /^T([01])(\d{3})([01])(\d{3})$/.exec(raw))) {
        const t = (m[1] === "1" ? -1 : 1) * Number(m[2]) / 10;
        const d = (m[3] === "1" ? -1 : 1) * Number(m[4]) / 10;
        push(raw, `Exact temperature ${t.toFixed(1)} C and dew point ${d.toFixed(1)} C`);
      } else push(raw, "Remark (not explained here)");
      continue;
    }

    if (raw === "RMK") { inRemarks = true; push(raw, "Remarks"); continue; }
    if (!sawType && (raw === "METAR" || raw === "SPECI")) {
      sawType = true;
      push(raw, raw === "METAR" ? "Routine hourly weather report" : "Special report, issued because conditions changed");
    } else if (!sawStation && /^[A-Z][A-Z0-9]{3}$/.test(raw) && !/^(AUTO|COR)$/.test(raw)) {
      sawStation = true;
      push(raw, `Station ${raw}`);
    } else if (!sawTime && (m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(raw))) {
      sawTime = true;
      push(raw, `Day ${Number(m[1])} of the month, ${m[2]}${m[3]} Zulu (UTC)`);
    } else if (raw === "AUTO") push(raw, "Fully automated report, no human observer");
    else if (raw === "COR") push(raw, "Corrected report");
    else if (raw === "NIL") push(raw, "No report available");
    else if ((m = /^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT$/.exec(raw))) push(raw, windMeaning(m));
    else if ((m = /^(\d{3})V(\d{3})$/.exec(raw))) push(raw, `Wind direction varying between ${m[1]} and ${m[2]} degrees`);
    else if (raw === "CAVOK") push(raw, NOT_EXPLAINED);
    else if (/^\d$/.test(raw) && /^\d+\/\d+SM$/.test((words[i + 1] ?? "").toUpperCase())) {
      pendingVisWhole = raw;
    } else if ((m = /^(M|P)?(\d+(?:\/\d+)?)SM$/.exec(raw))) {
      const text = pendingVisWhole ? `${pendingVisWhole} ${m[2]}` : m[2]!;
      const shownRaw = pendingVisWhole ? `${pendingVisWhole} ${raw}` : raw;
      const value = parseFraction(text);
      pendingVisWhole = null;
      if (value === null) { push(shownRaw, NOT_EXPLAINED); continue; }
      visibility = m[1] === "M" ? value - 0.0001 : value;
      const prefix = m[1] === "M" ? "less than " : m[1] === "P" ? "more than " : "";
      push(shownRaw, `Visibility ${prefix}${text} statute ${value <= 1 ? "mile" : "miles"}`);
    } else if ((m = /^R(\d{2}[LCR]?)\/([MP])?(\d{4})(?:V([MP])?(\d{4}))?FT$/.exec(raw))) {
      const lim = (c: string | undefined) => (c === "M" ? "less than " : c === "P" ? "more than " : "");
      const range = m[5] ? `varying from ${lim(m[2])}${Number(m[3])} to ${lim(m[4])}${Number(m[5])} ft` : `${lim(m[2])}${Number(m[3])} ft`;
      push(raw, `Runway ${m[1]} visual range ${range}`);
    } else if (raw === "SKC" || raw === "CLR") {
      push(raw, raw === "SKC" ? "Sky clear" : "Clear below 12,000 ft (automated station)");
    } else if ((m = /^VV(\d{3})$/.exec(raw))) {
      const h = Number(m[1]) * 100;
      ceilings.push(h);
      push(raw, `Sky obscured, vertical visibility ${feet(h)} (counts as a ceiling)`);
    } else if ((m = /^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/.exec(raw))) {
      const h = Number(m[2]) * 100;
      if (m[1] === "BKN" || m[1] === "OVC") ceilings.push(h);
      const cover = COVER[m[1]!]!;
      const type = m[3] === "CB" ? ", cumulonimbus" : m[3] === "TCU" ? ", towering cumulus" : "";
      push(raw, `${cover.charAt(0).toUpperCase()}${cover.slice(1)} at ${feet(h)} above ground${type}`);
    } else if ((m = /^(M)?(\d{2})\/(?:(M)?(\d{2}))?$/.exec(raw))) {
      const t = (m[1] ? -1 : 1) * Number(m[2]);
      if (m[4] === undefined) push(raw, `Temperature ${t} C, dew point not reported`);
      else push(raw, `Temperature ${t} C, dew point ${(m[3] ? -1 : 1) * Number(m[4])} C`);
    } else if ((m = /^A(\d{2})(\d{2})$/.exec(raw))) {
      push(raw, `Altimeter setting ${m[1]}.${m[2]} inches of mercury`);
    } else {
      const wx = weatherMeaning(raw);
      push(raw, wx ?? NOT_EXPLAINED);
    }
  }

  return { tokens, ...flightCategory(ceilings.length ? Math.min(...ceilings) : null, visibility) };
}

/** NWS flight categories; the worse of ceiling and visibility wins. Null/null gives no hint. */
export function flightCategory(
  ceilingFt: number | null,
  visibilitySm: number | null,
): { category: FlightCategory | null; categoryNote: string } {
  if (ceilingFt === null && visibilitySm === null) {
    return { category: null, categoryNote: "No ceiling or visibility found, so no category hint." };
  }
  const rank = (c: FlightCategory) => ["VFR", "MVFR", "IFR", "LIFR"].indexOf(c);
  let byCeiling: FlightCategory = "VFR";
  if (ceilingFt !== null) byCeiling = ceilingFt < 500 ? "LIFR" : ceilingFt < 1000 ? "IFR" : ceilingFt <= 3000 ? "MVFR" : "VFR";
  let byVis: FlightCategory = "VFR";
  if (visibilitySm !== null) byVis = visibilitySm < 1 ? "LIFR" : visibilitySm < 3 ? "IFR" : visibilitySm <= 5 ? "MVFR" : "VFR";
  const category = rank(byCeiling) >= rank(byVis) ? byCeiling : byVis;
  const ceil = ceilingFt === null ? "no ceiling" : `ceiling ${feet(ceilingFt)}`;
  const vis = visibilitySm === null ? "visibility not found" : `visibility ${Number(visibilitySm.toFixed(2))} SM`;
  return { category, categoryNote: `${category}: ${ceil}, ${vis}. A study hint only.` };
}
