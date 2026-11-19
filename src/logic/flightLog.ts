import type { IsoDate, JournalEntry } from "@/domain/types";
import { addDays, todayIso } from "@/lib/dates";

export const hasFlightLogData = (entry: JournalEntry): boolean =>
  Boolean(
    entry.aircraftType.trim() ||
      entry.aircraftId.trim() ||
      entry.departureAirport.trim() ||
      entry.arrivalAirport.trim() ||
      entry.instructorName.trim() ||
      entry.totalTime != null ||
      entry.dualReceived != null ||
      entry.soloTime != null ||
      entry.picTime != null ||
      entry.crossCountryTime != null ||
      entry.nightTime != null ||
      entry.actualInstrumentTime != null ||
      entry.simulatedInstrumentTime != null ||
      entry.dayLandings != null ||
      entry.nightLandings != null,
  );

export interface FlightLogTotals {
  flights: number;
  totalTime: number;
  dualReceived: number;
  soloTime: number;
  picTime: number;
  crossCountryTime: number;
  nightTime: number;
  instrumentTime: number;
  landings: number;
}

/** Flights dated after `today` are planned, not flown, so they are left out of every total. */
export function flightLogTotals(entries: JournalEntry[], today: IsoDate = todayIso()): FlightLogTotals {
  const logged = entries.filter((entry) => hasFlightLogData(entry) && entry.date <= today);
  const sum = (read: (entry: JournalEntry) => number | null) =>
    logged.reduce((total, entry) => total + (read(entry) ?? 0), 0);

  return {
    flights: logged.length,
    totalTime: sum((entry) => entry.totalTime),
    dualReceived: sum((entry) => entry.dualReceived),
    soloTime: sum((entry) => entry.soloTime),
    picTime: sum((entry) => entry.picTime),
    crossCountryTime: sum((entry) => entry.crossCountryTime),
    nightTime: sum((entry) => entry.nightTime),
    instrumentTime:
      sum((entry) => entry.actualInstrumentTime) +
      sum((entry) => entry.simulatedInstrumentTime),
    landings:
      sum((entry) => entry.dayLandings) + sum((entry) => entry.nightLandings),
  };
}

export const formatHours = (hours: number): string => hours.toFixed(1);

type FlightTimes = Pick<
  JournalEntry,
  | "totalTime"
  | "dualReceived"
  | "soloTime"
  | "picTime"
  | "crossCountryTime"
  | "nightTime"
  | "actualInstrumentTime"
  | "simulatedInstrumentTime"
>;

const PART_TIMES: ReadonlyArray<readonly [Exclude<keyof FlightTimes, "totalTime">, string]> = [
  ["dualReceived", "dual received"],
  ["soloTime", "solo"],
  ["picTime", "PIC"],
  ["crossCountryTime", "cross-country"],
  ["nightTime", "night"],
  ["actualInstrumentTime", "actual instrument"],
  ["simulatedInstrumentTime", "simulated instrument"],
];

/** Whether any logbook time differs between a saved entry and an edit of it. */
export const flightTimesChanged = (before: FlightTimes, after: FlightTimes): boolean =>
  before.totalTime !== after.totalTime || PART_TIMES.some(([key]) => before[key] !== after[key]);

// Times are entered to a tenth; this only absorbs floating-point addition.
const HOURS_TOLERANCE = 1e-9;

/**
 * Why these logbook times can't all be true of one flight, or null.
 *
 * Each part of a flight is part of its total: 2.0 hours of dual on a 1.5-hour
 * flight is a typing slip, and once saved it would inflate every total built
 * from the log. Dual received and solo can't overlap, and neither can actual
 * and simulated instrument time. Nothing is checked until a total is entered.
 */
export function flightTimeProblem(times: FlightTimes): string | null {
  const total = times.totalTime;
  if (total == null || !Number.isFinite(total)) return null;
  const exceeds = (value: number | null) => value != null && value > total + HOURS_TOLERANCE;
  const over = PART_TIMES.filter(([key]) => exceeds(times[key])).map(([, label]) => label);
  if (over.length > 0) {
    const named = over.length === 1 ? over[0]! : `${over.slice(0, -1).join(", ")} and ${over.at(-1)!}`;
    const sentence = `${named.charAt(0).toUpperCase()}${named.slice(1)} time`;
    return `${sentence} can't be more than this flight's total time of ${formatHours(total)} hr.`;
  }
  if (exceeds((times.dualReceived ?? 0) + (times.soloTime ?? 0))) {
    return `Dual received and solo time together can't be more than this flight's total time of ${formatHours(total)} hr.`;
  }
  if (exceeds((times.actualInstrumentTime ?? 0) + (times.simulatedInstrumentTime ?? 0))) {
    return `Actual and simulated instrument time together can't be more than this flight's total time of ${formatHours(total)} hr.`;
  }
  return null;
}

export interface FlightTimeCheck {
  entry: JournalEntry;
  problem: string;
}

/**
 * Saved entries whose times can't all be true of one flight, newest first.
 *
 * Entries saved before the form checked times can still hold, say, more dual
 * than total time. They are only pointed out: the times stay exactly as the student
 * logged them, and still count in every total, until the student corrects them.
 */
export function flightTimeChecks(entries: JournalEntry[]): FlightTimeCheck[] {
  return entries
    .map((entry) => ({ entry, problem: flightTimeProblem(entry) }))
    .filter((check): check is FlightTimeCheck => check.problem !== null)
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date));
}

export interface FlightActivity {
  flightsLast30Days: number;
  hoursLast30Days: number;
  averageFlightTime: number;
  lastFlightDate: IsoDate | null;
}

/** A training-rhythm snapshot. Future-dated entries are deliberately excluded. */
export function flightActivity(
  entries: JournalEntry[],
  today: IsoDate = todayIso(),
): FlightActivity {
  const logged = entries.filter(hasFlightLogData);
  const completed = logged.filter((entry) => entry.date <= today);
  const start = addDays(today, -29);
  const recent = completed.filter((entry) => entry.date >= start);
  const timed = completed.filter((entry) => entry.totalTime != null);

  return {
    flightsLast30Days: recent.length,
    hoursLast30Days: recent.reduce((total, entry) => total + (entry.totalTime ?? 0), 0),
    averageFlightTime:
      timed.length === 0
        ? 0
        : timed.reduce((total, entry) => total + (entry.totalTime ?? 0), 0) / timed.length,
    lastFlightDate:
      completed.length === 0
        ? null
        : completed.reduce(
            (latest, entry) => (entry.date > latest ? entry.date : latest),
            completed[0]!.date,
          ),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One plain line about the last 30 days, e.g. "Last 30 days: 3 flights, 4.2 hours · last flight 12 Nov 2026". Null when nothing is logged yet. */
export function flightRhythmLine(activity: FlightActivity): string | null {
  if (!activity.lastFlightDate) return null;
  const [year, month, day] = activity.lastFlightDate.split("-").map(Number);
  const last = `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
  const n = activity.flightsLast30Days;
  const hours = formatHours(activity.hoursLast30Days);
  const recent =
    n === 0
      ? "no flights"
      : `${n} ${n === 1 ? "flight" : "flights"}, ${hours} ${hours === "1" || hours === "1.0" ? "hour" : "hours"}`;
  return `Last 30 days: ${recent} · last flight ${last}`;
}

export type HoursToGoStatus = "to_go" | "done" | "unknown";

export interface HoursToGoRow {
  key: string;
  label: string;
  /** Logged hours when the journal can measure this; null for text-only rows. */
  logged: number | null;
  /** The reference in plain words, e.g. "40 h". */
  reference: string;
  /** Hours left to the reference, never negative; null when not measurable. */
  toGo: number | null;
  status: HoursToGoStatus;
  meta?: string;
  /** Extra logged figure shown as information only. */
  info?: string;
  /** Replaces the default right-hand status when the figure is not plain hours. */
  statusText?: string;
}

export const HOURS_TO_GO_CANT_TELL = "Can't tell from your journal";
export const HOURS_TO_GO_TICK_HINT = "Tick it on the flight in your journal.";
export const HOURS_TO_GO_CONFIRM = "Confirm with your instructor.";
export const HOURS_TO_GO_NIGHT_STATUS = "Can't tell from your journal — check with your instructor";

/**
 * First day of the calendar month two months before the test month: the start
 * of the 61.109(a)(1)(ii) practice-test-prep window. 2027-03-15 -> 2027-01-01;
 * 2027-02-10 -> 2026-12-01. Null for anything that is not a YYYY-MM-DD day.
 */
export function prepWindowStart(testDate: string | null | undefined): string | null {
  if (!testDate || !/^\d{4}-\d{2}-\d{2}$/.test(testDate)) return null;
  const year = Number(testDate.slice(0, 4));
  const month = Number(testDate.slice(5, 7));
  if (month < 1 || month > 12) return null;
  const index = year * 12 + (month - 1) - 2;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
}

/**
 * "Hours still to go" against the headline 14 CFR 61.109(a) airplane
 * references. A study aid: only totals the journal can measure are computed.
 * Subsets the journal cannot tell apart are listed as text with no numbers.
 */
export function privatePilotHoursToGo(
  totals: FlightLogTotals,
  nightLandings: number,
  checkrideDate?: string | null,
  entries?: JournalEntry[],
  today: IsoDate = todayIso(),
): HoursToGoRow[] {
  const measured = (
    key: string,
    label: string,
    logged: number,
    reference: number,
    meta?: string,
  ): HoursToGoRow => {
    const toGo = Math.max(0, Math.round((reference - logged) * 10) / 10);
    return {
      key,
      label,
      logged,
      reference: `${reference} h`,
      toGo,
      status: toGo === 0 ? "done" : "to_go",
      ...(meta ? { meta } : {}),
    };
  };
  const text = (key: string, label: string, reference: string, meta?: string): HoursToGoRow => ({
    key,
    label,
    logged: null,
    reference,
    toGo: null,
    status: "unknown",
    ...(meta ? { meta } : {}),
  });
  const windowStart = prepWindowStart(checkrideDate);
  const tickHint = (meta?: string) => [meta, HOURS_TO_GO_TICK_HINT].filter(Boolean).join(" ");
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const list = (entries ?? []).filter((e) => e.date <= today); // planned flights do not count
  const anyTick = list.some(
    (e) =>
      e.toweredFullStopLandings != null ||
      e.longSoloXc === true ||
      e.nightXc100 === true ||
      e.checkridePrep === true,
  );
  const overlap = (a: number | null, b: number | null) => (a != null && b != null ? Math.min(a, b) : 0);
  const xcTraining = round1(list.reduce((n, e) => n + overlap(e.dualReceived, e.crossCountryTime), 0));
  const soloXc = round1(list.reduce((n, e) => n + overlap(e.soloTime, e.crossCountryTime), 0));
  const nightTraining = round1(list.reduce((n, e) => n + overlap(e.dualReceived, e.nightTime), 0));
  const longXc = list.filter((e) => e.longSoloXc === true).sort((a, b) => a.date.localeCompare(b.date));
  const nightXcTicked = list.some((e) => e.nightXc100 === true);
  const towerLandings = list.reduce(
    (n, e) => n + ((e.soloTime ?? 0) > 0 ? (e.toweredFullStopLandings ?? 0) : 0),
    0,
  );
  const prepHours = round1(
    list
      .filter((e) => e.checkridePrep === true && (windowStart == null || e.date >= windowStart))
      .reduce((n, e) => n + (e.dualReceived ?? 0), 0),
  );
  const prepMeta = windowStart
    ? `Your 2-month window starts ${windowStart} — confirm with your instructor.`
    : undefined;

  const xcTrainingRow: HoursToGoRow =
    entries === undefined
      ? text("xc-training", "Cross-country training", "3 h")
      : measured("xc-training", "Cross-country training", xcTraining, 3, HOURS_TO_GO_CONFIRM);
  const soloXcRow: HoursToGoRow =
    entries === undefined
      ? text("solo-xc", "Solo cross-country", "5 h")
      : measured("solo-xc", "Solo cross-country", soloXc, 5, HOURS_TO_GO_CONFIRM);
  const prepReference = "3 h within the 2 calendar months before the test month";
  const prepRow: HoursToGoRow =
    entries === undefined
      ? text("prep", "Practical-test prep training", prepReference, prepMeta)
      : !anyTick
        ? text("prep", "Practical-test prep training", prepReference, tickHint(prepMeta))
        : {
            ...measured(
              "prep",
              "Practical-test prep training",
              prepHours,
              3,
              prepMeta ??
                `Counts every flight you ticked; the window depends on the test date. ${HOURS_TO_GO_CONFIRM}`,
            ),
            reference: prepReference,
          };
  const longReference =
    "One solo XC of 150 NM total with full-stop landings at 3 points and one leg over 50 NM straight-line";
  const longRow: HoursToGoRow =
    entries === undefined
      ? text("solo-xc-long", "Long solo cross-country", longReference)
      : longXc.length > 0
        ? {
            key: "solo-xc-long",
            label: "Long solo cross-country",
            logged: null,
            reference: longReference,
            toGo: null,
            status: "done",
            statusText: `Ticked on ${longXc[0]!.date} — done`,
            meta: HOURS_TO_GO_CONFIRM,
          }
        : !anyTick
          ? text("solo-xc-long", "Long solo cross-country", longReference, tickHint())
          : {
              key: "solo-xc-long",
              label: "Long solo cross-country",
              logged: null,
              reference: longReference,
              toGo: null,
              status: "to_go",
              statusText: "Not ticked yet — to go",
              meta: HOURS_TO_GO_CONFIRM,
            };
  const towerReference =
    "3 solo takeoffs/landings to a full stop at an airport with an operating control tower";
  const towerRow: HoursToGoRow =
    entries === undefined
      ? text("solo-tower", "Solo towered-airport landings", towerReference)
      : !anyTick
        ? text("solo-tower", "Solo towered-airport landings", towerReference, tickHint())
        : {
            key: "solo-tower",
            label: "Solo towered-airport landings",
            logged: null,
            reference: towerReference,
            toGo: Math.max(0, 3 - towerLandings),
            status: towerLandings >= 3 ? "done" : "to_go",
            statusText:
              towerLandings >= 3
                ? `${towerLandings} / 3 landings — done`
                : `${towerLandings} / 3 landings — ${3 - towerLandings} to go`,
            meta: `Counts only landings ticked on solo flights. ${HOURS_TO_GO_CONFIRM}`,
          };
  const nightInfo = `Logged: ${formatHours(totals.nightTime)} h night, ${nightLandings} night landings`;
  const nightRow: HoursToGoRow = {
    key: "night",
    label: "Night training",
    logged: totals.nightTime,
    reference:
      "3 h night training incl. one night XC over 100 NM total and 10 night takeoffs/landings to a full stop",
    toGo: null,
    status: "unknown",
    info: nightInfo,
  };
  if (entries !== undefined && anyTick) {
    const done = nightTraining >= 3 && nightXcTicked && nightLandings >= 10;
    nightRow.status = done ? "done" : "to_go";
    nightRow.info = `${nightInfo}. Night training with your instructor: ${formatHours(nightTraining)} h of 3.`;
    nightRow.statusText = `${formatHours(nightTraining)} / 3 h, night XC ${nightXcTicked ? "ticked" : "not ticked"}, ${nightLandings} / 10 landings — ${done ? "done" : "to go"}`;
    nightRow.meta = `Night landings are counted as logged; the journal can't tell which were full stop. ${HOURS_TO_GO_CONFIRM}`;
  } else if (entries !== undefined) {
    nightRow.meta = HOURS_TO_GO_TICK_HINT;
  }

  return [
    measured("total", "Total flight time", totals.totalTime, 40),
    measured("training", "Flight training received", totals.dualReceived, 20),
    measured("solo", "Solo flight", totals.soloTime, 10),
    measured(
      "instrument",
      "Instrument training",
      totals.instrumentTime,
      3,
      "Counts the actual and simulated instrument time you log. Your instructor confirms which counts.",
    ),
    nightRow,
    xcTrainingRow,
    prepRow,
    soloXcRow,
    longRow,
    towerRow,
  ];
}

export function flightRoute(entry: JournalEntry): string {
  const from = entry.departureAirport.trim();
  const to = entry.arrivalAirport.trim();
  if (from && to) return from === to ? from : `${from} → ${to}`;
  return from || to || "—";
}
