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

export const isOverdue = (due: IsoDate | null, today: IsoDate): boolean =>
  due !== null && due < today;

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

/** e.g. "Sep 6". */
export function formatShortDate(date: IsoDate): string {
  const d = parseIsoDate(date);
  return `${MONTHS[d.getMonth()]?.slice(0, 3)} ${d.getDate()}`;
}

export function formatMonthYear(date: IsoDate): string {
  const d = parseIsoDate(date);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
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
  return formatShortDate(date);
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
