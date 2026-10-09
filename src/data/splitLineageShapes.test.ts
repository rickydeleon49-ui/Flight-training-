/**
 * M2 split lineage: the webview trusts only results shaped exactly like what
 * the desktop commands produce. The receipt fixture is written by the native
 * test `the_serialized_receipt_matches_the_shared_fixture`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { splitPdf, splitPdfAutomatically } from "@/services/pdf";

import { isSplitSourceReceipt, SplitResultShapeError } from "./splitLineageShapes";
import {
  invokeCancelSplitBatch,
  invokeFingerprintStoredDocuments,
  invokeReconcileSplitBatch,
  invokeSaveSplitBatch,
} from "./tauriDb";

vi.mock("@/data", () => ({ isTauri: () => true }));

const receipt = JSON.parse(
  readFileSync(join(__dirname, "../../src-tauri/fixtures/split-lineage/receipt.json"), "utf8"),
) as Record<string, unknown>;
const clone = () => structuredClone(receipt) as Record<string, any>;

describe("receipt shape", () => {
  it("accepts the receipt exactly as the native splitter serializes it", () => {
    expect(isSplitSourceReceipt(receipt)).toBe(true);
  });

  it("refuses extra provenance, a mismatched operation id, bad fingerprints and tier mix-ups", () => {
    const extra = clone();
    extra.core.plan[0].sourceContentSha256 = "f".repeat(64);
    const mismatched = clone();
    mismatched.operationId = "0".repeat(64);
    const badHash = clone();
    badHash.core.sourceContentSha256 = "NOT-A-HASH";
    const directWithSnapshot = clone();
    directWithSnapshot.core.isNested = false;
    const emptyPlan = clone();
    emptyPlan.core.plan = [];
    const zeroPage = clone();
    zeroPage.core.plan[0].selection.start = 0;
    for (const bad of [extra, mismatched, badHash, directWithSnapshot, emptyPlan, zeroPage, null, [], "x"]) {
      expect(isSplitSourceReceipt(bad)).toBe(false);
    }
  });

  it("the split services hand back only a well-shaped receipt", async () => {
    const call = vi.fn().mockResolvedValue(receipt);
    await expect(
      splitPdf({ relativePath: "a.pdf", materialId: "B", firstPage: 1, lastPage: 2, fileName: "B", sourceMaterialId: "A" }, call),
    ).resolves.toEqual(receipt);
    expect(call).toHaveBeenCalledWith("split_pdf", expect.objectContaining({ sourceMaterialId: "A" }));
    const forged = clone();
    forged.core.rootTotalPages = "400";
    await expect(
      splitPdfAutomatically({ relativePath: "a.pdf", batchId: "b", fileName: "B", sourceMaterialId: "A" }, vi.fn().mockResolvedValue(forged)),
    ).rejects.toBeInstanceOf(SplitResultShapeError);
  });
});

describe("desktop split commands", () => {
  const typedReceipt = receipt as unknown as Parameters<typeof invokeSaveSplitBatch>[0];
  const shown = [{ id: "B", title: "B", notes: "" }];

  it("sends the receipt back unchanged and checks every result", async () => {
    const saved = { operationId: typedReceipt.operationId, parts: [{ id: "B", title: "B", filePath: "B.pdf", fileSize: 28 }], idempotentReplay: false };
    const call = vi.fn().mockResolvedValue(saved);
    await expect(invokeSaveSplitBatch(typedReceipt, shown, call)).resolves.toEqual(saved);
    expect(call).toHaveBeenCalledWith("save_split_batch", { receipt, presentation: shown });

    await expect(invokeSaveSplitBatch(typedReceipt, shown, vi.fn().mockResolvedValue({ ...saved, parts: "B" }))).rejects.toBeInstanceOf(SplitResultShapeError);
    await expect(
      invokeCancelSplitBatch("op", vi.fn().mockResolvedValue({ operationId: "op", status: "gone", cancelled: true, removedFiles: [] })),
    ).rejects.toBeInstanceOf(SplitResultShapeError);
    await expect(
      invokeReconcileSplitBatch("op", vi.fn().mockResolvedValue({ operationId: "op", status: "committed", parts: [], reconciled: true })),
    ).resolves.toMatchObject({ reconciled: true });
  });

  it("fingerprints must answer for exactly the files asked about", async () => {
    const good = [{ relativePath: "a.pdf", sha256: "a".repeat(64) }, { relativePath: "b.pdf", sha256: null }];
    await expect(invokeFingerprintStoredDocuments(["a.pdf", "b.pdf"], vi.fn().mockResolvedValue(good))).resolves.toEqual(good);
    await expect(
      invokeFingerprintStoredDocuments(["b.pdf", "a.pdf"], vi.fn().mockResolvedValue(good)),
    ).rejects.toBeInstanceOf(SplitResultShapeError);
    await expect(
      invokeFingerprintStoredDocuments(["a.pdf"], vi.fn().mockResolvedValue([{ relativePath: "a.pdf", sha256: "short" }])),
    ).rejects.toBeInstanceOf(SplitResultShapeError);
  });
});
