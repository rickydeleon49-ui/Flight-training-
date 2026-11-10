import { daysBetween, todayIso } from "@/lib/dates";
import type { IsoDate } from "@/domain/types";

/** Days before the checkride when a notice goes out (none after it). */
export const CHECKRIDE_MILESTONES = [30, 7, 1] as const;

/** Whole calendar days to go; null when no date or it has passed. Calendar math, so DST cannot skew it. */
export function daysToCheckride(date: IsoDate | null | undefined, today: IsoDate = todayIso()): number | null {
  if (!date) return null;
  const days = daysBetween(today, date);
  return days < 0 ? null : days;
}

/** "12 days to your checkride", "1 day to your checkride", or the day-of line. Null when unset or passed. */
export function checkrideLine(date: IsoDate | null | undefined, today: IsoDate = todayIso()): string | null {
  const days = daysToCheckride(date, today);
  if (days === null) return null;
  if (days === 0) return "Checkride today — you've got this";
  return `${days} ${days === 1 ? "day" : "days"} to your checkride`;
}

export const CHECKRIDE_TITLE = "Your Flight Deck";
export const checkrideBody = (days: number): string =>
  days === 1 ? "Your checkride is tomorrow." : `Your checkride is in ${days} days.`;
