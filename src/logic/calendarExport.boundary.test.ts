/** Independent review regressions: validate before emitting RFC 5545 content. */
import { describe, expect, it } from "vitest";

import { makeEvent } from "@/testing/factories";

import { CalendarExportError, exportCalendarEvent } from "./calendarExport";

const valid = makeEvent({ id: "event-A", date: "2026-10-24", startTime: "10:00", endTime: "11:00" });

describe("Calendar export boundary regressions", () => {
  it("cannot inject a calendar property through the stored event identifier", () => {
    const ics = exportCalendarEvent({ ...valid, id: "event-A\r\nATTENDEE:mailto:other@example.com" });
    expect(ics).not.toContain("\r\nATTENDEE:");
  });

  it.each([" 2026-10-24 ", "2026-10-24\r\n"])("refuses a noncanonical date %j rather than emitting malformed DTSTART", (date) => {
    expect(() => exportCalendarEvent({ ...valid, date })).toThrow(CalendarExportError);
  });

  it("refuses an invalid export timestamp instead of emitting NaN", () => {
    expect(() => exportCalendarEvent(valid, { now: new Date(NaN) })).toThrow(CalendarExportError);
  });

  it.each([null, "23:30"])("refuses a generated end beyond the four-digit calendar range, start=%j", (startTime) => {
    expect(() => exportCalendarEvent({ ...valid, date: "9999-12-31", startTime, endTime: null })).toThrow(CalendarExportError);
  });

  it("matches an independently specified complete ICS fixture", () => {
    const event = makeEvent({
      id: "event-A", title: "Circuit practice", date: "2026-10-24", startTime: "10:00", endTime: "11:00",
      location: "", instructor: "", status: "scheduled",
    });
    const expected = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Her Flight Deck//Calendar Export//EN", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT", "UID:event-A@herflightdeck.invalid", "DTSTAMP:20261017T183000Z", "STATUS:CONFIRMED",
      "SUMMARY:Circuit practice", "DTSTART:20261024T100000", "DTEND:20261024T110000",
      "DESCRIPTION:Flight Lesson\\nPrepared with Her Flight Deck — open the lesso",
      " n in the app for your checklist", "END:VEVENT", "END:VCALENDAR", "",
    ].join("\r\n");
    expect(exportCalendarEvent(event, { now: new Date("2026-10-17T18:30:00Z") })).toBe(expected);
  });

  it.each(["0000-01-01T00:00:00Z", "+010000-01-01T00:00:00Z"])("refuses an out-of-range DTSTAMP %s", (stamp) => {
    expect(() => exportCalendarEvent(valid, { now: new Date(stamp) })).toThrow(CalendarExportError);
  });

  it("retains valid events at the upper supported date boundary", () => {
    expect(exportCalendarEvent({ ...valid, date: "9999-12-30", startTime: null, endTime: null }))
      .toContain("DTEND;VALUE=DATE:99991231\r\n");
    expect(exportCalendarEvent({ ...valid, date: "9999-12-31" })).toContain("DTEND:99991231T110000\r\n");
  });

  it("escapes punctuation in a UID without introducing properties", () => {
    const ics = exportCalendarEvent({ ...valid, id: "part,one;two\\three" });
    expect(ics).toContain("UID:part\\,one\\;two\\\\three@herflightdeck.invalid\r\n");
  });
});
