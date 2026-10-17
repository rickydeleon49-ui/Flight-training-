/**
 * Page references and destinations (M4 Slice 1).
 *
 * The production port of the accepted prototype's contract model
 * (`docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/proof/contractModel.mjs`),
 * under the owner-approved scope (docs/M4_PRODUCTION_SCOPE_OWNER_APPROVAL_2026-10-16.md):
 *
 * - OD-4: a physical page is a safe whole number from 1 to a trusted page count.
 * - OD-5: printed labels ("iv", "3-12") stay separate from physical pages and
 *   resolve only through a map built for the exact same file.
 * - OD-6: an out-of-range, unverified or unknown-provenance reference is
 *   refused and explained. It is never moved to a nearby page.
 * - OD-7: split parts translate through recorded lineage; a deleted ancestor
 *   gives guidance instead of a destination in the wrong document.
 *
 * Every resolved result carries one complete destination record: material,
 * coordinate space, content identity, physical page and trusted count. The
 * opener and the save use only that record, never a bare page and a
 * self-reported count. Pure functions.
 */

const HEX64 = /^[0-9a-fA-F]{64}$/;

export type CoordinateSpace = "material_physical" | "root_physical" | "parent_physical" | "child_physical";

/** Where a page number came from. Only physical_index and verified maps can resolve. */
export type PageProvenance =
  | "physical_index"
  | "printed_label"
  | "verified_label_map"
  | "lineage_translation"
  | "unknown";

export interface Destination {
  materialId: string;
  coordinateSpace: CoordinateSpace;
  contentSha256: string;
  physicalPage: number;
  totalPages: number;
  pageLabel: string | null;
  provenance: PageProvenance;
}

export type ResolvedDestination = { status: "resolved"; destination: Destination };
export type UnresolvedDestination = {
  status: "unresolved";
  destination: null;
  /** Why it did not resolve, for logs and tests. */
  reason: string;
  /** What to tell her, in plain words. */
  guidance: string;
  code?: "ROOT_DELETED" | "PARENT_DELETED" | "DESTINATION_COUNT_UNKNOWN" | "DESTINATION_IDENTITY_MISSING";
};
export type DestinationRecord = ResolvedDestination | UnresolvedDestination;

export interface TrustedIdentity {
  contentSha256: string;
  totalPages: number;
}

/** A printed-label map, declaring the file it was built for (OD-5, M4-R16). */
export interface LabelMap {
  map: Readonly<Record<string, number>>;
  contentSha256: string;
}

/** True only for a trusted safe whole page count. */
export function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** Canonical lowercase form; null for anything that is not a 64-hex digest. */
export function canonicalContentHash(value: unknown): string | null {
  if (typeof value !== "string" || !HEX64.test(value)) return null;
  return value.toLowerCase();
}

const SPACES: readonly CoordinateSpace[] = ["material_physical", "root_physical", "parent_physical", "child_physical"];

function unresolved(reason: string, guidance: string, code?: UnresolvedDestination["code"]): UnresolvedDestination {
  return code
    ? { status: "unresolved", destination: null, reason, guidance, code }
    : { status: "unresolved", destination: null, reason, guidance };
}

function resolvedDestination(input: {
  materialId: unknown;
  coordinateSpace: CoordinateSpace;
  contentSha256: unknown;
  physicalPage: unknown;
  totalPages: unknown;
  pageLabel: string | null;
  provenance: PageProvenance;
}): DestinationRecord {
  const hash = canonicalContentHash(input.contentSha256);
  const page = input.physicalPage;
  if (typeof input.materialId !== "string" || input.materialId.length === 0) {
    return unresolved("material identity missing", "This document can't be found in your library.");
  }
  if (!hash) {
    return unresolved(
      "content identity missing or malformed",
      "This document's pages haven't been checked yet, so no page can be opened safely.",
      "DESTINATION_IDENTITY_MISSING",
    );
  }
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) {
    return unresolved("physical page must be a safe integer >= 1", "That isn't a page number this document has.");
  }
  if (!isSafeCount(input.totalPages)) {
    return unresolved("trusted page count missing or malformed", "This document's length isn't known yet.");
  }
  if (page > input.totalPages) {
    return unresolved(
      `physical page ${page} exceeds trusted count ${input.totalPages}`,
      `This document has ${input.totalPages} pages, so there is no page ${page}.`,
    );
  }
  return {
    status: "resolved",
    destination: {
      materialId: input.materialId,
      coordinateSpace: input.coordinateSpace,
      contentSha256: hash,
      physicalPage: page,
      totalPages: input.totalPages,
      pageLabel: input.pageLabel,
      provenance: input.provenance,
    },
  };
}

/** True only for a complete, self-consistent resolved destination. */
export function isResolvedDestination(record: unknown): record is ResolvedDestination {
  if (!record || typeof record !== "object") return false;
  const r = record as { status?: unknown; destination?: unknown };
  if (r.status !== "resolved" || !r.destination || typeof r.destination !== "object") return false;
  const d = r.destination as Partial<Destination>;
  return (
    typeof d.materialId === "string" &&
    d.materialId.length > 0 &&
    canonicalContentHash(d.contentSha256) === d.contentSha256 &&
    typeof d.physicalPage === "number" &&
    Number.isSafeInteger(d.physicalPage) &&
    d.physicalPage >= 1 &&
    isSafeCount(d.totalPages) &&
    d.physicalPage <= d.totalPages &&
    SPACES.includes(d.coordinateSpace as CoordinateSpace)
  );
}

/** Whether a physical page is within [1, totalPages] of a trusted count. */
export function validatePageIndex(pageIndex: unknown, totalPages: unknown): { valid: true } | { valid: false; error: string } {
  if (typeof pageIndex !== "number" || !Number.isSafeInteger(pageIndex) || pageIndex < 1) {
    return { valid: false, error: "pageIndex must be a safe integer >= 1" };
  }
  if (!isSafeCount(totalPages)) return { valid: false, error: "totalPages must be a safe integer >= 1" };
  if (pageIndex > totalPages) return { valid: false, error: `pageIndex ${pageIndex} exceeds totalPages ${totalPages}` };
  return { valid: true };
}

export interface PageReferenceOptions {
  materialId: string;
  provenance?: PageProvenance;
  contentSha256?: string | null;
  totalPages?: number | null;
  labelMap?: LabelMap | null;
}

/**
 * One reference (a number or a printed label) into a destination record.
 *
 * - A number resolves only when its provenance is "physical_index" and the
 *   count is trusted. A number of unknown provenance (a page cited by a study
 *   aid, for example) stays unresolved: it might be a printed page number.
 * - A label resolves only through a map built for the current content.
 * - Out of range is refused, never clamped (OD-6).
 */
export function parsePageReference(input: unknown, options: PageReferenceOptions): DestinationRecord {
  const provenance = options.provenance ?? "unknown";
  const totalPages = options.totalPages;
  const current = canonicalContentHash(options.contentSha256);
  const resolvePhysical = (page: number, label: string | null) =>
    resolvedDestination({
      materialId: options.materialId,
      coordinateSpace: "material_physical",
      contentSha256: options.contentSha256,
      physicalPage: page,
      totalPages,
      pageLabel: label,
      provenance: "physical_index",
    });

  if (typeof input === "number") {
    if (provenance !== "physical_index") {
      return unresolved(
        "Numeric reference lacks coordinate provenance",
        `Page ${input} may be a printed page number rather than the PDF's own page count, so it can't be opened exactly. Look for page ${input} in the document.`,
      );
    }
    if (!isSafeCount(totalPages)) {
      return unresolved("Physical destination requires trusted safe totalPages >= 1", "This document's length isn't known yet.");
    }
    if (!Number.isSafeInteger(input) || input < 1) {
      return unresolved("Physical page must be a safe integer >= 1", "That isn't a page number this document has.");
    }
    if (input > totalPages) {
      return unresolved(
        `Physical index ${input} exceeds total pages ${totalPages}`,
        `This document has ${totalPages} pages, so there is no page ${input}.`,
      );
    }
    return resolvePhysical(input, null);
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (provenance === "physical_index") {
      if (!/^\d+$/.test(trimmed)) {
        return unresolved("Invalid physical index", "Enter a whole page number.");
      }
      const n = Number(trimmed);
      if (!isSafeCount(totalPages)) {
        return unresolved("Physical destination requires trusted safe totalPages >= 1", "This document's length isn't known yet.");
      }
      if (!Number.isSafeInteger(n) || n < 1 || n > totalPages) {
        return unresolved(
          `Physical index ${n} out of bounds [1, ${totalPages}]`,
          `This document has ${totalPages} pages, so there is no page ${trimmed}.`,
        );
      }
      return resolvePhysical(n, null);
    }

    const labelMap = options.labelMap;
    if (labelMap && Object.prototype.hasOwnProperty.call(labelMap.map, trimmed)) {
      const mapped = labelMap.map[trimmed];
      const mapHash = canonicalContentHash(labelMap.contentSha256);
      if (!mapHash) {
        return unresolved("Printed label map must declare the content identity it was built for", `Printed page "${trimmed}" can't be matched to this file.`);
      }
      if (!current) {
        return unresolved("Label map resolution requires the trusted current content identity", "This document's pages haven't been checked yet.");
      }
      if (mapHash !== current) {
        return unresolved(
          `Printed label map is stale: built for ${mapHash.slice(0, 12)}, current content is ${current.slice(0, 12)}`,
          `Printed page "${trimmed}" was matched for an earlier version of this file.`,
        );
      }
      if (!isSafeCount(totalPages)) {
        return unresolved("Label map destination requires trusted safe totalPages >= 1", "This document's length isn't known yet.");
      }
      if (typeof mapped !== "number" || !Number.isSafeInteger(mapped) || mapped < 1 || mapped > totalPages) {
        return unresolved(`Mapped destination ${String(mapped)} exceeds total pages ${totalPages}`, `Printed page "${trimmed}" isn't in this file.`);
      }
      return resolvedDestination({
        materialId: options.materialId,
        coordinateSpace: "material_physical",
        contentSha256: mapHash,
        physicalPage: mapped,
        totalPages,
        pageLabel: trimmed,
        provenance: "verified_label_map",
      });
    }
    return unresolved(
      "Printed label lacks verified physical mapping",
      `Printed page "${trimmed}" hasn't been matched to a PDF page. Look for it in the document.`,
    );
  }

  return unresolved("Invalid reference type", "That isn't a page reference.");
}

export interface ResolveRequest {
  materialId: string;
  reference: number | string;
  /** Trusted identity from the native inspector, or null when unknown. */
  identity: TrustedIdentity | null;
  provenance?: PageProvenance;
  labelMap?: LabelMap | null;
  /** A printed label to carry with a physical destination (a bookmark's, for example). */
  pageLabel?: string | null;
}

/** The single entry point from a reference plus the trusted identity to a destination. */
export function resolveDestination(request: ResolveRequest): DestinationRecord {
  const { identity } = request;
  if (!identity || !canonicalContentHash(identity.contentSha256) || !isSafeCount(identity.totalPages)) {
    return unresolved(
      "Trusted content identity and page count are required before a destination can resolve",
      "This document's pages haven't been checked yet, so no page can be opened safely.",
    );
  }
  const parsed = parsePageReference(request.reference, {
    materialId: request.materialId,
    provenance: request.provenance ?? "unknown",
    contentSha256: identity.contentSha256,
    totalPages: identity.totalPages,
    labelMap: request.labelMap ?? null,
  });
  if (parsed.status === "resolved") {
    if (!isResolvedDestination(parsed)) {
      return unresolved("reference resolved a page but produced an incomplete destination record", "That page can't be opened safely.");
    }
    if (request.pageLabel !== undefined && parsed.destination.provenance === "physical_index") {
      return { status: "resolved", destination: { ...parsed.destination, pageLabel: request.pageLabel } };
    }
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Split parts (OD-7)                                                  */
/* ------------------------------------------------------------------ */

/**
 * The lineage needed to translate between a split part and its sources.
 * First-level parts have null parent fields, as stored by schema 13.
 * Hashes and counts must come from trusted identities, not from the request.
 */
export interface TranslationLineage {
  /** The split part (child) material. */
  materialId: string;
  childPageCount: number;
  childContentSha256?: string | null;
  rootMaterialId: string | null;
  rootContentSha256?: string | null;
  sourcePageStart: number;
  sourcePageEnd: number;
  sourceTotalPages: number | null;
  parentMaterialId: string | null;
  parentContentSha256?: string | null;
  parentPageStart: number | null;
  parentPageEnd: number | null;
  parentTotalPages: number | null;
}

export type TranslationDirection = "child_to_root" | "child_to_parent" | "root_to_child";

export type TranslationResult =
  | { success: true; status: "resolved"; translatedPage: number; destination: Destination }
  | (UnresolvedDestination & { success: false; translatedPage?: number });

const fail = (reason: string, guidance: string, code?: UnresolvedDestination["code"]): TranslationResult => ({
  ...unresolved(reason, guidance, code),
  success: false,
});

/**
 * Translate a page between a split part and its original or parent.
 *
 * - child → root/parent needs a complete range whose length equals the part's
 *   page count, and the destination's own trusted count. With those, the
 *   translated page always lands inside the recorded range, so arithmetic
 *   cannot overflow (M4-R18).
 * - root → child needs the live child material.
 * - A deleted ancestor returns guidance, never a different document.
 */
export function translateSplitCoordinates(
  { direction, page }: { direction: TranslationDirection; page: number },
  lineage: TranslationLineage | null,
): TranslationResult {
  if (!lineage || typeof lineage !== "object") return fail("Missing or invalid lineage metadata", "Where this part came from isn't recorded.");
  const childPageCount = lineage.childPageCount;
  if (!isSafeCount(childPageCount)) return fail("childPageCount must be a safe integer >= 1", "Where this part came from isn't recorded completely.");
  const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;

  if (direction === "child_to_root" || direction === "child_to_parent") {
    if (!whole(page) || page > childPageCount) {
      return fail(`Child page must be a safe integer in [1, ${childPageCount}]`, `This part has ${childPageCount} pages.`);
    }
    const isRoot = direction === "child_to_root";
    const destinationId = isRoot ? lineage.rootMaterialId : lineage.parentMaterialId;
    const start = isRoot ? lineage.sourcePageStart : lineage.parentPageStart;
    const end = isRoot ? lineage.sourcePageEnd : lineage.parentPageEnd;
    const count = isRoot ? lineage.sourceTotalPages : lineage.parentTotalPages;
    const hash = isRoot ? lineage.rootContentSha256 : lineage.parentContentSha256;
    const noun = isRoot ? "original document" : "part this was taken from";
    if (!destinationId) {
      return fail(
        `${isRoot ? "Root" : "Parent"} document deleted`,
        `The ${noun} is no longer in your library, so this page can't be shown there.`,
        isRoot ? "ROOT_DELETED" : "PARENT_DELETED",
      );
    }
    if (!whole(start) || !whole(end)) return fail(`Missing or invalid range for ${direction}`, `The pages this part covers in the ${noun} aren't recorded.`);
    if (end < start) return fail("Range end precedes its start", `The pages this part covers in the ${noun} aren't recorded correctly.`);
    if (end - start + 1 !== childPageCount) {
      return fail(`${isRoot ? "Root" : "Parent"} range length does not match childPageCount`, `The pages this part covers in the ${noun} don't add up.`);
    }
    if (!isSafeCount(count)) {
      return fail(
        `${isRoot ? "Root" : "Parent"} destination requires a trusted safe-integer page count`,
        `The ${noun}'s length isn't known, so no exact page can be opened.`,
        "DESTINATION_COUNT_UNKNOWN",
      );
    }
    if (end > count) return fail(`Range end ${end} exceeds its total pages ${count}`, `The ${noun} is shorter than this part's recorded pages.`);
    const translated = start + page - 1; // within [start, end] by the checks above
    const record = resolvedDestination({
      materialId: destinationId,
      coordinateSpace: isRoot ? "root_physical" : "parent_physical",
      contentSha256: hash,
      physicalPage: translated,
      totalPages: count,
      pageLabel: null,
      provenance: "lineage_translation",
    });
    if (record.status !== "resolved") return { ...record, success: false, code: "DESTINATION_IDENTITY_MISSING", translatedPage: translated };
    return { success: true, status: "resolved", translatedPage: translated, destination: record.destination };
  }

  if (direction === "root_to_child") {
    if (!lineage.materialId) return fail("Missing child destination materialId", "This part is no longer in your library.");
    const { sourcePageStart: start, sourcePageEnd: end } = lineage;
    if (!whole(start) || !whole(end)) return fail("Missing or invalid sourcePageStart/sourcePageEnd", "The pages this part covers aren't recorded.");
    if (end < start) return fail("sourcePageEnd must be >= sourcePageStart", "The pages this part covers aren't recorded correctly.");
    if (!whole(page) || page < start || page > end) {
      return fail(`Root page ${page} is outside split range [${start}, ${end}]`, `This part covers pages ${start}–${end} of the original.`);
    }
    const childPage = page - start + 1;
    if (childPage > childPageCount) return fail(`Translated child page ${childPage} exceeds childPageCount ${childPageCount}`, "This part is shorter than its recorded range.");
    const record = resolvedDestination({
      materialId: lineage.materialId,
      coordinateSpace: "child_physical",
      contentSha256: lineage.childContentSha256,
      physicalPage: childPage,
      totalPages: childPageCount,
      pageLabel: null,
      provenance: "lineage_translation",
    });
    if (record.status !== "resolved") return { ...record, success: false, code: "DESTINATION_IDENTITY_MISSING", translatedPage: childPage };
    return { success: true, status: "resolved", translatedPage: childPage, destination: record.destination };
  }

  return fail(`Unknown translation direction: ${String(direction)}`, "That translation isn't supported.");
}

/** How a saved page relates to the current verified file, in her words. */
export function savedPlaceNote(status: "active" | "verified" | "unverified" | "drifted"): string | null {
  if (status === "drifted") return "Saved for an earlier version of this file, so the page may have moved.";
  if (status === "unverified") return "Saved before this file's pages were checked.";
  return null;
}
