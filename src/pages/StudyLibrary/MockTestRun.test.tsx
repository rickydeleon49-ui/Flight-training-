// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { createElement as h } from "react";
import type { MockQuestion } from "@/logic/mockTest";
import { MockTestRunner, startMockRun } from "./MockTestRun";

const qs: MockQuestion[] = [0, 1, 2].map((n) => ({
  id: `q${n}`, materialId: "m", materialTitle: "M",
  question: { question: `Question text ${n}`, acsTask: "PA.I.A", sourcePage: null, options: ["a", "b", "c"], correctIndex: 1, explanation: `Secret explanation ${n}` },
}));
const T0 = Date.parse("2026-11-19T10:00:00Z");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const ui = (initial = startMockRun(qs, T0), onSave = vi.fn(), onClose = vi.fn()) =>
  render(h(MemoryRouter, null, h(MockTestRunner, { questions: qs, initial, onSave, onClose })));

it("start freezes the ids and sets deadline = start + 150 s per question", () => {
  const run = startMockRun(qs, T0);
  expect(run.questionIds).toEqual(["q0", "q1", "q2"]);
  expect(Date.parse(run.deadline) - T0).toBe(3 * 150 * 1000);
  ui(run);
  expect(screen.getByText("0:07:30")).toBeTruthy();
});

it("answers without feedback, Back/Next move, nothing explains before the end", () => {
  const onSave = vi.fn();
  ui(startMockRun(qs, T0), onSave);
  fireEvent.click(screen.getByRole("button", { name: "2. b" }));
  expect(screen.getByRole("button", { name: "2. b" }).getAttribute("aria-pressed")).toBe("true");
  expect(document.body.textContent).not.toMatch(/Secret explanation|Correct answer|Incorrect/);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Question text 1")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByText("Question text 0")).toBeTruthy();
  expect(onSave).not.toHaveBeenCalled();
});

it("reopen resumes at the same question with the same deadline", () => {
  const saved = { ...startMockRun(qs, T0), index: 2, answers: { q0: "1" } };
  vi.setSystemTime(T0 + 60_000);
  ui(saved);
  expect(screen.getByText("Question text 2")).toBeTruthy();
  expect(screen.getByText("0:06:30")).toBeTruthy();
  expect(screen.getByText(/1 answered/)).toBeTruthy();
});

it("time up finishes, saves the finished run and shows Finished", () => {
  const onSave = vi.fn();
  ui(startMockRun(qs, T0), onSave);
  act(() => { vi.advanceTimersByTime(3 * 150 * 1000 + 1000); });
  expect(screen.getByText("Finished")).toBeTruthy();
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0]![0].finishedAt).toBeTruthy();
});

it("End test asks first, then finishes", () => {
  const onSave = vi.fn();
  ui(startMockRun(qs, T0), onSave);
  fireEvent.click(screen.getByRole("button", { name: "End test" }));
  expect(onSave).not.toHaveBeenCalled();
  const confirm = screen.getAllByRole("button", { name: "End test" }).at(-1)!;
  fireEvent.click(confirm);
  expect(screen.getByText("Finished")).toBeTruthy();
  expect(onSave).toHaveBeenCalledTimes(1);
});

it("saves on every 5th answer and when the page hides; clock announces politely", () => {
  const onSave = vi.fn();
  const many: MockQuestion[] = qs;
  ui(startMockRun(many, T0), onSave);
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "1. a" }));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "1. a" }));
  expect(onSave).toHaveBeenCalledTimes(1);
  fireEvent(window, new Event("pagehide"));
  expect(onSave).toHaveBeenCalledTimes(2);
  act(() => { vi.advanceTimersByTime(3 * 150 * 1000 - 59_000); });
  const live = document.querySelector('[aria-live="polite"]');
  expect(live?.textContent).toBe("1 minute left");
});
