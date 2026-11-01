import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/data", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: mocks.save }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));

import { localStamp, revealIphoneBackup, sendToIphone } from "./iphone";

const info = { bytes: 1234, path: "/x/y.hfdbackup" };

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.save.mockReset();
});

describe("sendToIphone", () => {
  it("formats the local stamp for the file name", () => {
    expect(localStamp(new Date(2026, 9, 31, 9, 5))).toBe("2026-10-31 0905");
  });

  it("uses iCloud Drive when Rust saved there", async () => {
    mocks.invoke.mockResolvedValueOnce(info);
    const result = await sendToIphone();
    expect(result).toEqual({ info, viaICloud: true });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "create_iphone_backup",
      expect.objectContaining({ localStamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{4}$/) }),
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("falls back to the save dialog when iCloud Drive is off", async () => {
    mocks.invoke.mockResolvedValueOnce(null).mockResolvedValueOnce(info);
    mocks.save.mockResolvedValueOnce("/chosen/file.hfdbackup");
    const result = await sendToIphone();
    expect(result).toEqual({ info, viaICloud: false });
    expect(mocks.invoke).toHaveBeenLastCalledWith("create_complete_backup", {
      destinationPath: "/chosen/file.hfdbackup",
    });
  });

  it("returns null when she cancels the dialog", async () => {
    mocks.invoke.mockResolvedValueOnce(null);
    mocks.save.mockResolvedValueOnce(null);
    expect(await sendToIphone()).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("asks Rust to show the file", async () => {
    mocks.invoke.mockResolvedValueOnce(undefined);
    await revealIphoneBackup("/x/y.hfdbackup");
    expect(mocks.invoke).toHaveBeenCalledWith("reveal_iphone_backup", { path: "/x/y.hfdbackup" });
  });
});
