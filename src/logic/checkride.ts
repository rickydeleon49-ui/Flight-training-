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

/** "What to bring" items, in our own words from the ACS Applicant's Practical Test Checklist. */
export const BRING_ITEMS = [
  { id: "photo-id", label: "Photo ID" },
  { id: "medical", label: "Your current medical certificate" },
  { id: "student-cert", label: "Your student pilot certificate" },
  { id: "application", label: "Your completed application (FAA Form 8710-1 / IACRA)" },
  { id: "knowledge-report", label: "Your knowledge test report" },
  { id: "logbook", label: "Your logbook with your instructor's endorsements" },
  { id: "aircraft-docs", label: "Aircraft papers: airworthiness certificate, registration, operating limitations" },
  { id: "weight-balance", label: "The aircraft's weight and balance data" },
  { id: "maintenance", label: "Aircraft maintenance records" },
  { id: "handbook", label: "The aircraft's flight manual or handbook" },
  { id: "charts-tools", label: "Current charts, plotter, flight computer and flight log forms" },
  { id: "view-limiting", label: "A view-limiting device (hood or foggles)" },
  { id: "fee", label: "The examiner's fee, if it applies" },
] as const;
