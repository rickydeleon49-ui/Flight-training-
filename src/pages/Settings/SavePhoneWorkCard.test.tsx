// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ unsavedPhoneWork: vi.fn(), savePhoneWork: vi.fn() }));
vi.mock("@/services/backups", async (original) => ({
  ...await original<typeof import("@/services/backups")>(), ...mocks,
}));
import { SavePhoneWorkCard } from "./SavePhoneWorkCard";

const none = { reviews: 0, tests: 0, bookmarks: 0, readingPositions: 0, materials: 0, since: null };
const some = { reviews: 12, tests: 1, bookmarks: 0, readingPositions: 0, materials: 0, since: null };
const saved = { fileName: "My phone work.hfdbackup", savedAt: "2026-11-04T10:00:00.000Z", fileBytes: 10 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.unsavedPhoneWork.mockResolvedValue(some);
  mocks.savePhoneWork.mockResolvedValue(saved);
});
afterEach(cleanup);

describe("SavePhoneWorkCard", () => {
  it("shows what is not saved yet", async () => {
    render(<SavePhoneWorkCard />);
    expect(await screen.findByText("This phone has 12 card reviews and 1 practice test that aren't saved anywhere else yet.")).toBeTruthy();
  });

  it("uses the singular verb for one unsaved item", async () => {
    mocks.unsavedPhoneWork.mockResolvedValue({ ...none, reviews: 1 });
    render(<SavePhoneWorkCard />);
    expect(await screen.findByText("This phone has 1 card review that isn't saved anywhere else yet.")).toBeTruthy();
  });

  it("says everything is saved when nothing is new", async () => {
    mocks.unsavedPhoneWork.mockResolvedValue(none);
    render(<SavePhoneWorkCard />);
    expect(await screen.findByText("Everything you did on this phone is saved.")).toBeTruthy();
  });

  it("saves once, shows where, and checks again", async () => {
    render(<SavePhoneWorkCard />);
    await screen.findByText(/12 card reviews/);
    mocks.unsavedPhoneWork.mockResolvedValue(none);
    fireEvent.click(screen.getByRole("button", { name: "Save my phone work" }));
    expect((await screen.findByRole("status")).textContent).toBe("Saved in Files → Your Flight Deck → My phone work.hfdbackup.");
    expect(mocks.savePhoneWork).toHaveBeenCalledOnce();
    await screen.findByText("Everything you did on this phone is saved.");
    expect(mocks.unsavedPhoneWork).toHaveBeenCalledTimes(2);
  });

  it("shows a calm alert when saving fails and keeps the counts", async () => {
    mocks.savePhoneWork.mockRejectedValue(new Error("Your phone work was copied, but this phone couldn't note it as saved. Try again."));
    render(<SavePhoneWorkCard />);
    await screen.findByText(/12 card reviews/);
    fireEvent.click(screen.getByRole("button", { name: "Save my phone work" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Try again");
    expect(screen.getByText(/12 card reviews/)).toBeTruthy();
  });

  it("still offers the button when the check fails", async () => {
    mocks.unsavedPhoneWork.mockRejectedValue("nope");
    render(<SavePhoneWorkCard />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Save my phone work" })).toBeTruthy();
  });

  it("uses plain words throughout", async () => {
    render(<SavePhoneWorkCard />);
    await screen.findByText(/12 card reviews/);
    fireEvent.click(screen.getByRole("button", { name: "Save my phone work" }));
    await screen.findByRole("status");
    const text = document.body.textContent!.toLowerCase().replace("my phone work.hfdbackup", "");
    for (const w of ["sync", "backup", "ledger", "database", "archive", "manifest"]) expect(text).not.toContain(w);
  });
});
