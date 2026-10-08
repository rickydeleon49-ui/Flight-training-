/**
 * M2-4 / C2: the desktop adapter accepts only allowlisted native read
 * outcomes — one native code with its exact fixed message, or a result of
 * the expected shape. Anything else is IPC_TRANSPORT_ERROR, never raw text.
 * No real IPC.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { CARD_LIBRARY_ERROR_MESSAGES, CardLibraryReadError } from "@/logic/cardLibrary";

import { invokeCardLibraryRead, isLibraryRecentReviewsResult, isLibraryReviewDueResult } from "./tauriDb";

const dueResult = {
  materials: [{ materialId: "m", newCount: 2 }],
  issues: [],
  nextCursor: null,
  summary: { isPageLocal: true, isComplete: true },
};
const historyResult = { rows: [{ id: "e", materialId: "m" }], next: "c", pendingMaterialIds: [], enrichment: null, summary: { isPageLocal: true } };

const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) => (error instanceof CardLibraryReadError ? `${error.code}|${error.message}` : "other"),
  );

describe("invokeCardLibraryRead", () => {
  it("passes the input to the named native command and returns a well-shaped result", async () => {
    const call = vi.fn().mockResolvedValue(dueResult);
    await expect(invokeCardLibraryRead("get_library_review_due", { limit: 5 }, isLibraryReviewDueResult, call)).resolves.toEqual(dueResult);
    expect(call).toHaveBeenCalledWith("get_library_review_due", { input: { limit: 5 } });
    const history = vi.fn().mockResolvedValue(historyResult);
    await expect(invokeCardLibraryRead("get_library_recent_reviews", {}, isLibraryRecentReviewsResult, history)).resolves.toEqual(historyResult);
  });

  it("accepts each native code only with its exact message", async () => {
    for (const code of ["INVALID_TIME", "INVALID_FILTER", "INVALID_INPUT", "INVALID_CURSOR", "STALE_CURSOR", "INVALID_TARGET", "NOT_READY", "STORAGE_ERROR"] as const) {
      const message = CARD_LIBRARY_ERROR_MESSAGES[code];
      expect(await outcome(invokeCardLibraryRead("get_library_review_due", {}, isLibraryReviewDueResult, vi.fn().mockRejectedValue({ code, message })))).toBe(`${code}|${message}`);
      expect(
        await outcome(invokeCardLibraryRead("get_library_review_due", {}, isLibraryReviewDueResult, vi.fn().mockRejectedValue({ code, message: "raw SQLITE_BUSY /private" }))),
      ).toBe(`IPC_TRANSPORT_ERROR|${CARD_LIBRARY_ERROR_MESSAGES.IPC_TRANSPORT_ERROR}`);
    }
  });

  it("never accepts transport codes, unknown codes or malformed results from the native side", async () => {
    const ipc = `IPC_TRANSPORT_ERROR|${CARD_LIBRARY_ERROR_MESSAGES.IPC_TRANSPORT_ERROR}`;
    for (const rejection of [{ code: "IPC_TRANSPORT_ERROR", message: CARD_LIBRARY_ERROR_MESSAGES.IPC_TRANSPORT_ERROR }, { code: "DISK_FULL", message: "x" }, "boom", null]) {
      expect(await outcome(invokeCardLibraryRead("get_library_review_due", {}, isLibraryReviewDueResult, vi.fn().mockRejectedValue(rejection)))).toBe(ipc);
    }
    for (const bad of [null, [], { ...dueResult, summary: { isPageLocal: false, isComplete: true } }, { ...dueResult, nextCursor: 3 }, { ...dueResult, materials: [{}] }, historyResult]) {
      expect(await outcome(invokeCardLibraryRead("get_library_review_due", {}, isLibraryReviewDueResult, vi.fn().mockResolvedValue(bad)))).toBe(ipc);
    }
    expect(await outcome(invokeCardLibraryRead("get_library_recent_reviews", {}, isLibraryRecentReviewsResult, vi.fn().mockResolvedValue(dueResult)))).toBe(ipc);
  });
});
