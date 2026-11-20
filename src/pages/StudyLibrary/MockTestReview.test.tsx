// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { MockTestRun } from "@/domain/types";
import { scoreMock, type MockQuestion } from "@/logic/mockTest";
import { MockTestReview } from "./MockTestReview";

afterEach(cleanup);
const mk = (id: string, explanation = ""): MockQuestion => ({
  id, materialId: "m", materialTitle: "M",
  question: { question: `Q ${id}`, acsTask: null, sourcePage: null, options: ["opt a", "opt b"], correctIndex: 1, explanation } as MockQuestion["question"],
});
const qs = [mk("a", "Because b."), mk("b"), mk("c"), mk("d")];
// a right, b wrong, c unanswered, d right
const run: MockTestRun = {
  questionIds: ["a", "b", "c", "d"], answers: { a: "1", b: "0", d: "1" }, flags: ["a", "c"], index: 0,
  startedAt: "2026-11-19T10:00:00.000Z", deadline: "2026-11-19T10:10:00.000Z", finishedAt: "2026-11-19T10:04:00.000Z",
};
const ui = (r = run) => render(h(MockTestReview, { run: r, questions: qs, onBack: vi.fn() }));
const shownQuestions = () => screen.queryAllByText(/^Q [a-d]$/).map((e) => e.textContent);

it("Missed shows wrong and unanswered, matching scoreMock", () => {
  ui();
  expect(shownQuestions()).toEqual(scoreMock(run, qs).missedIds.map((id) => `Q ${id}`));
  expect(shownQuestions()).toEqual(["Q b", "Q c"]);
  expect(screen.getByText("Your answer: opt a")).toBeTruthy();
  expect(screen.getByText("Your answer: Not answered")).toBeTruthy();
  expect(screen.getAllByText("Right answer: opt b")).toHaveLength(2);
});

it("Flagged and All filters", () => {
  ui();
  fireEvent.click(screen.getByRole("button", { name: "Flagged" }));
  expect(shownQuestions()).toEqual(["Q a", "Q c"]);
  expect(screen.getByText("Because b.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  expect(shownQuestions()).toEqual(["Q a", "Q b", "Q c", "Q d"]);
});

it("empty filters read as one friendly line", () => {
  ui({ ...run, flags: [], answers: { a: "1", b: "1", c: "1", d: "1" } });
  expect(screen.getByText("No missed questions in this test.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Flagged" }));
  expect(screen.getByText("No flagged questions in this test.")).toBeTruthy();
});

it("review shows the figure for a figure question only", () => {
  const fq: MockQuestion = { ...mk("f"), question: { ...mk("f").question, figureId: "faa-49" } };
  const two = [mk("p"), fq];
  const r: MockTestRun = { ...run, questionIds: ["p", "f"], answers: {}, flags: [] };
  render(h(MockTestReview, { run: r, questions: two, onBack: vi.fn() }));
  expect(document.querySelectorAll(".figure-view")).toHaveLength(1);
});
