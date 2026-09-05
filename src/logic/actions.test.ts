import { describe, expect, it } from "vitest";

import { makeAction } from "@/testing/factories";
import {
  actionsFor,
  byDueDate,
  completionChanges,
  groupByCategory,
  isDueToday,
  isOverdue,
  mostImportantAction,
  overdueActions,
  planActions,
  reopenChanges,
  rescheduleChanges,
} from "./actions";

const TODAY = "2026-09-05";

describe("overdue detection", () => {
  it("treats an open action past its due date as overdue", () => {
    expect(isOverdue(makeAction({ dueDate: "2026-09-03" }), TODAY)).toBe(true);
  });

  it("does not treat work due today as overdue", () => {
    const action = makeAction({ dueDate: TODAY });
    expect(isOverdue(action, TODAY)).toBe(false);
    expect(isDueToday(action, TODAY)).toBe(true);
  });

  it("never marks an undated action overdue", () => {
    // Nothing becomes overdue merely because it has no date.
    expect(isOverdue(makeAction({ dueDate: null }), TODAY)).toBe(false);
  });

  it("ignores completed work when finding overdue items", () => {
    const done = makeAction({
      dueDate: "2026-09-01",
      status: "completed",
      completedAt: "2026-09-02T10:00:00.000Z",
    });
    expect(isOverdue(done, TODAY)).toBe(false);
    expect(overdueActions([done], TODAY)).toHaveLength(0);
  });

  it("returns overdue work oldest first", () => {
    const list = overdueActions(
      [
        makeAction({ title: "newer", dueDate: "2026-09-04" }),
        makeAction({ title: "older", dueDate: "2026-09-01" }),
      ],
      TODAY,
    );
    expect(list.map((a) => a.title)).toEqual(["older", "newer"]);
  });
});

describe("today's plan", () => {
  it("includes work due today and undated work", () => {
    const plan = planActions(
      [
        makeAction({ title: "today", dueDate: TODAY }),
        makeAction({ title: "undated", dueDate: null }),
        makeAction({ title: "later", dueDate: "2026-09-20" }),
      ],
      TODAY,
    );
    expect(plan.map((a) => a.title).sort()).toEqual(["today", "undated"]);
  });

  it("leaves overdue work to Needs Attention so nothing is listed twice", () => {
    const overdue = makeAction({ title: "overdue", dueDate: "2026-09-01" });
    expect(planActions([overdue], TODAY)).toHaveLength(0);
    expect(overdueActions([overdue], TODAY)).toHaveLength(1);
  });

  it("leaves completed work off the plan", () => {
    const plan = planActions(
      [makeAction({ dueDate: TODAY, status: "completed" }), makeAction({ dueDate: TODAY })],
      TODAY,
    );
    expect(plan).toHaveLength(1);
  });

  it("groups into the product's four sections in a fixed order", () => {
    const groups = groupByCategory([
      makeAction({ category: "stretch" }),
      makeAction({ category: "non_negotiable" }),
      makeAction({ category: "life_admin" }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["non_negotiable", "life_admin", "stretch"]);
  });

  it("omits sections that have nothing in them", () => {
    const groups = groupByCategory([makeAction({ category: "prepare" })]);
    expect(groups).toHaveLength(1);
  });
});

describe("sorting", () => {
  it("puts dated work ahead of undated work", () => {
    const dated = makeAction({ dueDate: "2026-09-09" });
    const undated = makeAction({ dueDate: null });
    expect([undated, dated].sort(byDueDate)[0]).toBe(dated);
  });

  it("falls back to priority when neither is dated", () => {
    const later = makeAction({ dueDate: null, priority: "later" });
    const nextUp = makeAction({ dueDate: null, priority: "next_up" });
    expect([later, nextUp].sort(byDueDate)[0]).toBe(nextUp);
  });
});

describe("mostImportantAction", () => {
  it("surfaces overdue work before anything else", () => {
    const overdue = makeAction({ title: "overdue", dueDate: "2026-09-01", category: "life_admin" });
    const today = makeAction({ title: "today", dueDate: TODAY, category: "non_negotiable" });
    expect(mostImportantAction([today, overdue], TODAY)?.title).toBe("overdue");
  });

  it("prefers a non-negotiable when nothing is overdue", () => {
    const stretch = makeAction({ title: "stretch", category: "stretch", dueDate: TODAY });
    const must = makeAction({ title: "must", category: "non_negotiable", dueDate: TODAY });
    expect(mostImportantAction([stretch, must], TODAY)?.title).toBe("must");
  });

  it("returns null rather than inventing work when nothing is waiting", () => {
    expect(mostImportantAction([], TODAY)).toBeNull();
    expect(mostImportantAction([makeAction({ status: "completed" })], TODAY)).toBeNull();
  });
});

describe("completing and rescheduling", () => {
  it("stamps the completion time", () => {
    const changes = completionChanges("2026-09-05T14:00:00.000Z");
    expect(changes.status).toBe("completed");
    expect(changes.completedAt).toBe("2026-09-05T14:00:00.000Z");
  });

  it("clears the stamp when reopened", () => {
    expect(reopenChanges()).toEqual({ status: "open", completedAt: null });
  });

  it("rescheduling moves the date and keeps the action open", () => {
    // Missing a day must never destroy the work — it gets a new date.
    const changes = rescheduleChanges("2026-09-08");
    expect(changes).toEqual({ dueDate: "2026-09-08", status: "open", completedAt: null });
  });
});

describe("relationships", () => {
  it("finds the actions attached to a given entity", () => {
    const forGoal = makeAction({ relatedType: "goal", relatedId: "goal-1" });
    const forOther = makeAction({ relatedType: "goal", relatedId: "goal-2" });
    const forMaterial = makeAction({ relatedType: "material", relatedId: "goal-1" });
    const found = actionsFor([forGoal, forOther, forMaterial], "goal", "goal-1");
    expect(found).toEqual([forGoal]);
  });
});
