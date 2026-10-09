/**
 * Where a split part came from, read back (M2 split lineage, SL-D3–D5, D7).
 *
 * A part records two tiers: the original document ("root") and, for a part
 * of a part, the part it was taken from ("parent"). Which tier is the
 * immediate source is decided by the row's structure, never by which hashes
 * happen to be missing. A recorded fingerprint is compared only with the
 * current file of the same tier, so a matching original never vouches for a
 * parent, and an unknown fingerprint never matches anything.
 *
 * Pure functions; fingerprints are taken natively, off the interface thread,
 * and passed in.
 */
import type { SplitLineage, SplitSourceVerdict, StudyMaterial } from "@/domain/types";

/** A first-level split of an original document (structural, SL-R8). */
export function isDirectSplit(lineage: SplitLineage): boolean {
  return lineage.nestedLevel === 1 && lineage.parentPageStart === null;
}

/**
 * Pages `selection` of a part that covers original pages `parent`, counted
 * in the original document. Part pages 20–40 of a part that is original pages
 * 101–300 are original pages 120–140.
 */
export function composeNestedRange(
  parent: { start: number; end: number },
  selection: { start: number; end: number },
): { start: number; end: number; childPageCount: number } {
  const whole = (value: number) => Number.isSafeInteger(value) && value >= 1;
  if (!whole(parent.start) || !whole(parent.end) || parent.end < parent.start) {
    throw new RangeError("The parent's pages are not a valid range.");
  }
  const parentLength = parent.end - parent.start + 1;
  if (!whole(selection.start) || !whole(selection.end) || selection.end < selection.start) {
    throw new RangeError("The chosen pages are not a valid range.");
  }
  if (selection.end > parentLength) {
    throw new RangeError(`This part has ${parentLength} pages, so there is no page ${selection.end}.`);
  }
  return {
    start: parent.start + selection.start - 1,
    end: parent.start + selection.end - 1,
    childPageCount: selection.end - selection.start + 1,
  };
}

/** Current fingerprints by stored path; `null` means the file is not there. */
export type Fingerprints = ReadonlyMap<string, string | null>;

/**
 * What the current copy of one tier says. `fingerprints` is `null` when the
 * contents cannot be checked here (browser mode, or not checked yet).
 */
export function sourceVerdict(
  recordedSha256: string | null,
  materialId: string | null,
  materials: ReadonlyMap<string, StudyMaterial>,
  fingerprints: Fingerprints | null,
): SplitSourceVerdict {
  if (!recordedSha256) return "unknown";
  const live = materialId ? materials.get(materialId) : undefined;
  if (!live) return "deleted";
  if (!live.filePath || !fingerprints || !fingerprints.has(live.filePath)) return "unknown";
  const current = fingerprints.get(live.filePath);
  if (current === null || current === undefined) return "missing";
  return current === recordedSha256 ? "matching" : "changed";
}

export interface LineageVerdicts {
  /** The immediate source: the original for a first-level part. */
  parent: SplitSourceVerdict;
  root: SplitSourceVerdict;
}

export function lineageVerdicts(
  lineage: SplitLineage,
  materials: ReadonlyMap<string, StudyMaterial>,
  fingerprints: Fingerprints | null,
): LineageVerdicts {
  const root = sourceVerdict(lineage.sourceContentSha256, lineage.rootMaterialId, materials, fingerprints);
  const parent = isDirectSplit(lineage)
    ? root
    : sourceVerdict(lineage.parentContentSha256, lineage.parentMaterialId, materials, fingerprints);
  return { parent, root };
}

/** The stored files whose fingerprints the verdicts need. */
export function lineageFilesToCheck(
  lineage: SplitLineage,
  materials: ReadonlyMap<string, StudyMaterial>,
): string[] {
  const paths = new Set<string>();
  const add = (recorded: string | null, id: string | null) => {
    const path = recorded && id ? materials.get(id)?.filePath : null;
    if (path) paths.add(path);
  };
  add(lineage.sourceContentSha256, lineage.rootMaterialId);
  if (!isDirectSplit(lineage)) add(lineage.parentContentSha256, lineage.parentMaterialId);
  return [...paths];
}

/**
 * The other parts split from the same edition of the same source, in page
 * order. A part whose source fingerprint is unknown has no related parts:
 * an unknown never establishes that two parts came from the same edition.
 */
export function relatedParts(material: StudyMaterial, all: readonly StudyMaterial[]): StudyMaterial[] {
  const mine = material.lineage;
  if (!mine) return [];
  const direct = isDirectSplit(mine);
  const sourceId = direct ? mine.rootMaterialId : mine.parentMaterialId;
  const sourceHash = direct ? mine.sourceContentSha256 : mine.parentContentSha256;
  if (!sourceId || !sourceHash) return [];
  const startOf = (lineage: SplitLineage) =>
    (direct ? lineage.sourcePageStart : lineage.parentPageStart) ?? 0;
  return all
    .filter((other) => {
      const theirs = other.lineage;
      if (!theirs || other.id === material.id || isDirectSplit(theirs) !== direct) return false;
      return direct
        ? theirs.rootMaterialId === sourceId && theirs.sourceContentSha256 === sourceHash
        : theirs.parentMaterialId === sourceId && theirs.parentContentSha256 === sourceHash;
    })
    .sort((a, b) => startOf(a.lineage!) - startOf(b.lineage!) || a.id.localeCompare(b.id));
}

export interface SourceTarget {
  /** The live material to open, or `null` once it has been removed. */
  materialId: string | null;
  title: string;
  /** Where this part's first page is in that document. */
  firstPage: number;
  lastPage: number;
  totalPages: number | null;
}

/** Where this part is in the document it was taken from directly. */
export function immediateSource(lineage: SplitLineage): SourceTarget {
  if (isDirectSplit(lineage)) return originalSource(lineage);
  return {
    materialId: lineage.parentMaterialId,
    title: lineage.parentTitle ?? lineage.parentFileName ?? "the part it came from",
    firstPage: lineage.parentPageStart ?? 1,
    lastPage: lineage.parentPageEnd ?? lineage.childPageCount,
    totalPages: lineage.parentTotalPages,
  };
}

/** Where this part is in the original document. */
export function originalSource(lineage: SplitLineage): SourceTarget {
  return {
    materialId: lineage.rootMaterialId,
    title: lineage.sourceTitle || lineage.sourceFileName,
    firstPage: lineage.sourcePageStart,
    lastPage: lineage.sourcePageEnd,
    totalPages: lineage.sourceTotalPages,
  };
}

/** A plain description of a page range, such as "pages 120–140 of 400". */
export function describePages(target: Pick<SourceTarget, "firstPage" | "lastPage" | "totalPages">): string {
  const range =
    target.firstPage === target.lastPage
      ? `page ${target.firstPage}`
      : `pages ${target.firstPage}–${target.lastPage}`;
  return target.totalPages ? `${range} of ${target.totalPages}` : range;
}

/** What she reads about a tier's current copy. `null` when all is well. */
export function describeVerdict(verdict: SplitSourceVerdict, removedWording: string): string | null {
  switch (verdict) {
    case "matching":
      return null;
    case "changed":
      return "This PDF has changed since the part was made, so the page numbers may no longer line up.";
    case "missing":
      return "This PDF's file is missing from your library storage.";
    case "deleted":
      return removedWording;
    case "unknown":
      return "It hasn't been checked whether this PDF is still the same copy.";
  }
}
