import type { CardRating } from "@/domain/types";
import { readRemembered, writeRemembered } from "@/state/useRememberedState";

/**
 * Flashcards ask Again / Got it by default. "Got it" records the same rating
 * as Good, so the scheduler is unchanged. The student can switch on the
 * four-button row (Again / Hard / Good / Easy) in Settings.
 *
 * Kept on this device in localStorage (no database migration), like the
 * other small UI preferences.
 */
export const FOUR_RATING_BUTTONS_KEY = "four-rating-buttons";

const isBool = (value: unknown): value is boolean => typeof value === "boolean";

export function getFourRatingButtons(): boolean {
  return readRemembered(FOUR_RATING_BUTTONS_KEY, false, isBool, "device");
}

export function setFourRatingButtons(on: boolean): void {
  writeRemembered(FOUR_RATING_BUTTONS_KEY, on, "device");
}

export const FOUR_RATINGS: CardRating[] = ["again", "hard", "good", "easy"];
export const TWO_RATINGS: CardRating[] = ["again", "good"];

export function ratingOrder(four: boolean): CardRating[] {
  return four ? FOUR_RATINGS : TWO_RATINGS;
}

export function ratingLabels(four: boolean): Record<CardRating, string> {
  return { again: "Again", hard: "Hard", good: four ? "Good" : "Got it", easy: "Easy" };
}
