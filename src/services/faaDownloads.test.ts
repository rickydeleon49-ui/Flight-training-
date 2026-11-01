// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
let native = true;
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@/data", () => ({ isTauri: () => native }));

import {
  cancelFaaDownload, downloadFaaHandbook, faaDownloadProgress, faaFailure, listFaaDownloads,
} from "./faaDownloads";

beforeEach(() => { invoke.mockReset(); native = true; });

describe("FAA handbook download service", () => {
  it("sends only the manifest id and the material id, never an address", async () => {
    invoke.mockResolvedValue({ manifestId: "afh-3c-ch04" });
    await downloadFaaHandbook("afh-3c-ch04", "mat-1");
    expect(invoke).toHaveBeenCalledWith("download_faa_handbook", { id: "afh-3c-ch04", materialId: "mat-1" });
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/https?:/);
  });
  it("turns a native failure into a typed failure", async () => {
    invoke.mockRejectedValue({ kind: "tooBig", message: "This file is bigger than expected." });
    await expect(downloadFaaHandbook("x", "m")).rejects.toEqual({ kind: "tooBig", message: "This file is bigger than expected." });
  });
  it("gives a plain fallback for an unexpected rejection", () => {
    expect(faaFailure("boom").kind).toBe("unavailable");
    expect(faaFailure(null).message).toMatch(/add the PDF yourself/);
  });
  it("lists, polls and cancels through the native commands", async () => {
    invoke.mockResolvedValue([]);
    await listFaaDownloads();
    await faaDownloadProgress();
    await cancelFaaDownload();
    expect(invoke.mock.calls.map(c => c[0])).toEqual(["list_faa_downloads", "faa_download_progress", "cancel_faa_download"]);
  });
  it("does nothing in browser mode", async () => {
    native = false;
    expect(await listFaaDownloads()).toEqual([]);
    expect(await faaDownloadProgress()).toBeNull();
    await cancelFaaDownload();
    await expect(downloadFaaHandbook("x", "m")).rejects.toMatchObject({ kind: "unavailable" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
