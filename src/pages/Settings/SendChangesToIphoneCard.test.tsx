// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendChangesToIphone: vi.fn() }));
vi.mock("@/services/iphone", async (original) => ({
  ...(await original<typeof import("@/services/iphone")>()),
  sendChangesToIphone: mocks.sendChangesToIphone,
}));

import { SendChangesToIphoneCard } from "./SendChangesToIphoneCard";
import source from "./SendChangesToIphoneCard.tsx?raw";

const sent = {
  fileName: "Changes from my Mac.hfdprogress",
  sentAt: "x",
  nothingNew: false,
  counts: { materials: 2, removed: 0, cardSets: 1, practiceTests: 0, studyGuides: 0 },
  pdfsIncluded: 0,
  pdfsLeft: 0,
  fileBytes: 2048,
  path: "/x/Changes from my Mac.hfdprogress",
};

afterEach(cleanup);
beforeEach(() => {
  mocks.sendChangesToIphone.mockReset();
});

describe("SendChangesToIphoneCard", () => {
  it("names the real file and where to find it", async () => {
    mocks.sendChangesToIphone.mockResolvedValue({ sent, viaICloud: true });
    render(<SendChangesToIphoneCard />);
    fireEvent.click(screen.getByRole("button", { name: "Send changes to my iPhone" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("2 study materials and 1 card set");
    expect(status.textContent).toContain("Files → iCloud Drive → Her Flight Deck");
    expect(status.textContent).toContain("Changes from my Mac.hfdprogress");
  });

  it("says AirDrop when it was saved elsewhere", async () => {
    mocks.sendChangesToIphone.mockResolvedValue({ sent, viaICloud: false });
    render(<SendChangesToIphoneCard />);
    fireEvent.click(screen.getByRole("button", { name: "Send changes to my iPhone" }));
    expect((await screen.findByRole("status")).textContent).toContain("AirDrop Changes from my Mac.hfdprogress");
  });

  it("says so when nothing is new", async () => {
    mocks.sendChangesToIphone.mockResolvedValue({ sent: { ...sent, nothingNew: true }, viaICloud: true });
    render(<SendChangesToIphoneCard />);
    fireEvent.click(screen.getByRole("button", { name: "Send changes to my iPhone" }));
    expect((await screen.findByRole("status")).textContent).toBe("Nothing new to send since last time.");
  });

  it("shows nothing when she cancels", async () => {
    mocks.sendChangesToIphone.mockResolvedValue(null);
    render(<SendChangesToIphoneCard />);
    fireEvent.click(screen.getByRole("button", { name: "Send changes to my iPhone" }));
    await waitFor(() => expect(mocks.sendChangesToIphone).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the calm sentence from the app on error", async () => {
    mocks.sendChangesToIphone.mockRejectedValue("Send a full copy to your iPhone first; after that only changes are sent.");
    render(<SendChangesToIphoneCard />);
    fireEvent.click(screen.getByRole("button", { name: "Send changes to my iPhone" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Send a full copy to your iPhone first");
  });

  it("uses no developer words", () => {
    const copy = source.match(/>[^<>{}]*[A-Za-z][^<>{}]*</g)?.join(" ") ?? "";
    for (const word of ["sync", "upload", "manifest", "archive", "outbox", "stream"]) {
      expect(copy.toLowerCase()).not.toContain(word);
    }
  });
});
