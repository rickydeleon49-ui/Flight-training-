// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chooseCompleteBackup: vi.fn(), importPickedBackup: vi.fn(), phoneActivitySummary: vi.fn(), unsavedPhoneWork: vi.fn(), savePhoneWork: vi.fn(),
  discardIncomingBackup: vi.fn(), stageCompleteRestore: vi.fn(), exitForRestore: vi.fn(),
}));
vi.mock("@/services/backups", async (original) => ({
  ...await original<typeof import("@/services/backups")>(), ...mocks,
}));
const platform = vi.hoisted(() => ({ isIOS: vi.fn() }));
vi.mock("@/services/platform", () => platform);
import { formatBackupDate, unsavedPhoneWorkSentence } from "@/services/backups";
import { GetStudyMaterialCard } from "./GetStudyMaterialCard";

const info = { path: "/app/.incoming/latest.hfdbackup", createdAt: 1793361600, bytes: 8192, fileBytes: 2048, files: 4 };
const none = { reviews: 0, tests: 0, bookmarks: 0, readingPositions: 0, materials: 0, guides: 0, generatedTests: 0, since: null };
const activity = { latestReviewAt: "2026-10-30T12:00:00Z", reviewsLast7Days: 2, attemptsLast7Days: 3 };

beforeEach(() => {
  vi.resetAllMocks();
  platform.isIOS.mockReturnValue(true);
  mocks.chooseCompleteBackup.mockResolvedValue("/picked/material.hfdbackup");
  mocks.importPickedBackup.mockResolvedValue(info);
  mocks.phoneActivitySummary.mockResolvedValue(activity);
  mocks.unsavedPhoneWork.mockResolvedValue(none);
  mocks.discardIncomingBackup.mockResolvedValue(undefined);
  mocks.stageCompleteRestore.mockResolvedValue(info);
  mocks.exitForRestore.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function pick() {
  render(<GetStudyMaterialCard />);
  fireEvent.click(screen.getByRole("button", { name: "Get my study material" }));
  await screen.findByText(/From your Mac/);
  // The text commits before the dialog's showModal effect and before `run` releases its
  // lock; on a busy machine a click in that gap found no button or was ignored. Wait for
  // the real ready state, still on real timers, before any test switches to fake ones.
  await waitFor(() => expect(screen.getByRole("button", { name: "Replace what's on this phone" }).hasAttribute("disabled")).toBe(false));
}
function confirm() { fireEvent.click(screen.getByRole("button", { name: "Replace what's on this phone" })); }

describe("GetStudyMaterialCard", () => {
  it("does nothing after a cancelled picker", async () => {
    mocks.chooseCompleteBackup.mockResolvedValue(null);
    render(<GetStudyMaterialCard />);
    fireEvent.click(screen.getByRole("button", { name: "Get my study material" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Get my study material" }).hasAttribute("disabled")).toBe(false));
    for (const name of ["importPickedBackup", "phoneActivitySummary", "unsavedPhoneWork", "stageCompleteRestore", "exitForRestore", "discardIncomingBackup"] as const) {
      expect(mocks[name]).not.toHaveBeenCalled();
    }
  });

  it("uses singular wording, omits a zero part, and drops the clause when both are zero", async () => {
    mocks.phoneActivitySummary.mockResolvedValue({ ...activity, reviewsLast7Days: 1, attemptsLast7Days: 1 });
    await pick();
    expect(screen.getByText(/Your last card review/).textContent).toContain("1 card review and 1 practice test this week will be replaced.");
    cleanup();
    mocks.phoneActivitySummary.mockResolvedValue({ ...activity, reviewsLast7Days: 0, attemptsLast7Days: 4 });
    await pick();
    expect(screen.getByText(/Your last card review/).textContent).toMatch(/; 4 practice tests this week will be replaced\.$/);
    cleanup();
    mocks.phoneActivitySummary.mockResolvedValue({ ...activity, reviewsLast7Days: 0, attemptsLast7Days: 0 });
    await pick();
    const text = screen.getByText(/Your last card review/).textContent ?? "";
    expect(text).not.toContain("this week");
    expect(text).toContain("Your study activity on this phone will be replaced.");
  });

  it("previews the date, size, files and phone activity", async () => {
    await pick();
    expect(screen.getByText(/From your Mac/).textContent).toBe(`From your Mac · ${formatBackupDate(info.createdAt)} · 2 KB · 4 files`);
    expect(screen.getByText(/Your last card review/).textContent).toContain("2 card reviews and 3 practice tests this week will be replaced.");
    expect(screen.queryByText(/Nothing changes on this phone/)).toBeNull();
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

  it("on Mac stages only the copy and waits for Ok before the final sentence and delayed exit", async () => {
    platform.isIOS.mockReturnValue(false);
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
    expect(screen.getByRole("status").textContent).toContain("All set. Your Flight Deck will close now; open it again and your study material is there.");
    await act(async () => { await vi.advanceTimersByTimeAsync(1499); });
    expect(mocks.exitForRestore).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.exitForRestore).toHaveBeenCalledOnce();
  });


  it("shows elapsed seconds while opening the picked file and stops when ready", async () => {
    let resolve!: (value: typeof info) => void;
    mocks.importPickedBackup.mockReturnValue(new Promise((done) => { resolve = done; }));
    vi.useFakeTimers();
    render(<GetStudyMaterialCard />);
    fireEvent.click(screen.getByRole("button", { name: "Get my study material" }));
    await act(async () => {});
    expect(mocks.importPickedBackup).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toBe("Opening your file…");
    expect(screen.getByRole("button", { name: "Opening…" }).hasAttribute("disabled")).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(25000); });
    expect(screen.getByRole("status").textContent).toBe("Opening your file… · 25 s");
    await act(async () => { resolve(info); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("on iOS shows copying seconds until Ok, then All set with no buttons or exit", async () => {
    let resolve!: (value: typeof info) => void;
    mocks.stageCompleteRestore.mockReturnValue(new Promise((done) => { resolve = done; }));
    await pick();
    vi.useFakeTimers();
    confirm();
    expect(screen.getByRole("status").textContent).toBe("Copying your study material… this can take a minute.");
    expect(screen.getByRole("button", { name: "Not now" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Replace what's on this phone" }).hasAttribute("disabled")).toBe(true);
    confirm();
    expect(mocks.stageCompleteRestore).toHaveBeenCalledExactlyOnceWith(info.path);
    await act(async () => { await vi.advanceTimersByTimeAsync(25000); });
    expect(screen.getByRole("status").textContent).toBe("Copying your study material… this can take a minute. · 25 s");
    expect(screen.queryByRole("heading", { name: "All set" })).toBeNull();
    await act(async () => { resolve(info); });
    expect(screen.getByRole("heading", { name: "All set" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Close Your Flight Deck (swipe it away) and open it again to see your study material.");
    expect(screen.queryByRole("button")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(mocks.exitForRestore).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
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
    expect(screen.getByRole("button", { name: "Not now" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByText(/From your Mac/)).toBeNull());
    expect(mocks.discardIncomingBackup).toHaveBeenCalledOnce();
  });

  it.each([
    [null, 1, 0], [null, 0, 1], [activity.latestReviewAt, 0, 0],
  ])("never promises no loss for existing activity (%s, %s, %s)", async (latestReviewAt, reviewsLast7Days, attemptsLast7Days) => {
    mocks.phoneActivitySummary.mockResolvedValue({ latestReviewAt, reviewsLast7Days, attemptsLast7Days });
    await pick();
    expect(screen.queryByText(/Nothing changes on this phone/)).toBeNull();
    expect(screen.getByText(/will be replaced/)).toBeTruthy();
  });

  it("uses plain words throughout the preview and final sentence", async () => {
    mocks.phoneActivitySummary.mockResolvedValue({ latestReviewAt: null, reviewsLast7Days: 0, attemptsLast7Days: 0 });
    await pick();
    expect(screen.getByText("Nothing changes on this phone until you tap Replace.")).toBeTruthy();
    const previewText = document.body.textContent;
    confirm();
    await screen.findByRole("heading", { name: "All set" });
    const copy = `${previewText} ${document.body.textContent}`.toLowerCase();
    for (const word of ["sync", "manifest", "archive", "restart"]) expect(copy).not.toContain(word);
  });

  describe("unsaved phone work", () => {
    const BLOCKED = "This phone has 12 card reviews and 1 practice test that aren't saved anywhere else yet. Save my phone work first, then get your study material.";
    const unsaved = { reviews: 12, tests: 1, bookmarks: 0, readingPositions: 0, materials: 0, guides: 0, generatedTests: 0, since: null };

    it("matches the sentence the app itself refuses with", () => {
      expect(unsavedPhoneWorkSentence(unsaved)).toBe(BLOCKED);
      expect(unsavedPhoneWorkSentence({ ...unsaved, materials: 1 })).toBe("This phone has 12 card reviews, 1 practice test, and 1 study material that aren't saved anywhere else yet. Save my phone work first, then get your study material.");
      expect(unsavedPhoneWorkSentence({ ...unsaved, materials: 1, guides: 1, generatedTests: 1 })).toBe("This phone has 12 card reviews, 2 practice tests, 1 study guide, and 1 study material that aren't saved anywhere else yet. Save my phone work first, then get your study material.");
      expect(unsavedPhoneWorkSentence(none)).toBeNull();
      expect(unsavedPhoneWorkSentence({ ...none, reviews: 1 })).toBe("This phone has 1 card review that isn't saved anywhere else yet. Save my phone work first, then get your study material.");
    });

    it("on iOS blocks Replace and only offers Not now", async () => {
      mocks.unsavedPhoneWork.mockResolvedValue(unsaved);
      render(<GetStudyMaterialCard />);
      fireEvent.click(screen.getByRole("button", { name: "Get my study material" }));
      await screen.findByText(/From your Mac/);
      expect(screen.getByText(BLOCKED)).toBeTruthy();
      expect(screen.queryByText(/coming in the next update/)).toBeNull();
      expect(screen.getByRole("button", { name: "Save my phone work first" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Replace what's on this phone" })).toBeNull();
      expect(screen.queryByText(/will be replaced/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      await waitFor(() => expect(screen.queryByText(/From your Mac/)).toBeNull());
      expect(mocks.discardIncomingBackup).toHaveBeenCalledOnce();
      expect(mocks.stageCompleteRestore).not.toHaveBeenCalled();
    });

    const savedFile = { fileName: "My phone work.hfdbackup", savedAt: "2026-11-04T10:00:00.000Z", fileBytes: 10 };
    async function openBlocked() {
      mocks.unsavedPhoneWork.mockResolvedValueOnce(unsaved);
      render(<GetStudyMaterialCard />);
      fireEvent.click(screen.getByRole("button", { name: "Get my study material" }));
      await screen.findByText(/From your Mac/);
    }

    it("saving first unblocks Replace but does not restore", async () => {
      await openBlocked();
      mocks.savePhoneWork.mockResolvedValue(savedFile);
      mocks.unsavedPhoneWork.mockResolvedValue(none);
      fireEvent.click(screen.getByRole("button", { name: "Save my phone work first" }));
      await screen.findByRole("button", { name: "Replace what's on this phone" });
      expect(mocks.savePhoneWork).toHaveBeenCalledOnce();
      expect(screen.getByRole("status").textContent).toBe("Saved in Files \u2192 Your Flight Deck \u2192 My phone work.hfdbackup. Then on your Mac: Settings \u2192 Get progress from my iPhone.");
      expect(mocks.stageCompleteRestore).not.toHaveBeenCalled();
    });

    it("a failed save stays blocked and Not now still discards", async () => {
      await openBlocked();
      mocks.savePhoneWork.mockRejectedValue("Your phone work could not be saved.");
      fireEvent.click(screen.getByRole("button", { name: "Save my phone work first" }));
      expect((await screen.findByRole("alert")).textContent).toContain("could not be saved");
      expect(screen.queryByRole("button", { name: "Replace what's on this phone" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      await waitFor(() => expect(screen.queryByText(/From your Mac/)).toBeNull());
      expect(mocks.discardIncomingBackup).toHaveBeenCalledOnce();
    });

    it("on iOS with nothing unsaved keeps Replace", async () => {
      await pick();
      expect(screen.getByRole("button", { name: "Replace what's on this phone" })).toBeTruthy();
      expect(screen.getByText(/Your last card review/)).toBeTruthy();
    });

    it("on the Mac keeps Replace even with unsaved phone work", async () => {
      platform.isIOS.mockReturnValue(false);
      mocks.unsavedPhoneWork.mockResolvedValue(unsaved);
      await pick();
      expect(mocks.unsavedPhoneWork).not.toHaveBeenCalled();
      expect(screen.queryByText(BLOCKED)).toBeNull();
    });

    it("on iOS fails closed when the check fails", async () => {
      mocks.unsavedPhoneWork.mockRejectedValue("The phone work check broke.");
      render(<GetStudyMaterialCard />);
      fireEvent.click(screen.getByRole("button", { name: "Get my study material" }));
      await screen.findByText(/From your Mac/);
      expect((await screen.findByRole("alert")).textContent).toContain("The phone work check broke.");
      expect(screen.queryByRole("button", { name: "Replace what's on this phone" })).toBeNull();
      expect(mocks.stageCompleteRestore).not.toHaveBeenCalled();
    });

    it("uses plain words in the blocked sentence", async () => {
      mocks.unsavedPhoneWork.mockResolvedValue({ ...unsaved, bookmarks: 2, readingPositions: 1 });
      render(<GetStudyMaterialCard />);
      fireEvent.click(screen.getByRole("button", { name: "Get my study material" }));
      await screen.findByText(/From your Mac/);
      const copy = document.body.textContent!.toLowerCase();
      for (const word of ["sync", "manifest", "archive", "restart", "baseline", "ledger", "database", "restore"]) {
        expect(copy).not.toContain(word);
      }
    });
  });
});
