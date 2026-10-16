import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
  openPath: vi.fn(),
  save: vi.fn(),
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
  open: vi.fn(),
  save: mocks.save,
}));

import { chooseCompleteBackupDestination, dataDirectory, openDataFolder } from "./backups";

beforeEach(() => {
  mocks.isTauri.mockReturnValue(false);
  mocks.invoke.mockReset();
  mocks.openPath.mockReset();
  mocks.save.mockReset();
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
