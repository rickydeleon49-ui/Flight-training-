// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { makeMaterial } from "@/testing/factories";
import { expectNoA11yViolations } from "@/testing/a11y";
import type { AppData } from "@/state/AppDataContext";
import { StudyLibrary } from "./StudyLibrary";

let db: TestDatabase;
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({
    data: { materials: [makeMaterial({ id: "synthetic-material", title: "Synthetic study notes" })], actions: [], goals: [], events: [], aiStudySets: [], practiceTests: [], questions: [] } as unknown as AppData,
    dataRevision: 0,
    repositories: createRepositories(db),
    mutate: vi.fn(),
  }),
}));

let navigate: NavigateFunction;
function Address() {
  navigate = useNavigate();
  return <output aria-label="Address">{useLocation().search}</output>;
}
function open(path = "/study?keep=yes") {
  return render(<MemoryRouter initialEntries={[path]}><Address /><StudyLibrary /></MemoryRouter>);
}

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  db = await createNodeSqliteDatabase();
});
afterEach(() => { cleanup(); db.close(); });

const keys = ["library", "due", "history", "howto"];
function selected(index: number, focused = false) {
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.tabIndex)).toEqual(keys.map((_, i) => i === index ? 0 : -1));
  tabs.forEach((tab, i) => {
    expect(tab.id).toBe(`library-tab-${keys[i]}`);
    expect(tab.className).toBe(`library-tab${i === index ? " is-active" : ""}`);
    expect(tab.getAttribute("aria-selected")).toBe(String(i === index));
    expect(tab.getAttribute("aria-controls")).toBe(`library-panel-${keys[i]}`);
  });
  const panel = screen.getByRole("tabpanel");
  expect(panel.id).toBe(`library-panel-${keys[index]}`);
  expect(panel.getAttribute("aria-labelledby")).toBe(tabs[index]!.id);
  if (focused) expect(document.activeElement).toBe(tabs[index]);
}

it("ArrowRight/Left, Home and End select and focus tabs, keep one tab stop, and update only ?tab=", async () => {
  open();
  selected(0);
  act(() => screen.getAllByRole("tab")[0]!.focus());
  for (const [key, index] of [["ArrowRight", 1], ["ArrowRight", 2], ["ArrowLeft", 1], ["End", 3], ["Home", 0]] as const) {
    fireEvent.keyDown(document.activeElement!, { key });
    selected(index, true);
    const params = new URLSearchParams(screen.getByLabelText("Address").textContent!);
    expect(params.get("keep")).toBe("yes");
    expect(params.get("tab")).toBe(index === 0 ? null : keys[index]);
  }
  await waitFor(() => expect(screen.queryByText("Checking cards…")).toBeNull());
});

for (const [index, key] of keys.entries()) {
  it(`deep link ?tab=${key} selects the existing panel and passes axe`, async () => {
    const { container } = open(`/study?tab=${key}`);
    selected(index);
    await expectNoA11yViolations(container);
  });
}

it("follows later URL navigation and browser back without local selection drift", async () => {
  open();
  await act(async () => { await navigate("/study?tab=history"); });
  selected(2);
  await act(async () => { await navigate(-1); });
  selected(0);
  await act(async () => { await navigate("/study?tab=unknown"); });
  selected(0);
});
