import { expect, it } from "vitest";

import { dueLine } from "./StudyLibraryReviewDue";

it("says how many cards are ready, so phones show it above the list", () => {
  const rows = [
    { againCount: 1, dayCount: 2, newCount: 0 },
    { againCount: 0, dayCount: 0, newCount: 4 },
  ];
  expect(dueLine(rows)).toBe("7 cards ready in 2 materials");
  expect(dueLine(rows, false)).toBe("7 cards ready in 2 materials so far");
  expect(dueLine([{ againCount: 0, dayCount: 1, newCount: 0 }])).toBe("1 card ready in 1 material");
});
