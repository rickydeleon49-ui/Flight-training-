/**
 * Dates worth keeping an eye on.
 *
 * Two sources only, so nothing is duplicated: her medical expiry, which is a
 * fact about a document she holds, and the target dates already on
 * milestones. Dated events live in the Schedule and are not repeated here.
 *
 * A missed milestone target is deliberately dropped rather than lingering as
 * a reproach — the product does not nag about goals that slipped. An expired
 * medical is kept, because that is a fact she needs to see.
 */
import { daysBetween, parseIsoDate, todayIso } from "@/lib/dates";
import type { IsoDate, Milestone, Profile } from "@/domain/types";

export interface KeyDate {
  id: string;
  label: string;
  date: IsoDate;
  kind: "medical" | "milestone";
  /** Negative once the date has passed. */
  daysAway: number;
  passed: boolean;
}

export function upcomingKeyDates(
  profile: Profile,
  milestones: Milestone[],
  today: IsoDate = todayIso(),
  horizonDays = 180,
): KeyDate[] {
  const dates: KeyDate[] = [];

  if (profile.medicalExpiry) {
    const daysAway = daysBetween(today, profile.medicalExpiry);
    // Kept whatever the sign: an expired medical must not quietly disappear.
    if (daysAway <= horizonDays) {
      dates.push({
        id: "medical",
        label: "Medical certificate expires",
        date: profile.medicalExpiry,
        kind: "medical",
        daysAway,
        passed: daysAway < 0,
      });
    }
  }

  for (const milestone of milestones) {
    if (!milestone.targetDate || milestone.status === "completed") continue;
    const daysAway = daysBetween(today, milestone.targetDate);
    if (daysAway < 0 || daysAway > horizonDays) continue;
    dates.push({
      id: milestone.id,
      label: milestone.title,
      date: milestone.targetDate,
      kind: "milestone",
      daysAway,
      passed: false,
    });
  }

  return dates.sort((a, b) => a.date.localeCompare(b.date));
}

/** How long she has been at this, e.g. "7 months". Null before a start date. */
export function trainingDuration(
  startedOn: IsoDate | null,
  today: IsoDate = todayIso(),
): string | null {
  if (!startedOn) return null;
  const days = daysBetween(startedOn, today);
  if (days < 0) return null;
  if (days < 31) return days === 1 ? "1 day" : `${days} days`;

  // Counted on the calendar, not by dividing days: a year to the day should
  // read "1 year", which an average-month divisor gets wrong.
  const from = parseIsoDate(startedOn);
  const to = parseIsoDate(today);
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;

  if (months < 12) return months === 1 ? "1 month" : `${months} months`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearPart = years === 1 ? "1 year" : `${years} years`;
  if (rest === 0) return yearPart;
  return `${yearPart}, ${rest === 1 ? "1 month" : `${rest} months`}`;
}
