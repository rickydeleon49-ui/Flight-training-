import { describe, expect, it } from "vitest";

import { toEnum } from "@/data/db";
import {
  GOAL_STATUS_LABELS,
  GOAL_STATUS_OPTIONS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_OPTIONS,
  type GoalStatus,
  type ReviewStatus,
} from "./types";

describe("plain status labels (POLISH-065)", () => {
  it("shows plain words while the stored values stay the same", () => {
    expect(GOAL_STATUS_LABELS.working_on).toBe("In progress");
    expect(REVIEW_STATUS_LABELS.needs_review).toBe("Review again");
    expect(GOAL_STATUS_OPTIONS.find((o) => o.value === "working_on")?.label).toBe("In progress");
    expect(REVIEW_STATUS_OPTIONS.find((o) => o.value === "needs_review")?.label).toBe("Review again");
    expect(Object.keys(GOAL_STATUS_LABELS)).toEqual(["not_started", "working_on", "comfortable", "completed", "paused"]);
    expect(Object.keys(REVIEW_STATUS_LABELS)).toEqual(["needs_review", "studying", "confident", "reference_only"]);
    // Stored rows still read back as the same values.
    expect(toEnum<GoalStatus>("working_on", GOAL_STATUS_LABELS, "not_started")).toBe("working_on");
    expect(toEnum<ReviewStatus>("needs_review", REVIEW_STATUS_LABELS, "studying")).toBe("needs_review");
  });
});
