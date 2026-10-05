import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
}));

vi.mock("@/data", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { DesktopOnlyError } from "./documents";
import { buildImportOperation, pickStudyPacket, sha256Hex, StudyPacketReadError } from "./studyPackets";

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

describe("buildImportOperation (Slice B)", () => {
  it("hashes with SHA-256 over UTF-8 (known vectors)", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // Computed independently with Python's hashlib over the UTF-8 bytes.
    expect(await sha256Hex("✈ Class B")).toBe("4e9d6b76f3dbc842d0aa4498c23728a173fbe91c75b2e47123888719e89c70cb");
  });

  it("copies only contract fields, so nothing extra reaches the native boundary", async () => {
    const payload = {
      material: { title: "T", extra: "x" },
      studySet: {
        title: "T", summary: "S", sections: [{ heading: "H", body: "B", extra: 1 }],
        flashcards: [{ front: "F", back: "B", sourcePage: null, extra: 1 }], sourceNotes: "", provider: "import", model: "",
        extra: 1,
      },
      practiceTest: null,
    } as never;
    const id = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const operation = await buildImportOperation(payload, id);
    expect(JSON.stringify(operation)).not.toContain("extra");
    expect(operation).toMatchObject({ operationId: id, materialId: id, practiceTest: null });
    expect(operation.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to save without secure hashing rather than send a fake hash", async () => {
    vi.stubGlobal("crypto", {});
    await expect(sha256Hex("abc")).rejects.toThrow(/Secure hashing is unavailable/);
    vi.unstubAllGlobals();
  });
});
