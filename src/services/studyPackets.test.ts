import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
}));

vi.mock("@/data", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { DesktopOnlyError } from "./documents";
import { pickStudyPacket, StudyPacketReadError } from "./studyPackets";

const packet = {
  fileName: "packet.json",
  byteLength: 12,
  sha256: "a".repeat(64),
  text: '{"title":1}',
  bomRemoved: false,
};

beforeEach(() => {
  mocks.isTauri.mockReturnValue(true);
  mocks.invoke.mockReset();
});

describe("pickStudyPacket (simulated invoke; no native dialog opens in tests)", () => {
  it("refuses outside the desktop app without invoking anything", async () => {
    mocks.isTauri.mockReturnValue(false);
    await expect(pickStudyPacket()).rejects.toBeInstanceOf(DesktopOnlyError);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("invokes only the read-only command with no arguments, so the webview never supplies a path", async () => {
    mocks.invoke.mockResolvedValue(packet);
    await expect(pickStudyPacket()).resolves.toEqual(packet);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("pick_study_packet");
  });

  it("returns null when the dialog is cancelled", async () => {
    mocks.invoke.mockResolvedValue(null);
    await expect(pickStudyPacket()).resolves.toBeNull();
  });

  it.each(["file_empty", "file_too_large", "file_read_failed", "unsupported_encoding", "invalid_utf8"] as const)(
    "maps the native %s failure to a fixed error",
    async (code) => {
      mocks.invoke.mockRejectedValue({ code, message: "native text" });
      const error = await pickStudyPacket().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(StudyPacketReadError);
      expect((error as StudyPacketReadError).code).toBe(code);
      expect((error as Error).message).not.toContain("native text");
    },
  );

  it("never repeats an unexpected native error, which might contain a path", async () => {
    mocks.invoke.mockRejectedValue("Could not open /Users/someone/Private/notes.json");
    const error = (await pickStudyPacket().catch((e: unknown) => e)) as StudyPacketReadError;
    expect(error.code).toBe("file_read_failed");
    expect(error.message).toBe("The file could not be read.");
  });

  it("rejects a malformed native result instead of passing it on", async () => {
    mocks.invoke.mockResolvedValue({ ...packet, sha256: "not-a-hash" });
    await expect(pickStudyPacket()).rejects.toMatchObject({ code: "file_read_failed" });
    mocks.invoke.mockResolvedValue({ text: "x" });
    await expect(pickStudyPacket()).rejects.toMatchObject({ code: "file_read_failed" });
  });
});
