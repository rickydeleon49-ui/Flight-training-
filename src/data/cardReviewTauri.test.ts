/**
 * M2-3 C1: the desktop adapter accepts only allowlisted card-review
 * outcomes. A refusal counts only as exactly one native code with its fixed
 * message; anything else, including a malformed result, becomes
 * IPC_TRANSPORT_ERROR and is never shown raw. No real IPC is used.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import type { CardReviewAction } from "@/domain/types";

import { CARD_REVIEW_ERROR_MESSAGES, CardReviewError } from "./persistenceErrors";
import { invokeCardReviewSave } from "./tauriDb";

const rate: CardReviewAction = {
  action: "rate",
  operationId: "f1000000-0000-4000-8000-000000000001",
  materialId: "mat",
  versionContentHash: "a".repeat(64),
  itemId: "b".repeat(64),
  expectedGeneration: 0,
  expectedRevision: 0,
  rating: "good",
};
const reset: CardReviewAction = { action: "reset", operationId: "f1000000-0000-4000-8000-000000000002", materialId: "mat", expectedGeneration: 2 };
const itemResult = { action: "rate", itemId: "b".repeat(64), generation: 0, revision: 1, dueAt: "2026-10-07T15:00:00.000Z", reviewedAt: "2026-10-06T15:00:00.000Z", suspended: false, flag: null };

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) => (error instanceof CardReviewError ? `${error.code}|${error.message}` : "other"),
  );

describe("invokeCardReviewSave", () => {
  it("sends the operation to the native command and returns a matching result", async () => {
    const call = vi.fn().mockResolvedValue(itemResult);
    await expect(invokeCardReviewSave(rate, call)).resolves.toEqual(itemResult);
    expect(call).toHaveBeenCalledWith("save_card_review_atomically", { operation: rate });
    const resetCall = vi.fn().mockResolvedValue({ action: "reset", materialId: "mat", generation: 3 });
    await expect(invokeCardReviewSave(reset, resetCall)).resolves.toEqual({ action: "reset", materialId: "mat", generation: 3 });
  });

  it("passes through every native code only with its exact fixed message", async () => {
    for (const nativeCode of [
      "INVALID_ARGUMENT", "OPERATION_CONFLICT", "OPERATION_ERASED", "STALE_GENERATION", "STALE_REVISION", "STALE_CONTENT",
      "MALFORMED_CARDS", "CARD_SUSPENDED", "CARD_FLAGGED", "CLOCK_BEHIND_LAST_REVIEW", "NOT_FOUND", "INVALID_STATE", "NOT_READY", "STORAGE_ERROR",
    ] as const) {
      const message = CARD_REVIEW_ERROR_MESSAGES[nativeCode];
      expect(await code(invokeCardReviewSave(rate, vi.fn().mockRejectedValue({ code: nativeCode, message })))).toBe(`${nativeCode}|${message}`);
      expect(await code(invokeCardReviewSave(rate, vi.fn().mockRejectedValue({ code: nativeCode, message: "raw /private SQLITE_BUSY" })))).toBe(
        `IPC_TRANSPORT_ERROR|${CARD_REVIEW_ERROR_MESSAGES.IPC_TRANSPORT_ERROR}`,
      );
    }
  });

  it("never accepts transport-only codes, unknown codes, raw errors or malformed results from the native side", async () => {
    const ipc = `IPC_TRANSPORT_ERROR|${CARD_REVIEW_ERROR_MESSAGES.IPC_TRANSPORT_ERROR}`;
    for (const rejection of [
      { code: "UNSUPPORTED_DRIVER", message: CARD_REVIEW_ERROR_MESSAGES.UNSUPPORTED_DRIVER },
      { code: "IPC_TRANSPORT_ERROR", message: CARD_REVIEW_ERROR_MESSAGES.IPC_TRANSPORT_ERROR },
      { code: "DISK_FULL", message: "raw" },
      "plain string failure",
      null,
    ]) {
      expect(await code(invokeCardReviewSave(rate, vi.fn().mockRejectedValue(rejection)))).toBe(ipc);
    }
    for (const result of [
      null,
      { ...itemResult, itemId: "c".repeat(64) },
      { ...itemResult, action: "flag" },
      { ...itemResult, revision: -1 },
      { ...itemResult, extra: true },
      { action: "reset", materialId: "mat", generation: 1 },
    ]) {
      expect(await code(invokeCardReviewSave(rate, vi.fn().mockResolvedValue(result)))).toBe(ipc);
    }
    expect(await code(invokeCardReviewSave(reset, vi.fn().mockResolvedValue({ action: "reset", materialId: "other", generation: 1 })))).toBe(ipc);
  });
});
