import { expect, it } from "vitest";

import type { StudyMaterial } from "@/domain/types";
import { chapterCountLabel, groupChapterParts } from "./chapterGroups";

const book = (id: string, root: string | null = null) =>
  ({ id, title: id, lineage: root ? { rootMaterialId: root } : null }) as unknown as StudyMaterial;

it("tucks parts under their book and keeps everything else", () => {
  const list = [book("a"), book("a1", "a"), book("b"), book("a2", "a")];
  const { topLevel, partsOf } = groupChapterParts(list);
  expect(topLevel.map((m) => m.id)).toEqual(["a", "b"]);
  expect(partsOf.get("a")?.map((m) => m.id)).toEqual(["a1", "a2"]);
  expect(partsOf.has("b")).toBe(false);
});

it("never hides a part whose book is not in the list or was removed", () => {
  const list = [book("a1", "a"), book("c1", null)];
  const { topLevel, partsOf } = groupChapterParts(list);
  expect(topLevel.map((m) => m.id)).toEqual(["a1", "c1"]);
  expect(partsOf.size).toBe(0);
});

it("words the count", () => {
  expect(chapterCountLabel(1)).toBe("1 chapter");
  expect(chapterCountLabel(23)).toBe("23 chapters");
});
