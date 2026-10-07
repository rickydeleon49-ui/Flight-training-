/**
 * Local calendar days for card reviews (approved default C-D5).
 *
 * Stored instants are UTC and never rewritten. A day-ladder card is due
 * before the exclusive next local midnight of the zone the computer is in
 * now; that boundary is found by bisection on the local date, so 23- and
 * 25-hour days are exact.
 */

/** The IANA zone the computer is in now. Tests replace it. */
export function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** The local calendar date (YYYY-MM-DD) of an instant in an IANA zone. */
export function localDate(instantIso: string, timeZone: string): string {
  let format = dateFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormats.set(timeZone, format);
  }
  return format.format(new Date(instantIso));
}

/**
 * The first UTC instant whose local date in `timeZone` is after today's: the
 * exclusive end of the current local day.
 */
export function nextLocalMidnightUtc(nowIso: string, timeZone: string): string {
  const today = localDate(nowIso, timeZone);
  let low = Date.parse(nowIso); // local date is today
  let high = low + 50 * 60 * 60 * 1000; // certainly a later local date
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (localDate(new Date(middle).toISOString(), timeZone) > today) high = middle;
    else low = middle;
  }
  return new Date(high).toISOString();
}

/** "Thu 8 Oct" in the given zone, for "Next review" lines. */
export function shortLocalDay(instantIso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(new Date(instantIso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}
