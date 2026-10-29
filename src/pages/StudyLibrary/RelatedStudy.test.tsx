// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiStudySet, CompletedHistoryItem } from "@/domain/types";
import { makeEvent, makeMaterial, makeQuestion } from "@/testing/factories";
import { useAppData } from "@/state/AppDataContext";
import { RelatedStudy } from "./RelatedStudy";

let context: ReturnType<typeof useAppData>;
vi.mock("@/state/AppDataContext", () => ({ useAppData: () => context }));
const material = makeMaterial({ id: "fictional", title: "Synthetic material" });
const set: AiStudySet = { sourceMaterialId: material.id, title: "Synthetic guide", summary: "Saved summary", sections: [], flashcards: [{ front: "Fictional", back: "Answer", sourcePage: null, visualRegionId: "saved-region" }], sourceNotes: "", model: "", provider: "manual", generatedAt: "2026-10-28", updatedAt: "2026-10-28" };
const summary: CompletedHistoryItem = { attemptId: "old-attempt", versionId: "old-version", historyKey: material.id, versionNumber: 1, sourceMaterialTitle: "Frozen title", startedAt: "2026-10-28", completedAt: "2026-10-28", totalQuestions: 1, answeredCount: 0, correctCount: 0, incorrectCount: 0, dontKnowCount: 0, unansweredCount: 1, scorePercent: 0 };
const history = vi.fn();
function Location() { const l = useLocation(); return h("output", { "aria-label": "Location" }, `${l.pathname}${l.search}${l.hash}`); }
function open(id = material.id) { return render(h(MemoryRouter, null, h(RelatedStudy, { key: id, materialId: id }), h(Location))); }
async function expand() {
  const details = screen.getByText("Related study").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await act(async () => {});
  return details;
}
function rows() { return within(screen.getByRole("list", { name: "Related study destinations" })).getAllByRole("listitem"); }
beforeEach(() => {
  history.mockReset().mockResolvedValue([summary]);
  context = { data: { materials: [material], aiStudySets: [set], questions: [makeQuestion({ id: "exact-question", materialId: material.id })], events: [makeEvent({ id: "exact-lesson", materialIds: [material.id] })] }, dataRevision: 1, repositories: { practiceSessions: { getCompletedHistory: history } } } as unknown as typeof context;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("starts collapsed with no reads, expands to three then five, and focuses the first revealed row", async () => {
  open();
  expect(screen.getByText("Related study").closest("details")!.open).toBe(false);
  expect(history).not.toHaveBeenCalled();
  await expand();
  expect(history).toHaveBeenCalledExactlyOnceWith(material.id, 10);
  expect(rows()).toHaveLength(3);
  const more = screen.getByRole("button", { name: "Show more" });
  more.focus(); fireEvent.click(more);
  expect(rows()).toHaveLength(5);
  expect(document.activeElement).toBe(within(rows()[3]!).getByRole("link"));
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  expect(history).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/generate|AI|score|complete|schedule/i)).toBeNull();
});

it("jumps to the existing headings with focus and opens exact saved attempt/question/lesson destinations", async () => {
  open(); await expand();
  for (const [name, id] of [["Study guide: Synthetic guide", "material-guide-heading"], ["Cards: Synthetic guide", "material-cards-heading"]]) {
    const heading = document.createElement("h2"); heading.id = id!; heading.tabIndex = -1; heading.scrollIntoView = vi.fn(); document.body.append(heading);
    fireEvent.click(screen.getByRole("button", { name: `${name} From this material` }));
    expect(document.activeElement).toBe(heading);
    expect(heading.scrollIntoView).toHaveBeenCalledWith({ block: "start" }); heading.remove();
  }
  fireEvent.click(screen.getByRole("link", { name: "Recent saved review: Frozen title From this material" }));
  expect(screen.getByLabelText("Location").textContent).toBe("/study/history/fictional/old-attempt?review=missed");
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  fireEvent.click(screen.getByRole("link", { name: /Instructor question:/ }));
  expect(screen.getByLabelText("Location").textContent).toBe("/questions?question=exact-question");
  fireEvent.click(screen.getByRole("link", { name: /Lesson preparation:/ }));
  expect(screen.getByLabelText("Location").textContent).toBe("/schedule/exact-lesson");
});

it("reports read failure without empty or raw error text, and retries only the bounded read", async () => {
  context.data = { ...context.data, aiStudySets: [], questions: [], events: [] };
  history.mockRejectedValueOnce(new Error("PRIVATE_SENTINEL"));
  open(); await expand();
  expect(screen.getByText("Recent saved reviews couldn't be checked.")).toBeTruthy();
  expect(screen.queryByText("Nothing linked here yet.")).toBeNull();
  expect(screen.queryByText("PRIVATE_SENTINEL")).toBeNull();
  history.mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Nothing linked here yet.");
  expect(document.activeElement).toBe(screen.getByText("Related study"));
  expect(history.mock.calls).toEqual([[material.id, 10], [material.id, 10]]);
});

it("does not label a pending read empty, and keeps known rows during failure", async () => {
  let reject!: (error: Error) => void;
  history.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
  open(); await expand();
  expect(screen.getByText("Checking recent saved reviews…")).toBeTruthy();
  expect(screen.queryByText("Nothing linked here yet.")).toBeNull();
  await act(async () => reject(new Error("failed")));
  expect(rows()).toHaveLength(3);
  expect(screen.getByText("Recent saved reviews couldn't be checked.")).toBeTruthy();
});

it("retires late success and rejection across close/reopen and A→B→A navigation", async () => {
  let resolve!: (value: CompletedHistoryItem[]) => void;
  let reject!: (error: Error) => void;
  history.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const view = open(); const details = await expand();
  details.open = false; fireEvent(details, new Event("toggle"));
  await act(async () => {});
  history.mockResolvedValue([]);
  await expand();
  await act(async () => resolve([summary]));
  expect(screen.queryByRole("link", { name: /Recent saved review:/ })).toBeNull();
  view.unmount();
  history.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
  const old = open(); await expand(); old.unmount();
  const b = open("other"); await expand(); b.unmount();
  open(); await expand();
  await act(async () => reject(new Error("PRIVATE_LATE")));
  expect(screen.queryByText("Recent saved reviews couldn't be checked.")).toBeNull();
  expect(screen.queryByText("PRIVATE_LATE")).toBeNull();
});

it("retires stale review rows and results immediately on restore/refresh", async () => {
  const view = open(); await expand();
  expect(screen.getByRole("link", { name: /Recent saved review:/ })).toBeTruthy();
  let resolve!: (value: CompletedHistoryItem[]) => void;
  history.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  context = { ...context, dataRevision: 2 };
  view.rerender(h(MemoryRouter, null, h(RelatedStudy, { key: material.id, materialId: material.id }), h(Location)));
  expect(screen.queryByRole("link", { name: /Recent saved review:/ })).toBeNull();
  history.mockResolvedValue([]); context = { ...context, dataRevision: 3 };
  view.rerender(h(MemoryRouter, null, h(RelatedStudy, { key: material.id, materialId: material.id }), h(Location)));
  await act(async () => resolve([summary]));
  await waitFor(() => expect(screen.queryByText("Checking recent saved reviews…")).toBeNull());
  expect(screen.queryByRole("link", { name: /Recent saved review:/ })).toBeNull();
});

it("recomputes linked question/lesson removal and undo without retaining stale destinations", async () => {
  const view = open(); await expand(); fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  const before = context.data;
  context = { ...context, data: { ...before, questions: [], events: [], aiStudySets: [] } };
  view.rerender(h(MemoryRouter, null, h(RelatedStudy, { key: material.id, materialId: material.id }), h(Location)));
  expect(rows()).toHaveLength(1);
  expect(screen.queryByRole("link", { name: /Instructor question:|Lesson preparation:/ })).toBeNull();
  context = { ...context, data: before };
  view.rerender(h(MemoryRouter, null, h(RelatedStudy, { key: material.id, materialId: material.id }), h(Location)));
  expect(rows()).toHaveLength(5);
});
