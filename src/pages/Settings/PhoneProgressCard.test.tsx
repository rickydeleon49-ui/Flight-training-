// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ unsavedPhoneWork: vi.fn(), savePhoneWork: vi.fn(), sendPhoneProgress: vi.fn() }));
vi.mock("@/services/backups", async (original) => ({
  ...await original<typeof import("@/services/backups")>(), ...mocks,
}));
vi.mock("@/services/phoneProgress", async (original) => ({
  ...await original<typeof import("@/services/phoneProgress")>(), sendPhoneProgress: mocks.sendPhoneProgress,
}));
import { PhoneProgressCard } from "./PhoneProgressCard";

const none = { reviews: 0, tests: 0, bookmarks: 0, readingPositions: 0, materials: 0, guides: 0, generatedTests: 0, since: null };
const some = { reviews: 12, tests: 1, bookmarks: 0, readingPositions: 0, materials: 0, guides: 0, generatedTests: 0, since: null };
const saved = { fileName: "My phone work.hfdbackup", savedAt: "2026-11-04T10:00:00.000Z", fileBytes: 10 };

const sent = { fileName: "My phone progress.hfdprogress", sentAt: "2026-11-04T10:00:00.000Z", nothingNew: false, counts: some, pdfsIncluded: 1, pdfsLeft: 0, fileBytes: 10 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.unsavedPhoneWork.mockResolvedValue(some);
  mocks.savePhoneWork.mockResolvedValue(saved);
  mocks.sendPhoneProgress.mockResolvedValue(sent);
});
afterEach(cleanup);

describe("PhoneProgressCard", () => {
  it("shows what is not saved yet", async () => {
    render(<PhoneProgressCard />);
    expect(await screen.findByText("This phone has 12 card reviews and 1 practice test that aren't saved anywhere else yet.")).toBeTruthy();
  });

  it("uses the singular verb for one unsaved item", async () => {
    mocks.unsavedPhoneWork.mockResolvedValue({ ...none, reviews: 1 });
    render(<PhoneProgressCard />);
    expect(await screen.findByText("This phone has 1 card review that isn't saved anywhere else yet.")).toBeTruthy();
  });

  it("says everything is saved when nothing is new", async () => {
    mocks.unsavedPhoneWork.mockResolvedValue(none);
    render(<PhoneProgressCard />);
    expect(await screen.findByText("Everything you did on this phone is saved.")).toBeTruthy();
  });

  it("sends once, shows where, and checks again", async () => {
    render(<PhoneProgressCard />);
    await screen.findByText(/12 card reviews/);
    mocks.unsavedPhoneWork.mockResolvedValue(none);
    fireEvent.click(screen.getByRole("button", { name: "Send my progress to the Mac" }));
    expect((await screen.findByRole("status")).textContent).toBe("Sent: 12 card reviews and 1 practice test · 1 PDF. It's in Files → Your Flight Deck → My phone progress.hfdprogress. On your Mac: Settings → Get progress from my iPhone.");
    expect(mocks.sendPhoneProgress).toHaveBeenCalledOnce();
    expect(mocks.savePhoneWork).not.toHaveBeenCalled();
    await screen.findByText("Everything you did on this phone is saved.");
    expect(mocks.unsavedPhoneWork).toHaveBeenCalledTimes(2);
  });

  it("says when there is nothing new, and when a PDF was left out", async () => {
    mocks.sendPhoneProgress.mockResolvedValueOnce({ ...sent, nothingNew: true });
    render(<PhoneProgressCard />);
    await screen.findByText(/12 card reviews/);
    fireEvent.click(screen.getByRole("button", { name: "Send my progress to the Mac" }));
    expect((await screen.findByRole("status")).textContent).toBe("Nothing new to send since last time.");
    mocks.sendPhoneProgress.mockResolvedValueOnce({ ...sent, pdfsLeft: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Send my progress to the Mac" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("2 PDFs couldn't be included this time."));
  });

  it("still saves a full copy with the old sentence", async () => {
    render(<PhoneProgressCard />);
    await screen.findByText(/12 card reviews/);
    fireEvent.click(screen.getByRole("button", { name: "Save a full copy instead" }));
    expect((await screen.findByRole("status")).textContent).toBe("Saved in Files → Your Flight Deck → My phone work.hfdbackup. Then on your Mac: Settings → Get progress from my iPhone.");
    expect(mocks.savePhoneWork).toHaveBeenCalledOnce();
    expect(mocks.sendPhoneProgress).not.toHaveBeenCalled();
    expect(screen.getByText("Everything on this phone, for safekeeping.")).toBeTruthy();
  });

  it("shows a calm alert when sending fails and keeps the counts", async () => {
    mocks.sendPhoneProgress.mockRejectedValue(new Error("Your progress file was written, but this phone couldn't note it as sent. Try again."));
    render(<PhoneProgressCard />);
    await screen.findByText(/12 card reviews/);
    fireEvent.click(screen.getByRole("button", { name: "Send my progress to the Mac" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Try again");
    expect(screen.getByText(/12 card reviews/)).toBeTruthy();
  });

  it("still offers the buttons when the check fails", async () => {
    mocks.unsavedPhoneWork.mockRejectedValue("nope");
    render(<PhoneProgressCard />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Send my progress to the Mac" })).toBeTruthy();
  });

  it("uses plain words throughout", async () => {
    render(<PhoneProgressCard />);
    await screen.findByText(/12 card reviews/);
    fireEvent.click(screen.getByRole("button", { name: "Send my progress to the Mac" }));
    await screen.findByRole("status");
    const text = document.body.textContent!.toLowerCase().replace("my phone progress.hfdprogress", "");
    for (const w of ["sync", "backup", "ledger", "database", "archive", "manifest", "merge", "conflict", "export", "change file", "device", "blob", "outbox"]) expect(text).not.toContain(w);
  });
});
