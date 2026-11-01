// @vitest-environment jsdom
/**
 * M2 split lineage in the interface: a part's material page says where it
 * came from, links to what is still in the library, judges each source
 * against its own current file, lists the other parts of the same copy, and
 * offers the page number to copy. The manual split dialog saves through the
 * recorded receipt, reads an unacknowledged save back before cleaning up, and
 * cancels only a split that did not land. Real AppDataProvider and router on
 * disposable SQLite; desktop commands are stubbed. Every value is synthetic.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { SplitSourceReceipt, StoredDocumentFingerprint, StudyMaterial } from "@/domain/types";
import * as backups from "@/services/backups";
import * as documentService from "@/services/documents";
import * as geminiService from "@/services/gemini";
import * as pdfService from "@/services/pdf";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

import { ManualSplitDialog } from "./ManualSplitDialog";
import { SplitPdfDialog } from "./SplitPdfDialog";
import { MaterialDetail } from "./MaterialDetail";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

const T0 = "2026-10-08T12:00:00.000Z";
const H_ROOT = "1".repeat(64);
const H_OTHER = "2".repeat(64);
const H_A = "a".repeat(64);

let location: ReturnType<typeof useLocation>;
let context: ReturnType<typeof useAppData>;
function Probe() {
  location = useLocation();
  context = useAppData();
  return null;
}

async function materialRow(id: string, title: string, file: string) {
  await db.execute(
    "INSERT INTO study_materials (id, title, file_path, original_file_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, title, file, file, T0, T0],
  );
}

async function directPart(id: string, title: string, start: number, end: number, rootHash: string | null = H_ROOT) {
  await materialRow(id, title, `${id}.pdf`);
  await db.execute(
    `INSERT INTO material_split_lineage (material_id, parent_material_id, root_material_id, source_page_start,
       source_page_end, child_page_count, source_file_name, source_title, source_content_sha256,
       source_total_pages, nested_level, created_at)
     VALUES (?, NULL, 'R', ?, ?, ?, 'R.pdf', 'Root Handbook', ?, 400, 1, ?)`,
    [id, start, end, end - start + 1, rootHash, T0],
  );
}

async function nestedPart(id: string, title: string, start: number, end: number, parentHash: string | null) {
  await materialRow(id, title, `${id}.pdf`);
  await db.execute(
    `INSERT INTO material_split_lineage (material_id, parent_material_id, root_material_id, source_page_start,
       source_page_end, parent_page_start, parent_page_end, child_page_count, source_file_name, source_title,
       source_content_sha256, source_total_pages, parent_file_name, parent_title, parent_content_sha256,
       parent_total_pages, nested_level, created_at)
     VALUES (?, 'A', 'R', ?, ?, ?, ?, ?, 'R.pdf', 'Root Handbook', ?, 400, 'A.pdf', 'Part A', ?, 200, 2, ?)`,
    [id, 100 + start, 100 + end, start, end, end - start + 1, H_ROOT, parentHash, T0],
  );
}

/** Pretend to be the desktop app for fingerprints. */
function fingerprints(prints: Record<string, string | null>) {
  const fake = vi.fn(async (paths: string[]): Promise<StoredDocumentFingerprint[]> =>
    paths.map((relativePath) => ({ relativePath, sha256: prints[relativePath] ?? null })),
  );
  (db as { fingerprintStoredDocuments?: typeof fake }).fingerprintStoredDocuments = fake;
  return fake;
}

function Ready() {
  const { status } = useAppData();
  return status === "ready"
    ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }))
    : null;
}

async function openMaterial(id: string, title: string) {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [`/study/${id}?tab=more`] }, h(Probe), h(Ready))));
  await screen.findByRole("heading", { name: title });
}

const lineageSection = () => screen.getByRole("region", { name: "Where this part came from" });

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  await db.execute("INSERT INTO settings (key, value) VALUES ('airline_starter_pack', 'skipped-for-test')").catch(() => undefined);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: false, model: "", choice: "standard" });
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(false);
  vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  await materialRow("R", "Root Handbook", "R.pdf");
});

afterEach(() => {
  cleanup();
  db.close();
  vi.restoreAllMocks();
});

describe("where a part came from", () => {
  it("a first-level part links to its original, lists the same copy's parts and copies the page", async () => {
    await directPart("A", "Part A", 101, 300);
    await directPart("C", "Part C", 1, 100);
    await directPart("D", "Older copy part", 1, 100, H_OTHER);
    fingerprints({ "R.pdf": H_ROOT });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await openMaterial("A", "Part A");
    const section = lineageSection();
    expect(within(section).getByRole("link", { name: "Root Handbook" }).getAttribute("href")).toBe("/study/R");
    expect(section.textContent).toContain("pages 101–300 of 400");
    await waitFor(() => expect(within(section).queryByText(/hasn.t been checked/)).toBeNull());
    expect(within(section).queryByText("Taken from")).toBeNull();

    const related = within(section).getByRole("list", { name: "Other parts from the same copy" });
    expect(within(related).getByRole("link", { name: "Part C" })).toBeTruthy();
    expect(within(related).queryByRole("link", { name: "Older copy part" })).toBeNull();

    expect(section.textContent).toContain("In the original, that is page 101");
    fireEvent.click(within(section).getByRole("button", { name: "Copy page 101 of the original" }));
    expect(await within(section).findByText("Copied.")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("101");

    fireEvent.click(within(related).getByRole("link", { name: "Part C" }));
    await waitFor(() => expect(location.pathname).toBe("/study/C"));
  });

  it("a part of a part judges its parent on its own: an unknown parent is never vouched for by the original", async () => {
    await directPart("A", "Part A", 101, 300);
    await nestedPart("B", "Part B", 20, 40, null);
    fingerprints({ "R.pdf": H_ROOT, "A.pdf": H_A });
    await openMaterial("B", "Part B");
    const section = lineageSection();
    expect(within(section).getByRole("link", { name: "Part A" }).getAttribute("href")).toBe("/study/A");
    expect(section.textContent).toContain("pages 20–40 of 200");
    expect(section.textContent).toContain("pages 120–140 of 400");
    expect(section.textContent).toContain("in Part A, page 20");
    await waitFor(() => expect(within(section).getAllByText(/hasn.t been checked/)).toHaveLength(1));
    expect(within(section).getByRole("button", { name: "Copy page 20 of Part A" })).toBeTruthy();
  });

  it("says plainly when the original changed or was removed, and keeps the part whole", async () => {
    await directPart("A", "Part A", 101, 300);
    fingerprints({ "R.pdf": H_OTHER });
    await openMaterial("A", "Part A");
    expect(await within(lineageSection()).findByText(/has changed since the part was made/)).toBeTruthy();
    cleanup();

    await db.execute("DELETE FROM study_materials WHERE id = 'R'");
    await openMaterial("A", "Part A");
    const section = lineageSection();
    expect(within(section).queryByRole("link", { name: "Root Handbook" })).toBeNull();
    expect(within(section).getByText("Removed from your library")).toBeTruthy();
    expect(within(section).getByText(/its notes and its study history are all still here/)).toBeTruthy();
  });

  it("cannot check contents in the browser preview, and shows nothing for a material that was not split", async () => {
    await directPart("A", "Part A", 101, 300);
    await openMaterial("A", "Part A");
    expect(within(lineageSection()).getByText(/hasn.t been checked/)).toBeTruthy();
    cleanup();
    await openMaterial("R", "Root Handbook");
    expect(screen.queryByRole("region", { name: "Where this part came from" })).toBeNull();
  });
});

describe("saving a manual split", () => {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), "src-tauri/fixtures/split-lineage/receipt.json"), "utf8"),
  ) as SplitSourceReceipt;
  const receiptFor = (materialId: string): SplitSourceReceipt => {
    const receipt = structuredClone(fixture);
    receipt.core.plan[0]!.id = materialId;
    return receipt;
  };

  let saveSplitBatch: ReturnType<typeof vi.fn>;
  let reconcileSplitBatch: ReturnType<typeof vi.fn>;
  let cancelSplitBatch: ReturnType<typeof vi.fn>;
  let issued: SplitSourceReceipt | null;
  let onCreated: ReturnType<typeof vi.fn<(materialId: string) => void>>;

  beforeEach(() => {
    issued = null;
    vi.spyOn(backups, "createBackup").mockResolvedValue(undefined as never);
    vi.spyOn(pdfService, "inspectPdf").mockResolvedValue({ pages: 20, maxPagesPerSplit: 1000 });
    vi.spyOn(pdfService, "splitPdf").mockImplementation(async (request) => {
      issued = receiptFor(request.materialId);
      return issued;
    });
    saveSplitBatch = vi.fn();
    reconcileSplitBatch = vi.fn();
    cancelSplitBatch = vi.fn().mockResolvedValue({ operationId: "x", status: "cancelled", cancelled: true, removedFiles: ["B.pdf"] });
    Object.assign(db, { saveSplitBatch, reconcileSplitBatch, cancelSplitBatch });
    onCreated = vi.fn<(materialId: string) => void>();
  });

  async function splitPagesThreeToSeven() {
    const material = { id: "R", title: "Root Handbook", filePath: "R.pdf" } as StudyMaterial;
    render(
      h(AppDataProvider, null, h(MemoryRouter, null, h(Probe),
        h(ManualSplitDialog, { open: true, material, onClose: () => {}, onCreated }))),
    );
    await waitFor(() => expect(context?.status).toBe("ready"));
    fireEvent.change(await screen.findByLabelText(/First page/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/Last page/i), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save this chapter" }));
  }

  it("saves the receipt exactly as issued, with only the title and notes from here", async () => {
    saveSplitBatch.mockImplementation(async (receipt: SplitSourceReceipt) => ({
      operationId: receipt.operationId,
      parts: [{ id: receipt.core.plan[0]!.id, title: "t", filePath: "B.pdf", fileSize: 28 }],
      idempotentReplay: false,
    }));
    await splitPagesThreeToSeven();
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const [receipt, presentation] = saveSplitBatch.mock.calls[0]!;
    expect(receipt).toBe(issued);
    const materialId = issued!.core.plan[0]!.id;
    expect(presentation).toEqual([
      { id: materialId, title: "Root Handbook — Pages 3–7", notes: "Pages 3–7 of Root Handbook." },
    ]);
    expect(pdfService.splitPdf).toHaveBeenCalledWith(expect.objectContaining({ sourceMaterialId: "R", firstPage: 3, lastPage: 7 }));
    expect(onCreated).toHaveBeenCalledWith(materialId);
    expect(cancelSplitBatch).not.toHaveBeenCalled();
  });

  it("an unanswered save that did land is read back and kept", async () => {
    saveSplitBatch.mockRejectedValue(new Error("the answer was lost"));
    reconcileSplitBatch.mockImplementation(async (operationId: string) => ({
      operationId, status: "committed", parts: [{ id: issued!.core.plan[0]!.id, title: "t", filePath: "B.pdf", fileSize: 28 }], reconciled: true,
    }));
    await splitPagesThreeToSeven();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(issued!.core.plan[0]!.id));
    expect(reconcileSplitBatch).toHaveBeenCalledWith(issued!.operationId);
    expect(cancelSplitBatch).not.toHaveBeenCalled();
  });

  it("a save that did not land is cancelled by its own operation id, which removes its file", async () => {
    saveSplitBatch.mockRejectedValue(new Error("The PDF this was split from changed after it was split"));
    reconcileSplitBatch.mockImplementation(async (operationId: string) => ({ operationId, status: "pending", parts: [], reconciled: false }));
    await splitPagesThreeToSeven();
    expect(await screen.findByText(/its file was removed again/)).toBeTruthy();
    expect(cancelSplitBatch).toHaveBeenCalledWith(issued!.operationId);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("says to restart when the leftover file could not be removed", async () => {
    saveSplitBatch.mockRejectedValue(new Error("refused"));
    reconcileSplitBatch.mockRejectedValue(new Error("unreadable"));
    cancelSplitBatch.mockRejectedValue(new Error("busy"));
    await splitPagesThreeToSeven();
    expect(await screen.findByText(/restart the app before trying again/)).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe("saving an automatic split", () => {
  it("updates elapsed split seconds once a second and resets on the next message", async () => {
    vi.spyOn(pdfService, "inspectPdf").mockResolvedValue({pages:522,maxPagesPerSplit:1000});
    let progress!: (message: string) => void;
    const stop = vi.fn();
    vi.spyOn(pdfService, "watchSplitProgress").mockImplementation(async callback => { progress = callback; return stop; });
    let reject!: (error: Error) => void;
    vi.spyOn(pdfService, "splitPdfAutomatically").mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const material = {id:"R",title:"Synthetic",filePath:"R.pdf",fileSize:1} as StudyMaterial;
    const view = render(h(AppDataProvider, null, h(SplitPdfDialog, {open:true,material,onClose:()=>{},onCreated:vi.fn()})));
    const create = await screen.findByRole("button", {name:"Create study-size parts"});
    await waitFor(() => expect(create.hasAttribute("disabled")).toBe(false));
    fireEvent.click(create);
    await waitFor(() => expect(progress).toBeTypeOf("function"));
    vi.useFakeTimers();
    try {
      act(() => progress("Reading pages 1–522 (part 1 of about 2)…"));
      act(() => vi.advanceTimersByTime(999));
      expect(screen.queryByText(/\(1 s\)/)).toBeNull();
      act(() => vi.advanceTimersByTime(39001));
      expect(screen.getByText("Reading pages 1–522 (part 1 of about 2)… (40 s)")).toBeTruthy();
      act(() => progress("Saving parts…"));
      expect(screen.getByText("Saving parts…")).toBeTruthy();
      await act(async () => reject(new Error("Synthetic stop")));
      expect(stop).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally { view.unmount(); vi.useRealTimers(); }
  });

  it("titles every planned part from the receipt and saves them together", async () => {
    const fixture = JSON.parse(
      readFileSync(join(process.cwd(), "src-tauri/fixtures/split-lineage/receipt.json"), "utf8"),
    ) as SplitSourceReceipt;
    const receipt = structuredClone(fixture);
    const second = structuredClone(receipt.core.plan[0]!);
    receipt.core.plan[0] = { ...receipt.core.plan[0]!, id: "batch-part-1", selection: { start: 1, end: 10 } };
    receipt.core.plan.push({ ...second, id: "batch-part-2", selection: { start: 11, end: 20 } });
    vi.spyOn(pdfService, "inspectPdf").mockResolvedValue({ pages: 20, maxPagesPerSplit: 1000 });
    vi.spyOn(pdfService, "watchSplitProgress").mockResolvedValue(() => {});
    vi.spyOn(pdfService, "splitPdfAutomatically").mockResolvedValue(receipt);
    const saveSplitBatch = vi.fn(async (issued: SplitSourceReceipt, _presentation: unknown) => ({
      operationId: issued.operationId,
      parts: issued.core.plan.map((part) => ({ id: part.id, title: "t", filePath: part.filePath, fileSize: part.fileSize })),
      idempotentReplay: false,
    }));
    Object.assign(db, { saveSplitBatch });
    const onCreated = vi.fn();
    const material = { id: "R", title: "Root Handbook", filePath: "R.pdf", originalFileName: "R.pdf", fileSize: 1 } as StudyMaterial;
    render(
      h(AppDataProvider, null, h(MemoryRouter, null, h(Probe),
        h(SplitPdfDialog, { open: true, material, onClose: () => {}, onCreated }))),
    );
    await waitFor(() => expect(context?.status).toBe("ready"));
    fireEvent.click(await screen.findByRole("button", { name: "Create study-size parts" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(["batch-part-1", "batch-part-2"]));
    expect(pdfService.splitPdfAutomatically).toHaveBeenCalledWith(expect.objectContaining({ sourceMaterialId: "R" }));
    expect(saveSplitBatch.mock.calls[0]![1]).toEqual([
      { id: "batch-part-1", title: "Root Handbook — Part 1 of 2", notes: "Pages 1–10 of Root Handbook." },
      { id: "batch-part-2", title: "Root Handbook — Part 2 of 2", notes: "Pages 11–20 of Root Handbook." },
    ]);
  });
});


describe("automatic split completion with pages left out", () => {
  it.each([
    [[1], "Page 1 was left out because it's too large by itself (likely a big picture). It's still in your original PDF."],
    [[1, 3], "Pages 1 and 3 were left out because they're too large by themselves (likely big pictures). They're still in your original PDF."],
    [[1, 2, 3, 4, 5, 6, 7, 8], "Pages 1, 2, 3, 4, 5 and 3 more were left out because they're too large by themselves (likely big pictures). They're still in your original PDF."],
  ] as const)("keeps the completion message visible for %j until Done", async (skipped, message) => {
    const receipt = JSON.parse(readFileSync(join(process.cwd(), "src-tauri/fixtures/split-lineage/receipt.json"), "utf8")) as SplitSourceReceipt;
    receipt.core.skippedPages = [...skipped];
    receipt.core.plan[0]!.selection = { start: 9, end: 10 };
    vi.spyOn(pdfService, "inspectPdf").mockResolvedValue({ pages: 20, maxPagesPerSplit: 1000 });
    vi.spyOn(pdfService, "watchSplitProgress").mockResolvedValue(() => {});
    vi.spyOn(pdfService, "splitPdfAutomatically").mockResolvedValue(receipt);
    const saveSplitBatch = vi.fn(async (_receipt: SplitSourceReceipt) => ({
      operationId: receipt.operationId,
      parts: receipt.core.plan.map((p) => ({ id: p.id, title: "t", filePath: p.filePath, fileSize: p.fileSize })),
      idempotentReplay: false,
    }));
    Object.assign(db, { saveSplitBatch });
    const onCreated = vi.fn();
    const material = { id: "R", title: "Root Handbook", filePath: "R.pdf" } as StudyMaterial;
    render(h(AppDataProvider, null, h(MemoryRouter, null, h(Probe),
      h(SplitPdfDialog, { open: true, material, onClose: () => {}, onCreated }))));
    await waitFor(() => expect(context?.status).toBe("ready"));
    fireEvent.click(await screen.findByRole("button", { name: "Create study-size parts" }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
    expect(saveSplitBatch.mock.calls[0]![0]).toBe(receipt);
    expect(screen.queryByRole("button", { name: "Create study-size parts" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCreated).toHaveBeenCalledWith(receipt.core.plan.map((p) => p.id));
    expect(saveSplitBatch).toHaveBeenCalledTimes(1);
  });
});
