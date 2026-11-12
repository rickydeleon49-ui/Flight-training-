// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { getFourRatingButtons, ratingLabels, ratingOrder, setFourRatingButtons } from "./ratingButtons";

describe("rating buttons preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to two buttons and Got it is the Good rating", () => {
    expect(getFourRatingButtons()).toBe(false);
    expect(ratingOrder(false)).toEqual(["again", "good"]);
    expect(ratingLabels(false).good).toBe("Got it");
  });

  it("shows four buttons when switched on and remembers it", () => {
    setFourRatingButtons(true);
    expect(getFourRatingButtons()).toBe(true);
    expect(ratingOrder(true)).toEqual(["again", "hard", "good", "easy"]);
    expect(ratingLabels(true).good).toBe("Good");
  });
});
