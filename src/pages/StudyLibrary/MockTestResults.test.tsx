// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { MockTestRun } from "@/domain/types";
import { scoreMock, type MockQuestion } from "@/logic/mockTest";
import { MockTestResults } from "./MockTestResults";

afterEach(cleanup);
const mk = (id: string, acsTask: string | null): MockQuestion => ({
  id, materialId: "m", materialTitle: "M",
  question: { question: `Q ${id}`, acsTask, sourcePage: null, options: ["a", "b"], correctIndex: 1, explanation: "" } as MockQuestion["question"],
});
const qs = [mk("a", "PA.I.A"), mk("b", "PA.I.B"), mk("c", "PA.V.A"), mk("d", null)];
const run: MockTestRun = {
  questionIds: ["a", "b", "c", "d"], answers: { a: "1", b: "0", c: "1", d: "1" }, flags: [], index: 0,
  startedAt: "2026-11-19T10:00:00.000Z", deadline: "2026-11-19T10:10:00.000Z", finishedAt: "2026-11-19T10:04:00.000Z",
};
const ui = (extra = {}) => render(h(MockTestResults, { run, questions: qs, onClose: vi.fn(), ...extra }));

it("bar rows match scoreMock, including Not tagged yet", () => {
  ui();
  const s = scoreMock(run, qs);
  expect(s.rows.some((r) => r.label === "Not tagged yet" && r.total === 1)).toBe(true);
  for (const r of s.rows) expect(screen.getByText(`${r.label}: ${r.correct} of ${r.total} (${r.percent}%)`)).toBeTruthy();
  expect(screen.getAllByRole("img")).toHaveLength(s.rows.length);
  expect(screen.getByText("3 of 4 correct (75%)")).toBeTruthy();
});

it("shows time used of the run's own allowed time, never a fixed one", () => {
  ui();
  expect(screen.getByText("Time used: 4 min of 10 min")).toBeTruthy();
});

it("has the wording and no verdict words", () => {
  ui();
  const text = document.body.textContent ?? "";
  expect(text).toContain("practice score, not a prediction");
  expect(text).toContain("Practice numbers only. Your instructor decides.");
  expect(text).toContain("70% line");
  expect(text).not.toMatch(/\b(go|no-go|safe|legal|required|ready|readiness score|pass|fail|OK to fly)\b/i);
});

it("lists history newest first and Close works", () => {
  const onClose = vi.fn();
  const older = { ...run, finishedAt: "2026-11-10T10:00:00.000Z", answers: {} };
  ui({ history: [run, older], onClose });
  const items = screen.getAllByRole("listitem").filter((li) => /: \d+%$/.test(li.textContent ?? "") && !/ of /.test(li.textContent ?? ""));
  expect(items.map((li) => li.textContent?.split(": ")[1])).toEqual(["75%", "0%"]);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalled();
});
