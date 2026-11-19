/**
 * Small plain-words decoder for a US domestic NOTAM (FAA Order JO 7930.2U, chapter 4). Never guesses:
 * a keyword, number or time it cannot read says so. Facts come only from JO 7930.2U and the
 * contraction list in JO 7340.2P; the numbers in the comments are line numbers in the saved copies.
 */
import { NOT_EXPLAINED, type MetarToken } from "./metarExplain";

export type NotamExplanation = { tokens: MetarToken[] };

/** A NOTAM starts with "!" and an accountability id of 3-5 letters or digits (e.g. !CLE, !FDC, !SUAW). Nothing else counts. */
export function looksLikeNotam(text: string): boolean {
  return /^!\s*[A-Za-z0-9]{3,5}(?:\s|$)/.test(text.trim());
}

/** Keyword list: JO 7930.2U ch 1 sec 2 (appendix file, about line 1958). */
const KEYWORDS: Record<string, string> = {
  RWY: "Runway: a temporary change or hazard on a runway, its lighting, markings or signs",
  TWY: "Taxiway: a temporary change or hazard on a taxiway, its lighting, markings or signs",
  APRON: "Apron or ramp: a temporary change or hazard on an apron, ramp or taxilane",
  AD: "Aerodrome: a temporary change or hazard on or within 5 statute miles of an airport that is not tied to one runway, taxiway or apron",
  OBST: "Obstruction: a tower, crane, wind turbine, balloon or an obstruction light outage",
  NAV: "Navigation aid: a change in a ground-based navaid or GNSS (satellite navigation)",
  COM: "Communications: a frequency or communication outlet that is out, changed or unavailable",
  SVC: "Services: a change in service levels, such as operating hours or air traffic or airport services",
  AIRSPACE: "Airspace: a restriction or activity warning that limits use of airspace",
  ODP: "Obstacle departure procedure",
  SID: "Standard instrument departure",
  STAR: "Standard terminal arrival",
  CHART: "Chart: a U.S. Government chart correction that takes effect before the next publication",
  DATA: "Data: a change to a data set (such as a database), named in the text",
  IAP: "Instrument approach procedure",
  VFP: "Visual flight procedure (such as a charted visual flight procedure)",
  DVA: "Diverse vector area",
  ROUTE: "Route: a change or hazard on a published air traffic service route",
  SPECIAL: "Special instrument flight procedure",
  SECURITY: "Security: State Department advisories, special security instructions, ADIZ procedures",
};

/** Glossary: only JO 7340.2P (line numbers) and JO 7930.2U TBL 3-3-1. Plain English words are left out on purpose. */
const GLOSSARY: Record<string, string> = {
  CLSD: "closed", // 7340.2P:747
  AVBL: "available (or availability)", // 7340.2P:474
  "U/S": "unserviceable (out of service)", // 7340.2P:3447
  OTS: "out of service", // 7340.2P:2361 (also "organized track system" at 2360; the NOTAM sense is used)
  BTN: "between", // 7340.2P:587
  ACFT: "aircraft", // 7340.2P:81
  AP: "airport", // 7340.2P:327
  LGT: "light or lighting", // 7340.2P:1816
  LGTD: "lighted", // 7340.2P:1817
  UNLGTD: "unlighted", // 7340.2P:3491
  OBSC: "obscured", // 7340.2P:2285
  WIP: "work in progress", // 7340.2P:3652
  SN: "snow", // 7340.2P:3096 (other meanings at 3097-3098 are not aviation weather)
  PCT: "percent", // 7340.2P:2417
  OBS: "observed", // 7340.2P:2284
  MNT: "monitored (or monitor)", // 7340.2P:2035
  COND: "condition", // 7340.2P:792
  CONST: "construction", // 7340.2P:802
  EXC: "except", // 7340.2P:1223
  DLY: "daily", // 7340.2P:985
  ADJ: "adjacent", // 7340.2P:122
  PPR: "prior permission required", // 7340.2P:2486
  TFC: "traffic", // 7340.2P:3312
  FREQ: "frequency", // 7340.2P:1384
  ARR: "arrival (or arrive)", // 7340.2P:380
  DEP: "departure", // 7340.2P:941
  IFR: "instrument flight rules", // 7340.2P:1643
  VFR: "visual flight rules", // 7340.2P:3567
  VOR: "VHF omnidirectional radio range", // 7340.2P:3588
  NDB: "nondirectional radio beacon", // 7340.2P:2152
  ILS: "instrument landing system", // 7340.2P:1654
  LOC: "localizer", // 7340.2P:1845
  GS: "glide slope", // 7340.2P:1499
  DME: "distance measuring equipment", // 7340.2P:988
  PAPI: "precision approach path indicator", // 7340.2P:2394
  VASI: "visual approach slope indicator", // 7340.2P:3550
  REIL: "runway end identifier lights", // 7340.2P:2721
  MALSR: "medium intensity approach lighting system with runway alignment indicator lights", // 7340.2P:1929
  ALS: "approach light system", // 7340.2P:264
  RCLL: "runway center line lights", // 7340.2P:2679
  HIRL: "high intensity runway lights", // 7340.2P:1557
  MIRL: "medium intensity runway edge lights", // 7340.2P:2013
  TWR: "aerodrome control tower", // 7340.2P:3430
  ATIS: "automatic terminal information service", // 7340.2P:439
  AWOS: "automatic weather observing/reporting system", // 7340.2P:485
  ASOS: "automated surface observing system", // 7340.2P:410
  CTAF: "common traffic advisory frequency", // 7340.2P:854
  RAIM: "receiver autonomous integrity monitoring", // 7340.2P:2632
  WAAS: "Wide Area Augmentation System", // 7340.2P:3618
  GPS: "global positioning system", // 7340.2P:1486
  TFR: "temporary flight restriction", // 7340.2P:3314
  MOA: "military operations area", // 7340.2P:2039 (2038 "memorandum of agreement" is not used)
  ACT: "active (or activated)", // 7340.2P:100
  SFC: "surface", // 7340.2P:3018
  UNL: "unlimited", // 7340.2P:3490, TBL 3-3-1
  AGL: "above ground level", // 7340.2P:200
  MSL: "mean sea level", // 7340.2P:2076
  FT: "feet", // 7340.2P:1409
  NM: "nautical miles", // 7340.2P:2180
  WI: "within", // 7340.2P:3643
  FM: "from", // 7340.2P:1350
  ABV: "above", // 7340.2P:64
  BLW: "below", // 7340.2P:549
  EST: "estimate (estimated)", // 7340.2P:1198
  PERM: "permanent", // 7340.2P:2434
  NOTAMR: "NOTAM replacement (the number after it is the NOTAM being replaced)", // 7930.2U:1246
  NOTAMC: "NOTAM cancellation (the number after it is the NOTAM being cancelled)", // 7930.2U:1246
  OPN: "open", // 7340.2P:2341
  UNREL: "unreliable", // 7340.2P:3497, TBL 3-3-1
  INOP: "inoperative", // 7340.2P:1689
  WID: "wide (width)", // 7340.2P:3647
  FICON: "field condition", // 7340.2P:1312
  NAVAID: "navigational aid", // 7340.2P:2138
  HLP: "heliport", // 7340.2P:1567
  THR: "threshold", // 7340.2P:3324
  LOM: "compass locator at ILS outer marker", // 7340.2P:1852
  VORTAC: "VOR and TACAN (collocated)", // 7340.2P:3590
  RNAV: "area navigation", // 7340.2P:2805
  PJE: "parachute jumping exercise", // 7340.2P:2448
  UAS: "unmanned aircraft system", // 7340.2P:3454
  UNMON: "unmonitored", // 7340.2P:3494
  UNAVBL: "unavailable", // 7340.2P:3482
  OPR: "operate (operator, operational)", // 7340.2P:2344
  OPS: "operations", // 7340.2P:2345
  ARTCC: "Air Route Traffic Control Center", // 7340.2P:387
  WX: "weather", // 7340.2P:3704
  SR: "sunrise", // 7340.2P:3138
  SS: "sunset", // 7340.2P:3148
  MKD: "marked", // 7340.2P:2021
};

export const NOTAM_GLOSSARY: Readonly<Record<string, string>> = GLOSSARY;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const num = (n: number) => n.toLocaleString("en-US");

/** YYMMDDHHMM to "20 Nov 2026 13:00 UTC", or null when it is not a real date and time. */
function stamp(value: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!m) return null;
  const [yy, mo, dd, hh, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || dd < 1 || dd > new Date(Date.UTC(2000 + yy, mo, 0)).getUTCDate() || hh > 23 || mi > 59) return null;
  return `${dd} ${MONTHS[mo - 1]} 20${String(yy).padStart(2, "0")} ${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")} UTC`;
}

function numberMeaning(word: string, fdc: boolean): string | null {
  let m = /^(\d{2})\/(\d{3})$/.exec(word);
  if (m) {
    const month = Number(m[1]);
    if (month >= 1 && month <= 12) return `NOTAM number ${m[2]} for month ${m[1]} (${MONTH_NAMES[month - 1]})`;
    return NOT_EXPLAINED;
  }
  m = /^(\d)\/(\d{4})$/.exec(word);
  if (m) return fdc ? `FDC NOTAM number ${m[2]} (${m[1]} = year of issuance)` : NOT_EXPLAINED;
  return null;
}

/** Placeholder forms in the order's own examples: x/xxxx, mm/nnn, XX/XXX. */
const isPlaceholderNumber = (word: string) => /^[A-Za-z]{1,2}\/[A-Za-z]{3,4}$/.test(word);

/** Words with surrounding punctuation removed, so "(410FT" and "U/S…" can be looked up. */
const core = (word: string) => word.replace(/^[("]+/, "").replace(/[.,;:…)"]+$/, "");

function level(value: string, agl: boolean, msl: boolean): string | null {
  let m: RegExpExecArray | null;
  if (value === "SFC") return "surface";
  if (value === "UNL") return "unlimited";
  if ((m = /^FL(\d{3})$/.exec(value))) return `flight level ${m[1]} (${num(Number(m[1]) * 100)} ft)`;
  if ((m = /^(\d{1,5})FT$/.exec(value))) {
    const ft = `${num(Number(m[1]))} ft`;
    return agl ? `${ft} above ground level` : msl ? `${ft} MSL` : ft;
  }
  return null;
}

const LEVEL = "(?:SFC|UNL|FL\\d{3}|\\d{1,5}FT)";

export function explainNotam(text: string): NotamExplanation {
  const tokens: MetarToken[] = [];
  // Keep a validity group with spaces around its dash as one word.
  const prepared = text
    .trim()
    .toUpperCase()
    .replace(/(\d{10})\s*-\s*(\d{10}|PERM)(\s*EST)?/g, (_m, a: string, b: string, e?: string) => `${a}-${b}${e ? "EST" : ""}`)
    .replace(/\b(YYMMDDHHMM|YYDDMM\w*|YYMMDD\w*)\s*-\s*(YYMMDDHHMM|YYDDMM\w*|YYMMDD\w*)/g, "$1-$2");
  const words = prepared.split(/\s+/).filter(Boolean);
  let i = 0;

  // "!" + accountability
  const head = /^!([A-Z0-9]{3,5})$/.exec(words[0] ?? "");
  let accountability = "";
  if (head) {
    accountability = head[1]!;
    tokens.push({
      raw: words[0]!,
      meaning:
        accountability === "FDC"
          ? "Flight Data Center NOTAM (usually regulatory: procedures, charts, airspace, TFRs)"
          : `Accountability location ${accountability} (keeps the NOTAM numbering)`,
    });
    i = 1;
  } else if (words[0] === "!" && /^[A-Z0-9]{3,5}$/.test(words[1] ?? "")) {
    accountability = words[1]!;
    tokens.push({ raw: `! ${accountability}`, meaning: `Accountability location ${accountability} (keeps the NOTAM numbering)` });
    i = 2;
  } else {
    return { tokens: [{ raw: words[0] ?? "", meaning: NOT_EXPLAINED }] };
  }
  const fdc = accountability === "FDC";

  // NOTAM number (optional)
  const first = words[i];
  if (first !== undefined && /^[A-Z0-9]{1,2}\/[A-Z0-9]{3,4}$/.test(first) && !KEYWORDS[first]) {
    tokens.push({ raw: first, meaning: (!isPlaceholderNumber(first) ? numberMeaning(first, fdc) : null) ?? NOT_EXPLAINED });
    i++;
  }

  // Location identifier: the affected airport, NAVAID or ARTCC. It is missing only if a keyword comes right away.
  const loc = words[i];
  const afterLoc = words[i + 1];
  const isKeywordWord = (w: string | undefined) => w !== undefined && (KEYWORDS[w] !== undefined || w === "(U)");
  if (loc !== undefined && /^[A-Z0-9]{2,5}$/.test(loc) && !isKeywordWord(loc) && afterLoc !== undefined) {
    tokens.push({ raw: loc, meaning: `Location ${loc} (the affected airport, NAVAID or ARTCC)` });
    i++;
  }

  // Keyword, with "(U)" in front when unverified
  if (words[i] === "(U)") {
    tokens.push({ raw: "(U)", meaning: "unverified: not yet confirmed by the airport manager or designee" });
    i++;
  }
  let keyword = "";
  let designatorAt = -1;
  if (words[i] !== undefined) {
    const w = words[i]!;
    if (KEYWORDS[w]) {
      keyword = w;
      if (w === "TWY" || w === "RWY") designatorAt = i + 1;
      tokens.push({ raw: w, meaning: KEYWORDS[w]! });
    } else if (w === "NOTAMR" || w === "NOTAMC") {
      tokens.push({ raw: w, meaning: GLOSSARY[w]! });
    } else {
      tokens.push({ raw: w, meaning: NOT_EXPLAINED });
    }
    i++;
  }

  // Body
  const heightsAreMsl = keyword === "OBST" || keyword === "AIRSPACE";
  let plain: string[] = [];
  const flush = () => {
    if (plain.length) tokens.push({ raw: plain.join(" "), meaning: "Written as is (a name, number or plain word)" });
    plain = [];
  };
  const push = (raw: string, meaning: string) => {
    flush();
    tokens.push({ raw, meaning });
  };
  for (; i < words.length; i++) {
    const word = words[i]!;
    const c = core(word);
    const next = words[i + 1];
    const nextIsAgl = next !== undefined && core(next) === "AGL";
    let m: RegExpExecArray | null;

    // Name right after TWY or RWY, such as "L" or "13/31"
    if (
      i === designatorAt &&
      /^(?:\d{1,2}[LRC]?(?:\/\d{1,2}[LRC]?)?|[A-Z]{1,2}\d{0,2})$/.test(c) &&
      !Object.prototype.hasOwnProperty.call(GLOSSARY, c) &&
      !Object.prototype.hasOwnProperty.call(KEYWORDS, c)
    ) {
      push(word, `${keyword === "TWY" ? "Taxiway" : "Runway"} ${c}`);
      continue;
    }

    // Validity: YYMMDDHHMM-YYMMDDHHMM or -PERM, optionally followed by EST
    if ((m = /^(\d{10})-(\d{10}|PERM)(EST)?$/.exec(c))) {
      const from = stamp(m[1]!);
      const until = m[2] === "PERM" ? "PERM" : stamp(m[2]!);
      if (!from || !until) push(word, NOT_EXPLAINED);
      else if (until === "PERM") push(word, `From ${from}. PERM: permanent (does not expire on its own)`);
      else {
        push(word, `From ${from} until ${until} (all NOTAMs end at their end time unless PERM)`);
        if (m[3]) push("EST", "estimated end: it may be cancelled earlier, and it ends at this time anyway if not");
      }
      continue;
    }
    if (/^(?:YYMMDD|YYDDMM|MMDD)\w*(?:-\w+)?$/.test(c)) {
      push(word, NOT_EXPLAINED);
      continue;
    }
    // Field conditions
    if (/^[0-6]\/[0-6]\/[0-6]$/.test(c) && words[i - 1] !== undefined && core(words[i - 1]!) === "FICON") {
      push(word, "Runway condition codes (0-6) for the first, middle and last third of the runway");
      continue;
    }
    // NOTAMR / NOTAMC number
    if (/^\d{2}\/\d{3}$/.test(c) && ["NOTAMR", "NOTAMC"].includes(core(words[i - 1] ?? ""))) {
      push(word, `${numberMeaning(c, false) ?? NOT_EXPLAINED} (the one named by ${core(words[i - 1]!)})`);
      continue;
    }
    // Heights and ranges
    if ((m = new RegExp(`^(${LEVEL})-(${LEVEL})$`).exec(c))) {
      const low = level(m[1]!, nextIsAgl, heightsAreMsl)!;
      const high = level(m[2]!, nextIsAgl, heightsAreMsl)!;
      push(nextIsAgl ? `${word} ${next}` : word, `From ${low} up to ${high}`);
      if (nextIsAgl) i++;
      continue;
    }
    if ((m = new RegExp(`^${LEVEL}$`).exec(c)) && c !== "SFC" && c !== "UNL") {
      const described = level(c, nextIsAgl, heightsAreMsl)!;
      push(nextIsAgl ? `${word} ${next}` : word, described);
      if (nextIsAgl) i++;
      continue;
    }
    if ((m = /^(\d+)NM$/.exec(c))) {
      push(word, `${num(Number(m[1]))} nautical miles`);
      continue;
    }
    // Schedule pairs such as SR-SS or SR/SS
    if ((m = /^(SR|SS)[/-](SR|SS)$/.exec(c))) {
      push(word, `${GLOSSARY[m[1]!]} to ${GLOSSARY[m[2]!]}`);
      continue;
    }
    if (GLOSSARY[c] !== undefined && Object.prototype.hasOwnProperty.call(GLOSSARY, c)) {
      push(word, GLOSSARY[c]!);
      continue;
    }
    plain.push(word);
  }
  flush();
  return { tokens };
}
