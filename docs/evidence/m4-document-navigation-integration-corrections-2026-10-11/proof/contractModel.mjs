/**
 * Her Flight Deck - Contract Model & Navigation Coordinate Validator
 * M4-R9: Complete destination validation, trusted safe bounds, and nullable schema13 lineage
 */
import { createHash } from "node:crypto";

/**
 * Validates whether a physical page index is within trusted bounds [1, totalPages].
 *
 * @param {number} pageIndex
 * @param {number} totalPages
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePageIndex(pageIndex, totalPages) {
  if (typeof pageIndex !== "number" || !Number.isSafeInteger(pageIndex) || pageIndex < 1) {
    return { valid: false, error: "pageIndex must be a safe integer >= 1" };
  }
  if (typeof totalPages !== "number" || !Number.isSafeInteger(totalPages) || totalPages < 1) {
    return { valid: false, error: "totalPages must be a safe integer >= 1" };
  }
  if (pageIndex > totalPages) {
    return { valid: false, error: `pageIndex ${pageIndex} exceeds totalPages ${totalPages}` };
  }
  return { valid: true };
}

/**
 * Parses and validates an external page reference (number or string label).
 *
 * Rules:
 * - Physical destinations require a trusted safe integer totalPages >= 1.
 * - Missing or invalid totalPages (undefined, null, NaN, Infinity, float, string)
 *   cannot bypass bounds and MUST NOT resolve to an active physical destination.
 * - Printed label maps must be content-bound and bounded by a trusted safe integer totalPages.
 * - Legacy numbers/strings without proven physical coordinate provenance stay unresolved.
 *
 * @param {number | string} input
 * @param {object} [options]
 * @param {string} [options.provenance] 'physical_index' | 'printed_label' | 'unknown'
 * @param {Record<string, number>} [options.labelToPhysicalMap]
 * @param {number} [options.totalPages]
 * @param {string} [options.contentSha256]
 * @returns {object}
 */
export function parsePageReference(input, options = {}) {
  const provenance = options.provenance || "unknown";
  const totalPages = options.totalPages;

  const isSafeTotal =
    typeof totalPages === "number" &&
    Number.isSafeInteger(totalPages) &&
    totalPages >= 1;

  if (typeof input === "number") {
    if (provenance === "physical_index") {
      // Must have trusted totalPages to resolve
      if (!isSafeTotal) {
        return {
          isResolved: false,
          physicalIndex: null,
          isPureIndex: true,
          rawNumber: input,
          pageLabel: null,
          provenance: "physical_index",
          error: "Physical destination requires trusted safe totalPages >= 1",
        };
      }
      if (!Number.isSafeInteger(input) || input < 1) {
        return {
          isResolved: false,
          physicalIndex: null,
          isPureIndex: true,
          rawNumber: input,
          pageLabel: null,
          provenance: "physical_index",
          error: "Physical page must be a safe integer >= 1",
        };
      }
      if (input > totalPages) {
        return {
          isResolved: false,
          physicalIndex: null,
          isPureIndex: true,
          rawNumber: input,
          pageLabel: null,
          provenance: "physical_index",
          error: `Physical index ${input} exceeds total pages ${totalPages}`,
        };
      }
      return {
        isResolved: true,
        physicalIndex: input,
        isPureIndex: true,
        pageLabel: null,
        provenance: "physical_index",
      };
    }

    // Number without proven physical provenance (e.g. legacy integer or Gemini label)
    return {
      isResolved: false,
      physicalIndex: null,
      isPureIndex: false,
      rawNumber: input,
      pageLabel: null,
      provenance: "unknown",
      error: "Numeric reference lacks coordinate provenance",
    };
  }

  if (typeof input === "string") {
    const trimmed = input.trim();

    if (provenance === "physical_index") {
      if (/^\d+$/.test(trimmed)) {
        const n = Number(trimmed);
        if (!isSafeTotal) {
          return {
            isResolved: false,
            physicalIndex: null,
            isPureIndex: true,
            rawInput: trimmed,
            pageLabel: trimmed,
            provenance: "physical_index",
            error: "Physical destination requires trusted safe totalPages >= 1",
          };
        }
        if (!Number.isSafeInteger(n) || n < 1 || n > totalPages) {
          return {
            isResolved: false,
            physicalIndex: null,
            isPureIndex: true,
            rawInput: trimmed,
            pageLabel: trimmed,
            provenance: "physical_index",
            error: `Physical index ${n} out of bounds [1, ${totalPages}]`,
          };
        }
        return {
          isResolved: true,
          physicalIndex: n,
          isPureIndex: true,
          pageLabel: trimmed,
          provenance: "physical_index",
        };
      }
      return {
        isResolved: false,
        physicalIndex: null,
        isPureIndex: false,
        rawInput: trimmed,
        pageLabel: trimmed,
        provenance: "physical_index",
        error: "Invalid physical index",
      };
    }

    // Check verified label-to-physical map: requires trusted bounds
    if (options.labelToPhysicalMap && Object.prototype.hasOwnProperty.call(options.labelToPhysicalMap, trimmed)) {
      const mapped = options.labelToPhysicalMap[trimmed];
      if (!isSafeTotal) {
        return {
          isResolved: false,
          physicalIndex: null,
          isPureIndex: false,
          rawInput: trimmed,
          pageLabel: trimmed,
          mapped: false,
          error: "Label map destination requires trusted safe totalPages >= 1",
        };
      }
      if (!Number.isSafeInteger(mapped) || mapped < 1 || mapped > totalPages) {
        return {
          isResolved: false,
          physicalIndex: null,
          isPureIndex: false,
          rawInput: trimmed,
          pageLabel: trimmed,
          mapped: false,
          error: `Mapped destination ${mapped} exceeds total pages ${totalPages}`,
        };
      }
      return {
        isResolved: true,
        physicalIndex: mapped,
        isPureIndex: false,
        pageLabel: trimmed,
        mapped: true,
        provenance: "verified_label_map",
      };
    }

    return {
      isResolved: false,
      physicalIndex: null,
      isPureIndex: false,
      rawInput: trimmed,
      pageLabel: trimmed,
      provenance: provenance === "printed_label" ? "printed_label" : "unknown",
      error: "Printed label lacks verified physical mapping",
    };
  }

  return {
    isResolved: false,
    physicalIndex: null,
    isPureIndex: false,
    rawInput: input,
    pageLabel: null,
    provenance: "unknown",
    error: "Invalid reference type",
  };
}

/**
 * Direction-specific coordinate translation between split parts and ancestors.
 *
 * Lineage support:
 * - Legitimate first-level schema13 rows have nullable absent parent fields:
 *   (parentMaterialId: null, parentPageStart: null, parentPageEnd: null, parentTotalPages: null).
 *   This must NOT prevent valid child->root navigation.
 * - Direction-specific validation only checks fields required by that direction.
 * - Safe integer arithmetic is verified for all translation results.
 * - Reverse translation (root_to_child) requires live destination child materialId.
 * - Deleted or missing root/parent destinations return structured snapshot guidance.
 *
 * @param {object} request
 * @param {'child_to_root' | 'child_to_parent' | 'root_to_child'} request.direction
 * @param {number} request.page 1-based page in source space
 * @param {object} lineage Lineage metadata
 * @returns {object}
 */
export function translateSplitCoordinates({ direction, page }, lineage) {
  if (!lineage || typeof lineage !== "object") {
    return { success: false, error: "Missing or invalid lineage metadata" };
  }

  const childPageCount = lineage.childPageCount;
  if (typeof childPageCount !== "number" || !Number.isSafeInteger(childPageCount) || childPageCount < 1) {
    return { success: false, error: "childPageCount must be a safe integer >= 1" };
  }

  const checkSafeInt = (v, min = 1) => typeof v === "number" && Number.isSafeInteger(v) && v >= min;

  if (direction === "child_to_root") {
    if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || page > childPageCount) {
      return { success: false, error: `Child page must be a safe integer in [1, ${childPageCount}]` };
    }

    if (!lineage.rootMaterialId) {
      return {
        success: false,
        sourceMaterialId: null,
        code: "ROOT_DELETED",
        snapshotGuidance: "Root document deleted; navigation unavailable.",
      };
    }

    if (!checkSafeInt(lineage.sourcePageStart) || !checkSafeInt(lineage.sourcePageEnd)) {
      return { success: false, error: "Missing or invalid sourcePageStart/sourcePageEnd for root translation" };
    }

    if (lineage.sourcePageEnd < lineage.sourcePageStart) {
      return { success: false, error: "sourcePageEnd must be >= sourcePageStart" };
    }

    if (lineage.sourcePageEnd - lineage.sourcePageStart + 1 !== childPageCount) {
      return { success: false, error: "Root range length does not match childPageCount" };
    }

    const rootPage = lineage.sourcePageStart + page - 1;
    if (!Number.isSafeInteger(rootPage)) {
      return { success: false, error: "Translated root page exceeds safe integer bounds" };
    }

    if (lineage.sourceTotalPages !== undefined && lineage.sourceTotalPages !== null) {
      if (!checkSafeInt(lineage.sourceTotalPages) || rootPage > lineage.sourceTotalPages || lineage.sourcePageEnd > lineage.sourceTotalPages) {
        return { success: false, error: `Root destination ${rootPage} exceeds root total pages ${lineage.sourceTotalPages}` };
      }
    }

    return {
      success: true,
      rootPage,
      sourceMaterialId: lineage.rootMaterialId,
      destinationSpace: "root_physical",
    };
  }

  if (direction === "child_to_parent") {
    if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || page > childPageCount) {
      return { success: false, error: `Child page must be a safe integer in [1, ${childPageCount}]` };
    }

    if (!lineage.parentMaterialId) {
      return {
        success: false,
        sourceMaterialId: null,
        code: "PARENT_DELETED",
        snapshotGuidance: "Parent document deleted; navigation unavailable.",
      };
    }

    if (!checkSafeInt(lineage.parentPageStart) || !checkSafeInt(lineage.parentPageEnd)) {
      return { success: false, error: "Missing or invalid parentPageStart/parentPageEnd for parent translation" };
    }

    if (lineage.parentPageEnd < lineage.parentPageStart) {
      return { success: false, error: "parentPageEnd must be >= parentPageStart" };
    }

    if (lineage.parentPageEnd - lineage.parentPageStart + 1 !== childPageCount) {
      return { success: false, error: "Parent range length does not match childPageCount" };
    }

    const parentPage = lineage.parentPageStart + page - 1;
    if (!Number.isSafeInteger(parentPage)) {
      return { success: false, error: "Translated parent page exceeds safe integer bounds" };
    }

    if (lineage.parentTotalPages !== undefined && lineage.parentTotalPages !== null) {
      if (!checkSafeInt(lineage.parentTotalPages) || parentPage > lineage.parentTotalPages || lineage.parentPageEnd > lineage.parentTotalPages) {
        return { success: false, error: `Parent destination ${parentPage} exceeds parent total pages ${lineage.parentTotalPages}` };
      }
    }

    return {
      success: true,
      parentPage,
      sourceMaterialId: lineage.parentMaterialId,
      destinationSpace: "parent_physical",
    };
  }

  if (direction === "root_to_child") {
    if (!lineage.materialId) {
      return { success: false, error: "Missing child destination materialId for root_to_child translation" };
    }

    if (!checkSafeInt(lineage.sourcePageStart) || !checkSafeInt(lineage.sourcePageEnd)) {
      return { success: false, error: "Missing or invalid sourcePageStart/sourcePageEnd for child translation" };
    }

    if (lineage.sourcePageEnd < lineage.sourcePageStart) {
      return { success: false, error: "sourcePageEnd must be >= sourcePageStart" };
    }

    if (typeof page !== "number" || !Number.isSafeInteger(page) || page < lineage.sourcePageStart || page > lineage.sourcePageEnd) {
      return {
        success: false,
        error: `Root page ${page} is outside split range [${lineage.sourcePageStart}, ${lineage.sourcePageEnd}]`,
      };
    }

    const childPage = page - lineage.sourcePageStart + 1;
    if (!Number.isSafeInteger(childPage)) {
      return { success: false, error: "Translated child page exceeds safe integer bounds" };
    }

    if (childPage > childPageCount) {
      return { success: false, error: `Translated child page ${childPage} exceeds childPageCount ${childPageCount}` };
    }

    return {
      success: true,
      childPage,
      sourceMaterialId: lineage.materialId,
      destinationSpace: "child_physical",
    };
  }

  return { success: false, error: `Unknown translation direction: ${direction}` };
}

/**
 * Reconciles bookmarks against current document content hash and trusted bounds.
 *
 * Rules:
 * - Matching hash without trusted bounds/totalPages cannot verify.
 * - Out-of-bounds bookmarks become 'unverified'.
 * - Hash mismatch becomes 'unverified'.
 * - Original originating_content_sha256 is strictly preserved.
 *
 * @param {Array<object>} bookmarks
 * @param {string} currentContentSha256
 * @param {object} [options]
 * @param {number} [options.totalPages]
 * @returns {Array<object>}
 */
export function reconcileBookmarksOnContentDrift(bookmarks, currentContentSha256, options = {}) {
  const totalPages = options.totalPages;
  const isSafeTotal =
    typeof totalPages === "number" &&
    Number.isSafeInteger(totalPages) &&
    totalPages >= 1;

  return bookmarks.map((b) => {
    // Unknown or missing bounds cannot reverify
    if (!isSafeTotal) {
      return { ...b, status: "unverified" };
    }

    // Hash mismatch -> unverified
    if (b.originatingContentSha256 !== currentContentSha256) {
      return { ...b, status: "unverified" };
    }

    // Out of bounds -> unverified
    if (!Number.isSafeInteger(b.pageIndex) || b.pageIndex < 1 || b.pageIndex > totalPages) {
      return { ...b, status: "unverified" };
    }

    return { ...b, status: "verified" };
  });
}

/**
 * Computes SHA-256 for a byte buffer and checks for content drift.
 *
 * @param {Uint8Array | Buffer} currentBytes
 * @param {string} originatingSha256
 * @returns {object}
 */
export function detectContentDrift(currentBytes, originatingSha256) {
  const currentSha256 = createHash("sha256").update(currentBytes).digest("hex");
  const isMatch = currentSha256 === originatingSha256;

  return {
    currentSha256,
    originatingSha256,
    isMatch,
    driftStatus: isMatch ? "verified" : "drifted",
  };
}
