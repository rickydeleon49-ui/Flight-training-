// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeMaterial } from "@/testing/factories";
import { FAA_REFERENCES, faaReferenceDraft } from "@/logic/faaReferences";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), download: vi.fn(), progress: vi.fn(), cancel: vi.fn(), records: vi.fn(), record: vi.fn(), openUrl: vi.fn(),
  desktop: true, materials: [] as unknown[], pick: vi.fn(), preview: vi.fn(), open: vi.fn(), cleanup: vi.fn(), mutate: vi.fn(), create: vi.fn(),
}));
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data: { materials: mocks.materials }, mutate: mocks.mutate, repositories }),
}));
vi.mock("@/services/documents", () => ({
  canHandleFiles: () => mocks.desktop, pickAndImportDocument: mocks.pick,
  cleanupDocuments: mocks.cleanup, openDocument: mocks.open,
}));
vi.mock("@/data", () => ({ isTauri: () => mocks.desktop }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@/services/faaDownloads", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/services/faaDownloads")>(),
  listFaaDownloads: mocks.list, downloadFaaHandbook: mocks.download,
  faaDownloadProgress: mocks.progress, cancelFaaDownload: mocks.cancel,
}));
vi.mock("@/services/studyPageSources", () => ({ previewStudyPageSource: mocks.preview }));
import { FaaReferences } from "./FaaReferences";

const imported = {
  relativePath: "synthetic.pdf", originalFileName: "synthetic.pdf", fileSize: 100,
  pdfIdentity: { contentSha256: "a".repeat(64), totalPages: 1 },
};
const material = () => makeMaterial(faaReferenceDraft(FAA_REFERENCES[0], "id", "FAA-S-ACS-6B", imported));
const repositories = { faaDownloads: { list: mocks.records } };
const mount = () => render(h(MemoryRouter, null, h(FaaReferences)));

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  mocks.list.mockResolvedValue(entries);
  mocks.records.mockResolvedValue([]);
  mocks.progress.mockResolvedValue({ received: 12_000_000, total: 42_000_000 });
  mocks.download.mockResolvedValue(downloaded);
  mocks.cancel.mockResolvedValue(undefined);
  mocks.record.mockResolvedValue(receipt);
  mocks.openUrl.mockResolvedValue(undefined);
  mocks.desktop = true;
  mocks.materials = [];
  mocks.pick.mockResolvedValue(imported);
  mocks.preview.mockResolvedValue(imported.pdfIdentity);
  mocks.cleanup.mockResolvedValue([]);
  mocks.open.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue(material());
  mocks.mutate.mockImplementation((fn) => fn({ documents: { create: mocks.create }, faaDownloads: { record: mocks.record } }).catch(() => null));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);

it("shows optional ACS and PHAK with its addendum, with AFH as one additional entry", () => {
  mount();
  expect(screen.getByRole("region", { name: "FAA references" })).toBeTruthy();
  expect(screen.getAllByText("Optional · No saved PDF")).toHaveLength(3);
  expect(screen.getByRole("heading", { name: "PHAK addendum" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Check the current FAA version" })).toBeTruthy();
});

it("imports with the existing PDF-only path, saves a separate unverified material and retries a failed save", async () => {
  mocks.create.mockRejectedValueOnce(new Error("storage"));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Add PDF: Private Pilot Airplane ACS" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "FAA-S-ACS-6B" } });
  fireEvent.click(screen.getByRole("button", { name: "Choose local PDF" }));
  await screen.findByText("synthetic.pdf");
  expect(mocks.pick).toHaveBeenCalledWith(expect.any(String), true);
  fireEvent.click(screen.getByRole("button", { name: "Save reference" }));
  await screen.findByText(/could not be saved/);
  fireEvent.click(screen.getByRole("button", { name: "Save reference" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.create.mock.calls[1]![0]).toMatchObject({ title: "Private Pilot Airplane ACS — FAA-S-ACS-6B", notes: "", faaReference: { referenceId: "private-acs", edition: "FAA-S-ACS-6B", ...imported.pdfIdentity }, filePath: "synthetic.pdf", reviewStatus: "reference_only", tags: [] });
  expect(mocks.cleanup).toHaveBeenCalledWith([]);
});

it("cancels an imported copy safely and keeps Cancel available to retry failed cleanup", async () => {
  mocks.cleanup.mockResolvedValueOnce(["synthetic.pdf"]);
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Add PDF: PHAK addendum" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose local PDF" }));
  await screen.findByText("synthetic.pdf");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.cleanup).toHaveBeenCalledWith(["synthetic.pdf"]);
  expect(mocks.create).not.toHaveBeenCalled();
});

it("shows a missing saved file honestly, preserving the notes link and preventing open", async () => {
  mocks.materials = [material()];
  mocks.preview.mockResolvedValue(null);
  mount();
  await screen.findByText(/File missing/);
  expect((screen.getByRole("button", { name: /Open offline:/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("link", { name: /Notes and bookmarks/ }).getAttribute("href")).toBe("/study/id?tab=notes");
  expect(mocks.open).not.toHaveBeenCalled();
});

it("rechecks before opening, refuses changed bytes, and keeps the saved edition unverified", async () => {
  mocks.materials = [material()];
  mount();
  await screen.findByText("Saved on this Mac");
  expect(screen.getByText(/Your copy: FAA-S-ACS-6B/)).toBeTruthy();
  mocks.preview.mockResolvedValue({ ...imported.pdfIdentity, contentSha256: "b".repeat(64) });
  fireEvent.click(screen.getByRole("button", { name: /Open offline:/ }));
  await screen.findByText(/This file has changed since you added it/);
  expect(mocks.open).not.toHaveBeenCalled();
});

it("opens a matching copy in the existing external reader with honest M4 fallback wording", async () => {
  mocks.materials = [material()];
  mount();
  await screen.findByText("Saved on this Mac");
  fireEvent.click(screen.getByRole("button", { name: /Open offline:/ }));
  await screen.findByText("Opened in your PDF reader.");
  expect(mocks.open).toHaveBeenCalledWith("synthetic.pdf");
  expect(mocks.preview).toHaveBeenCalledTimes(2);
});

it("makes no native calls in browser mode, even with saved shelf materials", () => {
  mocks.desktop = false;
  mocks.materials = [material()];
  mount();
  expect(screen.getByText("Availability needs the desktop application")).toBeTruthy();
  for (const button of screen.getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(mocks.pick).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
});

it("retires a pending open check when the shelf unmounts", async () => {
  mocks.materials = [material()];
  const view = mount();
  await screen.findByText("Saved on this Mac");
  let finish!: (value: typeof imported.pdfIdentity) => void;
  mocks.preview.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: /Open offline:/ }));
  view.unmount();
  finish(imported.pdfIdentity);
  await Promise.resolve();
  expect(mocks.open).not.toHaveBeenCalled();
});

 it("shows each edition once and aligns all three publication rows", async () => {
  mocks.materials = [makeMaterial(faaReferenceDraft(FAA_REFERENCES[0], "id", FAA_REFERENCES[0].edition, imported))];
  mount();
  await screen.findByText("Saved on this Mac");
  expect(screen.getAllByText(/FAA-S-ACS-6C/)).toHaveLength(1);
  expect(screen.queryByText(/Your copy:/)).toBeNull();
  expect(document.querySelectorAll(".faa-shelf > .faa-shelf__entry")).toHaveLength(4);
});

it("keeps the earlier PDF when another pick is cancelled, then cleans unused picks before saving", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Add PDF: Private Pilot Airplane ACS" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose local PDF" }));
  await screen.findByText("synthetic.pdf");
  mocks.pick.mockResolvedValueOnce(null);
  fireEvent.click(screen.getByRole("button", { name: "Choose another PDF" }));
  await waitFor(() => expect(mocks.pick).toHaveBeenCalledTimes(2));
  expect(screen.getByText("synthetic.pdf")).toBeTruthy();
  mocks.pick.mockResolvedValueOnce({ ...imported, relativePath: "second.pdf", originalFileName: "second.pdf" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Choose another PDF" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Choose another PDF" }));
  await screen.findByText("second.pdf");
  expect(mocks.pick.mock.calls[0]![0]).not.toBe(mocks.pick.mock.calls[2]![0]);
  fireEvent.click(screen.getByRole("button", { name: "Save reference" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.cleanup).toHaveBeenCalledWith(["synthetic.pdf"]);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ title: FAA_REFERENCES[0].title, notes: "", filePath: "second.pdf" }));
});

const entries = [
  { id: "afh-3c-ch01", title: "Airplane Flying Handbook, chapter 1", edition: "FAA-H-8083-3C", published: "2021", maxBytes: 50_000_000, kind: "afhChapter", offeredNow: true },
  { id: "afh-3c-ch04", title: "Airplane Flying Handbook, chapter 4", edition: "FAA-H-8083-3C", published: "2021", maxBytes: 50_000_000, kind: "afhChapter", offeredNow: true },
  { id: "afh-addendum-mosaic", title: "Airplane Flying Handbook addendum (MOSAIC)", edition: "FAA-H-8083-3C addendum (MOSAIC)", published: "2025-10", maxBytes: 50_000_000, kind: "afhAddendum", offeredNow: true },
  { id: "phak-25c-full", title: "PHAK full book", kind: "phakFull", offeredNow: false },
];
const downloaded = { document: imported, manifestId: "afh-3c-ch04", sourceUrl: "https://www.faa.gov/synthetic.pdf", edition: "FAA-H-8083-3C", sha256: "a".repeat(64), bytes: 100, httpLastModified: null };
const receipt = { materialId: "afh-copy", documentId: "afh-3c-ch04", sourceUrl: downloaded.sourceUrl, edition: downloaded.edition, contentSha256: downloaded.sha256, bytes: 100, httpLastModified: null, downloadedAt: "2026-10-31T12:00:00Z" };

async function startDownload() {
  await screen.findByRole("option", { name: "Airplane Flying Handbook, chapter 4" });
  fireEvent.change(screen.getByRole("combobox", { name: "Chapter or addendum" }), { target: { value: "afh-3c-ch04" } });
  fireEvent.click(screen.getByRole("button", { name: "Get from faa.gov" }));
}

it("offers AFH chapters and addendum, filters PHAK, and saves exactly once with the downloaded identity", async () => {
  mount();
  await startDownload();
  await screen.findByText("Saved for offline study.");
  expect(screen.getAllByRole("heading", { name: "Airplane Flying Handbook" })).toHaveLength(1);
  expect(screen.queryByRole("option", { name: "PHAK full book" })).toBeNull();
  expect(screen.getByRole("option", { name: /MOSAIC/ })).toBeTruthy();
  expect(mocks.download).toHaveBeenCalledWith("afh-3c-ch04", expect.any(String));
  expect(mocks.record).toHaveBeenCalledExactlyOnceWith({ materialId: mocks.download.mock.calls[0]![1], title: "Airplane Flying Handbook, chapter 4", downloaded });
  expect(mocks.create).not.toHaveBeenCalled();
});

it("polls byte progress, locks a second request, and cancels without saving a material", async () => {
  let reject!: (reason: unknown) => void;
  mocks.download.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  mount();
  await startDownload();
  await screen.findByText("Downloading from faa.gov… 12 of 42 MB");
  await waitFor(() => expect(mocks.progress.mock.calls.length).toBeGreaterThan(1));
  expect((screen.getByRole("button", { name: "Get from faa.gov" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
  await act(async () => reject({ kind: "cancelled", message: "cancelled" }));
  await screen.findByText("Download cancelled.");
  expect(mocks.record).not.toHaveBeenCalled();
});

it("keeps the shelf usable after a failed download", async () => {
  mocks.download.mockRejectedValueOnce(new Error("synthetic failure"));
  mount();
  await startDownload();
  await screen.findByText("faa.gov didn't answer. Try again later, or add the PDF yourself.");
  expect((screen.getByRole("button", { name: "Add PDF: PHAK addendum" }) as HTMLButtonElement).disabled).toBe(false);
  expect(mocks.record).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Get from faa.gov" }));
  await screen.findByText("Saved for offline study.");
});

it("retries saving the existing download without downloading or creating a duplicate", async () => {
  mocks.record.mockRejectedValueOnce(new Error("storage"));
  mount();
  await startDownload();
  await screen.findByText("Your PDF couldn't be saved. Try Save downloaded PDF again.");
  fireEvent.click(screen.getByRole("button", { name: "Save downloaded PDF" }));
  await screen.findByText("Saved for offline study.");
  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(mocks.record.mock.calls[0]).toEqual(mocks.record.mock.calls[1]);
});

it("disables downloads offline and responds to connectivity changes", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  mount();
  await screen.findByRole("option", { name: /chapter 4/ });
  expect(screen.getByText("Needs internet once; works offline afterwards.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Get from faa.gov" }) as HTMLButtonElement).disabled).toBe(true);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  fireEvent(window, new Event("online"));
  await waitFor(() => expect((screen.getByRole("button", { name: "Get from faa.gov" }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.download).not.toHaveBeenCalled();
});

it("hides downloading in browser mode and keeps the handbook link as an anchor", async () => {
  mocks.desktop = false;
  mount();
  expect(screen.queryByRole("button", { name: "Get from faa.gov" })).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.progress).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("link", { name: "Check the current FAA version" }));
  expect(mocks.openUrl).not.toHaveBeenCalled();
});

it("reloads provenance, shows the edition/date/hash, opens the saved copy offline and uses the native source opener", async () => {
  mocks.records.mockResolvedValue([receipt]);
  mocks.materials = [makeMaterial({ id: receipt.materialId, title: "Airplane Flying Handbook, chapter 4", filePath: imported.relativePath })];
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  mount();
  await screen.findByText(`FAA-H-8083-3C · 2021 · from www.faa.gov on 2026-10-31 · SHA-256 ${downloaded.sha256}`);
  await screen.findByText("Saved on this Mac");
  fireEvent.click(screen.getByRole("button", { name: /Open offline:/ }));
  await screen.findByText("Opened in your PDF reader.");
  expect(mocks.open).toHaveBeenCalledWith(imported.relativePath);
  fireEvent.click(screen.getByRole("link", { name: "Check the current FAA version" }));
  expect(mocks.openUrl).toHaveBeenCalledWith("https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/airplane_handbook");
});

it("cancels on unmount and removes a late completed file instead of saving it", async () => {
  let finish!: (value: typeof downloaded) => void;
  mocks.download.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = mount();
  await startDownload();
  view.unmount();
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
  await act(async () => finish(downloaded));
  expect(mocks.cleanup).toHaveBeenCalledWith([imported.relativePath]);
  expect(mocks.record).not.toHaveBeenCalled();
});

it("offers the addendum through the same record path", async () => {
  mocks.download.mockResolvedValue({ ...downloaded, manifestId: "afh-addendum-mosaic", edition: "FAA-H-8083-3C addendum (MOSAIC)" });
  mount();
  await screen.findByRole("option", { name: /MOSAIC/ });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "afh-addendum-mosaic" } });
  fireEvent.click(screen.getByRole("button", { name: "Get from faa.gov" }));
  await screen.findByText("Saved for offline study.");
  expect(mocks.record.mock.calls[0]![0]).toMatchObject({ title: "Airplane Flying Handbook addendum (MOSAIC)", downloaded: { manifestId: "afh-addendum-mosaic" } });
});

it("shows received bytes when total size is unknown and discards completion after Cancel", async () => {
  let finish!: (value: typeof downloaded) => void;
  mocks.download.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  mocks.progress.mockResolvedValue({ received: 12_000_000, total: 0 });
  mount();
  await startDownload();
  await screen.findByText("Downloading from faa.gov… 12 MB");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => finish(downloaded));
  await screen.findByText("Download cancelled.");
  expect(mocks.cleanup).toHaveBeenCalledWith([imported.relativePath]);
  expect(mocks.record).not.toHaveBeenCalled();
});

it("removes an unsaved downloaded file when leaving after a failed save", async () => {
  mocks.record.mockResolvedValue(null);
  const view = mount();
  await startDownload();
  await screen.findByText("Your PDF couldn't be saved. Try Save downloaded PDF again.");
  view.unmount();
  expect(mocks.cleanup).toHaveBeenCalledWith([imported.relativePath]);
});

it("places the local PDF action beside Get from faa.gov", async () => {
  const addPdf = vi.fn();
  render(h(MemoryRouter, null, h(FaaReferences, { onAddPdf: addPdf })));
  await screen.findByRole("option", { name: /chapter 4/ });
  const get = screen.getByRole("button", { name: "Get from faa.gov" });
  const add = get.previousElementSibling!;
  expect(add.textContent).toBe("Add PDF");
  fireEvent.click(add);
  expect(addPdf).toHaveBeenCalledTimes(1);
  expect(mocks.download).not.toHaveBeenCalled();
});
