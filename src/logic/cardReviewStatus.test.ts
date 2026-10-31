import { describe, expect, it } from "vitest";

import { nextSessionSize, reviewButtonLabel, reviewStatusLine } from "./cardReviewStatus";

describe("card review wording", () => {
  it("20 new cards and none due: the heading and button agree on 10 at a time", () => {
    expect(reviewStatusLine(0, 20)).toBe("20 new cards — 10 at a time");
    expect(reviewButtonLabel(0, 20)).toBe("Start 10 new cards");
    expect(reviewStatusLine(0, 20)).not.toContain("none due");
  });

  it("a few new cards start all of them", () => {
    expect(reviewStatusLine(0, 3)).toBe("3 new cards");
    expect(reviewButtonLabel(0, 3)).toBe("Start 3 new cards");
    expect(reviewButtonLabel(0, 1)).toBe("Start 1 new card");
  });

  it("due cards come first and new ones fill the session up to 20", () => {
    expect(reviewStatusLine(3, 0)).toBe("3 cards due");
    expect(reviewButtonLabel(3, 0)).toBe("Review 3 cards");
    expect(reviewStatusLine(1, 1)).toBe("1 new card · 1 card due");
    expect(reviewButtonLabel(3, 20)).toBe("Review 13 cards");
    expect(nextSessionSize(15, 20)).toEqual({ due: 15, fresh: 5 });
    expect(nextSessionSize(25, 20)).toEqual({ due: 20, fresh: 0 });
    expect(reviewButtonLabel(25, 20)).toBe("Review 20 cards");
  });
});
