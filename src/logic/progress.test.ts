import { describe, expect, it } from "vitest";

import {
  makeChecklistItem,
  makeEvent,
  makeGoal,
  makeJournalEntry,
  makeMaterial,
  makeMilestone,
} from "@/testing/factories";
import {
  currentMilestone,
  goalEvidence,
  hasEvidence,
  milestoneProgress,
  reorderMilestones,
  studyFocus,
} from "./progress";

describe("goalEvidence", () => {
  const goal = makeGoal({ id: "goal-1", confidence: 3 });

  it("counts what actually happened rather than estimating completion", () => {
    const evidence = goalEvidence(goal, {
      journalEntries: [
        makeJournalEntry({ goalId: "goal-1", date: "2026-08-20" }),
        makeJournalEntry({ goalId: "goal-1", date: "2026-09-01" }),
        makeJournalEntry({ goalId: "other" }),
      ],
      materials: [
        makeMaterial({ goalId: "goal-1", reviewStatus: "confident" }),
        makeMaterial({ goalId: "goal-1", reviewStatus: "needs_review" }),
      ],
      checklistItems: [
        makeChecklistItem({ goalId: "goal-1", done: true }),
        makeChecklistItem({ goalId: "goal-1", done: false }),
      ],
      events: [
        makeEvent({ goalId: "goal-1", status: "completed", date: "2026-08-15" }),
        makeEvent({ goalId: "goal-1", status: "scheduled", date: "2026-09-20" }),
      ],
    });

    expect(evidence.lessonsRecorded).toBe(1);
    expect(evidence.journalEntries).toBe(2);
    expect(evidence.materialsReviewed).toBe(1);
    expect(evidence.materialsTotal).toBe(2);
    expect(evidence.checklistDone).toBe(1);
    expect(evidence.checklistTotal).toBe(2);
    expect(evidence.confidence).toBe(3);
  });

  it("reports the most recent practice date across lessons and journal entries", () => {
    const evidence = goalEvidence(goal, {
      journalEntries: [makeJournalEntry({ goalId: "goal-1", date: "2026-09-01" })],
      materials: [],
      checklistItems: [],
      events: [makeEvent({ goalId: "goal-1", status: "completed", date: "2026-08-15" })],
    });
    expect(evidence.lastPracticed).toBe("2026-09-01");
  });

  it("reports nothing at all for an untouched goal", () => {
    const evidence = goalEvidence(makeGoal({ confidence: null }), {
      journalEntries: [], materials: [], checklistItems: [], events: [],
    });
    expect(hasEvidence(evidence)).toBe(false);
    expect(evidence.lastPracticed).toBeNull();
  });
});

describe("milestoneProgress", () => {
  it("counts goals by status instead of producing a percentage", () => {
    const milestone = makeMilestone({ id: "m1" });
    const progress = milestoneProgress(milestone, [
      makeGoal({ milestoneId: "m1", status: "completed" }),
      makeGoal({ milestoneId: "m1", status: "comfortable" }),
      makeGoal({ milestoneId: "m1", status: "working_on" }),
      makeGoal({ milestoneId: "m1", status: "not_started" }),
      makeGoal({ milestoneId: "other", status: "completed" }),
    ]);

    expect(progress.total).toBe(4);
    expect(progress.counts.completed).toBe(1);
    expect(progress.counts.working_on).toBe(1);
    // "Completed" for the dashboard means finished or comfortable.
    expect(progress.completed).toHaveLength(2);
    expect(progress.workingOn).toHaveLength(1);
  });
});

describe("currentMilestone", () => {
  const first = makeMilestone({ id: "m1", status: "completed" });
  const second = makeMilestone({ id: "m2", status: "in_progress" });
  const third = makeMilestone({ id: "m3", status: "not_started" });

  it("honours an explicit choice", () => {
    expect(currentMilestone([first, second, third], "m3")?.id).toBe("m3");
  });

  it("falls back to the one in progress", () => {
    expect(currentMilestone([first, second, third], null)?.id).toBe("m2");
  });

  it("falls back again to the first unfinished milestone", () => {
    expect(currentMilestone([first, third], null)?.id).toBe("m3");
  });

  it("ignores a stale id that no longer exists", () => {
    expect(currentMilestone([first, second], "deleted")?.id).toBe("m2");
  });
});

describe("studyFocus", () => {
  it("prefers Next Up material", () => {
    const nextUp = makeMaterial({ id: "next", priority: "next_up" });
    const later = makeMaterial({ id: "later", priority: "later" });
    expect(studyFocus([later, nextUp])?.id).toBe("next");
  });

  it("prefers material being studied when priorities match", () => {
    const studying = makeMaterial({ id: "studying", reviewStatus: "studying" });
    const confident = makeMaterial({ id: "confident", reviewStatus: "confident" });
    expect(studyFocus([confident, studying])?.id).toBe("studying");
  });

  it("skips reference-only material", () => {
    expect(studyFocus([makeMaterial({ reviewStatus: "reference_only" })])).toBeNull();
  });
});

describe("reorderMilestones", () => {
  const path = [
    makeMilestone({ id: "a", position: 0, title: "Explore" }),
    makeMilestone({ id: "b", position: 1, title: "Ground school" }),
    makeMilestone({ id: "c", position: 2, title: "Lessons" }),
  ];

  const applied = (updates: Array<{ id: string; position: number }>) => {
    const next = path.map((m) => ({
      ...m,
      position: updates.find((u) => u.id === m.id)?.position ?? m.position,
    }));
    return next.sort((x, y) => x.position - y.position).map((m) => m.id);
  };

  it("moves a milestone one place earlier", () => {
    expect(applied(reorderMilestones(path, "c", "up"))).toEqual(["a", "c", "b"]);
  });

  it("moves a milestone one place later", () => {
    expect(applied(reorderMilestones(path, "a", "down"))).toEqual(["b", "a", "c"]);
  });

  it("does nothing at the ends of the journey", () => {
    expect(reorderMilestones(path, "a", "up")).toEqual([]);
    expect(reorderMilestones(path, "c", "down")).toEqual([]);
  });

  it("ignores a milestone that is not there", () => {
    expect(reorderMilestones(path, "missing", "up")).toEqual([]);
  });

  it("settles a list whose positions have all drifted to the same value", () => {
    // Everything added with position 0 still has a stable created-at order.
    const drifted = [
      makeMilestone({ id: "x", position: 0, createdAt: "2026-01-01T00:00:00.000Z" }),
      makeMilestone({ id: "y", position: 0, createdAt: "2026-01-02T00:00:00.000Z" }),
      makeMilestone({ id: "z", position: 0, createdAt: "2026-01-03T00:00:00.000Z" }),
    ];
    const updates = reorderMilestones(drifted, "z", "up");
    const next = drifted
      .map((m) => ({ ...m, position: updates.find((u) => u.id === m.id)?.position ?? m.position }))
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
      .map((m) => m.id);
    expect(next).toEqual(["x", "z", "y"]);
  });
});
