// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { makeMaterial } from "@/testing/factories";
import type { PracticeQuestion, PracticeTest } from "@/domain/types";
import { buildMixedTest } from "@/logic/mixedPractice";
import { MixedPracticeTest } from "./MixedPracticeTest";

const q = (text: string): PracticeQuestion => ({ question: text, sourcePage: null, options: ["One", "Two"], correctIndex: 1, explanation: "Because" });
const t = (id: string, n: number): PracticeTest => ({ sourceMaterialId: id, title: id,
  questions: Array.from({ length: n }, (_, i) => q(`${id}-q${i}`)), provider: "manual", model: "",
  generatedAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:00Z" });
const materials = ["a", "b", "c", "d"].map((id) => makeMaterial({ id, title: `Mat ${id}` }));
const tests = [t("a", 15), t("b", 15), t("c", 3)];
afterEach(cleanup);

it("builds from chosen materials only, capped and spread", () => {
  const set = buildMixedTest(tests, materials, ["a", "b"]);
  expect(set).toHaveLength(20);
  expect(new Set(set.map((x) => x.materialId))).toEqual(new Set(["a", "b"]));
  expect(set.filter((x) => x.materialId === "a")).toHaveLength(10);
  expect(buildMixedTest(tests, materials, ["a"])).toEqual([]);
  expect(buildMixedTest(tests, materials, ["a", "d"])).toEqual([]);
});

it("picker needs two materials, lists only ones with questions, and shows a result", () => {
  render(h(MixedPracticeTest, { practiceTests: tests, materials }));
  fireEvent.click(screen.getByRole("button", { name: "Mixed practice test" }));
  expect(screen.queryByText(/Mat d/)).toBeNull();
  const start = screen.getByRole("button", { name: "Start mixed test" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/Mat a/));
  expect(start.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/Mat c/));
  expect(start.disabled).toBe(false);
  fireEvent.click(start);
  for (let i = 0; i < 18; i++) {
    fireEvent.click(screen.getByRole("button", { name: "2. Two" }));
    fireEvent.click(screen.getByRole("button", { name: i === 17 ? "See score" : "Continue" }));
  }
  expect(screen.getByText("18 of 18 correct")).toBeTruthy();
  expect(screen.getByText(/Not an official FAA knowledge test score/)).toBeTruthy();
});

it("dead end offers Toolkit quizzes and the one material that has questions", () => {
  render(h(MemoryRouter, null, h(MixedPracticeTest, { practiceTests: [t("a", 5)], materials })));
  fireEvent.click(screen.getByRole("button", { name: "Mixed practice test" }));
  expect(screen.getByRole("link", { name: "Go to Toolkit quizzes" }).getAttribute("href")).toBe("/toolkit?tool=quiz");
  expect(screen.getByRole("link", { name: /Practise Mat a on its own/ }).getAttribute("href")).toBe("/study/a#material-practice-test");
});

it("dead end with no questions only offers Toolkit quizzes", () => {
  render(h(MemoryRouter, null, h(MixedPracticeTest, { practiceTests: [], materials })));
  fireEvent.click(screen.getByRole("button", { name: "Mixed practice test" }));
  expect(screen.getByRole("link", { name: "Go to Toolkit quizzes" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /on its own/ })).toBeNull();
});

const startRun = (onFinished?: () => void) => {
  render(h(MixedPracticeTest, { practiceTests: tests, materials, ...(onFinished ? { onFinished } : {}) }));
  fireEvent.click(screen.getByRole("button", { name: "Mixed practice test" }));
  fireEvent.click(screen.getByLabelText(/Mat a/));
  fireEvent.click(screen.getByLabelText(/Mat c/));
  fireEvent.click(screen.getByRole("button", { name: "Start mixed test" }));
};
// The leave confirm stays mounted (so focus can return); it is "shown" only while its dialog is open.
const leaveOpen = () => {
  const title = screen.queryByText("Leave this test?");
  const dlg = title?.closest("dialog");
  return Boolean(dlg && (dlg.hasAttribute("open") || dlg.getAttribute("aria-modal") === "true"));
};
const closeBtn = () => screen.getAllByRole("button", { name: /^close/i })[0]!;

it("asks before leaving after an answer; Keep going stays, Leave closes", () => {
  startRun();
  fireEvent.click(screen.getByRole("button", { name: "2. Two" }));
  fireEvent.click(closeBtn());
  expect(leaveOpen()).toBe(true);
  expect(screen.getByText("Your answers in this mixed test are not kept.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
  expect(leaveOpen()).toBe(false);
  expect(screen.getByText(/Question 1 of/)).toBeTruthy();
  fireEvent.click(closeBtn());
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  expect(screen.queryByText(/Question 1 of/)).toBeNull();
  expect(screen.getByRole("button", { name: "Mixed practice test" })).toBeTruthy();
});

it("closes without a confirm before any answer", () => {
  startRun();
  fireEvent.click(closeBtn());
  expect(leaveOpen()).toBe(false);
  expect(screen.queryByText(/Question 1 of/)).toBeNull();
});

it("Done on the result closes this and tells the parent; X on the result needs no confirm", () => {
  let finished = 0;
  startRun(() => { finished++; });
  for (let i = 0; i < 18; i++) {
    fireEvent.click(screen.getByRole("button", { name: "2. Two" }));
    fireEvent.click(screen.getByRole("button", { name: i === 17 ? "See score" : "Continue" }));
  }
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(finished).toBe(1);
  expect(screen.queryByText("18 of 18 correct")).toBeNull();
});

it("closing from the result screen asks nothing and does not close the parent", () => {
  let finished = 0;
  startRun(() => { finished++; });
  for (let i = 0; i < 18; i++) {
    fireEvent.click(screen.getByRole("button", { name: "2. Two" }));
    fireEvent.click(screen.getByRole("button", { name: i === 17 ? "See score" : "Continue" }));
  }
  fireEvent.click(closeBtn());
  expect(leaveOpen()).toBe(false);
  expect(finished).toBe(0);
});

it("returns focus to the close control after Keep going", () => {
  startRun();
  fireEvent.click(screen.getByRole("button", { name: "2. Two" }));
  const trigger = closeBtn();
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
  expect(leaveOpen()).toBe(false);
  expect(document.activeElement).not.toBe(document.body);
});
