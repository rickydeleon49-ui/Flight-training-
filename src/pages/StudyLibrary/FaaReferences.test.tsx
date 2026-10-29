// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeMaterial } from "@/testing/factories";
import { FAA_REFERENCES, faaReferenceDraft } from "@/logic/faaReferences";

const mocks = vi.hoisted(() => ({
  desktop: true, materials: [] as unknown[], pick: vi.fn(), preview: vi.fn(), open: vi.fn(), cleanup: vi.fn(), mutate: vi.fn(), create: vi.fn(),
}));
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data: { materials: mocks.materials }, mutate: mocks.mutate }),
}));
vi.mock("@/services/documents", () => ({
  canHandleFiles: () => mocks.desktop, pickAndImportDocument: mocks.pick,
  cleanupDocuments: mocks.cleanup, openDocument: mocks.open,
}));
vi.mock("@/services/studyPageSources", () => ({ previewStudyPageSource: mocks.preview }));
import { FaaReferences } from "./FaaReferences";

const imported = {
  relativePath: "synthetic.pdf", originalFileName: "synthetic.pdf", fileSize: 100,
  pdfIdentity: { contentSha256: "a".repeat(64), totalPages: 1 },
};
const material = () => makeMaterial(faaReferenceDraft(FAA_REFERENCES[0], "id", "FAA-S-ACS-6B", imported));
const mount = () => render(h(MemoryRouter, null, h(FaaReferences)));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.desktop = true;
  mocks.materials = [];
  mocks.pick.mockResolvedValue(imported);
  mocks.preview.mockResolvedValue(imported.pdfIdentity);
  mocks.cleanup.mockResolvedValue([]);
  mocks.open.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue(material());
  mocks.mutate.mockImplementation((fn) => fn({ documents: { create: mocks.create } }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);

it("shows optional ACS and PHAK with its addendum, with sources as text only", () => {
  mount();
  expect(screen.getByRole("region", { name: "FAA references" })).toBeTruthy();
  expect(screen.getAllByText("Optional · No saved PDF")).toHaveLength(3);
  expect(screen.getByRole("heading", { name: "PHAK addendum" })).toBeTruthy();
  expect(document.querySelector("a[href^='http']")).toBeNull();
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
  expect(document.querySelectorAll(".faa-shelf > .faa-shelf__entry")).toHaveLength(3);
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
