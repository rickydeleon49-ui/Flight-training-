// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ choose: vi.fn(), run: vi.fn(), refresh: vi.fn() }));
vi.mock("@/state/AppDataContext", () => ({ useAppData: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/services/phoneProgress", async (original) => ({
  ...(await original<typeof import("@/services/phoneProgress")>()),
  choosePhoneProgressFile: mocks.choose,
  importPhoneProgress: mocks.run,
}));

import { GetPhoneProgressCard } from "./GetPhoneProgressCard";
import source from "./GetPhoneProgressCard.tsx?raw";

const none = { reviews: 0, tests: 0, bookmarks: 0, readingPositions: 0, materials: 0, guides: 0, generatedTests: 0, since: null };
const BUTTON = "Choose the file from my iPhone";

afterEach(cleanup);
beforeEach(() => {
  mocks.choose.mockReset();
  mocks.run.mockReset();
  mocks.refresh.mockReset();
  mocks.refresh.mockResolvedValue(undefined);
});

describe("GetPhoneProgressCard", () => {
  it("says what was brought in", async () => {
    mocks.choose.mockResolvedValue("/x/My phone work.hfdbackup");
    mocks.run.mockResolvedValue({
      outcome: "added",
      counts: { ...none, reviews: 12, tests: 1 },
      pdfsAdded: 0,
      pdfsWaiting: 0,
      phoneSavedAt: null,
      fromFuture: false,
    });
    render(<GetPhoneProgressCard />);
    fireEvent.click(screen.getByRole("button", { name: BUTTON }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "Brought in from your iPhone: 12 card reviews and 1 practice test.",
    );
    expect(mocks.run).toHaveBeenCalledWith("/x/My phone work.hfdbackup");
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("does nothing when she cancels", async () => {
    mocks.choose.mockResolvedValue(null);
    render(<GetPhoneProgressCard />);
    fireEvent.click(screen.getByRole("button", { name: BUTTON }));
    await waitFor(() => expect(mocks.choose).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: BUTTON })).toBeTruthy());
    expect(mocks.run).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the app's calm message, or a fixed one, on error", async () => {
    mocks.choose.mockResolvedValue("/x/a.hfdbackup");
    mocks.run.mockRejectedValueOnce("That file was made on this Mac.");
    render(<GetPhoneProgressCard />);
    fireEvent.click(screen.getByRole("button", { name: BUTTON }));
    expect((await screen.findByRole("alert")).textContent).toBe("That file was made on this Mac.");
    mocks.run.mockRejectedValueOnce(new Error(""));
    fireEvent.click(screen.getByRole("button", { name: BUTTON }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("That file couldn't be brought in. Nothing on this Mac was changed."),
    );
  });

  it("explains the steps in plain words", () => {
    render(<GetPhoneProgressCard />);
    expect(screen.getByRole("heading", { name: "Get progress from my iPhone" })).toBeTruthy();
    expect(screen.getByText(/On your iPhone, open Settings → Send my progress to the Mac/)).toBeTruthy();
    const copy = (source.match(/>[^<>{}]*[A-Za-z][^<>{}]*</g)?.join(" ") ?? "") + document.body.textContent;
    for (const word of ["sync", "merge", "conflict", "import", "ingest", "ledger", "change file", "device", "export", "blob", "outbox"]) {
      expect(copy.toLowerCase()).not.toContain(word);
    }
  });
});
