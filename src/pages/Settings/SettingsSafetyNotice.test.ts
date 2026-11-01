// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as backups from "@/services/backups";
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
afterEach(() => { vi.restoreAllMocks(); cleanup(); db.close(); localStorage.clear(); });

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

it("explains backup waiting and hides raw write errors", async () => {
  vi.spyOn(backups, "chooseCompleteBackupDestination").mockResolvedValue("/fictional/backup.zip");
  let reject!: (error: unknown) => void;
  vi.spyOn(backups, "createCompleteBackup").mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(h(AppDataProvider, null, h(MemoryRouter, null, h(Ready))));
  const button = await screen.findByRole("button", {name:"Save complete backup"});
  fireEvent.click(button);
  expect(await screen.findByRole("button", {name:"Saving your backup… This can take a minute when you have big PDFs."})).toBeTruthy();
  await waitFor(() => expect(reject).toBeDefined());
  await act(async () => reject("Could not create the backup file: Read-only file system (os error 30)"));
  expect(await screen.findByText("That folder can't be saved to. Choose another folder, like Documents.")).toBeTruthy();
  expect(screen.queryByText(/os error 30/)).toBeNull();
});
