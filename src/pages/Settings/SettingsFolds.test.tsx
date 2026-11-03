// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as backups from "@/services/backups";
import * as provider from "@/services/provider";
import * as appData from "@/data";
import { Settings } from "./Settings";
let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
function Ready() { return useAppData().status === "ready" ? <><Link to="/settings#ai-provider">Provider settings</Link><Settings /></> : null; }
async function open(hash = "") {
  render(<AppDataProvider><MemoryRouter initialEntries={[`/settings${hash}`]}><Ready /></MemoryRouter></AppDataProvider>);
  await screen.findByRole("heading", { name: "About you" });
}
const fold = (name: string) => document.getElementById(`settings-${name}`) as HTMLDetailsElement;
beforeEach(async () => { localStorage.clear(); db = await createNodeSqliteDatabase(); });
afterEach(() => { cleanup(); db.close(); localStorage.clear(); vi.restoreAllMocks(); });
it("Backups and data and Advanced start closed", async () => {
  await open();
  expect(fold("backups").open).toBe(false);
  expect(fold("advanced").open).toBe(false);
  expect(screen.getByText("Advanced · AI provider not set up")).toBeTruthy();
});
it.each(["backup", "restore"])("a %s result opens Backups and data; she can close it after seeing it", async (operation) => {
  vi.spyOn(backups, "backupsAvailable").mockReturnValue(true);
  vi.spyOn(backups, "upgradeCopyFailed").mockResolvedValue(false);
  vi.spyOn(backups, "dataDirectory").mockResolvedValue("");
  vi.spyOn(backups, "listBackups").mockResolvedValue([]);
  vi.spyOn(backups, "appVersion").mockResolvedValue("0.0.0");
  let reject!: (reason: string) => void;
  vi.spyOn(backups, operation === "backup" ? "chooseCompleteBackupDestination" : "chooseCompleteBackup").mockImplementation(() => new Promise((_, no) => { reject = no; }));
  await open();
  fireEvent.click(screen.getByText("Backups and data"));
  fireEvent.click(screen.getByRole("button", { name: operation === "backup" ? "Save complete backup" : "Restore backup" }));
  fold("backups").open = false;
  await act(async () => { reject("Synthetic backup failure"); });
  await screen.findByRole("alert");
  await waitFor(() => expect(fold("backups").open).toBe(true));
  // A summary that refuses to close looks broken; once shown, closing is her choice.
  fold("backups").open = false;
  await act(async () => {});
  expect(fold("backups").open).toBe(false);
});
it.each(["#settings-backups", "#ai-provider"])("opens the group addressed by %s", async (hash) => {
  await open(hash);
  await waitFor(() => expect(fold(hash === "#ai-provider" ? "advanced" : "backups").open).toBe(true));
});
it("#ai-provider opens Advanced after navigation and the material page links there", async () => {
  await open();
  fireEvent.click(screen.getByRole("link", { name: "Provider settings" }));
  await waitFor(() => expect(fold("advanced").open).toBe(true));
  expect(document.getElementById("ai-provider")).toBeTruthy();
  const material = readFileSync(`${process.cwd()}/src/pages/StudyLibrary/MaterialDetail.tsx`, "utf8");
  expect(material).toContain('to="/settings#ai-provider">Open Settings</Link>');
});
it("an asynchronous provider error opens Advanced", async () => {
  vi.spyOn(backups, "backupsAvailable").mockReturnValue(false);
  vi.spyOn(appData, "isTauri").mockReturnValue(true);
  vi.spyOn(provider, "providerStatus").mockRejectedValue("Synthetic connection failure");
  await open();
  await screen.findByRole("alert");
  await waitFor(() => expect(fold("advanced").open).toBe(true));
});
