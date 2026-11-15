// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { jumpToMaterialHeading } from "./materialJump";
import { OralScenariosCard } from "./OralScenariosCard";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

// The same wrapper MaterialDetail renders around the card.
function Harness() {
  const ctx = useAppData();
  const material = ctx.data.materials[0];
  if (ctx.status !== "ready" || !material) return null;
  return h("div", { id: "material-oral", tabIndex: -1 }, h(OralScenariosCard, { material }));
}
const mount = () => render(h(AppDataProvider, null, h(MemoryRouter, null, h(Harness))));

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  await createRepositories(db).documents.create({ id: "m1", title: "Oral material" });
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

it("with no scenarios the jump opens the fold so Add a scenario is reachable and focus lands on the section", async () => {
  mount();
  const add = await screen.findByRole("button", { name: "Add a scenario" });
  const fold = add.closest("details")!;
  expect(fold.open).toBe(false);
  act(() => jumpToMaterialHeading("material-oral"));
  expect(fold.open).toBe(true);
  expect(document.activeElement).toBe(document.getElementById("material-oral"));
  expect(document.getElementById("material-oral")!.contains(add)).toBe(true);
});

it("with saved scenarios the jump leaves them visible (no closed fold) and focuses the section", async () => {
  await createRepositories(db).oralScenarios.create("m1", {
    prompt: "Synthetic oral scenario", assumptions: "", points: ["Point one"], sourcePage: null, origin: "user",
  });
  mount();
  const practice = await screen.findByRole("button", { name: "Practice: Synthetic oral scenario" });
  expect(practice.closest("details")).toBeNull();
  act(() => jumpToMaterialHeading("material-oral"));
  expect(practice.closest("details")).toBeNull();
  expect(screen.getByRole("button", { name: "Add a scenario" })).toBeTruthy();
  expect(document.activeElement).toBe(document.getElementById("material-oral"));
});

it("a jump to a missing id does nothing and does not throw", () => {
  expect(() => jumpToMaterialHeading("material-oral")).not.toThrow();
});
