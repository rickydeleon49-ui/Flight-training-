// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stageStartFresh: vi.fn(),
  restartForRestore: vi.fn(),
  clearAppLocalStorage: vi.fn(),
}));

vi.mock("@/services/backups", async (original) => ({
  ...(await original<typeof import("@/services/backups")>()),
  stageStartFresh: mocks.stageStartFresh,
  restartForRestore: mocks.restartForRestore,
  clearAppLocalStorage: mocks.clearAppLocalStorage,
}));

const platform = vi.hoisted(() => ({
  isIOS: vi.fn(() => false),
}));
vi.mock("@/services/platform", () => platform);

import { StartFreshDialog } from "./StartFreshDialog";

describe("StartFreshDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    platform.isIOS.mockReturnValue(false);
    mocks.stageStartFresh.mockResolvedValue(undefined);
    mocks.restartForRestore.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Mac title when not on iOS", () => {
    platform.isIOS.mockReturnValue(false);
    render(<StartFreshDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Start fresh on this Mac?" })).toBeDefined();
  });

  it("renders iPhone title when on iOS", () => {
    platform.isIOS.mockReturnValue(true);
    render(<StartFreshDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Start fresh on this iPhone?" })).toBeDefined();
  });

  it("displays the exact plain-words body text", () => {
    render(<StartFreshDialog open={true} onClose={vi.fn()} />);
    const expected =
      "This erases your notes, logbook, study material, progress and saved safety copies on this device. Your Gemini key stays saved. Backups you saved to iCloud or Files are not touched.";
    expect(screen.getByText(expected)).toBeDefined();
  });

  it("disables 'Erase and start fresh' button until text is exactly ERASE (case-insensitive, trimmed)", () => {
    render(<StartFreshDialog open={true} onClose={vi.fn()} />);
    const eraseButton = screen.getByRole("button", { name: "Erase and start fresh" });
    const input = screen.getByLabelText("Type ERASE to confirm");

    // Initially empty -> disabled
    expect(eraseButton.hasAttribute("disabled")).toBe(true);

    // Partial text -> disabled
    fireEvent.change(input, { target: { value: "eras" } });
    expect(eraseButton.hasAttribute("disabled")).toBe(true);

    // Wrong text -> disabled
    fireEvent.change(input, { target: { value: "NOPE" } });
    expect(eraseButton.hasAttribute("disabled")).toBe(true);

    // Superstring -> disabled
    fireEvent.change(input, { target: { value: "ERASER" } });
    expect(eraseButton.hasAttribute("disabled")).toBe(true);

    // Exact ERASE -> enabled
    fireEvent.change(input, { target: { value: "ERASE" } });
    expect(eraseButton.hasAttribute("disabled")).toBe(false);

    // Lowercase erase -> enabled
    fireEvent.change(input, { target: { value: "erase" } });
    expect(eraseButton.hasAttribute("disabled")).toBe(false);

    // Mixed case with leading/trailing whitespace -> enabled
    fireEvent.change(input, { target: { value: "   eRaSe   " } });
    expect(eraseButton.hasAttribute("disabled")).toBe(false);
  });

  it("Save-a-backup-first calls the backup flow", () => {
    const onSaveBackupFirst = vi.fn();
    render(<StartFreshDialog open={true} onClose={vi.fn()} onSaveBackupFirst={onSaveBackupFirst} />);
    const saveButton = screen.getByRole("button", { name: "Save a backup first" });
    fireEvent.click(saveButton);
    expect(onSaveBackupFirst).toHaveBeenCalledOnce();
  });

  it("confirm calls stage then clearStorage then restart in order", async () => {
    const callOrder: string[] = [];
    const stage = vi.fn(async () => {
      callOrder.push("stage");
    });
    const clearStorage = vi.fn(() => {
      callOrder.push("clearStorage");
    });
    const restart = vi.fn(async () => {
      callOrder.push("restart");
    });

    render(
      <StartFreshDialog
        open={true}
        onClose={vi.fn()}
        stage={stage}
        clearStorage={clearStorage}
        restart={restart}
      />,
    );

    const input = screen.getByLabelText("Type ERASE to confirm");
    fireEvent.change(input, { target: { value: "ERASE" } });

    const eraseButton = screen.getByRole("button", { name: "Erase and start fresh" });
    fireEvent.click(eraseButton);

    await waitFor(() => expect(restart).toHaveBeenCalledOnce());

    expect(callOrder).toEqual(["stage", "clearStorage", "restart"]);
  });

  it("confirm with default service bindings calls stageStartFresh, clearAppLocalStorage and restartForRestore", async () => {
    render(<StartFreshDialog open={true} onClose={vi.fn()} />);

    const input = screen.getByLabelText("Type ERASE to confirm");
    fireEvent.change(input, { target: { value: "erase" } });

    const eraseButton = screen.getByRole("button", { name: "Erase and start fresh" });
    fireEvent.click(eraseButton);

    await waitFor(() => expect(mocks.restartForRestore).toHaveBeenCalledOnce());

    expect(mocks.stageStartFresh).toHaveBeenCalledOnce();
    expect(mocks.clearAppLocalStorage).toHaveBeenCalledOnce();
    expect(mocks.restartForRestore).toHaveBeenCalledOnce();
  });

  it("failure shows error and does not restart or clear storage", async () => {
    const stage = vi.fn(async () => {
      throw new Error("Disk is write-protected.");
    });
    const clearStorage = vi.fn();
    const restart = vi.fn();

    render(
      <StartFreshDialog
        open={true}
        onClose={vi.fn()}
        stage={stage}
        clearStorage={clearStorage}
        restart={restart}
      />,
    );

    const input = screen.getByLabelText("Type ERASE to confirm");
    fireEvent.change(input, { target: { value: "erase" } });

    const eraseButton = screen.getByRole("button", { name: "Erase and start fresh" });
    fireEvent.click(eraseButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });

    expect(screen.getByRole("alert").textContent).toContain("Disk is write-protected.");
    expect(clearStorage).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it("closes on Cancel", () => {
    const onClose = vi.fn();
    render(<StartFreshDialog open={true} onClose={onClose} />);
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
