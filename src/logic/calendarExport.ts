/**
 * RFC 5545 iCalendar (.ics) export for single lessons (P54-05 part B).
 *
 * Produces one VCALENDAR containing one VEVENT with a stable UID, UTC DTSTAMP,
 * and floating local date-times without timezone identifiers or UTC offsets,
 * matching how lessons are stored (wall-clock calendar strings).
 *
 * In accordance with reviewer corrections:
 * - METHOD and SEQUENCE are omitted (one-time file export, not a sync protocol).
 * - ORGANIZER, attendees, recurrence and alarms are omitted.
 * - Completed lessons have no export.
 * - Scheduled events export as STATUS:CONFIRMED.
 * - Cancelled and rescheduled events export as STATUS:CANCELLED.
 * - A start time without an end receives an approved 1-hour duration with
 *   calendar-day rollover.
 * - Missing start with explicit end, equal end, and inverted end are refused.
 * - Invalid dates and malformed clock values are refused.
 * - Escapes RFC TEXT characters and folds physical lines at <= 75 UTF-8 octets
 *   without splitting multibyte characters, using CRLF line endings.
 */
import { EVENT_TYPE_LABELS, type ScheduleEvent } from "@/domain/types";
import { exportFileName } from "@/logic/studyExport";

export class CalendarExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarExportError";
  }
}

export interface CalendarExportOptions {
  includeChecklist?: boolean;
  prepItemTitles?: string[];
  /** Export timestamp (defaults to current time). Emitted as UTC DTSTAMP. */
  now?: Date;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

export function isValidIsoDate(dateStr: string): boolean {
  if (typeof dateStr !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return false;
  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const day = parseInt(match[3]!, 10);
  if (year < 1 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

export function isValidClockTime(timeStr: string): boolean {
  if (typeof timeStr !== "string") return false;
  const match = /^(\d{2}):(\d{2})$/.exec(timeStr.trim());
  if (!match) return false;
  const hour = parseInt(match[1]!, 10);
  const minute = parseInt(match[2]!, 10);
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  return true;
}

export function nextCalendarDay(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match || !isValidIsoDate(dateStr)) {
    throw new CalendarExportError(`Invalid date: "${dateStr}".`);
  }
  let year = parseInt(match[1]!, 10);
  let month = parseInt(match[2]!, 10);
  let day = parseInt(match[3]!, 10);

  const dim = daysInMonth(year, month);
  if (day < dim) {
    day += 1;
  } else if (month < 12) {
    month += 1;
    day = 1;
  } else {
    year += 1;
    month = 1;
    day = 1;
  }
  if (year > 9999) {
    throw new CalendarExportError("The lesson end date exceeds the supported calendar range.");
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function calendarFileName(event: ScheduleEvent): string {
  return exportFileName(`Lesson ${event.date} ${event.title}`, "ics");
}

/**
 * Escapes TEXT values per RFC 5545 section 3.3.11:
 * \ -> \\
 * ; -> \;
 * , -> \,
 * newlines -> \n
 * Control characters other than TAB are stripped to prevent injection or corruption.
 */
export function escapeRfcText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

const encoder = new TextEncoder();

/**
 * Folds a content line to lines of no more than 75 UTF-8 octets,
 * prepending a space (1 octet) on continuation lines, and avoiding
 * splitting multibyte code points. Returns physical lines joined by CRLF.
 */
export function foldLine(line: string): string {
  const codePoints = Array.from(line);
  const physicalLines: string[] = [];
  let currentLine = "";
  let currentOctets = 0;

  for (const cp of codePoints) {
    const cpOctets = encoder.encode(cp).length;
    if (currentOctets + cpOctets > 75) {
      physicalLines.push(currentLine);
      currentLine = " " + cp;
      currentOctets = 1 + cpOctets;
    } else {
      currentLine += cp;
      currentOctets += cpOctets;
    }
  }
  physicalLines.push(currentLine);
  return physicalLines.join("\r\n");
}

function formatUtcStamp(date: Date): string {
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
    throw new CalendarExportError("The export timestamp is outside the supported calendar range.");
  }
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

function dateToYmd(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

function timeToHms(timeStr: string): string {
  return `${timeStr.replace(/:/g, "")}00`;
}

function addOneHour(dateStr: string, timeStr: string): [string, string] {
  const hour = parseInt(timeStr.slice(0, 2), 10);
  const minute = timeStr.slice(3, 5);
  if (hour < 23) {
    const endHour = String(hour + 1).padStart(2, "0");
    return [dateStr, `${endHour}${minute}00`];
  }
  const endHour = "00";
  const nextDay = nextCalendarDay(dateStr);
  return [nextDay, `${endHour}${minute}00`];
}

/**
 * Builds the RFC 5545 iCalendar representation of one lesson event.
 */
export function exportCalendarEvent(
  event: ScheduleEvent,
  options: CalendarExportOptions = {},
): string {
  if (event.status === "completed") {
    throw new CalendarExportError("Completed lessons cannot be exported to a calendar.");
  }

  if (!isValidIsoDate(event.date)) {
    throw new CalendarExportError(`Invalid lesson date: "${event.date}".`);
  }

  const rawStart = typeof event.startTime === "string" ? event.startTime.trim() : "";
  const rawEnd = typeof event.endTime === "string" ? event.endTime.trim() : "";
  const hasStart = rawStart.length > 0;
  const hasEnd = rawEnd.length > 0;

  if (!hasStart && hasEnd) {
    throw new CalendarExportError("The lesson has an end time without a start time.");
  }

  if (hasStart && !isValidClockTime(rawStart)) {
    throw new CalendarExportError(`Malformed start time: "${event.startTime}".`);
  }

  if (hasEnd && !isValidClockTime(rawEnd)) {
    throw new CalendarExportError(`Malformed end time: "${event.endTime}".`);
  }

  if (hasStart && hasEnd && rawEnd <= rawStart) {
    throw new CalendarExportError("The lesson end time must be after the start time.");
  }

  let dtstartLine: string;
  let dtendLine: string;

  if (hasStart && hasEnd) {
    dtstartLine = `DTSTART:${dateToYmd(event.date)}T${timeToHms(rawStart)}`;
    dtendLine = `DTEND:${dateToYmd(event.date)}T${timeToHms(rawEnd)}`;
  } else if (hasStart && !hasEnd) {
    const [endDate, endHms] = addOneHour(event.date, rawStart);
    dtstartLine = `DTSTART:${dateToYmd(event.date)}T${timeToHms(rawStart)}`;
    dtendLine = `DTEND:${dateToYmd(endDate)}T${endHms}`;
  } else {
    // All-day event
    const nextDay = nextCalendarDay(event.date);
    dtstartLine = `DTSTART;VALUE=DATE:${dateToYmd(event.date)}`;
    dtendLine = `DTEND;VALUE=DATE:${dateToYmd(nextDay)}`;
  }

  const status =
    event.status === "cancelled" || event.status === "rescheduled"
      ? "STATUS:CANCELLED"
      : "STATUS:CONFIRMED";

  const now = options.now ?? new Date();
  const dtstamp = `DTSTAMP:${formatUtcStamp(now)}`;
  const uid = `UID:${escapeRfcText(`${event.id}@herflightdeck.invalid`)}`;
  const summary = `SUMMARY:${escapeRfcText(event.title.trim())}`;

  // Description contains only:
  // - Event type
  // - Instructor (when present)
  // - Fixed note: "Prepared with Her Flight Deck — open the lesson in the app for your checklist"
  // - Preparation checklist titles (only when explicitly selected)
  const descLines: string[] = [];
  const typeLabel = EVENT_TYPE_LABELS[event.eventType] ?? event.eventType;
  descLines.push(typeLabel);

  if (event.instructor && event.instructor.trim().length > 0) {
    descLines.push(`Instructor: ${event.instructor.trim()}`);
  }

  descLines.push("Prepared with Her Flight Deck — open the lesson in the app for your checklist");

  if (options.includeChecklist && options.prepItemTitles && options.prepItemTitles.length > 0) {
    const cleanTitles = options.prepItemTitles
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (cleanTitles.length > 0) {
      descLines.push("");
      descLines.push("Preparation checklist:");
      for (const title of cleanTitles) {
        descLines.push(`- ${title}`);
      }
    }
  }

  const description = `DESCRIPTION:${escapeRfcText(descLines.join("\n"))}`;

  const logicalLines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Her Flight Deck//Calendar Export//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    uid,
    dtstamp,
    status,
    summary,
    dtstartLine,
    dtendLine,
  ];

  if (event.location && event.location.trim().length > 0) {
    logicalLines.push(`LOCATION:${escapeRfcText(event.location.trim())}`);
  }

  logicalLines.push(description);
  logicalLines.push("END:VEVENT");
  logicalLines.push("END:VCALENDAR");

  return logicalLines.map(foldLine).join("\r\n") + "\r\n";
}
