// @vitest-environment jsdom
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { Notes } from "@/pages/Notes/Notes";
import { OralPracticeDialog } from "./OralPracticeDialog";
import { parseOralPoints, oralNoteDraft } from "@/logic/oralPractice";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

const POINTS = ["Zebra alpha point", "Quokka bravo point", "Narwhal charlie point"];

function Harness() {
  const ctx = useAppData();
  const material = ctx.data.materials[0];
  if (ctx.status !== "ready" || !material) return null;
  return h(OralPracticeDialog, { material, open: true, onClose: () => {} });
}
function Page() {
  return h(Routes, null,
    h(Route, { path: "/", element: h(Harness) }),
    h(Route, { path: "/notes", element: h(Notes) }),
  );
}
const mount = () => render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/"] }, h(Page))));
const count = async (table: string) => (await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]!.n;

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  await createRepositories(db).documents.create({ id: "m1", title: "Oral material" });
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

async function toAnswerStep(answer?: string) {
  await screen.findByText(/Try it — the scenario is not saved yet/);
  fireEvent.change(await screen.findByLabelText("Scenario"), { target: { value: "Engine roughness at 3,000 feet" } });
  fireEvent.change(screen.getByLabelText("Discussion points"), { target: { value: POINTS.join("\n") } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const box = await screen.findByLabelText("Your answer (optional)");
  if (answer !== undefined) fireEvent.change(box, { target: { value: answer } });
}

it("keeps the discussion points out of the page until she shows them", async () => {
  mount();
  await toAnswerStep("carb heat first");
  for (const point of POINTS) expect(document.body.innerHTML).not.toContain(point);
  expect(document.body.innerHTML).not.toContain("I covered this");
  fireEvent.click(screen.getByRole("button", { name: "Show discussion points" }));
  for (const point of POINTS) expect(await screen.findByText(point)).toBeTruthy();
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  expect(screen.getByText("Try it — the scenario is not saved yet.")).toBeTruthy();
});

it("works with the keyboard alone (native buttons and fields, no pointer handlers)", async () => {
  mount();
  await toAnswerStep();
  const show = screen.getByRole("button", { name: "Show discussion points" });
  expect(show.tagName).toBe("BUTTON");
  show.focus();
  expect(document.activeElement).toBe(show);
  fireEvent.click(show); // Enter/Space on a focused button is a click
  const heading = await screen.findByRole("heading", { name: "Your discussion points" });
  await waitFor(() => expect(document.activeElement).toBe(heading));
  const first = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
  first.focus();
  fireEvent.click(first); // Space on a focused checkbox toggles it
  expect(first.checked).toBe(true);
});

it("accepts a 20,000-character answer", async () => {
  mount();
  const long = "x".repeat(20000);
  await toAnswerStep(long);
  const box = screen.getByLabelText("Your answer (optional)") as HTMLTextAreaElement;
  expect(box.value.length).toBe(20000);
  expect(box.maxLength).toBe(20000);
  fireEvent.click(screen.getByRole("button", { name: "Show discussion points" }));
  expect(await screen.findByText(POINTS[0]!)).toBeTruthy();
});

it("writes nothing when she cancels", async () => {
  const before = { q: 0, n: 0 };
  mount();
  before.q = await count("questions"); before.n = await count("notes");
  await toAnswerStep("my answer");
  fireEvent.click(screen.getByRole("button", { name: "Show discussion points" }));
  await screen.findByText(POINTS[0]!);
  fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);
  expect(await count("questions")).toBe(before.q);
  expect(await count("notes")).toBe(before.n);
});

it("Ask my instructor adds exactly one question linked to the material, once", async () => {
  mount();
  const before = await count("questions");
  await toAnswerStep("carb heat first");
  fireEvent.click(screen.getByRole("button", { name: "Show discussion points" }));
  fireEvent.click((await screen.findAllByRole("checkbox"))[0]!);
  const ask = screen.getByRole("button", { name: "Ask my instructor" });
  fireEvent.click(ask); fireEvent.click(ask);
  await screen.findByText("Added to your Questions.");
  expect(await count("questions")).toBe(before + 1);
  const row = (await db.select<{ text: string; material_id: string }>("SELECT text, material_id FROM questions"))[0]!;
  expect(row.material_id).toBe("m1");
  expect(row.text).toContain("Engine roughness at 3,000 feet");
  expect(row.text).toContain("carb heat first");
  expect(row.text).toContain("- Zebra alpha point");
  expect(row.text).not.toContain("Quokka");
  expect(await count("notes")).toBe(0);
});

it("Write a note opens the Notes editor prefilled and saves only on Save note", async () => {
  mount();
  await toAnswerStep("carb heat first");
  fireEvent.click(screen.getByRole("button", { name: "Show discussion points" }));
  fireEvent.click((await screen.findAllByRole("checkbox"))[1]!);
  fireEvent.click(screen.getByRole("button", { name: "Write a note" }));
  const body = (await screen.findByLabelText("Note")) as HTMLTextAreaElement;
  expect(body.value).toContain("Engine roughness at 3,000 feet");
  expect(body.value).toContain("carb heat first");
  expect(body.value).toContain("- Quokka bravo point");
  expect(body.value).not.toContain("Zebra");
  expect(await count("notes")).toBe(0);
  fireEvent.change(body, { target: { value: body.value + "\nedited" } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(async () => expect(await count("notes")).toBe(1));
  expect(await count("questions")).toBe(0);
});

it("needs a scenario and 1-12 points, and parses one point per line", async () => {
  expect(parseOralPoints(" a \n\n b\r\n")).toEqual(["a", "b"]);
  expect(oralNoteDraft({ scenario: "S", assumptions: "", answer: "", coveredPoints: [] }).body).toBe("Scenario:\nS");
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  expect(await screen.findByText("Write the scenario first.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Scenario"), { target: { value: "S" } });
  fireEvent.change(screen.getByLabelText("Discussion points"), {
    target: { value: Array.from({ length: 13 }, (_, i) => `p${i}`).join("\n") },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText(/12 points or fewer/)).toBeTruthy();
});

it("uses no scoring words and no browser storage in the component", () => {
  for (const file of ["OralPracticeDialog.tsx", "../../logic/oralPractice.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).not.toMatch(/score|%|correct|pass|localStorage|sessionStorage|fetch\(|setInterval/i);
  }
});
