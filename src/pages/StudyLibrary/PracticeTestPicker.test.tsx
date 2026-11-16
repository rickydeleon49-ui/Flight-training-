// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { makeMaterial } from "@/testing/factories";
import type { PracticeTest } from "@/domain/types";
import { PracticeTestPicker } from "./PracticeTestPicker";

afterEach(cleanup);

it("shows Practice by checkride topic above the list of practice tests", () => {
  const tests: PracticeTest[] = [{ sourceMaterialId: "a", title: "A", provider: "manual", model: "",
    generatedAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:00Z",
    questions: [{ question: "Q", acsTask: "PA.I.A", sourcePage: null, options: ["a", "b", "c"], correctIndex: 0, explanation: "e" }] }];
  render(h(MemoryRouter, null, h(PracticeTestPicker, { practiceTests: tests, materials: [makeMaterial({ id: "a", title: "Synthetic A.pdf" })] })));
  fireEvent.click(screen.getByRole("button", { name: "Practice test" }));
  const topic = screen.getByRole("button", { name: "Practice by checkride topic" });
  const link = screen.getByRole("link", { name: /Synthetic A\.pdf/ });
  expect(topic.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("a second tap on Practice test or Mixed practice test does not stack another dialog", () => {
  const mk = (id: string): PracticeTest => ({ sourceMaterialId: id, title: id, provider: "manual", model: "",
    generatedAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:00Z",
    questions: [{ question: "Q", acsTask: "PA.I.A", sourcePage: null, options: ["a", "b", "c"], correctIndex: 0, explanation: "e" }] });
  const materials = [makeMaterial({ id: "a", title: "A.pdf" }), makeMaterial({ id: "b", title: "B.pdf" })];
  render(h(MemoryRouter, null, h(PracticeTestPicker, { practiceTests: [mk("a"), mk("b")], materials })));
  const opener = screen.getByRole("button", { name: "Practice test" });
  fireEvent.click(opener);
  fireEvent.click(opener);
  const titled = (title: string) => Array.from(document.querySelectorAll("dialog"))
    .filter((d) => d.querySelector("h2")?.textContent === title).length;
  expect(titled("Practice tests")).toBe(1);
  const mixed = screen.getByRole("button", { name: "Mixed practice test" });
  fireEvent.click(mixed);
  fireEvent.click(mixed);
  fireEvent.click(opener);
  expect(titled("Mixed practice test")).toBe(1);
  expect(titled("Practice tests")).toBe(1);
});
