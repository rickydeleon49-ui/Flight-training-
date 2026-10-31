/**
 * Plain, consistent wording for the card-review heading and its button.
 *
 * A review session holds every due card first (up to 20 cards in all), then
 * new cards, at most 10 new at a time. The wording says exactly that, so the
 * count beside the button matches what the button starts.
 */
export const NEW_CARDS_AT_A_TIME = 10;
export const CARDS_PER_SESSION = 20;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** How many cards the next session holds (see `getDueQueue`). */
export function nextSessionSize(dueNow: number, newCount: number): { due: number; fresh: number } {
  const due = Math.min(Math.max(0, dueNow), CARDS_PER_SESSION);
  const fresh = Math.max(0, Math.min(newCount, NEW_CARDS_AT_A_TIME, CARDS_PER_SESSION - due));
  return { due, fresh };
}

/** "20 new cards — 10 at a time", "3 cards due", "5 new cards · 3 cards due". */
export function reviewStatusLine(dueNow: number, newCount: number): string {
  const fresh = newCount > 0
    ? newCount > NEW_CARDS_AT_A_TIME
      ? `${plural(newCount, "new card")} — ${NEW_CARDS_AT_A_TIME} at a time`
      : plural(newCount, "new card")
    : null;
  const due = dueNow > 0 ? `${plural(dueNow, "card")} due` : null;
  return [fresh, due].filter(Boolean).join(" · ");
}

/** "Start 10 new cards" when only new cards wait; otherwise "Review N cards". */
export function reviewButtonLabel(dueNow: number, newCount: number): string {
  const { due, fresh } = nextSessionSize(dueNow, newCount);
  return due === 0 ? `Start ${plural(fresh, "new card")}` : `Review ${plural(due + fresh, "card")}`;
}
