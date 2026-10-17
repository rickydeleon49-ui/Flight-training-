/**
 * The lesson brief (P54-05 part A): what each section shows, which follow-ups
 * are offered, and — through unique sentinel strings — that nothing private
 * or unticked ever reaches the printed page.
 */
import { describe, expect, it } from "vitest";

import { lessonPreparation } from "@/logic/preparation";
import { makeEvent, makeJournalEntry, makeMaterial, makePrepItem, makeQuestion, makeTransaction } from "@/testing/factories";

import { briefFileName, buildBriefHtml, lessonBrief, type BriefSources } from "./lessonBrief";

const NOW = new Date("2026-10-17T12:00:00Z");

const lesson = makeEvent({
  id: "lesson",
  title: "Pattern work",
  eventType: "flight_lesson",
  date: "2026-10-24",
  startTime: "09:00",
  endTime: "10:30",
  location: "KPAO",
  instructor: "Sam",
  goalId: "goal",
  notes: "SENTINEL_LESSON_NOTES",
  materialIds: ["m-chart", "m-gone", "m-phak"],
});

function sources(overrides: Partial<BriefSources> = {}): BriefSources {
  return { events: [lesson], prepItems: [], questions: [], materials: [], journalEntries: [], ...overrides };
}

describe("lesson brief sections", () => {
  it("shows the lesson's details as stored, with the year always printed", () => {
    const brief = lessonBrief(lesson, sources());
    expect(brief.title).toBe("Pattern work");
    expect(brief.facts).toEqual([
      { label: "Type", value: "Flight Lesson" },
      { label: "Date", value: "Saturday, October 24, 2026" },
      { label: "Time", value: "9:00 AM–10:30 AM" },
      { label: "Location", value: "KPAO" },
      { label: "Instructor", value: "Sam" },
    ]);
  });

  it("names a status only when it is not scheduled, and omits empty details", () => {
    const bare = makeEvent({ title: "Ground", eventType: "ground_school", startTime: null, endTime: null, location: " ", instructor: "", status: "cancelled" });
    expect(lessonBrief(bare, sources({ events: [bare] })).facts.map((fact) => fact.label)).toEqual(["Type", "Date", "Status"]);
    expect(lessonBrief(bare, sources({ events: [bare] })).facts.at(-1)).toEqual({ label: "Status", value: "Cancelled" });
    const startOnly = makeEvent({ startTime: "14:00", endTime: null });
    expect(lessonBrief(startOnly, sources({ events: [startOnly] })).facts.find((f) => f.label === "Time")?.value).toBe("2:00 PM");
  });

  it("uses exactly the lesson screen's readiness: same lines, same done state, same count", () => {
    const prepItems = [
      makePrepItem({ eventId: "lesson", title: "Review pattern entry", done: true, position: 0 }),
      makePrepItem({ eventId: "lesson", title: "Check weather", done: false, position: 1 }),
      makePrepItem({ eventId: "other", title: "SENTINEL_OTHER_PREP", done: false }),
    ];
    const questions = [
      makeQuestion({ eventId: "lesson", text: "Crosswind limits?", status: "asked" }),
      makeQuestion({ eventId: "lesson", text: "Go-around callout?", status: "to_ask" }),
    ];
    const brief = lessonBrief(lesson, sources({ prepItems, questions }));
    const screen = lessonPreparation(lesson, { prepItems, questions });
    expect(brief.preparation).toEqual(screen.lines);
    expect(brief.completed).toBe(screen.completed);

    const html = buildBriefHtml(brief, new Set(), NOW);
    expect(html).toContain("2 of 4 ready");
    expect(html).toContain("<strong>Done:</strong> Review pattern entry");
    expect(html).toContain("<strong>To do:</strong> Check weather");
    expect(html).toContain("<strong>Done:</strong> Ask: Crosswind limits?");
    expect(html).toContain("<strong>To do:</strong> Ask: Go-around callout?");
    expect(html).not.toContain("SENTINEL_OTHER_PREP");
    expect(html.slice(html.indexOf("<body>"))).not.toMatch(/\d+\s*%/);
  });

  it("lists attached reading by title, type and topic, in attachment order, skipping deleted materials", () => {
    const materials = [
      makeMaterial({ id: "m-phak", title: "PHAK ch. 14", materialType: "reference", topic: "airports", notes: "SENTINEL_MATERIAL_NOTES", filePath: "SENTINEL_PATH/phak.pdf" }),
      makeMaterial({ id: "m-chart", title: "Pattern diagram", materialType: "instructor_handout", topic: "landings" }),
      makeMaterial({ id: "m-other", title: "SENTINEL_UNATTACHED" }),
    ];
    const brief = lessonBrief(lesson, sources({ materials }));
    expect(brief.materials).toEqual([
      { title: "Pattern diagram", type: "Instructor Handout", topic: "Landings" },
      { title: "PHAK ch. 14", type: "Reference", topic: "Airports" },
    ]);
    const html = buildBriefHtml(brief, new Set(), NOW);
    for (const sentinel of ["SENTINEL_MATERIAL_NOTES", "SENTINEL_PATH", "SENTINEL_UNATTACHED"]) expect(html).not.toContain(sentinel);
  });

  it("says plainly when there is nothing to prepare or read, and omits an empty follow-up section", () => {
    const html = buildBriefHtml(lessonBrief(lesson, sources()), new Set(), NOW);
    expect(html).toContain("Nothing to prepare is listed for this lesson.");
    expect(html).toContain("No reading is attached to this lesson.");
    expect(html).not.toContain("<h2>Follow-ups</h2>");
  });
});

describe("follow-up candidates", () => {
  const entries = [
    makeJournalEntry({ id: "j-old", date: "2026-10-10", questionsForNextTime: "SENTINEL_OLDER_ENTRY" }),
    makeJournalEntry({ id: "j-early", date: "2026-10-17", createdAt: "2026-10-17T08:00:00Z", questionsForNextTime: "SENTINEL_SAME_DAY_EARLIER" }),
    makeJournalEntry({
      id: "j-new",
      date: "2026-10-17",
      createdAt: "2026-10-17T18:00:00Z",
      questionsForNextTime: "  Ask about crab vs slip  \n\nGo-around callout?\r\nFlap settings for short field",
      wentWell: "SENTINEL_WENT_WELL",
      wasDifficult: "SENTINEL_DIFFICULT",
      instructorFeedback: "SENTINEL_FEEDBACK",
    }),
    makeJournalEntry({ id: "j-same-lesson", eventId: "lesson", date: "2026-10-20", questionsForNextTime: "SENTINEL_THIS_LESSONS_ENTRY" }),
    makeJournalEntry({ id: "j-later", date: "2026-10-30", questionsForNextTime: "SENTINEL_LATER_ENTRY" }),
  ];

  it("offers the newest earlier journal entry's lines, trimmed, without blanks, in her wording", () => {
    const brief = lessonBrief(lesson, sources({ journalEntries: entries }));
    expect(brief.followUps.map((c) => c.text)).toEqual(["Ask about crab vs slip", "Go-around callout?", "Flap settings for short field"]);
    expect(brief.followUps[0]).toMatchObject({ id: "journal:j-new:0", from: "Journal, Saturday, October 17, 2026" });
  });

  it("offers open questions from this goal's other lessons and materials, oldest first, never answered ones", () => {
    const events = [lesson, makeEvent({ id: "goal-lesson", goalId: "goal", title: "Slow flight" }), makeEvent({ id: "other-goal", goalId: "elsewhere", title: "X" })];
    const materials = [makeMaterial({ id: "goal-material", goalId: "goal", title: "Pattern notes" })];
    const questions = [
      makeQuestion({ id: "q2", eventId: "goal-lesson", text: "Stall horn timing?", status: "revisit", createdAt: "2026-10-02T00:00:00Z" }),
      makeQuestion({ id: "q1", materialId: "goal-material", text: "Why 45° entry?", status: "to_ask", createdAt: "2026-10-01T00:00:00Z" }),
      makeQuestion({ eventId: "goal-lesson", text: "SENTINEL_ANSWERED", status: "answered" }),
      makeQuestion({ eventId: "goal-lesson", text: "SENTINEL_ASKED", status: "asked" }),
      makeQuestion({ eventId: "other-goal", text: "SENTINEL_OTHER_GOAL", status: "to_ask" }),
      makeQuestion({ text: "SENTINEL_UNLINKED", status: "to_ask" }),
    ];
    const brief = lessonBrief(lesson, sources({ events, materials, questions }));
    expect(brief.followUps).toEqual([
      { id: "question:q1", text: "Why 45° entry?", from: "Question about “Pattern notes”" },
      { id: "question:q2", text: "Stall horn timing?", from: "Question saved for “Slow flight”" },
    ]);
  });

  it("offers a repeated wording once and never repeats this lesson's own questions", () => {
    const events = [lesson, makeEvent({ id: "goal-lesson", goalId: "goal", title: "Slow flight" })];
    const questions = [
      makeQuestion({ eventId: "lesson", text: "go-around   CALLOUT?", status: "to_ask" }),
      makeQuestion({ eventId: "goal-lesson", text: "Ask about crab vs slip", status: "to_ask" }),
    ];
    const brief = lessonBrief(lesson, sources({ events, questions, journalEntries: entries }));
    expect(brief.followUps.map((c) => c.id)).toEqual(["journal:j-new:0", "journal:j-new:2"]);
  });

  it("offers no goal questions to a lesson without a goal", () => {
    const loose = makeEvent({ ...lesson, goalId: null });
    const events = [loose, makeEvent({ id: "goal-lesson", goalId: null })];
    const questions = [makeQuestion({ eventId: "goal-lesson", text: "SENTINEL_NO_GOAL", status: "to_ask" })];
    expect(lessonBrief(loose, sources({ events, questions })).followUps).toEqual([]);
  });

  it("prints only ticked follow-ups, and nothing else from the journal, finances or other lessons", () => {
    const transactions = [makeTransaction({ eventId: "lesson", description: "SENTINEL_FINANCE" })];
    const brief = lessonBrief(lesson, { ...sources({ journalEntries: entries }), ...{ transactions } } as BriefSources);
    const html = buildBriefHtml(brief, new Set(["journal:j-new:1"]), NOW);
    expect(html).toContain("<h2>Follow-ups</h2>");
    expect(html).toContain("Go-around callout?");
    expect(html).not.toContain("Ask about crab vs slip");
    expect(html).not.toContain("Flap settings for short field");
    for (const sentinel of [
      "SENTINEL_LESSON_NOTES",
      "SENTINEL_WENT_WELL",
      "SENTINEL_DIFFICULT",
      "SENTINEL_FEEDBACK",
      "SENTINEL_FINANCE",
      "SENTINEL_OLDER_ENTRY",
      "SENTINEL_SAME_DAY_EARLIER",
      "SENTINEL_THIS_LESSONS_ENTRY",
      "SENTINEL_LATER_ENTRY",
    ]) {
      expect(html).not.toContain(sentinel);
    }
  });
});

describe("the printed page", () => {
  it("escapes hostile text, keeps Unicode, and can load or run nothing", () => {
    const hostile = makeEvent({
      ...lesson,
      title: `<script>alert(1)</script> Ünïcødé ✈️ "quotes" & 'apostrophes'`,
      location: `<img src=x onerror=alert(2)>`,
      instructor: `<a href="https://example.com">x</a>`,
    });
    const prepItems = [makePrepItem({ eventId: "lesson", title: "</li><iframe src=//evil>" })];
    const journalEntries = [makeJournalEntry({ date: "2026-10-01", questionsForNextTime: "<style>body{display:none}</style>" })];
    const brief = lessonBrief(hostile, sources({ events: [hostile], prepItems, journalEntries }));
    const html = buildBriefHtml(brief, new Set(brief.followUps.map((c) => c.id)), NOW);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Ünïcødé ✈️ &quot;quotes&quot; &amp; &#39;apostrophes&#39;");
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
    // Every real tag in the body is one of the page's own; hostile markup is only text.
    const body = html.slice(html.indexOf("<body>"));
    const tags = new Set([...body.matchAll(/<\/?([a-z][a-z0-9]*)/gi)].map((match) => (match[1] ?? "").toLowerCase()));
    const allowed = new Set(["body", "html", "header", "h1", "h2", "p", "table", "tbody", "tr", "th", "td", "section", "ul", "li", "strong", "span", "br"]);
    expect([...tags].filter((tag) => !allowed.has(tag))).toEqual([]);
    expect(html.match(/<style>/g)).toHaveLength(1);
  });

  it("suggests a plain file name for the lesson", () => {
    expect(briefFileName(makeEvent({ date: "2026-10-24", title: "Pattern / work: day 3" }))).toBe("Lesson brief 2026-10-24 Pattern work day 3.html");
  });
});
