// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  cleanup: vi.fn(),
  ios: vi.fn(() => false),
}));
vi.mock("@/services/documents", () => ({
  canHandleFiles: () => true,
  formatFileSize: () => "1 KB",
  pickAndImportDocument: vi.fn(),
  savePastedText: mocks.save,
  cleanupDocuments: mocks.cleanup,
  documentErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error && error.message.trim() ? error.message : fallback,
}));
vi.mock("@/services/platform", () => ({
  deviceCan: () => ({ importFiles: true }),
  isIOS: mocks.ios,
}));

import { MaterialFormDialog } from "./MaterialFormDialog";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  mocks.save.mockReset();
  mocks.cleanup.mockReset().mockResolvedValue([]);
  mocks.ios.mockReturnValue(false);
});
afterEach(cleanup);

const view = (onSave = vi.fn().mockResolvedValue(true)) =>
  render(h(MaterialFormDialog, {
    open: true, goals: [], events: [], newMaterialId: "new", onClose: vi.fn(), onSave,
  }));

it("saves pasted text as the material's file", async () => {
  mocks.save.mockResolvedValue({ relativePath: "new.txt", originalFileName: "Notes.txt", fileSize: 5 });
  const onSave = vi.fn().mockResolvedValue(true);
  view(onSave);
  fireEvent.click(screen.getByRole("button", { name: "Paste text" }));
  expect(screen.getByText("Plain text, no pictures.")).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText("Paste a web page or type notes"), { target: { value: "Notes\nbody" } });
  fireEvent.click(screen.getByRole("button", { name: "Add text" }));
  await screen.findByText("Notes.txt");
  expect(mocks.save).toHaveBeenCalledWith("new", "Notes", "Notes\nbody");
  fireEvent.click(screen.getByRole("button", { name: "Add material" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]![0]).toMatchObject({ filePath: "new.txt", originalFileName: "Notes.txt", title: "Notes" });
});

it("keeps Add text disabled until there is text", () => {
  view();
  fireEvent.click(screen.getByRole("button", { name: "Paste text" }));
  const add = screen.getByRole("button", { name: "Add text" }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  fireEvent.change(screen.getByPlaceholderText("Paste a web page or type notes"), { target: { value: "   \n " } });
  expect(add.disabled).toBe(true);
});

it("hides the paste option on the phone", () => {
  mocks.ios.mockReturnValue(true);
  view();
  expect(screen.getByRole("button", { name: "Choose a file" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Paste text" })).toBeNull();
});
