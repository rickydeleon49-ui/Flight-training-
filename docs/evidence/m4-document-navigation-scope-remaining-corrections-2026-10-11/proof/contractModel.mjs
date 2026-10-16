/**
 * Her Flight Deck - Milestone 4 Contract Model (Corrected for M4-R5–R8)
 *
 * Implements:
 * - Strict Number.isSafeInteger page validation and clamping (R5)
 * - Explicit coordinate provenance resolution and safe printed label mapping (R5)
 * - Lineage range validation, nested parent coordinates, and deleted root safety (R5)
 * - Originating hash binding and bounded bookmark revalidation on content replacement (R6)
 * - Native viewer fallback messaging
 */
import { createHash } from "node:crypto";

/**
 * Validates a 1-based physical page request against optional known total pages.
 * Rejects non-integers, NaN, Infinity, fractions, negative values, and zero.
 *
 * @param {unknown} page
 * @param {unknown} [totalPages]
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePageIndex(page, totalPages) {
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) {
    return { valid: false, error: "Page index must be a finite safe integer >= 1" };
  }

  if (totalPages !== undefined && totalPages !== null) {
    if (typeof totalPages !== "number" || !Number.isSafeInteger(totalPages) || totalPages < 1) {
      return { valid: false, error: "Total pages must be a finite safe integer >= 1" };
    }
    if (page > totalPages) {
      return { valid: false, error: `Page index ${page} exceeds total pages ${totalPages}` };
    }
  }

  return { valid: true };
}

/**
 * Parses and resolves a page reference.
 *
 * Critical Provenance Rules (R5):
 * 1. An integer or number without explicit physical provenance (e.g. legacy Gemini sourcePage)
 *    remains UNRESOLVED (isResolved: false, physicalIndex: null).
 * 2. An explicit physical request with provenance 'physical_index' must be a safe integer >= 1.
 * 3. A printed label (string) remains unresolved unless verified against an explicit label-to-physical map.
 * 4. Mapped values must be safe integers >= 1 within known document bounds.
 *
 * @param {unknown} input
 * @param {object} [options]
 * @param {string} [options.provenance] 'physical_index' | 'printed_label' | 'unknown'
 * @param {Record<string, number>} [options.labelToPhysicalMap]
 * @param {number} [options.totalPages]
 * @returns {object}
 */
export function parsePageReference(input, options = {}) {
  const provenance = options.provenance || "unknown";
  const totalPages = options.totalPages;

  if (typeof input === "number") {
    if (provenance === "physical_index") {
      if (Number.isSafeInteger(input) && input >= 1) {
        if (totalPages !== undefined && Number.isSafeInteger(totalPages) && input > totalPages) {
          return {
            isResolved: false,
            physicalIndex: null,
            isPureIndex: true,
            rawNumber: input,
            pageLabel: null,
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
      return {
        isResolved: false,
        physicalIndex: null,
        isPureIndex: true,
        rawNumber: input,
        pageLabel: null,
        error: "Physical page must be a safe integer >= 1",
      };
    }

    // Number without proven physical provenance (e.g. Gemini integer-or-null)
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
        if (Number.isSafeInteger(n) && n >= 1) {
          if (totalPages !== undefined && Number.isSafeInteger(totalPages) && n > totalPages) {
            return {
              isResolved: false,
              physicalIndex: null,
              isPureIndex: true,
              rawInput: trimmed,
              pageLabel: trimmed,
              error: `Physical index ${n} exceeds total pages ${totalPages}`,
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
      }
      return {
        isResolved: false,
        physicalIndex: null,
        isPureIndex: false,
        rawInput: trimmed,
        pageLabel: trimmed,
        error: "Invalid physical index",
      };
    }

    // Check verified label-to-physical map
    if (options.labelToPhysicalMap && Object.prototype.hasOwnProperty.call(options.labelToPhysicalMap, trimmed)) {
      const mapped = options.labelToPhysicalMap[trimmed];
      if (Number.isSafeInteger(mapped) && mapped >= 1) {
        if (totalPages !== undefined && Number.isSafeInteger(totalPages) && mapped > totalPages) {
          return {
            isResolved: false,
            physicalIndex: null,
            isPureIndex: false,
            rawInput: trimmed,
            pageLabel: trimmed,
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
    }

    // Unmapped label remains unresolved
    return {
      isResolved: false,
      physicalIndex: null,
      isPureIndex: false,
      rawInput: trimmed,
      pageLabel: trimmed,
      mapped: false,
      provenance: "printed_label",
    };
  }

  return {
    isResolved: false,
    physicalIndex: null,
    isPureIndex: false,
    pageLabel: null,
    provenance: "unknown",
  };
}

/**
 * Clamps an explicitly physical page index within known bounds.
 *
 * @param {number} page
 * @param {number} totalPages
 * @returns {{ clampedPage: number, isClamped: boolean, notice: string | null }}
 */
export function clampPageIndex(page, totalPages) {
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(totalPages) || totalPages < 1) {
    throw new TypeError("clampPageIndex requires finite safe integers with totalPages >= 1");
  }

  if (page < 1) {
    return {
      clampedPage: 1,
      isClamped: true,
      notice: `Requested page ${page} is below range; clamped to page 1.`,
    };
  }

  if (page > totalPages) {
    return {
      clampedPage: totalPages,
      isClamped: true,
      notice: `Requested page ${page} exceeds document length; clamped to last page (${totalPages}).`,
    };
  }

  return {
    clampedPage: page,
    isClamped: false,
    notice: null,
  };
}

/**
 * Translates page coordinates across split-lineage boundaries.
 *
 * Enforces strict validation of safe integers, range lengths, destination bounds,
 * and explicit coordinate space and material ID in every successful direction.
 *
 * @param {object} request
 * @param {string} request.direction 'child_to_root' | 'child_to_parent' | 'root_to_child'
 * @param {number} request.page
 * @param {object} lineage
 * @returns {object}
 */
export function translateSplitCoordinates(request, lineage) {
  if (!request || typeof request !== "object") {
    return { success: false, error: "Invalid translation request" };
  }
  const { direction, page } = request;

  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) {
    return { success: false, error: "Requested page must be a finite safe integer >= 1" };
  }

  if (!lineage || typeof lineage !== "object") {
    return { success: false, error: "Missing lineage metadata" };
  }

  const childPageCount = lineage.childPageCount;
  if (typeof childPageCount !== "number" || !Number.isSafeInteger(childPageCount) || childPageCount < 1) {
    return { success: false, error: "childPageCount must be a finite safe integer >= 1" };
  }

  // Validate root range metadata if provided
  if (lineage.sourcePageStart !== undefined) {
    if (typeof lineage.sourcePageStart !== "number" || !Number.isSafeInteger(lineage.sourcePageStart) || lineage.sourcePageStart < 1) {
      return { success: false, error: "sourcePageStart must be a finite safe integer >= 1" };
    }
  }
  if (lineage.sourcePageEnd !== undefined) {
    if (typeof lineage.sourcePageEnd !== "number" || !Number.isSafeInteger(lineage.sourcePageEnd) || lineage.sourcePageEnd < lineage.sourcePageStart) {
      return { success: false, error: "sourcePageEnd must be >= sourcePageStart" };
    }
    if (lineage.sourcePageEnd - lineage.sourcePageStart + 1 !== childPageCount) {
      return { success: false, error: "Root range length does not match childPageCount" };
    }
  }
  if (lineage.sourceTotalPages !== undefined && lineage.sourceTotalPages !== null) {
    if (typeof lineage.sourceTotalPages !== "number" || !Number.isSafeInteger(lineage.sourceTotalPages) || lineage.sourceTotalPages < 1) {
      return { success: false, error: "sourceTotalPages must be a finite safe integer >= 1" };
    }
  }

  // Validate parent range metadata if provided
  if (lineage.parentPageStart !== undefined) {
    if (typeof lineage.parentPageStart !== "number" || !Number.isSafeInteger(lineage.parentPageStart) || lineage.parentPageStart < 1) {
      return { success: false, error: "parentPageStart must be a finite safe integer >= 1" };
    }
  }
  if (lineage.parentPageEnd !== undefined) {
    if (typeof lineage.parentPageEnd !== "number" || !Number.isSafeInteger(lineage.parentPageEnd) || lineage.parentPageEnd < lineage.parentPageStart) {
      return { success: false, error: "parentPageEnd must be >= parentPageStart" };
    }
    if (lineage.parentPageEnd - lineage.parentPageStart + 1 !== childPageCount) {
      return { success: false, error: "Parent range length does not match childPageCount" };
    }
  }
  if (lineage.parentTotalPages !== undefined && lineage.parentTotalPages !== null) {
    if (typeof lineage.parentTotalPages !== "number" || !Number.isSafeInteger(lineage.parentTotalPages) || lineage.parentTotalPages < 1) {
      return { success: false, error: "parentTotalPages must be a finite safe integer >= 1" };
    }
  }

  if (direction === "child_to_root") {
    if (page > childPageCount) {
      return { success: false, error: `Child page ${page} exceeds child length ${childPageCount}` };
    }

    if (!lineage.rootMaterialId) {
      return {
        success: false,
        sourceMaterialId: null,
        code: "ROOT_DELETED",
        snapshotGuidance: "Root document deleted; navigation unavailable.",
      };
    }

    if (lineage.sourcePageStart === undefined) {
      return { success: false, error: "Missing sourcePageStart for root translation" };
    }

    const rootPage = lineage.sourcePageStart + page - 1;

    if (lineage.sourceTotalPages !== undefined && rootPage > lineage.sourceTotalPages) {
      return { success: false, error: `Root destination ${rootPage} exceeds root total pages ${lineage.sourceTotalPages}` };
    }

    return {
      success: true,
      rootPage,
      sourceMaterialId: lineage.rootMaterialId,
      destinationSpace: "root_physical",
    };
  }

  if (direction === "child_to_parent") {
    if (page > childPageCount) {
      return { success: false, error: `Child page ${page} exceeds child length ${childPageCount}` };
    }

    if (!lineage.parentMaterialId) {
      return {
        success: false,
        sourceMaterialId: null,
        code: "PARENT_DELETED",
        snapshotGuidance: "Parent document deleted; navigation unavailable.",
      };
    }

    if (lineage.parentPageStart === undefined) {
      return { success: false, error: "Missing parentPageStart for parent translation" };
    }

    const parentPage = lineage.parentPageStart + page - 1;

    if (lineage.parentTotalPages !== undefined && parentPage > lineage.parentTotalPages) {
      return { success: false, error: `Parent destination ${parentPage} exceeds parent total pages ${lineage.parentTotalPages}` };
    }

    return {
      success: true,
      parentPage,
      sourceMaterialId: lineage.parentMaterialId,
      destinationSpace: "parent_physical",
    };
  }

  if (direction === "root_to_child") {
    if (lineage.sourcePageStart === undefined || lineage.sourcePageEnd === undefined) {
      return { success: false, error: "Missing sourcePageStart/End for child translation" };
    }

    if (page < lineage.sourcePageStart || page > lineage.sourcePageEnd) {
      return {
        success: false,
        error: `Root page ${page} is outside split range [${lineage.sourcePageStart}, ${lineage.sourcePageEnd}]`,
      };
    }

    const childPage = page - lineage.sourcePageStart + 1;
    return {
      success: true,
      childPage,
      sourceMaterialId: lineage.materialId,
      destinationSpace: "child_physical",
    };
  }

  return { success: false, error: `Unknown direction: ${direction}` };
}

/**
 * Reconciles bookmarks against active document content identity and safe bounds.
 *
 * Critical Revalidation Invariants (R6):
 * - If originatingContentSha256 does NOT match, mark 'unverified'.
 * - Even if hash matches, if totalPages is known and pageIndex > totalPages,
 *   the bookmark CANNOT be marked verified! It must remain 'unverified'.
 * - Page index must be a safe integer >= 1.
 *
 * @param {Array<object>} bookmarks
 * @param {string} currentContentSha256
 * @param {object} [options]
 * @param {number} [options.totalPages]
 * @returns {Array<object>}
 */
export function reconcileBookmarksOnContentDrift(bookmarks, currentContentSha256, options = {}) {
  const totalPages = options.totalPages;

  return bookmarks.map((b) => {
    // Hash mismatch -> unverified
    if (b.originatingContentSha256 !== currentContentSha256) {
      return { ...b, status: "unverified" };
    }

    // Hash matches: validate bounds
    if (totalPages !== undefined && totalPages !== null) {
      if (!Number.isSafeInteger(totalPages) || totalPages < 1 || b.pageIndex > totalPages) {
        return { ...b, status: "unverified" };
      }
    }

    if (!Number.isSafeInteger(b.pageIndex) || b.pageIndex < 1) {
      return { ...b, status: "unverified" };
    }

    return { ...b, status: "verified" };
  });
}

/**
 * Computes SHA-256 for byte buffer and checks for content drift.
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
    status: isMatch ? "verified" : "drifted",
    drifted: !isMatch,
    requiresReview: !isMatch,
  };
}

/**
 * Formats user guidance when native OS viewer cannot accept CLI page arguments.
 *
 * @param {string} title
 * @param {number} targetPage
 * @param {string | null} [pageLabel]
 * @returns {object}
 */
export function formatNativeJumpFallback(title, targetPage, pageLabel = null) {
  const labelText = pageLabel ? ` (printed '${pageLabel}')` : "";
  return {
    action: "open_native",
    userNotice: `Opened '${title}' in system viewer. Turn to page ${targetPage}${labelText}.`,
    targetPhysicalPage: targetPage,
    targetPageLabel: pageLabel,
  };
}
