// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CardRecentReview, CardReviewSnapshot } from "@/domain/types";
import { CardReviewPanel } from "./CardReviewPanel";

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
afterEach(cleanup);
it("FLAKE-CR-01: hidden history and reset acknowledgement do not mean the refreshed history has arrived", async () => {
  const snapshot: CardReviewSnapshot = { materialId: "A", generation: 0, states: {}, current: {
    status: "ok", versionId: "A", contentHash: "A",
    items: [{ itemId: "A", ordinal: 0, front: "Synthetic question", back: "Synthetic answer", sourcePage: null }],
  } };
  const old: CardRecentReview = { id: "old", itemId: "A", front: "Synthetic question", rating: "good", reviewedAt: "2026-10-07T10:00:00.000Z", earlierVersion: false };
  const page = held<{ rows: CardRecentReview[]; next: null }>();
  const fresh = held<{ rows: CardRecentReview[]; next: null }>();
  const reset = held<{ action: "reset"; materialId: string; generation: number }>();
  const repo = {
    getCardReviewSnapshot: vi.fn(async () => snapshot),
    getRecentReviews: vi.fn().mockResolvedValueOnce({ rows: [old], next: { id: old.id, reviewedAt: old.reviewedAt } })
      .mockImplementationOnce(() => page.promise).mockImplementationOnce(() => fresh.promise),
    getDueQueue: vi.fn(async () => []), saveAction: vi.fn(() => reset.promise), getOperationStatus: vi.fn(),
  };
  render(h(CardReviewPanel, { materialId: "A", materialTitle: "Synthetic", repository: repo }));
  await screen.findByRole("heading", { name: "Recent reviews" });
  fireEvent.click(screen.getByRole("button", { name: "Show more reviews" }));
  await waitFor(() => expect(repo.getRecentReviews).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Reset card reviews" }));
  const dialog = await screen.findByRole("dialog", { name: "Reset card reviews for “Synthetic”?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Reset reviews" }));
  // The old test's absence check passes here although the rows are still present.
  expect(screen.queryByRole("heading", { name: "Recent reviews" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Recent reviews", hidden: true })).toBeTruthy();
  await act(async () => reset.resolve({ action: "reset", materialId: "A", generation: 1 }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await screen.findByText(/Card reviews for this material were reset/);
  expect(screen.getByRole("button", { name: "Reset card reviews" })).toHaveProperty("disabled", true);
  // Acknowledged, but still displaying the old first page while the refresh is held.
  expect(screen.getByRole("heading", { name: "Recent reviews" })).toBeTruthy();
  await act(async () => page.resolve({ rows: [{ ...old, id: "erased-held-page", front: "Erased held page" }], next: null }));
  expect(screen.queryByText("Erased held page")).toBeNull();
  await act(async () => fresh.resolve({ rows: [], next: null }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Reset card reviews" })).toHaveProperty("disabled", false));
  expect(screen.queryByRole("heading", { name: "Recent reviews" })).toBeNull();
});
