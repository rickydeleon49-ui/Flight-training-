// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendToIphone: vi.fn(), revealIphoneBackup: vi.fn() }));
vi.mock("@/services/iphone", () => mocks);

import type { Repositories } from "@/data/repositories";
import { SendToIphoneCard } from "./SendToIphoneCard";
import source from "./SendToIphoneCard.tsx?raw";

const repositories = {
  app: {
    lastIphoneSend: vi.fn(async () => null),
    recordIphoneSend: vi.fn(async () => undefined),
  },
} as unknown as Repositories;

afterEach(cleanup);

beforeEach(() => {
  mocks.sendToIphone.mockReset();
  vi.mocked(repositories.app.recordIphoneSend).mockClear();
});

describe("SendToIphoneCard", () => {
  it("shows size, date and the Files sentence after a send", async () => {
    mocks.sendToIphone.mockResolvedValue({
      info: { bytes: 2048, path: "/Users/x/Library/Mobile Documents/com~apple~CloudDocs/Her Flight Deck/a.hfdbackup" },
      viaICloud: true,
    });
    render(<SendToIphoneCard repositories={repositories} />);
    fireEvent.click(screen.getByRole("button", { name: "Send to my iPhone" }));
    expect(await screen.findByText(/Saved for your iPhone · 2 KB/)).toBeTruthy();
    expect(screen.getByText(/open Files → iCloud Drive → Her Flight Deck/)).toBeTruthy();
    expect(repositories.app.recordIphoneSend).toHaveBeenCalled();
  });

  it("explains AirDrop when iCloud Drive was not used", async () => {
    mocks.sendToIphone.mockResolvedValue({
      info: { bytes: 10, path: "/Users/x/Downloads/a.hfdbackup" },
      viaICloud: false,
    });
    render(<SendToIphoneCard repositories={repositories} />);
    fireEvent.click(screen.getByRole("button", { name: "Send to my iPhone" }));
    expect(await screen.findByText(/iCloud Drive isn't on for this Mac/)).toBeTruthy();
  });

  it("records nothing when she cancels", async () => {
    mocks.sendToIphone.mockResolvedValue(null);
    render(<SendToIphoneCard repositories={repositories} />);
    fireEvent.click(screen.getByRole("button", { name: "Send to my iPhone" }));
    await waitFor(() => expect(mocks.sendToIphone).toHaveBeenCalled());
    expect(repositories.app.recordIphoneSend).not.toHaveBeenCalled();
    expect(screen.queryByText(/Saved for your iPhone/)).toBeNull();
  });

  it("shows a calm message on error", async () => {
    mocks.sendToIphone.mockRejectedValue("The disk is full.");
    render(<SendToIphoneCard repositories={repositories} />);
    fireEvent.click(screen.getByRole("button", { name: "Send to my iPhone" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The disk is full.");
  });

  it("uses no developer words", () => {
    const copy = source.match(/>[^<>{}]*[A-Za-z][^<>{}]*</g)?.join(" ") ?? "";
    for (const word of ["sync", "upload", "cloud sync", "manifest", "archive"]) {
      expect(copy.toLowerCase()).not.toContain(word);
    }
  });
});
