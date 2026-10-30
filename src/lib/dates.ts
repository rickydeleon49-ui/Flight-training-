/**
 * Date helpers.
 *
 * Calendar days are plain 'YYYY-MM-DD' strings compared lexically, which
 * avoids timezone drift entirely — a lesson on Saturday is on Saturday
 * regardless of where the machine thinks it is.
 */
import type { IsoDate, IsoDateTime } from "@/domain/types";

export const nowIso = (): IsoDateTime => new Date().toISOString();

/** Today as a local calendar day, not a UTC one. */
export function todayIso(now: Date = new Date()): IsoDate {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parse 'YYYY-MM-DD' into a local Date at midnight. */
export function parseIsoDate(date: IsoDate): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(date);
  d.setDate(d.getDate() + days);
  return todayIso(d);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const ms = parseIsoDate(to).getTime() - parseIsoDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

export const startOfMonth = (date: IsoDate): IsoDate => `${date.slice(0, 7)}-01`;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** e.g. "Saturday, September 6". Year is added when it is not the current one. */
export function formatLongDate(date: IsoDate, today: IsoDate = todayIso()): string {
  const d = parseIsoDate(date);
  const weekday = WEEKDAYS[d.getDay()];
  const month = MONTHS[d.getMonth()];
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return `${weekday}, ${month} ${d.getDate()}${sameYear ? "" : `, ${d.getFullYear()}`}`;
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?$/i;

function isRealCalendarDay(day: string): boolean {
  const match = CALENDAR_DAY.exec(day);
  if (!match) return false;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, date));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === date
  );
}

/**
 * A date she typed, as 'YYYY-MM-DD', or null when it isn't a real day.
 * Month first, as on US forms: "11/05/2026", "11-5-2026" and "11052026" are
 * all November 5, 2026; the stored form "2026-11-05" is accepted too.
 * Nothing is guessed or moved: a day that doesn't exist is refused, so a
 * typed date is never saved as a different one.
 */
export function parseTypedDate(text: string): IsoDate | null {
  const typed = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(typed);
  const us = /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})$/.exec(typed) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(typed);
  const [year, month, day] = iso ? [iso[1]!, iso[2]!, iso[3]!] : us ? [us[3]!, us[1]!, us[2]!] : [];
  if (!year || !month || !day) return null;
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isRealCalendarDay(date) ? date : null;
}

/** A stored day the way she types it: "11/05/2026". */
export function formatTypedDate(date: IsoDate): string {
  const match = CALENDAR_DAY.exec(date);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : "";
}

/**
 * The local calendar day a stored timestamp falls on, or null when it can't be
 * read. Accepts ISO 8601 ('2026-10-01T18:30:00.000Z', with or without an
 * offset), SQLite's UTC form ('2026-10-01 18:30:00') and a bare calendar day.
 * Timestamps without an offset are UTC, as SQLite writes them. The string is
 * rebuilt in strict ISO form before parsing, because WebKit refuses the
 * space-separated form that V8 accepts.
 */
export function localDayOf(timestamp: string | null | undefined): IsoDate | null {
  if (typeof timestamp !== "string") return null;
  const text = timestamp.trim();
  if (CALENDAR_DAY.test(text)) return isRealCalendarDay(text) ? text : null;
  const match = TIMESTAMP.exec(text);
  if (!match || !isRealCalendarDay(match[1]!)) return null;
  const rawOffset = match[3]?.toUpperCase() ?? "Z";
  const offset = rawOffset === "Z" ? "Z" : rawOffset.replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
  const parsed = new Date(`${match[1]}T${match[2]}${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : todayIso(parsed);
}

/**
 * A stored timestamp as the long local date it falls on, or null when it can't
 * be read. "2026-10-16T03:56:14Z" seen in California the evening before reads
 * "Thursday, October 15", not the UTC day the first ten characters name.
 */
export function formatLocalDay(
  timestamp: string | null | undefined,
  today: IsoDate = todayIso(),
): string | null {
  const day = localDayOf(timestamp);
  return day ? formatLongDate(day, today) : null;
}

/** e.g. "Oct 20". Year is added when it is not the current one: "Oct 20, 2028". */
export function formatShortDate(date: IsoDate, today: IsoDate = todayIso()): string {
  const d = parseIsoDate(date);
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return `${MONTHS[d.getMonth()]?.slice(0, 3)} ${d.getDate()}${sameYear ? "" : `, ${d.getFullYear()}`}`;
}

export function formatMonthYear(date: IsoDate): string {
  const d = parseIsoDate(date);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Stored timestamp as friendly local date and time, e.g. "Oct 21 at 12:35 PM". */
export function formatDateTime(
  timestamp: string | null | undefined,
  today: IsoDate = todayIso(),
): string {
  if (!timestamp) return "";
  const day = localDayOf(timestamp);
  if (!day) return "";
  const d = new Date(timestamp.includes("T") ? timestamp : timestamp.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return formatShortDate(day, today);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${formatShortDate(day, today)} at ${formatTime(time)}`;
}

/** Turn 24-hour '10:30' into '10:30 AM'. */
export function formatTime(time: string | null): string {
  if (!time) return "";
  const [hourText, minute = "00"] = time.split(":");
  const hour = Number(hourText);
  if (Number.isNaN(hour)) return time;
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${suffix}`;
}

/**
 * Human phrasing for a due date, e.g. "Today", "in 3 days", "2 days overdue".
 * Overdue wording states the fact without scolding.
 */
export function describeRelativeDate(date: IsoDate, today: IsoDate = todayIso()): string {
  const delta = daysBetween(today, date);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "1 day overdue";
  if (delta < 0) return `${Math.abs(delta)} days overdue`;
  if (delta < 7) return `in ${delta} days`;
  return formatShortDate(date, today);
}

export function formatDuration(minutes: number | null): string {
  if (!minutes || minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** Weeks of a month as calendar grids, Sunday-first, padded with neighbours. */
export function monthGrid(monthAnchor: IsoDate): IsoDate[][] {
  const first = parseIsoDate(startOfMonth(monthAnchor));
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());

  const weeks: IsoDate[][] = [];
  const cursor = new Date(gridStart);
  for (let week = 0; week < 6; week++) {
    const days: IsoDate[] = [];
    for (let day = 0; day < 7; day++) {
      days.push(todayIso(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(days);
    // Stop once we have covered the month and finished the week.
    if (cursor.getMonth() !== first.getMonth() && weeks.length >= 4) {
      const lastDay = days[6];
      if (lastDay && lastDay.slice(0, 7) !== monthAnchor.slice(0, 7)) break;
    }
  }
  return weeks;
}

export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];
