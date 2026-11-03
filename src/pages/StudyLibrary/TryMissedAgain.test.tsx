// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { PracticeAttempt, PracticeResponse, PracticeTestItem } from "@/domain/types";
import { missedAgainQuestions } from "@/logic/mixedPractice";
import { TryMissedAgain } from "./TryMissedAgain";

const item = (n: number, extra: Partial<PracticeTestItem> = {}): PracticeTestItem => ({
  id: `i${n}`, versionId: "v1", ordinal: n - 1, questionText: `Question text ${n}?`,
  options: [`Right ${n}`, `Wrong ${n}`], correctIndex: 0, explanation: `Why ${n}`, sourcePage: 10 + n, ...extra,
});
const resp = (n: number, kind: "correct" | "incorrect" | "dont_know", attemptId = "a1"): PracticeResponse => ({
  id: `r${n}-${attemptId}`, attemptId, itemId: `i${n}`, selectedIndex: kind === "dont_know" ? null : kind === "correct" ? 0 : 1,
  isDontKnow: kind === "dont_know", isCorrect: kind === "correct", answeredAt: "2026-11-01T10:00:00Z",
});
const attempt: PracticeAttempt = {
  id: "a1", versionId: "v1", sourceMaterialId: "m1", sourceMaterialTitle: "Weather book",
  startedAt: "2026-11-01T09:00:00Z", completedAt: "2026-11-01T10:00:00Z", status: "completed", revision: 6,
  totalQuestions: 5, answeredCount: 4, correctCount: 2, incorrectCount: 1, dontKnowCount: 1, scorePercent: 40,
};
// Q1 correct, Q2 incorrect, Q3 don't know, Q4 unanswered, Q5 correct; plus a foreign response.
const items = [1, 2, 3, 4, 5].map((n) => item(n));
const responses = [resp(1, "correct"), resp(2, "incorrect"), resp(3, "dont_know"), resp(5, "correct"), resp(4, "incorrect", "other")];

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);

it("takes only wrong and don't-know questions, in test order, from this attempt's own responses", () => {
  const set = missedAgainQuestions("a1", items, responses, "m1", "Weather book");
  expect(set.map((q) => q.question.question)).toEqual(["Question text 2?", "Question text 3?"]);
  expect(set[0]).toEqual({
    question: { question: "Question text 2?", options: ["Right 2", "Wrong 2"], correctIndex: 0, explanation: "Why 2", sourcePage: 12 },
    materialId: "m1", materialTitle: "Weather book",
  });
  expect(missedAgainQuestions("a1", items, [resp(1, "correct")], "m1", "x")).toEqual([]);
  // A frozen item whose correct answer is not one of its options is left out.
  expect(missedAgainQuestions("a1", [item(2, { correctIndex: 5 })], [resp(2, "incorrect")], "m1", "x")).toEqual([]);
  // The copy never shares the frozen item's options array.
  expect(set[0]!.question.options).not.toBe(items[1]!.options);
});

it("shows no button when nothing was missed", () => {
  render(h(TryMissedAgain, { attempt, items, responses: [resp(1, "correct")], materialTitle: "Weather book" }));
  expect(screen.queryByRole("button", { name: /you missed again/ })).toBeNull();
});

it("retries just the missed questions with explanation and source, then a today-only result", () => {
  render(h(TryMissedAgain, { attempt, items, responses, materialTitle: "Weather book" }));
  fireEvent.click(screen.getByRole("button", { name: "Try the 2 you missed again" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Question 1 of 2")).toBeTruthy();
  expect(within(dialog).getByText("Question text 2?")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "1. Right 2" }));
  expect(within(dialog).getByText("Correct. Correct answer: Right 2")).toBeTruthy();
  expect(within(dialog).getByText("Why 2")).toBeTruthy();
  expect(within(dialog).getByText("Source: Weather book · Page 12")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  expect(within(dialog).getByText("Question text 3?")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "2. Wrong 3" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "See score" }));
  const result = within(dialog).getByRole("region", { name: "Try again result" });
  expect(within(result).getByText("1 of 2 correct")).toBeTruthy();
  expect(document.activeElement).toBe(within(result).getByText("1 of 2 correct"));
  expect(within(result).getByText(/This result is for today only and is not saved/)).toBeTruthy();
  expect(within(result).getByText(/Question text 3\?/)).toBeTruthy();
  fireEvent.click(within(result).getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  // A second try starts fresh at question 1.
  fireEvent.click(screen.getByRole("button", { name: "Try the 2 you missed again" }));
  expect(screen.getByText("Question 1 of 2")).toBeTruthy();
});
