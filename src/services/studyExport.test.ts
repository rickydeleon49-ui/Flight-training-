import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
}));

vi.mock("@/data", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { DesktopOnlyError } from "./documents";
import { saveStudyExport, StudyExportError } from "./studyExport";

beforeEach(() => {
  mocks.isTauri.mockReturnValue(true);
  mocks.invoke.mockReset();
});

describe("saveStudyExport (simulated invoke; no native dialog opens in tests)", () => {
  it("refuses outside the desktop app without invoking anything", async () => {
    mocks.isTauri.mockReturnValue(false);
    await expect(saveStudyExport("packet", "a.json", "{}")).rejects.toBeInstanceOf(DesktopOnlyError);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("sends the kind, a suggested name and the text, never a path", async () => {
    mocks.invoke.mockResolvedValue({ fileName: "a.json", byteLength: 2 });
    await expect(saveStudyExport("packet", "a.json", "{}")).resolves.toEqual({ fileName: "a.json", byteLength: 2 });
    expect(mocks.invoke).toHaveBeenCalledWith("save_study_export", { kind: "packet", suggestedName: "a.json", contents: "{}" });
  });

  it("resolves to null when the dialog is cancelled", async () => {
    mocks.invoke.mockResolvedValue(null);
    await expect(saveStudyExport("handout", "a.html", "<p>")).resolves.toBeNull();
  });

  it("maps known failures and treats anything else as a failed write", async () => {
    mocks.invoke.mockRejectedValueOnce({ code: "not_regular_file", message: "ignored" });
    await expect(saveStudyExport("packet", "a.json", "{}")).rejects.toMatchObject({ code: "not_regular_file" });
    mocks.invoke.mockRejectedValueOnce({ code: "/Users/someone/secret", message: "/Users/someone/secret" });
    const error = await saveStudyExport("packet", "a.json", "{}").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StudyExportError);
    expect((error as StudyExportError).code).toBe("write_failed");
    expect((error as Error).message).not.toContain("/Users");
    mocks.invoke.mockResolvedValueOnce({ unexpected: true });
    await expect(saveStudyExport("packet", "a.json", "{}")).rejects.toMatchObject({ code: "write_failed" });
  });
});
