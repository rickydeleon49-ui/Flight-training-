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

it("uses the question-first layout class only in figure runs", () => {
  const { container, rerender } = render(h(QuickQuestionRun, { questions: [mq("Plain")], resultLabel: "r", onDone: () => {} }));
  expect(container.querySelector(".figure-run")).toBeNull();
  rerender(h(QuickQuestionRun, { questions: [mq("Fig", "faa-49")], resultLabel: "r", onDone: () => {} }));
  const run = container.querySelector(".figure-run")!;
  expect(run.classList.contains("figure-run--question-first")).toBe(true);
  expect(run.firstElementChild!.classList.contains("figure-run__question")).toBe(true);
  expect(container.querySelector(".figure-view--question-first")).toBeTruthy();
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

it("uses resolveFigure for the figure and its image source", () => {
  const figure = { id: "faa-900", faaNumber: 900, title: "Sectional", alt: "A sectional excerpt", file: "faa-900.webp", edition: "FAA-CT-8080-2H (2018)" as const, width: 10, height: 10 };
  const resolveFigure = vi.fn((id: string) => id === "faa-900" ? { figure, src: "data:image/webp;base64,AAAA" } : undefined);
  render(h(QuickQuestionRun, { questions: [mq("Pack", "faa-900")], resultLabel: "r", onDone: () => {}, resolveFigure }));
  expect(resolveFigure).toHaveBeenCalledWith("faa-900");
  expect(screen.getByRole("img").getAttribute("src")).toBe("data:image/webp;base64,AAAA");
});
