/**
 * M4 Document Navigation Contract Model & Logic (Corrected R2)
 *
 * Implements pure domain logic for:
 * 1. Physical PDF page index validation & clamping (finite safe integer bounds).
 * 2. Provenance-aware page reference resolution & printed label mapping.
 * 3. Split-lineage page coordinate translation with explicit destination spaces.
 * 4. Document replacement & content hash drift detection.
 * 5. Native opening fallback message generation.
 */
import crypto from "node:crypto";

/**
 * Validate and normalize a physical page index against known document bounds.
 * Physical page indices are strictly finite safe 1-based integers (1..totalPages).
 */
export function validatePageIndex(requested, totalPages) {
  // Validate totalPages first
  if (
    typeof totalPages !== "number" ||
    !Number.isFinite(totalPages) ||
    !Number.isInteger(totalPages) ||
    totalPages < 1
  ) {
    return {
      valid: false,
      normalizedPage: 1,
      code: "INVALID_TOTAL_PAGES",
      error: `Document total pages must be a finite positive integer. Received: ${totalPages}`,
    };
  }

  // Validate requested page
  if (
    typeof requested !== "number" ||
    !Number.isFinite(requested) ||
    !Number.isInteger(requested)
  ) {
    return {
      valid: false,
      normalizedPage: 1,
      code: "INVALID_PAGE_INDEX",
      error: `Page '${requested}' is not a valid integer.`,
    };
  }

  if (requested < 1) {
    return {
      valid: false,
      normalizedPage: 1,
      code: "CLAMPED_TO_FIRST",
      warning: `Requested page ${requested} is less than 1. Directed to first page.`,
    };
  }

  if (requested > totalPages) {
    return {
      valid: false,
      normalizedPage: totalPages,
      code: "CLAMPED_TO_LAST",
      warning: `Requested page ${requested} exceeds document length (${totalPages} pages). Directed to last page.`,
    };
  }

  return {
    valid: true,
    normalizedPage: requested,
    code: "OK",
  };
}

/**
 * Distinguish a physical PDF page index (1..N) from a printed page label
 * (e.g., "iv", "3-12", "Cover", "A-5") with provenance-aware resolution.
 *
 * Rules:
 * - Pure integer numbers with explicit or physical provenance resolve as pure physical index.
 * - String inputs (including numeric strings like "42") without explicit physical coordinate
 *   provenance are treated as printed labels.
 * - Unknown printed labels do NOT invent physical destinations (physicalIndex is null).
 * - If a verified label-to-physical map is supplied, resolves to the mapped physical leaf.
 */
export function parsePageReference(input, options = {}) {
  const { provenance = null, labelToPhysicalMap = null } = options;

  // Pure numeric input
  if (typeof input === "number") {
    if (Number.isFinite(input) && Number.isInteger(input) && input >= 1) {
      if (provenance === "unverified_label") {
        return {
          physicalIndex: null,
          pageLabel: String(input),
          isPureIndex: false,
          isResolved: false,
          labelCategory: "arabic_number",
        };
      }
      return {
        physicalIndex: input,
        pageLabel: String(input),
        isPureIndex: true,
        isResolved: true,
        labelCategory: "arabic_number",
      };
    }
    return {
      physicalIndex: null,
      pageLabel: null,
      isPureIndex: false,
      isResolved: false,
      labelCategory: "invalid",
    };
  }

  const str = String(input ?? "").trim();
  if (!str) {
    return {
      physicalIndex: null,
      pageLabel: null,
      isPureIndex: false,
      isResolved: false,
      labelCategory: "empty",
    };
  }

  // Helper to check verified label map
  const checkMap = (category) => {
    if (labelToPhysicalMap && Object.prototype.hasOwnProperty.call(labelToPhysicalMap, str)) {
      const mapped = labelToPhysicalMap[str];
      if (typeof mapped === "number" && Number.isInteger(mapped) && mapped >= 1) {
        return {
          physicalIndex: mapped,
          pageLabel: str,
          isPureIndex: false,
          isResolved: true,
          labelCategory: category,
        };
      }
    }
    return {
      physicalIndex: null,
      pageLabel: str,
      isPureIndex: false,
      isResolved: false,
      labelCategory: category,
    };
  };

  // Pure integer string like "42"
  if (/^\d+$/.test(str)) {
    if (provenance === "physical_index" || provenance === "verified_coordinate") {
      const parsed = parseInt(str, 10);
      return {
        physicalIndex: parsed,
        pageLabel: str,
        isPureIndex: true,
        isResolved: true,
        labelCategory: "arabic_number",
      };
    }
    // String without coordinate provenance remains unresolved unless mapped
    return checkMap("arabic_number");
  }

  // Roman numerals: i, ii, iii, iv, v, vi, vii, viii, ix, x...
  if (/^[ivxlcdm]+$/i.test(str)) {
    return checkMap("roman_numeral");
  }

  // Chapter-hyphenated labels: "3-12", "14-5"
  if (/^\d+-\d+$/.test(str)) {
    return checkMap("chapter_section");
  }

  // Appendix or letter-prefixed: "A-1", "B-12"
  if (/^[a-z]-\d+$/i.test(str)) {
    return checkMap("appendix");
  }

  // Named landmarks: "Cover", "TOC", "Index"
  return checkMap("named_landmark");
}

/**
 * Validate lineage consistency.
 */
function validateLineage(lineage) {
  if (!lineage || typeof lineage !== "object") {
    return { valid: false, error: "Lineage must be a valid object." };
  }
  const { sourcePageStart, sourcePageEnd, childPageCount } = lineage;
  if (
    typeof sourcePageStart !== "number" || !Number.isInteger(sourcePageStart) || sourcePageStart < 1 ||
    typeof sourcePageEnd !== "number" || !Number.isInteger(sourcePageEnd) || sourcePageEnd < sourcePageStart ||
    typeof childPageCount !== "number" || !Number.isInteger(childPageCount) || childPageCount < 1
  ) {
    return { valid: false, error: "Lineage contains invalid range boundaries." };
  }
  if (childPageCount !== (sourcePageEnd - sourcePageStart + 1)) {
    return { valid: false, error: `Child page count (${childPageCount}) does not match range length (${sourcePageEnd - sourcePageStart + 1}).` };
  }
  return { valid: true };
}

/**
 * Translate physical page coordinates between child split parts, parent parts, and the root handbook.
 * Returns destination ID plus explicit destination coordinate space.
 */
export function translateSplitCoordinates(request, lineage) {
  const { direction, page } = request ?? {};

  // Strict page number validation
  if (typeof page !== "number" || !Number.isFinite(page) || !Number.isInteger(page)) {
    return {
      success: false,
      code: "INVALID_PAGE_ARGUMENT",
      error: `Split coordinate page must be a finite integer. Received: ${page}`,
    };
  }

  // Validate lineage range consistency
  const lineageVal = validateLineage(lineage);
  if (!lineageVal.valid) {
    return {
      success: false,
      code: "INVALID_LINEAGE",
      error: lineageVal.error,
    };
  }

  if (direction === "child_to_root") {
    if (page < 1 || page > lineage.childPageCount) {
      return {
        success: false,
        code: "PAGE_OUT_OF_CHILD_BOUNDS",
        error: `Page ${page} is outside this split part (length: ${lineage.childPageCount} pages).`,
      };
    }

    const rootPage = lineage.sourcePageStart + page - 1;

    // Check if root document is still live in library
    if (!lineage.rootMaterialId) {
      // Root was deleted. Never substitute parentMaterialId with root coordinates!
      return {
        success: false,
        code: "ROOT_DELETED",
        error: "The original root handbook has been removed from your library.",
        destinationSpace: "root_physical",
        sourceMaterialId: null,
        rootPage,
        childPage: page,
        snapshotTitle: lineage.sourceTitle ?? "Original Handbook",
        snapshotFileName: lineage.sourceFileName ?? "root.pdf",
      };
    }

    return {
      success: true,
      destinationSpace: "root_physical",
      sourceMaterialId: lineage.rootMaterialId,
      rootPage,
      childPage: page,
      sourceRange: [lineage.sourcePageStart, lineage.sourcePageEnd],
    };
  }

  if (direction === "child_to_parent") {
    // Nested splits (nestedLevel > 1) can navigate to immediate parent
    if (!lineage.parentMaterialId || !lineage.parentPageStart || !lineage.parentPageEnd) {
      return {
        success: false,
        code: "NO_PARENT_LINEAGE",
        error: "This document does not have an immediate parent part.",
      };
    }
    if (page < 1 || page > lineage.childPageCount) {
      return {
        success: false,
        code: "PAGE_OUT_OF_CHILD_BOUNDS",
        error: `Page ${page} is outside this split part (length: ${lineage.childPageCount} pages).`,
      };
    }
    const parentPage = lineage.parentPageStart + page - 1;
    return {
      success: true,
      destinationSpace: "parent_physical",
      sourceMaterialId: lineage.parentMaterialId,
      parentPage,
      childPage: page,
      parentRange: [lineage.parentPageStart, lineage.parentPageEnd],
    };
  }

  if (direction === "root_to_child") {
    if (page < lineage.sourcePageStart || page > lineage.sourcePageEnd) {
      return {
        success: false,
        code: "PAGE_OUTSIDE_SPLIT_RANGE",
        error: `Root handbook page ${page} is outside this split part's range (${lineage.sourcePageStart}–${lineage.sourcePageEnd}).`,
        rootPage: page,
        sourceRange: [lineage.sourcePageStart, lineage.sourcePageEnd],
      };
    }
    const childPage = page - lineage.sourcePageStart + 1;
    return {
      success: true,
      destinationSpace: "child_physical",
      rootPage: page,
      childPage,
      sourceRange: [lineage.sourcePageStart, lineage.sourcePageEnd],
    };
  }

  return {
    success: false,
    code: "UNKNOWN_DIRECTION",
    error: `Unknown translation direction: ${direction}`,
  };
}

/**
 * Detect content drift when a document is re-imported, restored, or checked.
 * Validates strict 64-character hex format for hashes.
 */
export function detectContentDrift(currentBufferOrHex, recordedSha256) {
  let currentSha256;
  if (typeof currentBufferOrHex === "string" && /^[a-f0-9]{64}$/i.test(currentBufferOrHex)) {
    currentSha256 = currentBufferOrHex.toLowerCase();
  } else if (Buffer.isBuffer(currentBufferOrHex) || currentBufferOrHex instanceof Uint8Array) {
    currentSha256 = crypto.createHash("sha256").update(currentBufferOrHex).digest("hex").toLowerCase();
  } else {
    return {
      status: "invalid_input",
      currentSha256: null,
      drifted: false,
      message: "Provided document content could not be hashed.",
    };
  }

  const recorded = (recordedSha256 ?? "").trim().toLowerCase();

  if (!recorded || !/^[a-f0-9]{64}$/.test(recorded)) {
    return {
      status: "unrecorded",
      currentSha256,
      drifted: false,
      message: "No valid previous content hash was recorded.",
    };
  }

  if (currentSha256 === recorded) {
    return {
      status: "verified",
      currentSha256,
      drifted: false,
      message: "Content hash verified identical. Bookmarks and reading position are valid.",
    };
  }

  return {
    status: "drifted",
    currentSha256,
    recordedSha256: recorded,
    drifted: true,
    requiresReview: true,
    message: "Content hash has changed since bookmarks were created. Bookmarks may need verification.",
  };
}

/**
 * Reconcile bookmarks when a document content hash changes.
 * Bookmarks bound to the old hash are preserved with status: "unverified" rather than deleted.
 */
export function reconcileBookmarksOnContentDrift(bookmarks, activeContentSha256) {
  return bookmarks.map((b) => {
    if (b.originatingContentSha256.toLowerCase() === activeContentSha256.toLowerCase()) {
      return { ...b, status: "verified" };
    }
    return {
      ...b,
      status: "unverified",
      unverifiedReason: "Document was replaced with different content.",
    };
  });
}

/**
 * Generate human-intelligible user feedback when native application cannot receive programmatic page jump.
 */
export function formatNativeJumpFallback(materialTitle, pageIndex, pageLabel = null) {
  const pageDisp = pageLabel && pageLabel !== String(pageIndex)
    ? `page ${pageIndex} (printed '${pageLabel}')`
    : `page ${pageIndex}`;

  return {
    action: "open_native",
    userNotice: `Opened '${materialTitle}' in system viewer. Turn to ${pageDisp}.`,
    targetPhysicalPage: pageIndex,
    targetPageLabel: pageLabel,
  };
}
