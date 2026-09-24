// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeMaterial } from "@/testing/factories";

const files = vi.hoisted(() => ({
  pick: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock("@/services/documents", () => ({
  canHandleFiles: () => true,
  formatFileSize: () => "2 KB",
  pickAndImportDocument: files.pick,
  cleanupDocuments: files.cleanup,
}));

import { MaterialFormDialog } from "./MaterialFormDialog";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  files.pick.mockReset();
  files.cleanup.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

it("removes a newly imported file when the material form is cancelled", async () => {
  files.pick.mockResolvedValue({ relativePath: "new.pdf", originalFileName: "new.pdf", fileSize: 2048 });
  const onClose = vi.fn();
  render(h(MaterialFormDialog, {
    open: true, goals: [], events: [], newMaterialId: "new",
    onClose, onSave: vi.fn(),
  }));

  fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));
  await screen.findByText("new.pdf");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await waitFor(() => expect(files.cleanup).toHaveBeenCalledWith(["new.pdf"]));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it("keeps the form visible if an abandoned import cannot be removed", async () => {
  files.pick.mockResolvedValue({ relativePath: "new.pdf", originalFileName: "new.pdf", fileSize: 2048 });
  files.cleanup.mockResolvedValue(["new.pdf"]);
  const onClose = vi.fn();
  const { container } = render(h(MaterialFormDialog, {
    open: true, goals: [], events: [], newMaterialId: "new",
    onClose, onSave: vi.fn(),
  }));

  fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));
  await screen.findByText("new.pdf");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await screen.findByText(/unused file could not be removed/);
  expect(container.querySelector("dialog")?.open).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
});

it("never deletes a saved attachment when an edit is cancelled", async () => {
  const onClose = vi.fn();
  render(h(MaterialFormDialog, {
    open: true, material: makeMaterial({ filePath: "saved.pdf", originalFileName: "saved.pdf" }),
    goals: [], events: [], newMaterialId: "unused", onClose, onSave: vi.fn(),
  }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(files.cleanup).toHaveBeenCalledWith([]);
});

it("keeps an import available for retry and prevents duplicate saves", async () => {
  files.pick.mockResolvedValue({ relativePath: "new.pdf", originalFileName: "new.pdf", fileSize: 2048 });
  let finish!: (value: boolean) => void;
  const onSave = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  render(h(MaterialFormDialog, {
    open: true, goals: [], events: [], newMaterialId: "new",
    onClose: vi.fn(), onSave,
  }));

  fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));
  await screen.findByText("new.pdf");
  const save = screen.getByRole("button", { name: "Add material" });
  fireEvent.click(save);
  fireEvent.click(save);
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);
  finish(false);
  await waitFor(() => expect(screen.getByRole("button", { name: "Add material" })).toBeTruthy());
  expect(files.cleanup).toHaveBeenCalledWith([]);
  expect(screen.getByText("new.pdf")).toBeTruthy();
});

it("removes the previous attachment when a replacement file is saved successfully", async () => {
  files.pick.mockResolvedValue({ relativePath: "replacement.pdf", originalFileName: "replacement.pdf", fileSize: 4096 });
  const onSave = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  render(h(MaterialFormDialog, {
    open: true,
    material: makeMaterial({ filePath: "old.pdf", originalFileName: "old.pdf" }),
    goals: [], events: [], newMaterialId: "mat-1",
    onClose, onSave,
  }));

  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));
  await screen.findByText("replacement.pdf");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  await waitFor(() => expect(files.cleanup).toHaveBeenCalledWith(["old.pdf"]));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it("removes the previous attachment when the file is removed and saved successfully", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  render(h(MaterialFormDialog, {
    open: true,
    material: makeMaterial({ filePath: "old.pdf", originalFileName: "old.pdf" }),
    goals: [], events: [], newMaterialId: "mat-1",
    onClose, onSave,
  }));

  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  await waitFor(() => expect(files.cleanup).toHaveBeenCalledWith(["old.pdf"]));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it("preserves the previous attachment and displays an error if saving fails", async () => {
  files.pick.mockResolvedValue({ relativePath: "replacement.pdf", originalFileName: "replacement.pdf", fileSize: 4096 });
  const onSave = vi.fn().mockResolvedValue(false);
  render(h(MaterialFormDialog, {
    open: true,
    material: makeMaterial({ filePath: "old.pdf", originalFileName: "old.pdf" }),
    goals: [], events: [], newMaterialId: "mat-1",
    onClose: vi.fn(), onSave,
  }));

  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));
  await screen.findByText("replacement.pdf");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  await screen.findByText(/That material could not be saved/);
  // Old file must NOT be deleted
  expect(files.cleanup).toHaveBeenCalledWith([]);
});

it("surfaces former attachment cleanup failure, keeps dialog open, and allows bounded retry", async () => {
  files.pick.mockResolvedValue({ relativePath: "replacement.pdf", originalFileName: "replacement.pdf", fileSize: 4096 });
  files.cleanup.mockImplementation(async (paths: string[]) => paths.filter((p) => p === "old.pdf"));
  const onSave = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();

  render(h(MaterialFormDialog, {
    open: true,
    material: makeMaterial({ filePath: "old.pdf", originalFileName: "old.pdf" }),
    goals: [], events: [], newMaterialId: "mat-1",
    onClose, onSave,
  }));

  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));
  await screen.findByText("replacement.pdf");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  // Dialog remains open because former cleanup failed
  await screen.findByText(/previous file could not be removed from app storage/);
  expect(onClose).not.toHaveBeenCalled();

  // Retry button appears
  const retryBtn = screen.getByRole("button", { name: "Retry removing old file" });
  expect(retryBtn).toBeTruthy();

  // Now simulate successful cleanup on retry
  files.cleanup.mockResolvedValueOnce([]);
  fireEvent.click(retryBtn);

  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it("cleans up intermediate abandoned files on repeated replacement before saving", async () => {
  files.pick
    .mockResolvedValueOnce({ relativePath: "first.pdf", originalFileName: "first.pdf", fileSize: 1024 })
    .mockResolvedValueOnce({ relativePath: "second.pdf", originalFileName: "second.pdf", fileSize: 2048 });
  const onSave = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();

  render(h(MaterialFormDialog, {
    open: true,
    material: makeMaterial({ filePath: "original.pdf", originalFileName: "original.pdf" }),
    goals: [], events: [], newMaterialId: "mat-1",
    onClose, onSave,
  }));

  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  // Pick first replacement
  fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));
  await screen.findByText("first.pdf");

  // Pick second replacement
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));
  await screen.findByText("second.pdf");

  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  // first.pdf was cleaned up before save as unused
  expect(files.cleanup).toHaveBeenCalledWith(["first.pdf"]);
  // original.pdf was cleaned up after save
  expect(files.cleanup).toHaveBeenCalledWith(["original.pdf"]);
  // second.pdf was saved and never deleted
  expect(onClose).toHaveBeenCalledOnce();
});

it("closes dialog on successful creation of a new material", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();

  render(h(MaterialFormDialog, {
    open: true,
    material: null,
    goals: [], events: [], newMaterialId: "new-mat",
    onClose, onSave,
  }));

  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Handbook" } });
  fireEvent.click(screen.getByRole("button", { name: "Add material" }));

  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
