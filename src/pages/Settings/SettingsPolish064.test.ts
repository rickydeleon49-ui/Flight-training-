// @vitest-environment jsdom
/** POLISH-064: Settings on a Mac says each thing once, without "On macOS:" labels. */
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { Settings } from "@/pages/Settings/Settings";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));
vi.mock("@/lib/platform", async (original) => ({
  ...(await original<typeof import("@/lib/platform")>()),
  isMacOS: () => true,
  isWindowsOS: () => false,
}));

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  return null;
}
function Ready() {
  return useAppData().status === "ready"
    ? h(Routes, null, h(Route, { path: "/settings", element: h(Settings) }))
    : null;
}
async function open() {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/settings"] }, h(Probe), h(Ready))));
  await waitFor(() => expect(context.status).toBe("ready"));
  await screen.findByRole("heading", { name: "About you" });
}

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
});
afterEach(() => {
  cleanup();
  db.close();
  localStorage.clear();
});

it("shows Mac notes without an \"On macOS:\" label, and drops the stale, repeated and tester notes", async () => {
  await open();
  const text = document.body.textContent ?? "";
  expect(text).toContain("Press Save profile before closing the window.");
  expect(text).not.toContain("On macOS:");
  expect(text).not.toMatch(/region and calendar settings/);
  expect(text).not.toMatch(/changes immediately/);
  expect(text).toContain("Takes effect straight away.");
  expect(text).not.toMatch(/record the exact message for investigation/);
  expect(text).toContain("Her Flight Deck supports macOS 12 or newer.");
});

it("both profile buttons are called Save profile, and either one saves the name and why note", async () => {
  await open();
  const buttons = screen.getAllByRole("button", { name: "Save profile" });
  expect(buttons).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  for (const [index, button] of buttons.entries()) {
    fireEvent.change(screen.getByLabelText("What should we call you?"), { target: { value: `Avery ${index}` } });
    fireEvent.change(screen.getByLabelText(/Why did you start flying\?/), { target: { value: `Because ${index}` } });
    fireEvent.click(button);
    await waitFor(() => expect(context.data.profile.whyNote).toBe(`Because ${index}`));
    expect(context.data.profile.pilotName).toBe(`Avery ${index}`);
  }
});

it("BUGFIX-064: with two bad dates, Save profile stops at the first and focuses it", async () => {
  await open();
  const started = screen.getByLabelText("Training started");
  const medical = screen.getByLabelText("Medical certificate expires");
  fireEvent.change(started, { target: { value: "13292026" } });
  fireEvent.change(medical, { target: { value: "02302026" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save profile" })[0]!);
  expect(document.activeElement).toBe(started);
  expect(screen.getAllByText("That isn't a date — try 11/05/2026.")).toHaveLength(1);
  fireEvent.change(started, { target: { value: "" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save profile" })[0]!);
  expect(document.activeElement).toBe(medical);
  expect(screen.getByText("That isn't a date — try 11/05/2026.")).toBeTruthy();
});

it("FULLAPP-065: Your data says how many automatic copies are kept, matching backup.rs", async () => {
  const { readFileSync } = await import("node:fs");
  const keep = /const KEEP_BACKUPS: usize = (\d+);/.exec(readFileSync("src-tauri/src/backup.rs", "utf8"))?.[1];
  expect(keep).toBe("10");
  await open();
  expect(document.body.textContent).toContain(`The ${keep} newest copies are kept.`);
});
