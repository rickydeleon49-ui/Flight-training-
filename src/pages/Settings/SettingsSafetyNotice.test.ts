// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { Settings } from "./Settings";

let db: TestDatabase;
const status = vi.hoisted(() => ({ failed: false }));
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
vi.mock("@/services/backups", async (original) => ({
  ...(await original<typeof import("@/services/backups")>()),
  backupsAvailable: () => true,
  upgradeCopyFailed: async () => status.failed,
  dataDirectory: async () => "/fictional/data",
  listBackups: async () => [],
  appVersion: async () => "0.6.4",
}));
function Ready() {
  return useAppData().status === "ready" ? h(Settings) : null;
}
const sentence = "The safety copy before the last update couldn't be made. Make a complete backup now.";
beforeEach(async () => {
  localStorage.clear();
  status.failed = false;
  db = await createNodeSqliteDatabase();
});
afterEach(() => { cleanup(); db.close(); localStorage.clear(); });

it("shows the failed safety-copy sentence exactly once in Settings Your data", async () => {
  status.failed = true;
  render(h(AppDataProvider, null, h(MemoryRouter, null, h(Ready))));
  await screen.findByRole("heading", { name: "Your data" });
  await screen.findByText(sentence);
  expect(screen.getAllByText(sentence)).toHaveLength(1);
  expect(screen.getByText(sentence).getAttribute("role")).toBe("alert");
  expect(screen.getByText(sentence).closest("section, article, .card")?.textContent).toContain("Your data");
});

it("omits the sentence when no copy failure remains", async () => {
  render(h(AppDataProvider, null, h(MemoryRouter, null, h(Ready))));
  await screen.findByRole("heading", { name: "Your data" });
  await waitFor(() => expect(screen.getByText("/fictional/data")).toBeTruthy());
  expect(screen.queryByText(sentence)).toBeNull();
});
