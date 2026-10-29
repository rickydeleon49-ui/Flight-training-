// @vitest-environment jsdom
import { createElement as h } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { StudyMaterial } from "@/domain/types";
import { makeEvent, makeMaterial, makeQuestion } from "@/testing/factories";
import { AcsCodeLookupPanel } from "./AcsCodeLookupPanel";

afterEach(cleanup);
const tagged = (id: string, tags: string[]) => makeMaterial({ id, title: `Fictional ${id}`, tags });
function Location() { const l = useLocation(); return h("output", { "aria-label": "Location" }, l.pathname); }
function search(code: string, materials: StudyMaterial[], extra: Record<string, unknown> = {}) {
  const view = render(h(MemoryRouter, null, h(AcsCodeLookupPanel, { materials, ...extra }), h(Location)));
  fireEvent.change(screen.getByLabelText(/missed topic codes/i), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: /find study materials/i }));
  return view;
}
const rows = (code: string) => within(screen.getByRole("list", { name: `Related study for ${code}` })).queryAllByRole("link");

it("shows exact-tag rows with a visible reason, opening the tagged material", () => {
  search("PA.I.A.K1", [tagged("exact", ["pa.i.a.k1"]), tagged("other", ["PA.I.A.K2"])]);
  expect(rows("PA.I.A.K1").map(r => r.textContent)).toEqual(["Fictional exact Tagged: PA.I.A.K1›"]);
  fireEvent.click(rows("PA.I.A.K1")[0]!);
  expect(screen.getByLabelText("Location").textContent).toBe("/study/exact");
});

it("lists a task code from its element codes, each row naming the element it came from", () => {
  search("PA.I.A", [tagged("k3", ["PA.I.A.K3"]), tagged("task", ["PA.I.A"]), tagged("b", ["PA.I.B.K1"])]);
  const result = screen.getByTestId("acs-code-result-PA.I.A");
  expect(within(result).getByText("PA.I.A")).toBeTruthy();
  expect(result.textContent).toContain("Task A. Pilot Qualifications");
  expect(result.textContent).not.toMatch(/not found/i);
  expect(rows("PA.I.A").map(r => within(r).getByText(/^(Tagged|From element)/).textContent)).toEqual(["Tagged: PA.I.A", "From element PA.I.A.K3"]);
});

it("never lists untagged or topic-only items, and says so plainly", () => {
  search("PA.I.A.K1", [makeMaterial({ id: "untagged", title: "PA.I.A.K1 notes", notes: "PA.I.A.K1", tags: ["PA.I.A.K10"] })],
    { questions: [makeQuestion({ text: "PA.I.A.K1" })], events: [makeEvent({ title: "PA.I.A.K1" })] });
  expect(screen.queryByRole("list", { name: "Related study for PA.I.A.K1" })).toBeNull();
  expect(screen.getByText("No tagged study materials exist for this topic code.")).toBeTruthy();
});

it("shows three rows, then Show more reveals every match and moves focus to the first new row", async () => {
  search("PA.I.A", Array.from({ length: 8 }, (_, i) => tagged(`m${i}`, [i % 2 ? "PA.I.A.K1" : "PA.I.A.S1"])));
  expect(rows("PA.I.A")).toHaveLength(3);
  const more = screen.getByRole("button", { name: "Show more" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  more.focus();
  fireEvent.click(more);
  await act(async () => {});
  expect(rows("PA.I.A")).toHaveLength(8);
  expect(document.activeElement).toBe(rows("PA.I.A")[3]);
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
});

it("says the code could not be checked when the library can't be read, never that nothing is tagged", () => {
  const broken = { ...tagged("m", []), get tags(): string[] { throw new Error("PRIVATE_SENTINEL"); } };
  search("PA.I.A.K1", [broken]);
  const result = screen.getByTestId("acs-code-result-PA.I.A.K1");
  expect(result.textContent).toContain("couldn't be checked");
  expect(result.textContent).not.toMatch(/No tagged study materials/);
  expect(document.body.textContent).not.toContain("PRIVATE_SENTINEL");
});

it("keeps rows readable as one tappable link each with no score or readiness wording", () => {
  search("PA.I.A.K1", [tagged("m", ["PA.I.A.K1"])]);
  const [row] = rows("PA.I.A.K1");
  expect(row!.className).toContain("related-study__row");
  expect(document.body.textContent).not.toMatch(/score|ready|readiness|proficien|mastery/i);
});
