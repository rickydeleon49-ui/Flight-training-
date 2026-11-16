/** Plain-words winds and temperatures aloft (FB) decoder for study. Never guesses: unknown groups say so. */
import { NOT_EXPLAINED, type MetarToken } from "./metarExplain";

export type WindsAloftEntry = {
  /** The cell text as pasted; empty for a blank cell. */
  raw: string;
  /** Header altitude in feet. */
  altitude: number;
  meaning: string;
};
export type WindsAloftStation = {
  station: string;
  /** One entry per altitude column, in header order. */
  entries: WindsAloftEntry[];
  /** Cells that could not be matched to a single column. */
  unplaced: MetarToken[];
};
export type WindsAloftExplanation = { stations: WindsAloftStation[] };

const HEADER = /^\s*FT\s+\d{4,5}(?:\s+\d{4,5})*\s*$/i;
const SKIP_LINE = /^\s*(FB[A-Z]{2}\d*|DATA\b|VALID\b|TEMPS?\b|FD\b|\d{6}\b)/i;
const STATION_ROW = /^([A-Z][A-Z0-9]{2,3})(?:\s+\S|\s*$)/;
/** A pasted cell can sit this many characters off its header column and still be placed. */
const MAX_OFFSET = 4;

export const feetText = (n: number) => `${n.toLocaleString("en-US")} ft`;

type Layout = { header: string; altitudes: number[]; centers: number[]; rows: string[] };

function layout(text: string): Layout | null {
  const lines = text.replace(/\t/g, " ").split(/\r?\n/);
  const index = lines.findIndex((line) => HEADER.test(line));
  if (index < 0) return null;
  const header = lines[index]!.toUpperCase();
  const altitudes: number[] = [];
  const centers: number[] = [];
  for (const m of header.matchAll(/\d{4,5}/g)) {
    altitudes.push(Number(m[0]));
    centers.push(m.index! + (m[0].length - 1) / 2);
  }
  const rows = lines.slice(index + 1).filter((line) => line.trim() && !SKIP_LINE.test(line));
  return { header, altitudes, centers, rows };
}

/** True for an "FT 3000 6000 ..." header plus at least one station row. */
export function looksLikeWindsAloft(text: string): boolean {
  const l = layout(text);
  if (!l) return false;
  return l.rows.some((row) => STATION_ROW.test(row.trim().toUpperCase()) && /\s\S/.test(row.trim()));
}

const tempText = (t: number) => (t > 0 ? `+${t}` : `${t}`);

/** Decode one cell: DDSS, DDSS+TT, DDSS-TT, or (above 24,000 ft) DDSSTT with the minus left out. */
function decodeCell(raw: string, altitude: number): string {
  const m = /^(\d{2})(\d{2})(?:([+-])?(\d{2}))?$/.exec(raw);
  if (!m) return NOT_EXPLAINED;
  const [, dd, ss, sign, tt] = m;
  const high = altitude > 24000;
  let temp: number | null = null;
  if (tt !== undefined) {
    if (sign) temp = (sign === "-" ? -1 : 1) * Number(tt);
    else if (high) temp = -Number(tt);
    else return NOT_EXPLAINED; // a bare 6-digit cell at or below 24,000 ft has no sign rule
    if (high && sign === "+") return NOT_EXPLAINED; // always negative up there
  }
  const tail = temp === null ? "" : `, temperature ${tempText(temp)} °C`;
  const dir = Number(dd);
  const spd = Number(ss);
  if (dd === "99") {
    if (spd !== 0) return NOT_EXPLAINED;
    return `Light and variable (less than 5 kt)${tail}`;
  }
  let degrees: number;
  let speed = spd;
  if (dir >= 1 && dir <= 36) degrees = dir * 10;
  else if (dir >= 51 && dir <= 86) {
    degrees = (dir - 50) * 10;
    speed += 100;
  } else return NOT_EXPLAINED;
  if (speed === 0) return NOT_EXPLAINED;
  const deg = String(degrees).padStart(3, "0");
  const speedWords = dir >= 51 && spd === 99 ? "199 kt or more" : `${speed} kt`;
  return `From ${deg}° at ${speedWords}${tail}`;
}

/** Explain an FB table. Cells are placed by their position under the header, so blanks stay blank. */
export function explainWindsAloft(text: string): WindsAloftExplanation {
  const l = layout(text);
  if (!l) return { stations: [] };
  const stations: WindsAloftStation[] = [];
  for (const row of l.rows) {
    const upper = row.toUpperCase().trimEnd();
    const lead = /^\s*/.exec(upper)![0].length;
    const body = upper.slice(lead);
    const sm = STATION_ROW.exec(body);
    if (!sm) continue;
    const station = sm[1]!;
    const cells: (string | null)[] = l.altitudes.map(() => null);
    const unplaced: MetarToken[] = [];
    for (const m of upper.matchAll(/\S+/g)) {
      if (m.index! === lead) continue; // the station code
      const center = m.index! + (m[0].length - 1) / 2;
      let best = 0;
      for (let i = 1; i < l.centers.length; i++) {
        if (Math.abs(l.centers[i]! - center) < Math.abs(l.centers[best]! - center)) best = i;
      }
      if (Math.abs(l.centers[best]! - center) > MAX_OFFSET || cells[best] !== null) {
        unplaced.push({ raw: m[0], meaning: NOT_EXPLAINED });
      } else cells[best] = m[0];
    }
    stations.push({
      station,
      unplaced,
      entries: l.altitudes.map((altitude, i) => {
        const raw = cells[i] ?? "";
        return {
          raw,
          altitude,
          meaning: raw ? decodeCell(raw, altitude) : "No forecast for this level (blank)",
        };
      }),
    });
  }
  return { stations };
}

/** The two forecast levels on either side of an altitude (or the one level it sits on). No estimate is made. */
export function levelsAround(
  station: WindsAloftStation,
  altitude: number,
): { lower: WindsAloftEntry | null; upper: WindsAloftEntry | null; exact: WindsAloftEntry | null } {
  const exact = station.entries.find((e) => e.altitude === altitude) ?? null;
  let lower: WindsAloftEntry | null = null;
  let upper: WindsAloftEntry | null = null;
  for (const e of station.entries) {
    if (e.altitude < altitude && (!lower || e.altitude > lower.altitude)) lower = e;
    if (e.altitude > altitude && (!upper || e.altitude < upper.altitude)) upper = e;
  }
  return { lower, upper, exact };
}
