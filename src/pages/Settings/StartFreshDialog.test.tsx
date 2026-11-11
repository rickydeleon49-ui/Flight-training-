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
      "This erases your notes, logbook, study material, progress and saved safety copies on this device. Your AI key stays saved. Backups you saved to iCloud or Files are not touched.";
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

  it("shows success sentence under the button after save-first succeeds", async () => {
    const onSaveBackupFirst = vi.fn().mockResolvedValue("Backup saved to /path/to/backup.hfdbackup.");
    render(<StartFreshDialog open={true} onClose={vi.fn()} onSaveBackupFirst={onSaveBackupFirst} />);
    const saveButton = screen.getByRole("button", { name: "Save a backup first" });
    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(screen.getByText("Backup saved to /path/to/backup.hfdbackup.")).toBeDefined();
    });
  });

  it("shows 'Backup not saved.' under the button when save-first is cancelled", async () => {
    const onSaveBackupFirst = vi.fn().mockResolvedValue(null);
    render(<StartFreshDialog open={true} onClose={vi.fn()} onSaveBackupFirst={onSaveBackupFirst} />);
    const saveButton = screen.getByRole("button", { name: "Save a backup first" });
    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(screen.getByText("Backup not saved.")).toBeDefined();
    });
  });

  it("shows error via backupErrorMessage under the button when save-first throws", async () => {
    const onSaveBackupFirst = vi.fn().mockRejectedValue(new Error("Disk exploded"));
    render(<StartFreshDialog open={true} onClose={vi.fn()} onSaveBackupFirst={onSaveBackupFirst} />);
    const saveButton = screen.getByRole("button", { name: "Save a backup first" });
    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(screen.getByText("Disk exploded")).toBeDefined();
    });
  });

  it("disables Erase button and ERASE input while save-first runs", async () => {
    let resolveSave!: (val: string | null) => void;
    const onSaveBackupFirst = vi.fn(() => new Promise<string | null>((resolve) => { resolveSave = resolve; }));
    render(<StartFreshDialog open={true} onClose={vi.fn()} onSaveBackupFirst={onSaveBackupFirst} />);

    const input = screen.getByLabelText("Type ERASE to confirm");
    fireEvent.change(input, { target: { value: "ERASE" } });
    const eraseButton = screen.getByRole("button", { name: "Erase and start fresh" });
    expect(eraseButton.hasAttribute("disabled")).toBe(false);

    const saveButton = screen.getByRole("button", { name: "Save a backup first" });
    fireEvent.click(saveButton);

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDefined();
    expect(eraseButton.hasAttribute("disabled")).toBe(true);
    expect(input.hasAttribute("disabled")).toBe(true);

    resolveSave("Backup saved to /path/to/backup.hfdbackup.");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save a backup first" })).toBeDefined();
    });
    expect(eraseButton.hasAttribute("disabled")).toBe(false);
    expect(input.hasAttribute("disabled")).toBe(false);
  });

  it("shows unsaved-work warning above ERASE field and refreshes after successful save", async () => {
    const warning =
      "This phone has 2 card reviews that aren't saved anywhere else yet. Save my phone work first, then get your study material.";
    const checkUnsaved = vi.fn()
      .mockResolvedValueOnce(warning)
      .mockResolvedValueOnce(null);
    const onSaveBackupFirst = vi.fn().mockResolvedValue("Saved in Files → Your Flight Deck → My phone work.hfdbackup.");

    render(
      <StartFreshDialog
        open={true}
        onClose={vi.fn()}
        checkUnsaved={checkUnsaved}
        onSaveBackupFirst={onSaveBackupFirst}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(warning)).toBeDefined();
    });
    expect(checkUnsaved).toHaveBeenCalledOnce();

    const saveButton = screen.getByRole("button", { name: "Save a backup first" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("Saved in Files → Your Flight Deck → My phone work.hfdbackup.")).toBeDefined();
    });
    expect(checkUnsaved).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      expect(screen.queryByText(warning)).toBeNull();
    });
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

  it("on iOS does not call restart, shows 'Erase is set. Close Your Flight Deck and open it again to finish.', and lets her dismiss", async () => {
    platform.isIOS.mockReturnValue(true);
    const stage = vi.fn().mockResolvedValue(undefined);
    const clearStorage = vi.fn();
    const restart = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <StartFreshDialog
        open={true}
        onClose={onClose}
        stage={stage}
        clearStorage={clearStorage}
        restart={restart}
      />,
    );

    const input = screen.getByLabelText("Type ERASE to confirm");
    fireEvent.change(input, { target: { value: "ERASE" } });

    const eraseButton = screen.getByRole("button", { name: "Erase and start fresh" });
    fireEvent.click(eraseButton);

    await waitFor(() => {
      expect(
        screen.getByText("Erase is set. Close Your Flight Deck and open it again to finish."),
      ).toBeDefined();
    });

    expect(stage).toHaveBeenCalledOnce();
    expect(clearStorage).toHaveBeenCalledOnce();
    expect(restart).not.toHaveBeenCalled();
    expect(screen.queryByText(/Could not start fresh/)).toBeNull();

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(cancelButton);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows 'Erase is set. Quit Your Flight Deck and open it again to finish.' when restart fails after stage, not the error", async () => {
    platform.isIOS.mockReturnValue(false);
    const stage = vi.fn().mockResolvedValue(undefined);
    const clearStorage = vi.fn();
    const restart = vi.fn().mockRejectedValue(new Error("Unable to restart binary"));

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

    await waitFor(() => {
      expect(
        screen.getByText("Erase is set. Quit Your Flight Deck and open it again to finish."),
      ).toBeDefined();
    });

    expect(stage).toHaveBeenCalledOnce();
    expect(clearStorage).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Could not start fresh/)).toBeNull();
    expect(screen.queryByText("Unable to restart binary")).toBeNull();
  });

  it("prevents double-clicking Erase from calling stage twice", async () => {
    let resolveStage!: () => void;
    const stage = vi.fn(() => new Promise<void>((resolve) => { resolveStage = resolve; }));
    render(
      <StartFreshDialog
        open={true}
        onClose={vi.fn()}
        stage={stage}
      />,
    );

    const input = screen.getByLabelText("Type ERASE to confirm");
    fireEvent.change(input, { target: { value: "ERASE" } });

    const eraseButton = screen.getByRole("button", { name: "Erase and start fresh" });
    fireEvent.click(eraseButton);
    fireEvent.click(eraseButton);

    expect(stage).toHaveBeenCalledOnce();
    resolveStage();
  });

  it("closes on Cancel", () => {
    const onClose = vi.fn();
    render(<StartFreshDialog open={true} onClose={onClose} />);
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
