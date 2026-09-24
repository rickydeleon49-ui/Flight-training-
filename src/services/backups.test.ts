import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
  openPath: vi.fn(),
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

import { dataDirectory, revealFolder } from "./backups";

beforeEach(() => {
  mocks.isTauri.mockReturnValue(false);
  mocks.invoke.mockReset();
  mocks.openPath.mockReset();
});

describe("data directory outside the desktop shell", () => {
  it("reports no path rather than failing", async () => {
    expect(await dataDirectory()).toBe("");
  });

  it("refuses to reveal a folder without the desktop application", async () => {
    await expect(revealFolder("/some/path")).rejects.toThrow(
      "This needs the desktop application.",
    );
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

  it("reveals the identical path displayed in Settings", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.openPath.mockResolvedValueOnce(undefined);

    const displayedPath = "C:\\Users\\Pilot\\AppData\\Roaming\\com.herflightdeck.app";
    await revealFolder(displayedPath);

    expect(mocks.openPath).toHaveBeenCalledWith(displayedPath);
  });

  it("propagates opener failure if the OS refuses to open the folder", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.openPath.mockRejectedValueOnce(new Error("Path not allowed by scope"));

    await expect(revealFolder("C:\\invalid")).rejects.toThrow("Path not allowed by scope");
  });
});
