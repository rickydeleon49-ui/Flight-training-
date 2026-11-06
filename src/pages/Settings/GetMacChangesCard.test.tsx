// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ choose: vi.fn(), get: vi.fn(), refresh: vi.fn() }));
vi.mock("@/state/AppDataContext", () => ({ useAppData: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/services/macChanges", async (original) => ({
  ...(await original<typeof import("@/services/macChanges")>()),
  chooseMacChangesFile: mocks.choose,
  getMacChanges: mocks.get,
}));

import { GetMacChangesCard } from "./GetMacChangesCard";
import source from "./GetMacChangesCard.tsx?raw";

const got = {
  outcome: "added",
  materials: 3,
  removed: 0,
  cardSets: 0,
  practiceTests: 0,
  studyGuides: 0,
  pdfsAdded: 2,
  pdfsWaiting: 1,
  macSavedAt: null,
  fromFuture: false,
};
const button = () => screen.getByRole("button", { name: "Choose the file from my Mac" });

afterEach(cleanup);
beforeEach(() => {
  mocks.choose.mockReset();
  mocks.get.mockReset();
  mocks.refresh.mockReset();
  mocks.refresh.mockResolvedValue(undefined);
});

describe("GetMacChangesCard", () => {
  it("says what came in", async () => {
    mocks.choose.mockResolvedValue("/f/Changes from my Mac.hfdprogress");
    mocks.get.mockResolvedValue(got);
    render(<GetMacChangesCard />);
    fireEvent.click(button());
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Brought in from your Mac: 3 study materials.");
    expect(status.textContent).toContain("2 PDFs copied.");
    expect(status.textContent).toContain("1 PDF from your Mac isn't here yet.");
    expect(mocks.get).toHaveBeenCalledWith("/f/Changes from my Mac.hfdprogress");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the Brought in line when the reload fails", async () => {
    mocks.choose.mockResolvedValue("/f");
    mocks.get.mockResolvedValue(got);
    mocks.refresh.mockRejectedValue(new Error("boom"));
    render(<GetMacChangesCard />);
    fireEvent.click(button());
    expect((await screen.findByRole("status")).textContent).toContain("Brought in from your Mac");
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when the file was already in", async () => {
    mocks.choose.mockResolvedValue("/f");
    mocks.get.mockResolvedValue({ ...got, outcome: "alreadyIn", pdfsAdded: 0, pdfsWaiting: 0 });
    render(<GetMacChangesCard />);
    fireEvent.click(button());
    expect((await screen.findByRole("status")).textContent).toBe("That file was already brought in.");
  });

  it("does nothing when she cancels", async () => {
    mocks.choose.mockResolvedValue(null);
    render(<GetMacChangesCard />);
    fireEvent.click(button());
    await waitFor(() => expect(mocks.choose).toHaveBeenCalled());
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("shows the app's own sentence on error", async () => {
    mocks.choose.mockResolvedValue("/f");
    mocks.get.mockRejectedValue("This phone has work that isn't saved anywhere else yet. Send my progress to the Mac first, then get the Mac's changes.");
    render(<GetMacChangesCard />);
    fireEvent.click(button());
    expect((await screen.findByRole("alert")).textContent).toContain("Send my progress to the Mac first");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("uses no developer words", () => {
    const copy = source.match(/>[^<>{}]*[A-Za-z][^<>{}]*</g)?.join(" ") ?? "";
    for (const word of ["sync", "upload", "manifest", "archive", "outbox", "stream"]) {
      expect(copy.toLowerCase()).not.toContain(word);
    }
  });
});
