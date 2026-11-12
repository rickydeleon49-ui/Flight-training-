/** A plain time guess for a stack of due cards: about 10 seconds each, whole minutes, at least 1. */
const SECONDS_PER_CARD = 10;

export function estimateReviewMinutes(dueCards: number): number {
  return Math.max(1, Math.ceil((Math.max(0, dueCards) * SECONDS_PER_CARD) / 60));
}
