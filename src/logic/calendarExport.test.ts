import { describe, expect, it } from "vitest";

import type { ScheduleEvent } from "@/domain/types";
import {
  calendarFileName,
  CalendarExportError,
  daysInMonth,
  escapeRfcText,
  exportCalendarEvent,
  foldLine,
  isLeapYear,
  isValidClockTime,
  isValidIsoDate,
  nextCalendarDay,
} from "./calendarExport";

const sampleDate = "2026-10-24";
const sampleEvent: ScheduleEvent = {
  id: "evt-001",
  title: "Cross-country navigation",
  eventType: "flight_lesson",
  date: sampleDate,
  startTime: "10:00",
  endTime: "12:00",
  location: "KSQL (San Carlos Airport)",
  instructor: "Sarah Walker, CFI",
  notes: "SENTINEL_LESSON_NOTES_NEVER_EXPORT",
  goalId: "goal-1",
  estimatedCost: 35000,
  actualCost: null,
  status: "scheduled",
  createdAt: "2026-10-15T08:00:00.000Z",
  updatedAt: "2026-10-15T08:00:00.000Z",
  materialIds: ["mat-1"],
};

const fixedNow = new Date("2026-10-17T18:30:00.000Z");

/**
 * Independent RFC 5545 parser for conformance testing.
 * Unfolds CRLF + linear whitespace continuation, verifies physical line limits,
 * and extracts properties and components.
 */
function parseIcs(icsText: string): {
  physicalLines: string[];
  logicalLines: string[];
  properties: Record<string, string[]>;
  components: { type: string; properties: Record<string, string[]> }[];
} {
  // Must end with CRLF
  expect(icsText.endsWith("\r\n")).toBe(true);

  // Split into physical lines by CRLF
  const rawLines = icsText.slice(0, -2).split("\r\n");
  for (let i = 0; i < rawLines.length; i++) {
    const bytes = new TextEncoder().encode(rawLines[i]!).length;
    expect(bytes).toBeLessThanOrEqual(75);
    if (i > 0 && rawLines[i]!.startsWith(" ")) {
      // Valid continuation
    } else if (rawLines[i]!.startsWith(" ")) {
      throw new Error("First physical line starts with linear whitespace");
    }
  }

  // Unfold
  const logicalLines: string[] = [];
  let currentLogical = "";
  for (const line of rawLines) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      currentLogical += line.slice(1);
    } else {
      if (currentLogical) logicalLines.push(currentLogical);
      currentLogical = line;
    }
  }
  if (currentLogical) logicalLines.push(currentLogical);

  const properties: Record<string, string[]> = {};
  const components: { type: string; properties: Record<string, string[]> }[] = [];
  let currentComp: { type: string; properties: Record<string, string[]> } | null = null;

  for (const line of logicalLines) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const nameWithParams = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const propName = nameWithParams.split(";")[0]!;

    if (propName === "BEGIN") {
      if (value === "VCALENDAR") {
        // outer container
      } else {
        currentComp = { type: value, properties: {} };
      }
    } else if (propName === "END") {
      if (value === "VCALENDAR") {
        // end outer
      } else if (currentComp) {
        components.push(currentComp);
        currentComp = null;
      }
    } else {
      const target = currentComp ? currentComp.properties : properties;
      if (!target[nameWithParams]) target[nameWithParams] = [];
      target[nameWithParams].push(value);
    }
  }

  return { physicalLines: rawLines, logicalLines, properties, components };
}

describe("calendarExport - Calendar arithmetic & validation", () => {
  it("determines leap years correctly", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2023)).toBe(false);
  });

  it("returns correct days in month", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("validates ISO dates strictly", () => {
    expect(isValidIsoDate("2026-10-24")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false); // not leap year
    expect(isValidIsoDate("2026-04-31")).toBe(false); // April has 30 days
    expect(isValidIsoDate("2026-13-01")).toBe(false); // invalid month
    expect(isValidIsoDate("2026-00-10")).toBe(false);
    expect(isValidIsoDate("invalid")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });

  it("validates clock times strictly", () => {
    expect(isValidClockTime("00:00")).toBe(true);
    expect(isValidClockTime("10:30")).toBe(true);
    expect(isValidClockTime("23:59")).toBe(true);
    expect(isValidClockTime("24:00")).toBe(false);
    expect(isValidClockTime("12:60")).toBe(false);
    expect(isValidClockTime("9:30")).toBe(false);
    expect(isValidClockTime("10:5")).toBe(false);
    expect(isValidClockTime("invalid")).toBe(false);
  });

  it("rolls over next calendar day correctly across month, leap day, and year", () => {
    expect(nextCalendarDay("2026-10-24")).toBe("2026-10-25");
    expect(nextCalendarDay("2026-10-31")).toBe("2026-11-01");
    expect(nextCalendarDay("2024-02-28")).toBe("2024-02-29");
    expect(nextCalendarDay("2024-02-29")).toBe("2024-03-01");
    expect(nextCalendarDay("2023-02-28")).toBe("2023-03-01");
    expect(nextCalendarDay("2026-12-31")).toBe("2027-01-01");
  });
});

describe("calendarExport - Text escaping & line folding", () => {
  it("escapes backslashes, semicolons, commas, and normalizes all newline formats", () => {
    const input = "Backslash \\ and semicolon ; and comma , with\r\nCRLF and \nLF and \rCR";
    const escaped = escapeRfcText(input);
    expect(escaped).toBe("Backslash \\\\ and semicolon \\; and comma \\, with\\nCRLF and \\nLF and \\nCR");
  });

  it("strips harmful control characters", () => {
    const input = "Hello\u0000World\u0007Bell\u001BEscape";
    expect(escapeRfcText(input)).toBe("HelloWorldBellEscape");
  });

  it("folds physical lines at <= 75 octets without splitting multibyte UTF-8 code points", () => {
    // 70 ASCII characters + 4-byte emoji (🛩️) + more text
    const emoji = "🛩️"; // plane emoji
    const longText = "A".repeat(70) + emoji + "B".repeat(20);
    const folded = foldLine(longText);
    const physicalLines = folded.split("\r\n");

    for (const pl of physicalLines) {
      const bytes = new TextEncoder().encode(pl).length;
      expect(bytes).toBeLessThanOrEqual(75);
    }
    // Continuation lines start with space
    expect(physicalLines.length).toBeGreaterThan(1);
    for (let i = 1; i < physicalLines.length; i++) {
      expect(physicalLines[i]!.startsWith(" ")).toBe(true);
    }

    // Unfolded text matches original
    const unfolded = physicalLines
      .map((l, i) => (i === 0 ? l : l.slice(1)))
      .join("");
    expect(unfolded).toBe(longText);
  });
});

describe("calendarExport - Formatter & Conformance", () => {
  it("exports a timed lesson with exact golden fixture", () => {
    const ics = exportCalendarEvent(sampleEvent, { now: fixedNow });
    const parsed = parseIcs(ics);

    // VCALENDAR level properties
    expect(parsed.properties["VERSION"]).toEqual(["2.0"]);
    expect(parsed.properties["PRODID"]).toEqual(["-//Her Flight Deck//Calendar Export//EN"]);
    expect(parsed.properties["CALSCALE"]).toEqual(["GREGORIAN"]);

    // VEVENT
    expect(parsed.components.length).toBe(1);
    const vevent = parsed.components[0]!;
    expect(vevent.type).toBe("VEVENT");
    expect(vevent.properties["UID"]).toEqual(["evt-001@herflightdeck.invalid"]);
    expect(vevent.properties["DTSTAMP"]).toEqual(["20261017T183000Z"]);
    expect(vevent.properties["STATUS"]).toEqual(["CONFIRMED"]);
    expect(vevent.properties["SUMMARY"]).toEqual(["Cross-country navigation"]);
    expect(vevent.properties["DTSTART"]).toEqual(["20261024T100000"]);
    expect(vevent.properties["DTEND"]).toEqual(["20261024T120000"]);
    expect(vevent.properties["LOCATION"]).toEqual(["KSQL (San Carlos Airport)"]);

    // Description verification
    const desc = vevent.properties["DESCRIPTION"]?.[0] ?? "";
    expect(desc).toContain("Flight Lesson");
    expect(desc).toContain("Instructor: Sarah Walker\\, CFI");
    expect(desc).toContain("Prepared with Her Flight Deck — open the lesson in the app for your checklist");
  });

  it("exports start-only event with approved 1-hour duration", () => {
    const event: ScheduleEvent = {
      ...sampleEvent,
      startTime: "14:15",
      endTime: null,
    };
    const ics = exportCalendarEvent(event, { now: fixedNow });
    const parsed = parseIcs(ics);
    const vevent = parsed.components[0]!;

    expect(vevent.properties["DTSTART"]).toEqual(["20261024T141500"]);
    expect(vevent.properties["DTEND"]).toEqual(["20261024T151500"]);
  });

  it("exports all-day event (date only) with exclusive next-day DTEND", () => {
    const event: ScheduleEvent = {
      ...sampleEvent,
      startTime: null,
      endTime: null,
    };
    const ics = exportCalendarEvent(event, { now: fixedNow });
    const parsed = parseIcs(ics);
    const vevent = parsed.components[0]!;

    expect(vevent.properties["DTSTART;VALUE=DATE"]).toEqual(["20261024"]);
    expect(vevent.properties["DTEND;VALUE=DATE"]).toEqual(["20261025"]);
  });

  it("handles default 1-hour rollover at midnight, month end, leap day and year end", () => {
    // Midnight rollover on regular day
    const ev1: ScheduleEvent = { ...sampleEvent, date: "2026-05-15", startTime: "23:00", endTime: null };
    const p1 = parseIcs(exportCalendarEvent(ev1, { now: fixedNow })).components[0]!;
    expect(p1.properties["DTSTART"]).toEqual(["20260515T230000"]);
    expect(p1.properties["DTEND"]).toEqual(["20260516T000000"]);

    // Month end rollover
    const ev2: ScheduleEvent = { ...sampleEvent, date: "2026-10-31", startTime: "23:30", endTime: null };
    const p2 = parseIcs(exportCalendarEvent(ev2, { now: fixedNow })).components[0]!;
    expect(p2.properties["DTSTART"]).toEqual(["20261031T233000"]);
    expect(p2.properties["DTEND"]).toEqual(["20261101T003000"]);

    // Leap day rollover
    const ev3: ScheduleEvent = { ...sampleEvent, date: "2024-02-29", startTime: "23:45", endTime: null };
    const p3 = parseIcs(exportCalendarEvent(ev3, { now: fixedNow })).components[0]!;
    expect(p3.properties["DTSTART"]).toEqual(["20240229T234500"]);
    expect(p3.properties["DTEND"]).toEqual(["20240301T004500"]);

    // Non-leap Feb rollover
    const ev4: ScheduleEvent = { ...sampleEvent, date: "2023-02-28", startTime: "23:00", endTime: null };
    const p4 = parseIcs(exportCalendarEvent(ev4, { now: fixedNow })).components[0]!;
    expect(p4.properties["DTSTART"]).toEqual(["20230228T230000"]);
    expect(p4.properties["DTEND"]).toEqual(["20230301T000000"]);

    // Year end rollover
    const ev5: ScheduleEvent = { ...sampleEvent, date: "2026-12-31", startTime: "23:15", endTime: null };
    const p5 = parseIcs(exportCalendarEvent(ev5, { now: fixedNow })).components[0]!;
    expect(p5.properties["DTSTART"]).toEqual(["20261231T231500"]);
    expect(p5.properties["DTEND"]).toEqual(["20270101T001500"]);
  });

  it("refuses invalid dates, malformed times, end without start, and equal or inverted explicit ranges", () => {
    // Completed event
    expect(() => exportCalendarEvent({ ...sampleEvent, status: "completed" })).toThrow(CalendarExportError);

    // Invalid dates
    expect(() => exportCalendarEvent({ ...sampleEvent, date: "2026-02-29" })).toThrow(CalendarExportError);
    expect(() => exportCalendarEvent({ ...sampleEvent, date: "2026-13-01" })).toThrow(CalendarExportError);
    expect(() => exportCalendarEvent({ ...sampleEvent, date: "2026-04-31" })).toThrow(CalendarExportError);
    expect(() => exportCalendarEvent({ ...sampleEvent, date: "invalid" })).toThrow(CalendarExportError);

    // Malformed clock times
    expect(() => exportCalendarEvent({ ...sampleEvent, startTime: "24:00" })).toThrow(CalendarExportError);
    expect(() => exportCalendarEvent({ ...sampleEvent, startTime: "10:60" })).toThrow(CalendarExportError);
    expect(() => exportCalendarEvent({ ...sampleEvent, startTime: "10:00", endTime: "25:00" })).toThrow(CalendarExportError);
    expect(() => exportCalendarEvent({ ...sampleEvent, startTime: "9:30" })).toThrow(CalendarExportError);

    // End without start
    expect(() => exportCalendarEvent({ ...sampleEvent, startTime: null, endTime: "12:00" })).toThrow(CalendarExportError);

    // Equal explicit end
    expect(() => exportCalendarEvent({ ...sampleEvent, startTime: "10:00", endTime: "10:00" })).toThrow(CalendarExportError);

    // Inverted explicit end
    expect(() => exportCalendarEvent({ ...sampleEvent, startTime: "12:00", endTime: "10:00" })).toThrow(CalendarExportError);
  });

  it("exports status accurately for scheduled, cancelled, and rescheduled", () => {
    const scheduled = exportCalendarEvent({ ...sampleEvent, status: "scheduled" }, { now: fixedNow });
    expect(parseIcs(scheduled).components[0]!.properties["STATUS"]).toEqual(["CONFIRMED"]);

    const cancelled = exportCalendarEvent({ ...sampleEvent, status: "cancelled" }, { now: fixedNow });
    expect(parseIcs(cancelled).components[0]!.properties["STATUS"]).toEqual(["CANCELLED"]);

    const rescheduled = exportCalendarEvent({ ...sampleEvent, status: "rescheduled" }, { now: fixedNow });
    expect(parseIcs(rescheduled).components[0]!.properties["STATUS"]).toEqual(["CANCELLED"]);
  });

  it("omits METHOD, SEQUENCE, ORGANIZER, ATTENDEE, VALARM and RRULE", () => {
    const ics = exportCalendarEvent(sampleEvent, { now: fixedNow });
    expect(ics).not.toContain("METHOD");
    expect(ics).not.toContain("SEQUENCE");
    expect(ics).not.toContain("ORGANIZER");
    expect(ics).not.toContain("ATTENDEE");
    expect(ics).not.toContain("VALARM");
    expect(ics).not.toContain("RRULE");
  });

  it("preserves stable UID and UTC DTSTAMP across exports", () => {
    const ics1 = exportCalendarEvent(sampleEvent, { now: fixedNow });
    const later = new Date("2026-10-17T20:00:00.000Z");
    const ics2 = exportCalendarEvent(sampleEvent, { now: later });

    const p1 = parseIcs(ics1).components[0]!;
    const p2 = parseIcs(ics2).components[0]!;

    expect(p1.properties["UID"]).toEqual(["evt-001@herflightdeck.invalid"]);
    expect(p2.properties["UID"]).toEqual(["evt-001@herflightdeck.invalid"]);
    expect(p1.properties["DTSTAMP"]).toEqual(["20261017T183000Z"]);
    expect(p2.properties["DTSTAMP"]).toEqual(["20261017T200000Z"]);
  });

  it("preserves wall-clock interpretation on DST transition dates without timezone shift", () => {
    // US spring-forward Sunday: 2026-03-08
    const springEvent: ScheduleEvent = {
      ...sampleEvent,
      date: "2026-03-08",
      startTime: "02:30",
      endTime: "03:30",
    };
    const springIcs = exportCalendarEvent(springEvent, { now: fixedNow });
    const springParsed = parseIcs(springIcs).components[0]!;
    expect(springParsed.properties["DTSTART"]).toEqual(["20260308T023000"]);
    expect(springParsed.properties["DTEND"]).toEqual(["20260308T033000"]);

    // US fall-back Sunday: 2026-11-01
    const fallEvent: ScheduleEvent = {
      ...sampleEvent,
      date: "2026-11-01",
      startTime: "01:30",
      endTime: "02:30",
    };
    const fallIcs = exportCalendarEvent(fallEvent, { now: fixedNow });
    const fallParsed = parseIcs(fallIcs).components[0]!;
    expect(fallParsed.properties["DTSTART"]).toEqual(["20261101T013000"]);
    expect(fallParsed.properties["DTEND"]).toEqual(["20261101T023000"]);
  });

  it("prevents property and component injection through user text", () => {
    const maliciousEvent: ScheduleEvent = {
      ...sampleEvent,
      title: "Normal Title\r\nBEGIN:VEVENT\r\nSUMMARY:Injected Event\r\nSTATUS:CONFIRMED",
      location: "Normal Location\nMETHOD:PUBLISH\nORGANIZER:hacker@evil.com",
      instructor: "Instructor\rSEQUENCE:999",
    };
    const ics = exportCalendarEvent(maliciousEvent, { now: fixedNow });
    const parsed = parseIcs(ics);

    // Exactly one VEVENT component exists!
    expect(parsed.components.length).toBe(1);
    expect(parsed.components[0]!.type).toBe("VEVENT");

    // Injected text was escaped, not parsed as independent properties
    expect(ics).not.toContain("\r\nBEGIN:VEVENT\r\nSUMMARY:Injected");
    expect(ics).not.toContain("\r\nMETHOD:PUBLISH");
    expect(ics).not.toContain("\r\nSEQUENCE:999");
  });

  it("proves exclusion of lesson notes, finances, and unticked checklist with sentinels", () => {
    const sentinelNotes = "SENTINEL_SECRET_LESSON_NOTES_12345";
    const sentinelPrepItem = "SENTINEL_PREP_ITEM_TITLE_67890";

    const eventWithNotes: ScheduleEvent = {
      ...sampleEvent,
      notes: sentinelNotes,
    };

    // When checklist is NOT selected:
    const icsWithoutChecklist = exportCalendarEvent(eventWithNotes, {
      includeChecklist: false,
      prepItemTitles: [sentinelPrepItem],
      now: fixedNow,
    });
    expect(icsWithoutChecklist).not.toContain(sentinelNotes);
    expect(icsWithoutChecklist).not.toContain(sentinelPrepItem);
    expect(icsWithoutChecklist).not.toContain("Preparation checklist:");

    // When checklist IS selected:
    const icsWithChecklist = exportCalendarEvent(eventWithNotes, {
      includeChecklist: true,
      prepItemTitles: [sentinelPrepItem],
      now: fixedNow,
    });
    expect(icsWithChecklist).not.toContain(sentinelNotes);
    expect(icsWithChecklist).toContain(sentinelPrepItem);
    const parsedWithChecklist = parseIcs(icsWithChecklist);
    const desc = parsedWithChecklist.components[0]!.properties["DESCRIPTION"]?.[0] ?? "";
    expect(desc).toContain("Preparation checklist:");
    expect(desc).toContain(sentinelPrepItem);
  });

  it("suggests a sanitized file name with .ics extension", () => {
    expect(calendarFileName(sampleEvent)).toBe("Lesson 2026-10-24 Cross-country navigation.ics");

    const specialEvent: ScheduleEvent = {
      ...sampleEvent,
      title: "Night cross-country: Bay Tour / Class B",
    };
    expect(calendarFileName(specialEvent)).toBe("Lesson 2026-10-24 Night cross-country Bay Tour Class B.ics");
  });
});
