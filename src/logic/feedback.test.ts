import { describe, expect, it } from "vitest";

import { makeEvent, makeGoal, makeJournalEntry } from "@/testing/factories";
import { collectFeedback, goalsWithFeedback } from "./feedback";

describe("collectFeedback", () => {
  it("gathers feedback from every entry that has some, newest first", () => {
    const notes = collectFeedback(
      [
        makeJournalEntry({ date: "2026-08-01", instructorFeedback: "Earlier note." }),
        makeJournalEntry({ date: "2026-09-01", instructorFeedback: "Later note." }),
      ],
      [],
      [],
    );

    expect(notes.map((n) => n.text)).toEqual(["Later note.", "Earlier note."]);
  });

  it("skips entries with no feedback, including whitespace-only", () => {
    const notes = collectFeedback(
      [
        makeJournalEntry({ instructorFeedback: "" }),
        makeJournalEntry({ instructorFeedback: "   " }),
        makeJournalEntry({ instructorFeedback: "Real feedback." }),
      ],
      [],
      [],
    );
    expect(notes).toHaveLength(1);
  });

  it("carries the lesson and goal through for context", () => {
    const goal = makeGoal({ id: "goal-1", title: "Flare timing" });
    const event = makeEvent({ id: "event-1", title: "Traffic Pattern Practice" });
    const notes = collectFeedback(
      [
        makeJournalEntry({
          eventId: "event-1",
          goalId: "goal-1",
          title: "",
          instructorFeedback: "Look further down the runway.",
          confidence: 3,
        }),
      ],
      [event],
      [goal],
    );

    const note = notes[0];
    expect(note?.goalTitle).toBe("Flare timing");
    // With no entry title of its own, it falls back to the lesson's name.
    expect(note?.title).toBe("Traffic Pattern Practice");
    expect(note?.confidence).toBe(3);
  });

  it("handles an entry whose lesson or goal has since been deleted", () => {
    const notes = collectFeedback(
      [makeJournalEntry({ eventId: "gone", goalId: "gone", instructorFeedback: "Still here." })],
      [],
      [],
    );
    expect(notes[0]?.goalTitle).toBeNull();
    expect(notes[0]?.title).toBe("Lesson debrief");
  });
});

describe("goalsWithFeedback", () => {
  it("lists each goal once, ignoring feedback with no goal", () => {
    const goals = [makeGoal({ id: "g1", title: "Crosswind" }), makeGoal({ id: "g2", title: "Flare" })];
    const notes = collectFeedback(
      [
        makeJournalEntry({ goalId: "g1", instructorFeedback: "a" }),
        makeJournalEntry({ goalId: "g1", instructorFeedback: "b" }),
        makeJournalEntry({ goalId: "g2", instructorFeedback: "c" }),
        makeJournalEntry({ goalId: null, instructorFeedback: "d" }),
      ],
      [],
      goals,
    );

    expect(goalsWithFeedback(notes)).toEqual([
      { id: "g1", title: "Crosswind" },
      { id: "g2", title: "Flare" },
    ]);
  });
});
