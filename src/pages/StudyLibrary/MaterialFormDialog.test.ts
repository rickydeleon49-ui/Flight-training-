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
