import { describe, expect, it } from "vitest";

import type { StudyMaterial } from "@/domain/types";
import { packMaterialIds, packRows } from "./studyPackSelection";

const m = (id: string, root: string | null = null): StudyMaterial => ({
  id, title: id, lineage: root ? ({ materialId: id, rootMaterialId: root } as StudyMaterial["lineage"]) : null,
} as StudyMaterial);

describe("study pack selection", () => {
  const library = [m("book"), m("c1", "book"), m("c2", "book"), m("solo"), m("orphan", "gone")];

  it("shows a book with its chapters, and a chapter whose book is gone on its own", () => {
    const rows = packRows(library);
    expect(rows.map((r) => r.material.id)).toEqual(["book", "solo", "orphan"]);
    expect(rows[0]!.chapters.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("choosing a split book includes the book and every chapter", () => {
    expect(packMaterialIds(library, new Set(["book"]))).toEqual(["book", "c1", "c2"]);
  });

  it("a chapter id alone never travels without its book", () => {
    expect(packMaterialIds(library, new Set(["c1"]))).toEqual([]);
  });

  it("keeps library order and ignores unknown ids", () => {
    expect(packMaterialIds(library, new Set(["orphan", "solo", "nope"]))).toEqual(["solo", "orphan"]);
  });
});

import { isPackExportable } from "./studyPackSelection";
describe("isPackExportable", () => {
  const m = (filePath: string | null) => ({ filePath }) as never;
  it("is false for an empty material and true for a PDF or generated content", () => {
    expect(isPackExportable(m(null), false, 0)).toBe(false);
    expect(isPackExportable(m("  "), false, 0)).toBe(false);
    expect(isPackExportable(m("a.pdf"), false, 0)).toBe(true);
    expect(isPackExportable(m(null), true, 0)).toBe(true);
    expect(isPackExportable(m(null), false, 3)).toBe(true);
    expect(isPackExportable(m(null), false, 0, true)).toBe(true);
  });
});

import { MAX_SHARED_FILE_BYTES, packFileTooLarge, packTooLargeNote } from "./studyPackSelection";
describe("oversized files", () => {
  const big = { filePath: "afh.pdf", fileSize: MAX_SHARED_FILE_BYTES + 1 } as never;
  it("are not exportable even with a guide, and the limit itself is allowed", () => {
    expect(packFileTooLarge(big)).toBe(true);
    expect(isPackExportable(big, true, 5, true)).toBe(false);
    expect(isPackExportable({ filePath: "a.pdf", fileSize: MAX_SHARED_FILE_BYTES } as never, false, 0)).toBe(true);
    expect(packFileTooLarge({ filePath: null, fileSize: null })).toBe(false);
  });
  it("have a short plain note", () => {
    expect(packTooLargeNote(true)).toBe("The full book is too large to share. Its chapters are shared.");
    expect(packTooLargeNote(false)).toBe("Too large to share (over 50 MB).");
  });
});

import { packRowBlocked } from "./studyPackSelection";
describe("oversized books", () => {
  const big = (id: string, root: string | null = null) => ({ ...m(id, root), filePath: `${id}.pdf`, fileSize: MAX_SHARED_FILE_BYTES + 1 }) as StudyMaterial;
  const small = (id: string, root: string | null) => ({ ...m(id, root), filePath: `${id}.pdf`, fileSize: 1000 }) as StudyMaterial;
  const library = [big("afh"), small("c1", "afh"), small("c2", "afh"), big("lone")];
  it("a big book with chapters stays selectable and travels with its chapters", () => {
    const rows = packRows(library);
    expect(rows.map(packRowBlocked)).toEqual([false, true]);
    const selectable = rows.filter((row) => !packRowBlocked(row)).map((row) => row.material.id);
    expect(packMaterialIds(library, new Set(selectable))).toEqual(["afh", "c1", "c2"]);
  });
  it("says so in plain words", () => {
    expect(packTooLargeNote(true)).toBe("The full book is too large to share. Its chapters are shared.");
  });
});
