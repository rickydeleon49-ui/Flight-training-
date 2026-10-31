// @vitest-environment jsdom
import { createElement as h, type ContextType } from "react";
import drillSource from "./CheckrideTopicPractice.tsx?raw";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { makeMaterial } from "@/testing/factories";
import type { PracticeQuestion, PracticeTest } from "@/domain/types";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { AcsTaskChip } from "./AcsTaskChip";
import { CheckrideTopicPractice } from "./CheckrideTopicPractice";

const question = (text: string, acsTask?: string, sourcePage: number | null = null): PracticeQuestion => ({
  question: text, acsTask, sourcePage, options: ["First", "Second", "Third"], correctIndex: 1, explanation: `Explanation for ${text}`,
});
const test = (id: string, questions: PracticeQuestion[]): PracticeTest => ({ sourceMaterialId: id, title: id,
  questions, provider: "manual", model: "", generatedAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:00Z" });
const materials = [makeMaterial({ id: "a", title: "Synthetic A.pdf" }), makeMaterial({ id: "b", title: "Synthetic B.pdf" })];
const tests = [test("a", [question("A tagged", "PA.II.A", 4), question("Other task", "PA.I.A"), question("Old untagged")]),
  test("b", [question("B tagged", "PA.II.A")])];
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const open = () => fireEvent.click(screen.getByRole("button", { name: "Practice by checkride topic" }));
const choose = () => fireEvent.click(screen.getByRole("button", { name: "PA.II.A · Preflight Assessment · 2 questions" }));

it("shows a neutral chip only for a known tag", () => {
  const view = render(h(AcsTaskChip, { code: "PA.II.A" }));
  expect(screen.getByText("PA.II.A · Preflight Assessment").className).toContain("badge--neutral");
  view.rerender(h(AcsTaskChip)); expect(view.container.textContent).toBe("");
  view.rerender(h(AcsTaskChip, { code: "invalid" })); expect(view.container.textContent).toBe("");
});
it("lists only populated tasks with counts across saved tests", () => {
  render(h(CheckrideTopicPractice, { practiceTests: tests, materials })); open();
  expect(screen.getByRole("button", { name: "PA.II.A · Preflight Assessment · 2 questions" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "PA.I.A · Pilot Qualifications · 1 question" })).toBeTruthy();
  expect(screen.queryByText(/Airworthiness Requirements/)).toBeNull();
});
it("explains the empty state and ignores missing materials", () => {
  render(h(CheckrideTopicPractice, { practiceTests: tests, materials: [] })); open();
  expect(screen.getByText("New practice tests made from a PDF will be grouped by checkride topic.")).toBeTruthy();
});
it("drills only the chosen task across two PDFs, reveals sources, and writes nothing", async () => {
  const db = await createNodeSqliteDatabase();
  try {
    const repositories = createRepositories(db);
    for (const material of materials) await repositories.documents.create({ id: material.id, title: material.title });
    for (const saved of tests) await repositories.documents.savePracticeTest(saved);
    const saved = (await repositories.documents.listPracticeTests()).sort((a, b) => a.sourceMaterialId.localeCompare(b.sourceMaterialId));
    const writes = Object.values(repositories).flatMap((repository) => Object.keys(repository)
      .filter((key) => /^(save|create|update|delete|remove|record|start|complete|apply|commit|finish|abandon|erase|reset)/i.test(key))
      .map((key) => vi.spyOn(repository as Record<string, (...args: never[]) => unknown>, key)));
    const execute = vi.spyOn(db, "execute");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(h(AppDataContext.Provider, { value: { repositories, data: { ...EMPTY_DATA, practiceTests: saved, materials }, status: "ready" } as ContextType<typeof AppDataContext> },
      h(CheckrideTopicPractice, { practiceTests: saved, materials })));
    open(); choose();
    expect(screen.getByText("A tagged")).toBeTruthy();
    expect(screen.queryByText("B tagged")).toBeNull();
    expect(screen.queryByText("Other task")).toBeNull();
    expect(screen.queryByText("Old untagged")).toBeNull();
    expect(screen.queryByText(/Source:/)).toBeNull();
    fireEvent.keyDown(screen.getByRole("heading", { name: "Question 1 of 2" }), { key: "2" });
    expect(screen.getByRole("status").textContent).toContain("Correct. Correct answer: Second");
    expect(screen.getByText("Explanation for A tagged")).toBeTruthy();
    expect(screen.getByText("Source: Synthetic A.pdf · Page 4")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Next" }), { key: "Enter" });
    expect(screen.getByText("B tagged")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1. First" }));
    expect(screen.getByRole("status").textContent).toContain("Incorrect. Correct answer: Second");
    expect(screen.getByText("Source: Synthetic B.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    open(); choose(); expect(screen.queryByRole("status")).toBeNull();
    expect(execute).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  } finally { cleanup(); db.close(); }
});
it("keeps the picker and drill UI free of assessment wording", () => {
  expect(drillSource).not.toMatch(/score|mastery|readiness|weak|strong|progress|%/i);
});
