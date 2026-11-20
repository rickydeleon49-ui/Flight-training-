// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { OralDebriefRating } from "./OralDebriefRating";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

function Harness({ id = "s1" }: { id?: string }) {
  const ctx = useAppData();
  const material = ctx.data.materials[0];
  if (ctx.status !== "ready" || !material) return null;
  return h(OralDebriefRating, { scenarioId: id, title: "Title " + id, material });
}
const mount = (id?: string) => render(h(AppDataProvider, null, h(Harness, { id })));
const ratings = async () => (await createRepositories(db).toolkit.get()).oralRatings;

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  await createRepositories(db).documents.create({ id: "m1", title: "Oral material" });
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

it("saves the rating with area and title", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Needs work" }));
  fireEvent.change(screen.getByLabelText("ACS area"), { target: { value: "III" } });
  fireEvent.click(screen.getByRole("button", { name: "Save my rating" }));
  await screen.findByRole("status");
  expect(await ratings()).toEqual([
    expect.objectContaining({ scenarioId: "s1", title: "Title s1", rating: "Needs work", area: "PA.III" }),
  ]);
});

it("skip saves nothing and the save button needs a rating and an area", async () => {
  mount();
  const save = await screen.findByRole("button", { name: "Save my rating" });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(screen.queryByText("How did that feel?")).toBeNull();
  expect((await ratings()) ?? []).toEqual([]);
});

it("a new rating of the same scenario replaces the earlier one", async () => {
  const first = mount();
  fireEvent.click(await screen.findByRole("button", { name: "Needs work" }));
  fireEvent.change(screen.getByLabelText("ACS area"), { target: { value: "I" } });
  fireEvent.click(screen.getByRole("button", { name: "Save my rating" }));
  await screen.findByRole("status");
  first.unmount();
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Satisfactory" }));
  fireEvent.change(screen.getByLabelText("ACS area"), { target: { value: "II" } });
  fireEvent.click(screen.getByRole("button", { name: "Save my rating" }));
  await waitFor(async () => expect(await ratings()).toHaveLength(1));
  expect((await ratings())![0]).toMatchObject({ rating: "Satisfactory", area: "PA.II" });
});
