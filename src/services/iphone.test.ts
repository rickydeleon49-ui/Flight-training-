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

import { localStamp, macChangesCounts, revealIphoneBackup, sendChangesToIphone, sendToIphone } from "./iphone";

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

  it("falls back to the save dialog when iCloud Drive is off, and restarts the Mac's changes after the copy", async () => {
    const calls: string[] = [];
    mocks.invoke.mockImplementation(async (name: string) => {
      calls.push(name);
      if (name === "create_iphone_backup") return null;
      if (name === "change_stream_mark_before_copy") return 7;
      if (name === "create_complete_backup") return info;
      return undefined;
    });
    mocks.save.mockResolvedValueOnce("/chosen/file.hfdbackup");
    const result = await sendToIphone();
    expect(result).toEqual({ info, viaICloud: false });
    expect(mocks.invoke).toHaveBeenCalledWith("create_complete_backup", {
      destinationPath: "/chosen/file.hfdbackup",
    });
    expect(calls).toEqual([
      "create_iphone_backup",
      "change_stream_mark_before_copy",
      "create_complete_backup",
      "restart_change_stream_after_copy",
    ]);
    expect(mocks.invoke).toHaveBeenLastCalledWith("restart_change_stream_after_copy", { markBeforeCopy: 7 });
  });

  it("never restarts the changes when the copy fails", async () => {
    const calls: string[] = [];
    mocks.invoke.mockImplementation(async (name: string) => {
      calls.push(name);
      if (name === "create_iphone_backup") return null;
      if (name === "change_stream_mark_before_copy") return 7;
      throw new Error("disk full");
    });
    mocks.save.mockResolvedValueOnce("/chosen/file.hfdbackup");
    await expect(sendToIphone()).rejects.toThrow("disk full");
    expect(calls).not.toContain("restart_change_stream_after_copy");
  });

  it("still makes the copy when the starting point could not be read", async () => {
    mocks.invoke.mockImplementation(async (name: string) => {
      if (name === "create_iphone_backup") return null;
      if (name === "change_stream_mark_before_copy") throw new Error("nope");
      if (name === "create_complete_backup") return info;
      return undefined;
    });
    mocks.save.mockResolvedValueOnce("/chosen/file.hfdbackup");
    expect(await sendToIphone()).toEqual({ info, viaICloud: false });
    expect(mocks.invoke).not.toHaveBeenCalledWith("restart_change_stream_after_copy", expect.anything());
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

describe("sendChangesToIphone", () => {
  const sent = {
    fileName: "Changes from my Mac.hfdprogress",
    sentAt: "x",
    nothingNew: false,
    counts: { materials: 2, removed: 0, cardSets: 1, practiceTests: 0, studyGuides: 0 },
    pdfsIncluded: 0,
    pdfsLeft: 0,
    fileBytes: 10,
    path: "/x/Changes from my Mac.hfdprogress",
  };

  it("uses iCloud Drive when Rust saved there", async () => {
    mocks.invoke.mockResolvedValueOnce(sent);
    expect(await sendChangesToIphone()).toEqual({ sent, viaICloud: true });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("asks where to save with the real file name when iCloud Drive is off", async () => {
    mocks.invoke.mockResolvedValueOnce(null).mockResolvedValueOnce(sent);
    mocks.save.mockResolvedValueOnce("/chosen/Changes from my Mac.hfdprogress");
    expect(await sendChangesToIphone()).toEqual({ sent, viaICloud: false });
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "Changes from my Mac.hfdprogress" }),
    );
    expect(mocks.invoke).toHaveBeenLastCalledWith("send_mac_changes_to", {
      destinationPath: "/chosen/Changes from my Mac.hfdprogress",
    });
  });

  it("returns null when she cancels the dialog", async () => {
    mocks.invoke.mockResolvedValueOnce(null);
    mocks.save.mockResolvedValueOnce(null);
    expect(await sendChangesToIphone()).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("lists the counts in plain words", () => {
    expect(macChangesCounts(sent.counts)).toBe("2 study materials and 1 card set");
    expect(macChangesCounts({ materials: 0, removed: 0, cardSets: 0, practiceTests: 0, studyGuides: 0 })).toBeNull();
  });
});
