import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ open: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open, save: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/data", () => ({ isTauri: () => true }));

import { formatBackupDate } from "./backups";
import { choosePhoneProgressFile, importPhoneProgress, phoneProgressSentence, type PhoneProgress } from "./phoneProgress";

const none = { reviews: 0, tests: 0, bookmarks: 0, readingPositions: 0, materials: 0, guides: 0, generatedTests: 0, since: null };
const progress = (over: Partial<PhoneProgress> = {}): PhoneProgress => ({
  outcome: "added",
  counts: { ...none, reviews: 12, tests: 1 },
  pdfsAdded: 0,
  pdfsWaiting: 0,
  phoneSavedAt: null,
  fromFuture: false,
  ...over,
});

beforeEach(() => {
  mocks.open.mockReset();
  mocks.invoke.mockReset();
});

describe("phone progress service", () => {
  it("returns null when she cancels the file chooser", async () => {
    mocks.open.mockResolvedValue(null);
    expect(await choosePhoneProgressFile()).toBeNull();
  });

  it("asks for one hfdbackup file with no default folder", async () => {
    mocks.open.mockResolvedValue("/x/My phone work.hfdbackup");
    expect(await choosePhoneProgressFile()).toBe("/x/My phone work.hfdbackup");
    const options = mocks.open.mock.calls[0]![0];
    expect(options).toMatchObject({
      multiple: false,
      directory: false,
      title: "Choose the file from your iPhone",
      filters: [{ name: "Your Flight Deck file", extensions: ["hfdbackup"] }],
    });
    expect(options).not.toHaveProperty("defaultPath");
  });

  it("passes the picked path to the app", async () => {
    mocks.invoke.mockResolvedValue(progress());
    await importPhoneProgress("/x/a.hfdbackup");
    expect(mocks.invoke).toHaveBeenCalledWith("import_phone_progress", { sourcePath: "/x/a.hfdbackup" });
  });
});

describe("phone progress sentences", () => {
  it("names what came in, when the phone saved it and the PDFs copied", () => {
    const saved = 1_699_000_000;
    expect(phoneProgressSentence(progress({ phoneSavedAt: saved, pdfsAdded: 2 }))).toBe(
      `Brought in from your iPhone: 12 card reviews and 1 practice test · saved on the phone ${formatBackupDate(saved)} · 2 PDFs copied.`,
    );
    expect(phoneProgressSentence(progress({ counts: { ...none, bookmarks: 1 }, pdfsAdded: 1 }))).toBe(
      "Brought in from your iPhone: 1 bookmark · 1 PDF copied.",
    );
  });

  it("says so when the file was already in or has nothing new", () => {
    expect(phoneProgressSentence(progress({ outcome: "alreadyIn", counts: none }))).toBe("That file was already brought in.");
    expect(phoneProgressSentence(progress({ outcome: "nothingNew", counts: none }))).toBe(
      "Your iPhone hasn't done anything new since last time.",
    );
  });

  it("copes with a missing count list", () => {
    expect(phoneProgressSentence(progress({ counts: none }))).toBe("Your iPhone hasn't done anything new since last time.");
  });

  it("reports PDFs that are not here yet, singular and plural", () => {
    expect(phoneProgressSentence(progress({ pdfsWaiting: 1 }))).toContain("1 PDF from your phone isn't here yet.");
    expect(phoneProgressSentence(progress({ pdfsWaiting: 3 }))).toContain("3 PDFs from your phone aren't here yet.");
    expect(phoneProgressSentence(progress({ outcome: "alreadyIn", counts: none, pdfsAdded: 1 }))).toBe(
      "That file was already brought in. 1 PDF from your phone copied.",
    );
  });

  it("warns when the phone's clock looks ahead", () => {
    expect(phoneProgressSentence(progress({ fromFuture: true }))).toContain(
      "That file's clock looks ahead of this Mac's — check the time on your phone.",
    );
  });

  it("uses plain words", () => {
    const text = [
      phoneProgressSentence(progress({ pdfsAdded: 1, pdfsWaiting: 1, fromFuture: true, phoneSavedAt: 1_699_000_000 })),
      phoneProgressSentence(progress({ outcome: "alreadyIn", counts: none })),
    ]
      .join(" ")
      .toLowerCase();
    for (const word of ["sync", "merge", "conflict", "import", "ingest", "ledger", "change file", "device"]) {
      expect(text).not.toContain(word);
    }
  });
});
