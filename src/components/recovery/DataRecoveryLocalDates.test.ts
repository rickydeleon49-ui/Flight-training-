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

vi.mock("@/services/backups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/backups")>();
  return {
    ...actual,
    backupsAvailable: () => true,
    dataDirectory: () => Promise.resolve("/tmp/hfd"),
    listBackups: () => Promise.resolve(BACKUPS),
    openDataFolder: () => openDataFolderMock(),
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
