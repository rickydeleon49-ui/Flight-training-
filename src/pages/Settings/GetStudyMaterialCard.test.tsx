// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chooseCompleteBackup: vi.fn(), importPickedBackup: vi.fn(), phoneActivitySummary: vi.fn(),
  discardIncomingBackup: vi.fn(), stageCompleteRestore: vi.fn(), exitForRestore: vi.fn(),
}));
vi.mock("@/services/backups", async (original) => ({
  ...await original<typeof import("@/services/backups")>(), ...mocks,
}));
import { formatBackupDate } from "@/services/backups";
import { GetStudyMaterialCard } from "./GetStudyMaterialCard";

const info = { path: "/app/.incoming/latest.hfdbackup", createdAt: 1793361600, bytes: 2048, files: 4 };
const activity = { latestReviewAt: "2026-10-30T12:00:00Z", reviewsLast7Days: 2, attemptsLast7Days: 3 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.chooseCompleteBackup.mockResolvedValue("/picked/material.hfdbackup");
  mocks.importPickedBackup.mockResolvedValue(info);
  mocks.phoneActivitySummary.mockResolvedValue(activity);
  mocks.discardIncomingBackup.mockResolvedValue(undefined);
  mocks.stageCompleteRestore.mockResolvedValue(info);
  mocks.exitForRestore.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function pick() {
  render(<GetStudyMaterialCard />);
  fireEvent.click(screen.getByRole("button", { name: "Get my study material" }));
  await screen.findByText(/From your Mac/);
}
function confirm() { fireEvent.click(screen.getByRole("button", { name: "Replace what's on this phone" })); }

describe("GetStudyMaterialCard", () => {
  it("does nothing after a cancelled picker", async () => {
    mocks.chooseCompleteBackup.mockResolvedValue(null);
    render(<GetStudyMaterialCard />);
    fireEvent.click(screen.getByRole("button", { name: "Get my study material" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Get my study material" }).hasAttribute("disabled")).toBe(false));
    for (const name of ["importPickedBackup", "phoneActivitySummary", "stageCompleteRestore", "exitForRestore", "discardIncomingBackup"] as const) {
      expect(mocks[name]).not.toHaveBeenCalled();
    }
  });

  it("previews the date, size, files and phone activity", async () => {
    await pick();
    expect(screen.getByText(/From your Mac/).textContent).toBe(`From your Mac · ${formatBackupDate(info.createdAt)} · 2 KB · 4 files`);
    expect(screen.getByText(/Your last card review/).textContent).toContain("2 reviews and 3 tests this week will be replaced.");
    expect(screen.queryByText(/Nothing on this phone/)).toBeNull();
    expect(mocks.importPickedBackup).toHaveBeenCalledWith("/picked/material.hfdbackup");
  });

  it("discards the incoming copy on Not now", async () => {
    await pick();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByText(/From your Mac/)).toBeNull());
    expect(mocks.discardIncomingBackup).toHaveBeenCalledOnce();
    expect(mocks.stageCompleteRestore).not.toHaveBeenCalled();
    expect(mocks.exitForRestore).not.toHaveBeenCalled();
  });

  it("stages only the copy and waits for Ok before the final sentence and delayed exit", async () => {
    let resolve!: (value: typeof info) => void;
    mocks.stageCompleteRestore.mockReturnValue(new Promise((done) => { resolve = done; }));
    await pick();
    vi.useFakeTimers();
    confirm();
    expect(mocks.stageCompleteRestore).toHaveBeenCalledExactlyOnceWith(info.path);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.exitForRestore).not.toHaveBeenCalled();
    expect(screen.queryByText(/All set/)).toBeNull();
    await act(async () => { resolve(info); });
    expect(screen.getByRole("status").textContent).toContain("All set. Her Flight Deck will close now; open it again and your study material is there.");
    await act(async () => { await vi.advanceTimersByTimeAsync(1499); });
    expect(mocks.exitForRestore).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.exitForRestore).toHaveBeenCalledOnce();
  });

  it("shows an inspection error without staging or exiting", async () => {
    mocks.importPickedBackup.mockRejectedValue("That file could not be read. Please choose another copy.");
    render(<GetStudyMaterialCard />);
    fireEvent.click(screen.getByRole("button", { name: "Get my study material" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Please choose another copy.");
    expect(mocks.stageCompleteRestore).not.toHaveBeenCalled();
    expect(mocks.exitForRestore).not.toHaveBeenCalled();
  });

  it("keeps the preview and never exits when staging fails", async () => {
    mocks.stageCompleteRestore.mockRejectedValue("There is not enough room on this phone.");
    await pick();
    confirm();
    expect((await screen.findByRole("alert")).textContent).toContain("not enough room");
    expect(screen.getByText(/From your Mac/)).toBeTruthy();
    expect(mocks.exitForRestore).not.toHaveBeenCalled();
    expect(screen.queryByText(/All set/)).toBeNull();
  });

  it.each([
    [null, 1, 0], [null, 0, 1], [activity.latestReviewAt, 0, 0],
  ])("never promises no loss for existing activity (%s, %s, %s)", async (latestReviewAt, reviewsLast7Days, attemptsLast7Days) => {
    mocks.phoneActivitySummary.mockResolvedValue({ latestReviewAt, reviewsLast7Days, attemptsLast7Days });
    await pick();
    expect(screen.queryByText(/Nothing on this phone/)).toBeNull();
    expect(screen.getByText(/will be replaced/)).toBeTruthy();
  });

  it("uses plain words throughout the preview and final sentence", async () => {
    mocks.phoneActivitySummary.mockResolvedValue({ latestReviewAt: null, reviewsLast7Days: 0, attemptsLast7Days: 0 });
    await pick();
    expect(screen.getByText("Nothing on this phone will be lost yet.")).toBeTruthy();
    const previewText = document.body.textContent;
    confirm();
    await screen.findByText(/All set/);
    const copy = `${previewText} ${document.body.textContent}`.toLowerCase();
    for (const word of ["sync", "manifest", "archive", "restart"]) expect(copy).not.toContain(word);
  });
});
