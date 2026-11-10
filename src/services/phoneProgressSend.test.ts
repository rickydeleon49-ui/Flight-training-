import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => core);
vi.mock("@/data", () => ({ isTauri: () => true }));
import { preparePhoneProgress, sendPhoneProgress, sentPhoneProgressSentence } from "./phoneProgress";

const zero = { reviews: 0, tests: 0, bookmarks: 0, readingPositions: 0, materials: 0, guides: 0, generatedTests: 0, organization: 0, since: null };
const base = { fileName: "My phone progress.hfdprogress", sentAt: "x", nothingNew: false, counts: zero, pdfsIncluded: 0, pdfsLeft: 0, fileBytes: 1 };

beforeEach(() => { core.invoke.mockReset(); });

describe("sentPhoneProgressSentence", () => {
  it("handles singular, plural, nothing new and left-out PDFs", () => {
    expect(sentPhoneProgressSentence({ ...base, nothingNew: true })).toBe("Nothing new to send since last time.");
    expect(sentPhoneProgressSentence({ ...base })).toContain("Sent: your latest work.");
    expect(sentPhoneProgressSentence({ ...base, counts: { ...zero, reviews: 1 }, pdfsIncluded: 1 })).toContain("Sent: 1 card review · 1 PDF.");
    expect(sentPhoneProgressSentence({ ...base, pdfsIncluded: 3 })).toContain("· 3 PDFs.");
    expect(sentPhoneProgressSentence({ ...base, pdfsLeft: 1 })).toMatch(/1 PDF couldn't be included this time\.$/);
    expect(sentPhoneProgressSentence({ ...base, pdfsLeft: 2 })).toMatch(/2 PDFs couldn't be included this time\.$/);
  });
});

describe("commands", () => {
  it("calls the right names and never throws on prepare", async () => {
    core.invoke.mockResolvedValue(base);
    await sendPhoneProgress();
    expect(core.invoke).toHaveBeenCalledWith("send_phone_progress");
    core.invoke.mockImplementation(async () => { throw new Error("x"); });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(preparePhoneProgress()).resolves.toBeUndefined();
    expect(core.invoke).toHaveBeenLastCalledWith("prepare_phone_progress");
  });
});
