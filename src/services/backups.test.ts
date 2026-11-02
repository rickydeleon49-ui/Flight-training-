import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
  openPath: vi.fn(),
  save: vi.fn(),
  open: vi.fn(),
  isIOS: vi.fn(() => false),
}));

vi.mock("@/data", () => ({
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: mocks.openPath,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.open,
  save: mocks.save,
}));

vi.mock("./platform", () => ({ isIOS: mocks.isIOS }));

import { chooseCompleteBackup, chooseCompleteBackupDestination, dataDirectory, openDataFolder, importPickedBackup, discardIncomingBackup, exitForRestore, phoneActivitySummary } from "./backups";

beforeEach(() => {
  mocks.isTauri.mockReturnValue(false);
  mocks.invoke.mockReset();
  mocks.openPath.mockReset();
  mocks.save.mockReset();
  mocks.open.mockReset();
  mocks.isIOS.mockReturnValue(false);
});

describe("complete backup file name", () => {
  it("is dated with her local day, not the UTC one", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.save.mockResolvedValueOnce(null);
    const originalTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // Late evening locally: in the Americas the UTC date is already tomorrow.
      vi.setSystemTime(new Date("2026-10-15T06:30:00.000Z"));
      await chooseCompleteBackupDestination();
    } finally {
      vi.useRealTimers();
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "her-flight-deck-2026-10-14.hfdbackup" }),
    );
  });
});

describe("data directory outside the desktop shell", () => {
  it("reports no path rather than failing", async () => {
    expect(await dataDirectory()).toBe("");
  });

  it("refuses to open the data folder without the desktop application", async () => {
    await expect(openDataFolder()).rejects.toThrow("This needs the desktop application.");
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_data_folder");
  });
});

describe("data directory inside desktop shell", () => {
  it("returns the exact data directory path from the desktop shell", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.invoke.mockResolvedValueOnce("C:\\Users\\Pilot\\AppData\\Roaming\\com.herflightdeck.app");

    const path = await dataDirectory();
    expect(path).toBe("C:\\Users\\Pilot\\AppData\\Roaming\\com.herflightdeck.app");
    expect(mocks.invoke).toHaveBeenCalledWith("data_directory");
  });

  it("asks the desktop shell to open its own data folder, passing no path", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.invoke.mockResolvedValueOnce(undefined);

    await openDataFolder();

    expect(mocks.invoke).toHaveBeenCalledWith("open_data_folder");
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("passes the desktop shell's own failure message through", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.invoke.mockRejectedValueOnce("Could not open /Users/pilot/Library/Application Support/com.herflightdeck.app: denied");

    await expect(openDataFolder()).rejects.toBe(
      "Could not open /Users/pilot/Library/Application Support/com.herflightdeck.app: denied",
    );
  });
});

describe("phone import plumbing", () => {
  it("imports the selected path and returns the inspected copy", async () => {
    mocks.isTauri.mockReturnValue(true);
    const info = { path: "/app/.incoming/latest.hfdbackup" };
    mocks.invoke.mockResolvedValueOnce(info);
    expect(await importPickedBackup("/picked/copy.hfdbackup")).toBe(info);
    expect(mocks.invoke).toHaveBeenCalledWith("import_picked_backup", { sourcePath: "/picked/copy.hfdbackup" });
  });

  it("discards the incoming copy without passing a path", async () => {
    mocks.isTauri.mockReturnValue(true);
    await discardIncomingBackup();
    expect(mocks.invoke).toHaveBeenCalledWith("discard_incoming_backup");
  });

  it("exits for restore without passing arguments", async () => {
    mocks.isTauri.mockReturnValue(true);
    await exitForRestore();
    expect(mocks.invoke).toHaveBeenCalledWith("exit_for_restore");
  });

  it("returns the native activity summary", async () => {
    mocks.isTauri.mockReturnValue(true);
    const summary = { latestReviewAt: "2026-10-30T12:00:00Z", reviewsLast7Days: 2, attemptsLast7Days: 1 };
    mocks.invoke.mockResolvedValueOnce(summary);
    expect(await phoneActivitySummary()).toBe(summary);
    expect(mocks.invoke).toHaveBeenCalledWith("phone_activity_summary");
  });

  it("never invokes phone commands outside Tauri, including exit", async () => {
    await expect(importPickedBackup("/picked/copy.hfdbackup")).rejects.toThrow("Restore needs the application.");
    await discardIncomingBackup();
    await expect(exitForRestore()).rejects.toThrow("Restore needs the application.");
    expect(await phoneActivitySummary()).toEqual({ latestReviewAt: null, reviewsLast7Days: 0, attemptsLast7Days: 0 });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("backup picker filters", () => {
  it.each([false, true])("only filters extensions outside iOS (iOS=%s)", async (ios) => {
    mocks.isTauri.mockReturnValue(true);
    mocks.isIOS.mockReturnValue(ios);
    mocks.open.mockResolvedValue("/picked/material.hfdbackup");
    expect(await chooseCompleteBackup()).toBe("/picked/material.hfdbackup");
    const options = mocks.open.mock.calls[0]![0];
    expect(options).toMatchObject({ multiple: false, directory: false });
    if (ios) expect(options).not.toHaveProperty("filters");
    else expect(options.filters).toEqual([{ name: "Her Flight Deck backup", extensions: ["hfdbackup"] }]);
  });
});
