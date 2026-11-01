// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { makeMilestone } from "@/testing/factories";
import { expectNoA11yViolations } from "@/testing/a11y";
import { FlightPath } from "./FlightPath";

let data: AppData;
let db: TestDatabase;
let repositories: Repositories;
const mocks = vi.hoisted(() => ({ desktop: false, openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@/data", async (original) => ({ ...await original<object>(), isTauri: () => mocks.desktop }));
vi.mock("@/state/AppDataContext", async (original) => ({
  ...await original<object>(),
  useAppData: () => ({ data, repositories, mutate: vi.fn(), deleteWithUndo: vi.fn() }),
}));
vi.mock("./skills/SkillsSection", () => ({ SkillsSection: () => null }));

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase(); repositories = createRepositories(db);
  mocks.desktop = false;
  mocks.openUrl.mockReset().mockResolvedValue(undefined);
  data = { ...EMPTY_DATA, profile: { ...EMPTY_DATA.profile, flightSchool: "", trainingStartedOn: null } };
});
afterEach(() => { cleanup(); db.close(); });

function page() {
  return h(MemoryRouter, { initialEntries: ["/flight-path"] }, h(Routes, null,
    h(Route, { path: "/flight-path", element: h(FlightPath) }),
    h(Route, { path: "/finances", element: h("h1", null, "Training finances") }),
    h(Route, { path: "/study", element: h("h1", null, "Your study library") }),
  ));
}
const heading = () => screen.queryByRole("heading", { name: "Before you enroll" });

it.each([false, true])("shows on Flight Path without a school or start date (milestones: %s)", (milestones) => {
  if (milestones) data = { ...data, milestones: [makeMilestone()] };
  render(page());
  expect(heading()).not.toBeNull();
  expect(screen.getAllByRole("checkbox")).toHaveLength(8);
  expect(screen.getByText(/Check the details with/).textContent).toContain("Check the details with the FAA and your instructor.");
});

it("disappears immediately when a school is chosen, preserving ticks if cleared later", async () => {
  const view = render(page());
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);
  await waitFor(async () => expect(await repositories.studentPilotSteps.listDone()).toEqual(["discovery"]));
  data = { ...data, profile: { ...data.profile, flightSchool: "Example school" } };
  view.rerender(page());
  expect(heading()).toBeNull();
  data = { ...data, profile: { ...data.profile, flightSchool: "  " } };
  view.rerender(page());
  expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true);
});

it("saves ticks in her data, not in browser storage, and keeps them across remounts", async () => {
  const view = render(page());
  fireEvent.click(screen.getAllByRole("checkbox")[2]!);
  fireEvent.click(screen.getAllByRole("checkbox")[7]!);
  await waitFor(async () => expect(await repositories.studentPilotSteps.listDone()).toEqual(["checkride", "student"]));
  expect(localStorage.getItem("her-flight-deck.view.before-you-enroll")).toBeNull();
  view.unmount();
  render(page());
  await waitFor(() => expect((screen.getAllByRole("checkbox")[2] as HTMLInputElement).checked).toBe(true));
  expect((screen.getAllByRole("checkbox")[7] as HTMLInputElement).checked).toBe(true);
  expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(false);
});

it("moves ticks an older version kept in browser storage into her data once", async () => {
  localStorage.setItem("her-flight-deck.view.before-you-enroll", JSON.stringify({ hidden: false, done: ["discovery", "budget"] }));
  const view = render(page());
  await waitFor(() => expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true));
  await waitFor(async () => expect(await repositories.studentPilotSteps.listDone()).toEqual(["budget", "discovery"]));
  await waitFor(() => expect(JSON.parse(localStorage.getItem("her-flight-deck.view.before-you-enroll")!).done).toEqual([]));
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);
  await waitFor(async () => expect(await repositories.studentPilotSteps.listDone()).toEqual(["budget"]));
  view.unmount();
  render(page());
  await waitFor(() => expect((screen.getAllByRole("checkbox")[6] as HTMLInputElement).checked).toBe(true));
  expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(false);
});

it("gives every step an FAA link or an in-app link, only to faa.gov", () => {
  render(page());
  const faa = screen.getAllByRole("link", { name: /^FAA page:/ });
  expect(faa).toHaveLength(5);
  for (const link of faa) expect(link.getAttribute("href")).toMatch(/^https:\/\/www\.faa\.gov\//);
  expect(screen.getByText(/FAA pages last checked/)).not.toBeNull();
});

it("does not show when a start date is set without a school", () => {
  data.profile.trainingStartedOn = "2026-10-01";
  render(page());
  expect(heading()).toBeNull();
});

it("keeps every tick across remounts and allows a tick to be cleared", async () => {
  const view = render(page());
  for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
  await waitFor(async () => expect(await repositories.studentPilotSteps.listDone()).toHaveLength(8));
  view.unmount();
  const reloaded = render(page());
  await waitFor(() => expect(screen.getAllByRole("checkbox").every((box) => (box as HTMLInputElement).checked)).toBe(true));
  fireEvent.click(screen.getAllByRole("checkbox")[1]!);
  await waitFor(async () => expect(await repositories.studentPilotSteps.listDone()).toHaveLength(7));
  reloaded.unmount();
  render(page());
  await waitFor(() => expect(screen.getAllByRole("checkbox").map((box) => (box as HTMLInputElement).checked)).toEqual([true, false, true, true, true, true, true, true]));
});

it("keeps Hide across remounts", () => {
  const view = render(page());
  fireEvent.click(screen.getByRole("button", { name: "Hide" }));
  expect(heading()).toBeNull();
  view.unmount();
  render(page());
  expect(heading()).toBeNull();
});

it("Show first steps brings a hidden card back, with its ticks, on the same storage", async () => {
  const view = render(page());
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);
  await waitFor(async () => expect(await repositories.studentPilotSteps.listDone()).toEqual(["discovery"]));
  fireEvent.click(screen.getByRole("button", { name: "Hide" }));
  expect(heading()).toBeNull();
  view.unmount();
  render(page());
  fireEvent.click(screen.getByRole("button", { name: "Show first steps" }));
  expect(heading()).not.toBeNull();
  await waitFor(() => expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true));
  expect(screen.queryByRole("button", { name: "Show first steps" })).toBeNull();
  expect(JSON.parse(localStorage.getItem("her-flight-deck.view.before-you-enroll")!).hidden).toBe(false);
});

it("offers no Show first steps link once a school is chosen", () => {
  localStorage.setItem("her-flight-deck.view.before-you-enroll", JSON.stringify({ hidden: true, done: [] }));
  data.profile.flightSchool = "Example school";
  render(page());
  expect(screen.queryByRole("button", { name: "Show first steps" })).toBeNull();
});

it.each([["Finances", "/finances", "Training finances"], ["Study Library", "/study", "Your study library"]])(
  "opens the existing %s route", (name, href, title) => {
    render(page());
    const link = screen.getByRole("link", { name });
    expect(link.getAttribute("href")).toBe(href);
    fireEvent.click(link);
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  },
);

it("uses the external opener for each FAA source on desktop and handles failure", async () => {
  mocks.desktop = true;
  render(page());
  const links = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("https://www.faa.gov/"));
  expect(links).toHaveLength(8);
  for (const link of links) {
    fireEvent.click(link);
    expect(mocks.openUrl).toHaveBeenLastCalledWith(link.getAttribute("href"));
  }
  mocks.openUrl.mockRejectedValueOnce(new Error("synthetic failure"));
  fireEvent.click(links[0]!);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not open"));
});

it("falls back to unchecked for an invalid stored preference", () => {
  localStorage.setItem("her-flight-deck.view.before-you-enroll", JSON.stringify({ hidden: "false", done: ["unknown"] }));
  render(page());
  expect(heading()).not.toBeNull();
  expect(screen.getAllByRole("checkbox").some((box) => (box as HTMLInputElement).checked)).toBe(false);
});

it("passes axe before and after ticking", async () => {
  const view = render(page());
  await expectNoA11yViolations(view.container);
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);
  await expectNoA11yViolations(view.container);
});
