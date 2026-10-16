/**
 * Her Flight Deck - Contract Model & Navigation Coordinate Validator (round 2)
 *
 * M4-R15: a translation may only succeed against a trusted destination page count.
 * M4-R16: printed label maps must declare and match the content identity they were built for.
 * M4-R17: one explicit resolved/unresolved destination record carries material ID, coordinate
 *         space, content identity, physical page and trusted safe page count, and is produced by
 *         both the resolver and the translator and consumed by the opener and the durable proof.
 * M4-R18: the unreachable arithmetic guard is removed; the range invariant that makes arithmetic
 *         overflow impossible is stated where it holds and pinned by a regression.
 *
 * Retained from the accepted round (unchanged behaviour): malformed/unknown counts never resolve,
 * bounded physical references and content-bound maps do resolve, direction-specific nullable
 * schema-13 lineage, complete consistent root ranges with matching length, live destination child
 * identity for reverse translation, structured deletion guidance, hash-mismatch/out-of-bounds
 * invalidation, and the first-level nullable-parent positive control.
 */
import { createHash } from "node:crypto";

const HEX64 = /^[0-9a-fA-F]{64}$/;

/** @returns {boolean} true only for a trusted safe integer page count. */
export function isSafeCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** Canonical lowercase form; null for anything that is not a 64-hex digest. */
export function canonicalContentHash(value) {
  if (typeof value !== "string" || !HEX64.test(value)) return null;
  return value.toLowerCase();
}

export const DESTINATION_SPACES = Object.freeze({
  material: "material_physical",
  root: "root_physical",
  parent: "parent_physical",
  child: "child_physical",
});

/**
 * The single resolved-destination shape used from resolver through opener and persistence.
 * Every field is mandatory: an unbounded or unidentified destination cannot be a resolved record.
 */
function resolvedDestination({ materialId, coordinateSpace, contentSha256, physicalPage, totalPages, pageLabel, provenance }) {
  const hash = canonicalContentHash(contentSha256);
  const page = physicalPage;
  if (typeof materialId !== "string" || materialId.length === 0) return unresolvedDestination("material identity missing");
  if (!Object.values(DESTINATION_SPACES).includes(coordinateSpace)) return unresolvedDestination("unknown coordinate space");
  if (!hash) return unresolvedDestination("content identity missing or malformed");
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) return unresolvedDestination("physical page must be a safe integer >= 1");
  if (!isSafeCount(totalPages)) return unresolvedDestination("trusted page count missing or malformed");
  if (page > totalPages) return unresolvedDestination(`physical page ${page} exceeds trusted count ${totalPages}`);
  return {
    status: "resolved",
    destination: {
      materialId,
      coordinateSpace,
      contentSha256: hash,
      physicalPage: page,
      totalPages,
      pageLabel: typeof pageLabel === "string" ? pageLabel : null,
      provenance,
    },
  };
}

function unresolvedDestination(reason, guidance = null, extra = {}) {
  return { status: "unresolved", isResolved: false, physicalIndex: null, reason, guidance, destination: null, ...extra };
}

/** @returns {boolean} true only for a complete, self-consistent resolved destination. */
export function isResolvedDestination(record) {
  if (!record || record.status !== "resolved" || !record.destination) return false;
  const d = record.destination;
  return (
    typeof d.materialId === "string" &&
    d.materialId.length > 0 &&
    canonicalContentHash(d.contentSha256) === d.contentSha256 &&
    Number.isSafeInteger(d.physicalPage) &&
    d.physicalPage >= 1 &&
    isSafeCount(d.totalPages) &&
    d.physicalPage <= d.totalPages &&
    Object.values(DESTINATION_SPACES).includes(d.coordinateSpace)
  );
}

/**
 * Validates whether a physical page index is within trusted bounds [1, totalPages].
 */
export function validatePageIndex(pageIndex, totalPages) {
  if (typeof pageIndex !== "number" || !Number.isSafeInteger(pageIndex) || pageIndex < 1) {
    return { valid: false, error: "pageIndex must be a safe integer >= 1" };
  }
  if (!isSafeCount(totalPages)) {
    return { valid: false, error: "totalPages must be a safe integer >= 1" };
  }
  if (pageIndex > totalPages) {
    return { valid: false, error: `pageIndex ${pageIndex} exceeds totalPages ${totalPages}` };
  }
  return { valid: true };
}

/**
 * Parses and validates an external page reference and produces the unified destination record.
 *
 * Rules (retained + R15/R16/R17):
 * - Physical destinations require a trusted safe integer totalPages >= 1.
 * - Missing or malformed totals (undefined, null, NaN, Infinity, float, string) never resolve.
 * - Printed label maps must be bounded AND bound to the content identity they were built for:
 *   options.labelToPhysicalMap is { map, contentSha256 } and resolution requires that hash to
 *   equal the trusted current content identity.
 * - A resolved record always carries material ID, coordinate space, content identity, physical
 *   page and trusted count. Without a material identity the reference stays unresolved.
 *
 * @param {number | string} input
 * @param {object} options
 * @returns {object} legacy fields (isResolved/physicalIndex/pageLabel/provenance) plus the record
 */
export function parsePageReference(input, options = {}) {
  const provenance = options.provenance || "unknown";
  const totalPages = options.totalPages;
  const materialId = options.materialId;
  const contentSha256 = canonicalContentHash(options.contentSha256);
  const isSafeTotal = isSafeCount(totalPages);

  const finish = (record, legacy) => ({ ...legacy, ...record });
  const unresolvedPage = (error, legacy = {}) =>
    finish(unresolvedDestination(error), { isResolved: false, physicalIndex: null, mapped: false, ...legacy });
  const resolvedPage = (page, legacy, label = null) =>
    finish(
      resolvedDestination({
        materialId,
        coordinateSpace: DESTINATION_SPACES.material,
        contentSha256: options.contentSha256,
        physicalPage: page,
        totalPages,
        pageLabel: label,
        provenance,
      }),
      { isResolved: true, physicalIndex: page, pageLabel: label, mapped: false, ...legacy }
    );

  if (typeof input === "number") {
    if (provenance !== "physical_index") {
      return unresolvedPage("Numeric reference lacks coordinate provenance", { isPureIndex: false, rawNumber: input });
    }
    if (!isSafeTotal) {
      return unresolvedPage("Physical destination requires trusted safe totalPages >= 1", { isPureIndex: true, rawNumber: input, provenance: "physical_index" });
    }
    if (!Number.isSafeInteger(input) || input < 1) {
      return unresolvedPage("Physical page must be a safe integer >= 1", { isPureIndex: true, rawNumber: input, provenance: "physical_index" });
    }
    if (input > totalPages) {
      return unresolvedPage(`Physical index ${input} exceeds total pages ${totalPages}`, { isPureIndex: true, rawNumber: input, provenance: "physical_index" });
    }
    return resolvedPage(input, { isPureIndex: true, provenance: "physical_index" });
  }

  if (typeof input === "string") {
    const trimmed = input.trim();

    if (provenance === "physical_index") {
      if (!/^\d+$/.test(trimmed)) {
        return unresolvedPage("Invalid physical index", { isPureIndex: false, rawInput: trimmed, pageLabel: trimmed, provenance: "physical_index" });
      }
      const n = Number(trimmed);
      if (!isSafeTotal) {
        return unresolvedPage("Physical destination requires trusted safe totalPages >= 1", { isPureIndex: true, rawInput: trimmed, pageLabel: trimmed, provenance: "physical_index" });
      }
      if (!Number.isSafeInteger(n) || n < 1 || n > totalPages) {
        return unresolvedPage(`Physical index ${n} out of bounds [1, ${totalPages}]`, { isPureIndex: true, rawInput: trimmed, pageLabel: trimmed, provenance: "physical_index" });
      }
      return resolvedPage(n, { isPureIndex: true, rawInput: trimmed, provenance: "physical_index" }, trimmed);
    }

    const labelMap = options.labelToPhysicalMap;
    if (labelMap && Object.prototype.hasOwnProperty.call(labelMap.map ?? {}, trimmed)) {
      const mapped = labelMap.map[trimmed];
      const mapHash = canonicalContentHash(labelMap.contentSha256);
      if (!mapHash) {
        return unresolvedPage("Printed label map must declare the content identity it was built for", { isPureIndex: false, rawInput: trimmed, pageLabel: trimmed });
      }
      if (!contentSha256) {
        return unresolvedPage("Label map resolution requires the trusted current content identity", { isPureIndex: false, rawInput: trimmed, pageLabel: trimmed });
      }
      if (mapHash !== contentSha256) {
        return unresolvedPage(`Printed label map is stale: built for ${mapHash.slice(0, 12)}, current content is ${contentSha256.slice(0, 12)}`, { isPureIndex: false, rawInput: trimmed, pageLabel: trimmed });
      }
      if (!isSafeTotal) {
        return unresolvedPage("Label map destination requires trusted safe totalPages >= 1", { isPureIndex: false, rawInput: trimmed, pageLabel: trimmed });
      }
      if (!Number.isSafeInteger(mapped) || mapped < 1 || mapped > totalPages) {
        return unresolvedPage(`Mapped destination ${mapped} exceeds total pages ${totalPages}`, { isPureIndex: false, rawInput: trimmed, pageLabel: trimmed });
      }
      return finish(
        resolvedDestination({
          materialId,
          coordinateSpace: DESTINATION_SPACES.material,
          contentSha256: mapHash,
          physicalPage: mapped,
          totalPages,
          pageLabel: trimmed,
          provenance: "verified_label_map",
        }),
        { isResolved: true, physicalIndex: mapped, isPureIndex: false, rawInput: trimmed, pageLabel: trimmed, mapped: true, provenance: "verified_label_map" }
      );
    }

    return unresolvedPage("Printed label lacks verified physical mapping", { isPureIndex: false, rawInput: trimmed, pageLabel: trimmed, provenance: provenance === "printed_label" ? "printed_label" : "unknown" });
  }

  return unresolvedPage("Invalid reference type", { isPureIndex: false, rawInput: input });
}

/**
 * The single entry point that composes a validated destination from a reference plus the trusted
 * persisted identity. Callers may not hand the opener a bare page and a self-reported count.
 *
 * @param {object} request
 * @param {string} request.materialId
 * @param {number | string} request.reference  physical page or printed label
 * @param {object|null} request.identity  trusted { contentSha256, totalPages } from persistence
 * @param {string} [request.provenance]
 * @param {{map: Record<string, number>, contentSha256: string}|null} [request.labelToPhysicalMap]
 */
export function resolveDestination({ materialId, reference, identity, provenance = "unknown", labelToPhysicalMap = null }) {
  if (!identity || !identity.contentSha256 || !isSafeCount(identity.totalPages)) {
    return unresolvedDestination(
      "Trusted content identity and page count are required before a destination can resolve",
      `Unknown identity for ${materialId ?? "material"}: open the document to establish its length, then retry.`
    );
  }
  const parsed = parsePageReference(reference, {
    provenance,
    materialId,
    contentSha256: identity.contentSha256,
    totalPages: identity.totalPages,
    labelToPhysicalMap,
  });
  if (parsed.isResolved && isResolvedDestination(parsed)) return parsed;
  if (parsed.isResolved) return unresolvedDestination("reference resolved a page but produced an incomplete destination record");
  return parsed;
}

/**
 * Direction-specific coordinate translation between split parts and ancestors.
 *
 * Lineage rules (retained + R15/R17/R18):
 * - Legitimate first-level schema13 rows have nullable absent parent fields and MUST still allow
 *   child -> root navigation (positive regression pinned below).
 * - Validation is direction-specific: only fields the requested space needs are required.
 * - M4-R15: child -> root and child -> parent additionally require a trusted safe-integer
 *   DESTINATION count (sourceTotalPages / parentTotalPages). Without it the result is guidance,
 *   never a verified destination, because the computed page could exceed the real document.
 * - M4-R18: `sourcePageEnd - sourcePageStart + 1 === childPageCount` plus `page <= childPageCount`
 *   makes every translated page land inside [sourcePageStart, sourcePageEnd], both already safe
 *   integers, so arithmetic overflow is structurally impossible and no separate guard is needed.
 * - root -> child requires a live destination child materialId.
 * - Deleted or missing root/parent return structured snapshot guidance.
 */
export function translateSplitCoordinates({ direction, page }, lineage) {
  if (!lineage || typeof lineage !== "object") {
    return { success: false, status: "unresolved", error: "Missing or invalid lineage metadata" };
  }

  const childPageCount = lineage.childPageCount;
  if (!isSafeCount(childPageCount)) {
    return { success: false, status: "unresolved", error: "childPageCount must be a safe integer >= 1" };
  }
  const checkSafeInt = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
  const unresolved = (error, extra = {}) => ({ success: false, status: "unresolved", error, ...extra });

  const childPageGuard = unresolved(`Child page must be a safe integer in [1, ${childPageCount}]`);
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || page > childPageCount) return childPageGuard;

  if (direction === "child_to_root" || direction === "child_to_parent") {
    const isRoot = direction === "child_to_root";
    const idField = isRoot ? "rootMaterialId" : "parentMaterialId";
    const start = isRoot ? lineage.sourcePageStart : lineage.parentPageStart;
    const end = isRoot ? lineage.sourcePageEnd : lineage.parentPageEnd;
    const count = isRoot ? lineage.sourceTotalPages : lineage.parentTotalPages;
    const contentHash = isRoot ? lineage.rootContentSha256 : lineage.parentContentSha256;
    const deletedCode = isRoot ? "ROOT_DELETED" : "PARENT_DELETED";
    const deletedGuidance = isRoot
      ? "Root document deleted; navigation unavailable."
      : "Parent document deleted; navigation unavailable.";

    if (!lineage[idField]) {
      return {
        success: false,
        status: "unresolved",
        sourceMaterialId: null,
        code: deletedCode,
        guidance: deletedGuidance,
        snapshotGuidance: deletedGuidance,
      };
    }
    if (!checkSafeInt(start) || !checkSafeInt(end)) {
      return unresolved(`Missing or invalid ${isRoot ? "sourcePageStart/sourcePageEnd" : "parentPageStart/parentPageEnd"} for ${direction}`);
    }
    if (end < start) return unresolved(`${isRoot ? "sourcePageEnd" : "parentPageEnd"} must be >= ${isRoot ? "sourcePageStart" : "parentPageStart"}`);
    if (end - start + 1 !== childPageCount) {
      return unresolved(`${isRoot ? "Root" : "Parent"} range length does not match childPageCount`);
    }
    // M4-R15: the destination document's own trusted count is mandatory.
    if (!isSafeCount(count)) {
      return unresolved(
        `${isRoot ? "Root" : "Parent"} destination requires a trusted safe-integer page count (got ${JSON.stringify(count)})`,
        { code: "DESTINATION_COUNT_UNKNOWN", guidance: `${isRoot ? "Root" : "Parent"} document length is unknown; intent retained, no verified destination.` }
      );
    }
    if (end > count) return unresolved(`${isRoot ? "Root" : "Parent"} range end ${end} exceeds its total pages ${count}`);

    const translated = start + page - 1; // in [start, end] by the two invariants above, both safe integers
    const record = resolvedDestination({
      materialId: lineage[idField],
      coordinateSpace: isRoot ? DESTINATION_SPACES.root : DESTINATION_SPACES.parent,
      contentSha256: contentHash,
      physicalPage: translated,
      totalPages: count,
      pageLabel: null,
      provenance: "lineage_translation",
    });
    if (record.status !== "resolved") {
      return {
        ...unresolved(record.reason, { code: "DESTINATION_IDENTITY_MISSING" }),
        translatedPage: translated,
        destinationMaterialId: lineage[idField],
      };
    }
    return {
      success: true,
      status: "resolved",
      ...(isRoot ? { rootPage: translated } : { parentPage: translated }),
      sourceMaterialId: lineage[idField],
      destinationSpace: isRoot ? DESTINATION_SPACES.root : DESTINATION_SPACES.parent,
      destination: record.destination,
    };
  }

  if (direction === "root_to_child") {
    if (!lineage.materialId) return unresolved("Missing child destination materialId for root_to_child translation");
    if (!checkSafeInt(lineage.sourcePageStart) || !checkSafeInt(lineage.sourcePageEnd)) {
      return unresolved("Missing or invalid sourcePageStart/sourcePageEnd for child translation");
    }
    if (lineage.sourcePageEnd < lineage.sourcePageStart) return unresolved("sourcePageEnd must be >= sourcePageStart");
    if (typeof page !== "number" || !Number.isSafeInteger(page) || page < lineage.sourcePageStart || page > lineage.sourcePageEnd) {
      return unresolved(`Root page ${page} is outside split range [${lineage.sourcePageStart}, ${lineage.sourcePageEnd}]`);
    }
    const childPage = page - lineage.sourcePageStart + 1;
    if (childPage > childPageCount) return unresolved(`Translated child page ${childPage} exceeds childPageCount ${childPageCount}`);

    const record = resolvedDestination({
      materialId: lineage.materialId,
      coordinateSpace: DESTINATION_SPACES.child,
      contentSha256: lineage.childContentSha256,
      physicalPage: childPage,
      totalPages: childPageCount,
      pageLabel: null,
      provenance: "lineage_translation",
    });
    if (record.status !== "resolved") {
      return { ...unresolved(record.reason, { code: "DESTINATION_IDENTITY_MISSING" }), childPage, destinationMaterialId: lineage.materialId };
    }
    return {
      success: true,
      status: "resolved",
      childPage,
      sourceMaterialId: lineage.materialId,
      destinationSpace: DESTINATION_SPACES.child,
      destination: record.destination,
    };
  }

  return unresolved(`Unknown translation direction: ${direction}`);
}

/**
 * Reconciles bookmarks against current document content hash and trusted bounds.
 * Matching hash without trusted bounds cannot verify; hashes compare canonically (M4-R19).
 */
export function reconcileBookmarksOnContentDrift(bookmarks, currentContentSha256, options = {}) {
  const current = canonicalContentHash(currentContentSha256);
  const isSafeTotal = isSafeCount(options.totalPages);

  return bookmarks.map((b) => {
    const origin = canonicalContentHash(b.originatingContentSha256);
    if (!current) return { ...b, status: "unverified" };
    if (!isSafeTotal) return { ...b, status: "unverified" };
    if (!origin || origin !== current) return { ...b, status: "unverified" };
    if (!Number.isSafeInteger(b.pageIndex) || b.pageIndex < 1 || b.pageIndex > options.totalPages) {
      return { ...b, status: "unverified" };
    }
    return { ...b, status: "verified" };
  });
}

/**
 * Computes SHA-256 for a byte buffer and distinguishes verified / drifted / unknown content.
 */
export function detectContentDrift(currentBytes, originatingSha256) {
  const origin = canonicalContentHash(originatingSha256);
  if (!origin) {
    return { currentSha256: null, originatingSha256: originatingSha256 ?? null, isMatch: false, driftStatus: "unknown" };
  }
  if (currentBytes === null || currentBytes === undefined) {
    return { currentSha256: null, originatingSha256: origin, isMatch: false, driftStatus: "missing_file" };
  }
  const currentSha256 = createHash("sha256").update(currentBytes).digest("hex");
  const isMatch = currentSha256 === origin;
  return { currentSha256, originatingSha256: origin, isMatch, driftStatus: isMatch ? "verified" : "drifted" };
}
