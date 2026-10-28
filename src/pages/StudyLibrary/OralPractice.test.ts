// @vitest-environment jsdom
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { AppDataProvider, UNDO_WINDOW_MS, useAppData } from "@/state/AppDataContext";
import { UndoBar } from "@/components/undo/UndoBar";
import { Notes } from "@/pages/Notes/Notes";
import { OralScenariosCard } from "./OralScenariosCard";
import { parseOralPoints, oralNoteDraft } from "@/logic/oralPractice";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

const POINTS = ["Zebra alpha point", "Quokka bravo point", "Narwhal charlie point"];

function Harness() {
  const ctx = useAppData();
  const material = ctx.data.materials[0];
  if (ctx.status !== "ready" || !material) return null;
  return h("div", null, h(OralScenariosCard, { material }), h(UndoBar));
}
function Page() {
  return h(Routes, null,
    h(Route, { path: "/", element: h(Harness) }),
    h(Route, { path: "/notes", element: h(Notes) }),
  );
}
const mount = () => render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/"] }, h(Page))));
const count = async (table: string) => (await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]!.n;
const repos = () => createRepositories(db).oralScenarios;
const seed = (prompt: string, points = POINTS, origin: "user" | "instructor" = "user") =>
  repos().create("m1", { prompt, assumptions: "Fictional Alpha panel", points, sourcePage: null, origin });

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  await createRepositories(db).documents.create({ id: "m1", title: "Oral material" });
});
afterEach(() => { cleanup(); db.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function practise(title: string, answer?: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Practise: ${title}` }));
  const box = await screen.findByLabelText(/Your answer \(optional\)/);
  if (answer !== undefined) fireEvent.change(box, { target: { value: answer } });
}

it("adds a scenario with her instructor as the origin and lists its first line", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Add a scenario" }));
  fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));
  expect(await screen.findByText("Write the scenario first.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Scenario"), { target: { value: "Engine roughness at 3,000 feet\nSecond line" } });
  fireEvent.change(screen.getByLabelText("Discussion points"), {
    target: { value: Array.from({ length: 13 }, (_, i) => `p${i}`).join("\n") },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));
  expect(await screen.findByText(/12 points or fewer/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Discussion points"), { target: { value: POINTS.join("\n") } });
  fireEvent.click(screen.getByLabelText("My instructor gave me this"));
  fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));
  expect(await screen.findByRole("button", { name: "Practise: Engine roughness at 3,000 feet" })).toBeTruthy();
  expect(screen.getByText(/From my instructor/)).toBeTruthy();
  expect(await db.select("SELECT origin, points_json FROM oral_scenario_versions")).toEqual([
    { origin: "instructor", points_json: JSON.stringify(POINTS) },
  ]);
});

it("keeps the discussion points out of the page until she shows them, then offers the next scenario", async () => {
  await seed("Scenario Alpha");
  await seed("Scenario Bravo", ["Bravo only point"]);
  mount();
  await practise("Scenario Alpha", "carb heat first");
  for (const point of POINTS) expect(document.body.innerHTML).not.toContain(point);
  expect(document.body.innerHTML).not.toContain("Bravo only point");
  fireEvent.click(screen.getByRole("button", { name: "Show discussion points" }));
  for (const point of POINTS) expect(await screen.findByText(point)).toBeTruthy();
  expect(screen.getByText("carb heat first")).toBeTruthy();
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Next scenario" }));
  expect((await screen.findByLabelText(/Your answer \(optional\)/) as HTMLTextAreaElement).value).toBe("");
  expect(document.body.innerHTML).not.toContain("Bravo only point");
  fireEvent.click(screen.getByRole("button", { name: "Show discussion points" }));
  expect(await screen.findByText("Bravo only point")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Next scenario" })).toBeNull();
});

it("works with the keyboard alone (native buttons and fields, no pointer handlers)", async () => {
  await seed("Scenario Alpha");
  mount();
  await practise("Scenario Alpha");
  const show = screen.getByRole("button", { name: "Show discussion points" });
  expect(show.tagName).toBe("BUTTON");
  show.focus();
  expect(document.activeElement).toBe(show);
  fireEvent.click(show);
  const heading = await screen.findByRole("heading", { name: "Your discussion points" });
  await waitFor(() => expect(document.activeElement).toBe(heading));
  const first = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
  first.focus();
  fireEvent.click(first);
  expect(first.checked).toBe(true);
});

it("accepts a 20,000-character answer and never stores answers or ticks", async () => {
  await seed("Scenario Alpha");
  mount();
  const long = "x".repeat(20000);
  await practise("Scenario Alpha", long);
  const box = screen.getByLabelText(/Your answer \(optional\)/) as HTMLTextAreaElement;
  expect(box.value.length).toBe(20000);
  expect(box.maxLength).toBe(20000);
  fireEvent.click(screen.getByRole("button", { name: "Show discussion points" }));
  fireEvent.click((await screen.findAllByRole("checkbox"))[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  const tables = await db.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'oral%' ORDER BY name");
  expect(tables.map((t) => t.name)).toEqual(["oral_save_operations", "oral_scenario_versions", "oral_scenarios"]);
  const dump = JSON.stringify(await db.select("SELECT * FROM oral_scenario_versions")) + JSON.stringify(await db.select("SELECT * FROM oral_save_operations"));
  expect(dump).not.toContain("xxxxxxxxxx");
  expect(await count("oral_save_operations")).toBe(1);
  expect(await count("notes")).toBe(0);
  expect(await count("questions")).toBe(0);
});

it("writes nothing when she cancels", async () => {
  await seed("Scenario Alpha");
  mount();
  await practise("Scenario Alpha", "my answer");
  fireEvent.click(screen.getByRole("button", { name: "Show discussion points" }));
  await screen.findByText(POINTS[0]!);
  fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);
  fireEvent.click(await screen.findByRole("button", { name: "Add a scenario" }));
  fireEvent.change(screen.getByLabelText("Scenario"), { target: { value: "Unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(await count("questions")).toBe(0);
  expect(await count("notes")).toBe(0);
  expect(await count("oral_scenarios")).toBe(1);
  expect(await count("oral_save_operations")).toBe(1);
});

it("Ask my instructor adds exactly one question linked to the material, once", async () => {
  await seed("Engine roughness at 3,000 feet");
  mount();
  await practise("Engine roughness at 3,000 feet", "carb heat first");
  fireEvent.click(screen.getByRole("button", { name: "Show discussion points" }));
  fireEvent.click((await screen.findAllByRole("checkbox"))[0]!);
  const ask = screen.getByRole("button", { name: "Ask my instructor" });
  fireEvent.click(ask); fireEvent.click(ask);
  await screen.findByText("Added to your Questions.");
  expect(await count("questions")).toBe(1);
  const row = (await db.select<{ text: string; material_id: string }>("SELECT text, material_id FROM questions"))[0]!;
  expect(row.material_id).toBe("m1");
  expect(row.text).toContain("Engine roughness at 3,000 feet");
  expect(row.text).toContain("carb heat first");
  expect(row.text).toContain("- Zebra alpha point");
  expect(row.text).not.toContain("Quokka");
  expect(await count("notes")).toBe(0);
});

it("Write a note opens the Notes editor prefilled and saves only on Save note", async () => {
  await seed("Engine roughness at 3,000 feet");
  mount();
  await practise("Engine roughness at 3,000 feet", "carb heat first");
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

it("an edit adds a new version and keeps the earlier one", async () => {
  await seed("Scenario Alpha");
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Edit: Scenario Alpha" }));
  const prompt = screen.getByLabelText("Scenario") as HTMLTextAreaElement;
  expect(prompt.value).toBe("Scenario Alpha");
  expect((screen.getByLabelText("Discussion points") as HTMLTextAreaElement).value).toBe(POINTS.join("\n"));
  fireEvent.change(prompt, { target: { value: "Scenario Alpha, reworded" } });
  fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));
  expect(await screen.findByRole("button", { name: "Practise: Scenario Alpha, reworded" })).toBeTruthy();
  expect(await db.select("SELECT version_number, prompt FROM oral_scenario_versions ORDER BY version_number")).toEqual([
    { version_number: 1, prompt: "Scenario Alpha" },
    { version_number: 2, prompt: "Scenario Alpha, reworded" },
  ]);
});

it("moves a scenario up and down", async () => {
  await seed("Scenario Alpha");
  await seed("Scenario Bravo");
  mount();
  expect((await screen.findByRole("button", { name: "Move up: Scenario Alpha" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Move down: Scenario Alpha" }));
  await waitFor(async () => expect((await repos().list("m1")).map((s) => s.prompt)).toEqual(["Scenario Bravo", "Scenario Alpha"]));
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^Practise:/ }).map((b) => b.getAttribute("aria-label"))).toEqual([
    "Practise: Scenario Bravo",
    "Practise: Scenario Alpha",
  ]));
  fireEvent.click(screen.getByRole("button", { name: "Move up: Scenario Alpha" }));
  await waitFor(async () => expect((await repos().list("m1")).map((s) => s.prompt)).toEqual(["Scenario Alpha", "Scenario Bravo"]));
});

it("moving another scenario while a removal waits on Undo still saves", async () => {
  await seed("Scenario Alpha");
  await seed("Scenario Bravo");
  await seed("Scenario Charlie");
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Remove: Scenario Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Practise: Scenario Alpha" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Move down: Scenario Bravo" }));
  await waitFor(async () => expect((await repos().list("m1")).map((s) => s.prompt)).toEqual(["Scenario Charlie", "Scenario Bravo", "Scenario Alpha"]));
  expect(screen.queryByText(/changed in the meantime/)).toBeNull();
});

it("shows no move buttons for a single scenario", async () => {
  await seed("Scenario Alpha");
  mount();
  await screen.findByRole("button", { name: "Practise: Scenario Alpha" });
  expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
});

it("Remove asks first, hides the scenario at once, Undo brings it back, and it goes when the window closes", async () => {
  await seed("Scenario Alpha");
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Remove: Scenario Alpha" }));
  expect(screen.getByText("Remove this scenario?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Practise: Scenario Alpha" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(await screen.findByRole("button", { name: "Practise: Scenario Alpha" })).toBeTruthy();
  expect(await count("oral_save_operations")).toBe(1);

  vi.useFakeTimers({ shouldAdvanceTime: true });
  fireEvent.click(screen.getByRole("button", { name: "Remove: Scenario Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await act(async () => { vi.advanceTimersByTime(UNDO_WINDOW_MS + 10); });
  await waitFor(async () => expect(await repos().list("m1")).toEqual([]));
  expect(await db.select("SELECT removed_at IS NOT NULL AS gone FROM oral_scenarios")).toEqual([{ gone: 1 }]);
  expect(await count("oral_scenario_versions")).toBe(1);
});

it("parses one point per line and uses no scoring words or browser storage", () => {
  expect(parseOralPoints(" a \n\n b\r\n")).toEqual(["a", "b"]);
  expect(oralNoteDraft({ scenario: "S", assumptions: "", answer: "", coveredPoints: [] }).body).toBe("Scenario:\nS");
  for (const file of ["OralPracticeDialog.tsx", "OralScenarioEditor.tsx", "OralScenariosCard.tsx", "../../logic/oralPractice.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).not.toMatch(/score|%|correct|pass|localStorage|sessionStorage|fetch\(|setInterval/i);
  }
});
