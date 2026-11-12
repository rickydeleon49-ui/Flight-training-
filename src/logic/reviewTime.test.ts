import { describe, expect, it } from "vitest";

import { estimateReviewMinutes } from "./reviewTime";

describe("estimateReviewMinutes", () => {
  it("is at least one minute", () => {
    expect(estimateReviewMinutes(0)).toBe(1);
    expect(estimateReviewMinutes(1)).toBe(1);
    expect(estimateReviewMinutes(6)).toBe(1);
  });
  it("rounds up at about 10 seconds a card", () => {
    expect(estimateReviewMinutes(7)).toBe(2);
    expect(estimateReviewMinutes(18)).toBe(3);
    expect(estimateReviewMinutes(60)).toBe(10);
  });
});
