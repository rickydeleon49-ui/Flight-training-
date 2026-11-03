// @vitest-environment jsdom
/**
 * DESKTOP-V054-04: the recovery screen listed safety copies by the UTC day in
 * their names, so a copy made on a California evening read as tomorrow.
 */
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import type { BackupInfo } from "@/services/backups";

const BACKUPS: BackupInfo[] = [
  {
    name: "2026-10-16-035630-manual",
    path: "/tmp/hfd/backups/2026-10-16-035630-manual",
    bytes: 2048,
    createdAt: 1_792_115_790,
    restorable: true,
  },
  {
    name: "unreadable-name",
    path: "/tmp/hfd/backups/unreadable-name",
    bytes: 2048,
    createdAt: 0,
    restorable: true,
  },
];

const openDataFolderMock = vi.fn<() => Promise<void>>();
const inspectCompleteBackupMock = vi.fn();

vi.mock("@/services/backups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/backups")>();
  return {
    ...actual,
    backupsAvailable: () => true,
    dataDirectory: () => Promise.resolve("/tmp/hfd"),
    listBackups: () => Promise.resolve(BACKUPS),
    openDataFolder: () => openDataFolderMock(),
    chooseCompleteBackup: async () => "/tmp/fictional.hfdbackup",
    inspectCompleteBackup: inspectCompleteBackupMock,
  };
});

const { DataRecovery } = await import("./DataRecovery");

let hadTz = false;
let originalTz: string | undefined;
beforeAll(() => {
  hadTz = "TZ" in process.env;
  originalTz = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T03:56:30Z"));
});
afterAll(() => {
  vi.useRealTimers();
  if (hadTz) process.env.TZ = originalTz;
  else delete process.env.TZ;
});
afterEach(cleanup);

it("keeps the database reason in closed Details after the plain opening sentence", async () => {
  const reason = "Semantic validation failed: invalid practice session";
  render(h(DataRecovery, { error: reason }));
  await screen.findByText("Taken by you · Thursday, October 15");
  const plain = screen.getByText("Your training data could not be opened.");
  const details = screen.getByText(reason).closest("details")!;
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")?.textContent).toBe("Details");
  expect(plain.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it.each([
  "Semantic validation failed: invalid practice session",
  "Restore journal validation failed: invalid entry",
])("shows a plain backup problem with closed technical Details: %s", async (reason) => {
  inspectCompleteBackupMock.mockRejectedValueOnce(reason);
  render(h(DataRecovery, { error: null }));
  await screen.findByText("Taken by you · Thursday, October 15");
  fireEvent.click(screen.getByRole("button", { name: "Choose a backup file…" }));
  const plain = await screen.findByText("This backup file has a problem and can't be used as is.");
  expect(plain.getAttribute("role")).toBe("alert");
  expect(plain.textContent).toBe("This backup file has a problem and can't be used as is.");
  const details = screen.getByText(reason).closest("details")!;
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")?.textContent).toBe("Details");
  expect(plain.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("lists a copy made on a California evening under that evening's day", async () => {
  render(h(DataRecovery, { error: null }));
  expect(await screen.findByText("Taken by you · Thursday, October 15")).toBeTruthy();
  expect(screen.queryByText(/2026-10-16/)).toBeNull();
});

it("says the date is unknown when a copy's name has no readable time", async () => {
  render(h(DataRecovery, { error: null }));
  expect(await screen.findByText("Database copy · date unknown")).toBeTruthy();
});

it("names the local day in the confirmation before putting a copy back", async () => {
  render(h(DataRecovery, { error: null }));
  await screen.findByText("Taken by you · Thursday, October 15");
  fireEvent.click(screen.getAllByRole("button", { name: "Put this back" })[0]!);
  expect(await screen.findByText(/on Thursday, October 15\./)).toBeTruthy();
});

it("opens the data folder through the desktop shell and shows its real message if that fails", async () => {
  openDataFolderMock.mockRejectedValueOnce("Could not open /tmp/hfd: permission denied");
  render(h(DataRecovery, { error: null }));
  await screen.findByText("Taken by you · Thursday, October 15");
  fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
  expect(openDataFolderMock).toHaveBeenCalledTimes(1);
  const message = await screen.findByText("Could not open /tmp/hfd: permission denied");
  expect(message.getAttribute("role")).toBe("alert");
});
