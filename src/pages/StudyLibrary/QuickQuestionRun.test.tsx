// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { PracticeQuestion } from "@/domain/types";
import type { MixedQuestion } from "@/logic/mixedPractice";
import { QuickQuestionRun } from "./QuickQuestionRun";

afterEach(cleanup);
const mq = (text: string, figureId?: string): MixedQuestion => ({
  question: { question: text, options: ["One", "Two"], correctIndex: 1, explanation: "Because", sourcePage: null, ...(figureId ? { figureId } : {}) } as PracticeQuestion,
  materialId: "m", materialTitle: "Mat",
});

it("shows a figure only when figureId is set and resolves", () => {
  const { rerender } = render(h(QuickQuestionRun, { questions: [mq("Plain")], resultLabel: "r", onDone: () => {} }));
  expect(screen.queryByRole("img")).toBeNull();
  rerender(h(QuickQuestionRun, { questions: [mq("Fig", "faa-49")], resultLabel: "r", onDone: () => {} }));
  expect(screen.getByRole("img")).toBeTruthy();
  rerender(h(QuickQuestionRun, { questions: [mq("Unknown", "faa-999")], resultLabel: "r", onDone: () => {} }));
  expect(screen.queryByRole("img")).toBeNull();
});

it("calls onFinished once with the missed questions", () => {
  const onFinished = vi.fn();
  render(h(QuickQuestionRun, { questions: [mq("A"), mq("B")], resultLabel: "r", onDone: () => {}, onFinished }));
  fireEvent.click(screen.getByRole("button", { name: "2. Two" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(onFinished).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "1. One" }));
  fireEvent.click(screen.getByRole("button", { name: "See score" }));
  expect(onFinished).toHaveBeenCalledTimes(1);
  expect(onFinished.mock.calls[0]![0].map((m: MixedQuestion) => m.question.question)).toEqual(["B"]);
});
