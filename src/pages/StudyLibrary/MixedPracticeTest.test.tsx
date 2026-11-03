// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
