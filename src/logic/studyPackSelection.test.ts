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
