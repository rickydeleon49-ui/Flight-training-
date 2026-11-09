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
vi.mock("@/services/platform", async (original) => ({
  ...await original<typeof import("@/services/platform")>(),
  deviceCan: () => ({ geminiKey: true, generate: true, pdfKit: true, sendToIphone: true, getStudyMaterial: false }),
}));
function Ready() { return useAppData().status === "ready" ? <>
  <Link to="/settings">Settings menu</Link>
  <Link to="/settings#settings-backups">Backup settings</Link>
  <Link to="/settings#send-to-iphone">iPhone settings</Link>
  <Link to="/settings#ai-provider">Provider settings</Link>
  <Settings />
</> : null; }
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
it("Advanced has no 'not set up' note when Claude is the connected provider", async () => {
  vi.spyOn(backups, "backupsAvailable").mockReturnValue(false);
  vi.spyOn(appData, "isTauri").mockReturnValue(true);
  vi.spyOn(provider, "providerStatus").mockResolvedValue({ selected: "claude", providers: [{ id: "gemini", connected: false }, { id: "claude", connected: true }] });
  await open();
  await waitFor(() => expect(document.getElementById("settings-advanced-summary")!.textContent).toBe("Advanced"));
  expect(screen.getByText("Connected")).toBeTruthy();
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
  fireEvent.click(document.getElementById("settings-backups-summary")!);
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
it.each(["#settings-backups", "#send-to-iphone", "#ai-provider"])("opens only the group addressed by %s and scrolls to it", async (hash) => {
  const scrolled: string[] = [];
  const scroll = vi.fn(function (this: HTMLElement) {
    // The fold must be open before scrolling, so its heading is visible.
    expect(fold("backups").open).toBe(hash === "#settings-backups");
    expect(fold("advanced").open).toBe(hash === "#ai-provider");
    scrolled.push(this.id);
  });
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scroll });
  try {
    await open(hash);
    await waitFor(() => expect(scrolled).toEqual([hash.slice(1)]));
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
  } finally {
    if (original) Object.defineProperty(Element.prototype, "scrollIntoView", original);
    else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  }
});
it("hash navigation switches folds and a menu visit closes both", async () => {
  await open("#ai-provider");
  fireEvent.click(screen.getByRole("link", { name: "Backup settings" }));
  await waitFor(() => expect(fold("backups").open).toBe(true));
  expect(fold("advanced").open).toBe(false);
  fireEvent.click(screen.getByRole("link", { name: "iPhone settings" }));
  await waitFor(() => expect(fold("backups").open).toBe(false));
  expect(fold("advanced").open).toBe(false);
  fireEvent.click(screen.getByRole("link", { name: "Provider settings" }));
  await waitFor(() => expect(fold("advanced").open).toBe(true));
  fireEvent.click(screen.getByRole("link", { name: "Settings menu" }));
  await waitFor(() => expect(fold("advanced").open).toBe(false));
  expect(fold("backups").open).toBe(false);
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

it("POLISH-088: a Jump to row moves focus to the section heading and opens a fold", async () => {
  await open();
  const nav = screen.getByRole("navigation", { name: "Jump to" });
  const links = Array.from(nav.querySelectorAll("a")).map((a) => a.textContent);
  expect(links).toEqual(expect.arrayContaining(["About you", "Where you train", "Backups and data", "Advanced", "About & legal"]));
  fireEvent.click(screen.getByRole("link", { name: "Where you train" }));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Where you train" }));
  expect(fold("backups").open).toBe(false);
  fireEvent.click(screen.getByRole("link", { name: "Backups and data" }));
  expect(fold("backups").open).toBe(true);
  expect(document.activeElement?.textContent).toBe("Backups and data");
  fireEvent.click(screen.getByRole("link", { name: "Advanced" }));
  expect(fold("advanced").open).toBe(true);
});

it("POLISH-089: Jump to links are button-sized targets with space between them", async () => {
  await open();
  const nav = screen.getByRole("navigation", { name: "Jump to" });
  const links = Array.from(nav.querySelectorAll("a"));
  expect(links.length).toBeGreaterThan(3);
  for (const link of links) expect(link.className).toContain("settings-jumps__link");
  const css = readFileSync("src/pages/Settings/settings.css", "utf8");
  expect(css).toMatch(/\.settings-jumps__link\s*{[^}]*min-height:\s*36px/);
  expect(css).toMatch(/\.settings-jumps\s*{[^}]*gap:/);
});
