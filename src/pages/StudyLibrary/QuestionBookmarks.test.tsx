// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { PracticeTest, StudyMaterial } from "@/domain/types";
import { QuestionBookmarks } from "./QuestionBookmarks";

afterEach(cleanup);
const materials = [{ id: "m1", title: "Weather pack" }] as unknown as StudyMaterial[];
const tests = [{ sourceMaterialId: "m1", questions: [
  { question: "What is a front?", acsTask: null, sourcePage: null, options: ["x", "y"], correctIndex: 0, explanation: "A boundary." },
  { question: "Other?", acsTask: null, sourcePage: null, options: ["x", "y"], correctIndex: 1, explanation: "" },
] }] as unknown as PracticeTest[];
const idOf = (text: string) => `m1:${text.trim().toLowerCase()}`;
const front = { questionId: idOf("What is a front?"), materialId: "m1" };
const other = { questionId: idOf("Other?"), materialId: "m1" };
const gone = { questionId: "m1:deleted", materialId: "m1" };
const ui = (bookmarks: typeof front[], onChange = vi.fn()) =>
  render(h(QuestionBookmarks, { practiceTests: tests, materials, bookmarks, onChange }));

it("shows question, right answer, explanation and material", () => {
  ui([front]);
  expect(screen.getByText("What is a front?")).toBeTruthy();
  expect(screen.getByText("Right answer: x")).toBeTruthy();
  expect(screen.getByText("A boundary.")).toBeTruthy();
  expect(screen.getByText("From: Weather pack")).toBeTruthy();
});

it("Remove saves the list without that bookmark", () => {
  const onChange = vi.fn();
  ui([front, other], onChange);
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
  expect(onChange).toHaveBeenCalledWith([other]);
});

it("missing questions get one muted line and Remove them", () => {
  const onChange = vi.fn();
  ui([front, gone], onChange);
  expect(screen.getByText(/1 bookmarked question is no longer in your study packs\./)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove them" }));
  expect(onChange).toHaveBeenCalledWith([front]);
});

it("empty state reads well", () => {
  ui([]);
  expect(screen.getByText(/No bookmarked questions yet/)).toBeTruthy();
});
