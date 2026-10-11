/**
 * M4 Document Navigation Contract Model & Logic
 *
 * Implements pure domain logic for:
 * 1. Physical PDF page index validation & clamping.
 * 2. Printed page label vs physical index discrimination.
 * 3. Split-lineage page coordinate translation (child <-> parent <-> root).
 * 4. Document replacement & content hash drift detection.
 * 5. Native opening fallback message generation.
 * 6. WebKit / browser compatibility rules matrix.
 */
import crypto from "node:crypto";

/**
 * Validate and normalize a physical page index against known document bounds.
 * Physical page indices are strictly 1-based integers (1..totalPages).
 */
export function validatePageIndex(requested, totalPages) {
  if (typeof requested !== "number" || !Number.isFinite(requested) || !Number.isInteger(requested)) {
    return {
      valid: false,
      normalizedPage: 1,
      code: "INVALID_PAGE_INDEX",
      error: `Page '${requested}' is not a valid integer.`,
    };
  }

  if (typeof totalPages !== "number" || totalPages < 1) {
    return {
      valid: false,
      normalizedPage: 1,
      code: "INVALID_TOTAL_PAGES",
      error: "Document total pages must be at least 1.",
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
 * (e.g., "iv", "3-12", "Cover", "A-5").
 */
export function parsePageReference(input, physicalFallback = 1) {
  if (typeof input === "number" && Number.isInteger(input) && input >= 1) {
    return {
      physicalIndex: input,
      pageLabel: String(input),
      isPureIndex: true,
      labelCategory: "arabic_number",
    };
  }

  const str = String(input ?? "").trim();
  if (!str) {
    return {
      physicalIndex: physicalFallback,
      pageLabel: null,
      isPureIndex: false,
      labelCategory: "empty",
    };
  }

  // Pure integer string like "42"
  if (/^\d+$/.test(str)) {
    const parsed = parseInt(str, 10);
    return {
      physicalIndex: parsed,
      pageLabel: str,
      isPureIndex: true,
      labelCategory: "arabic_number",
    };
  }

  // Roman numerals: i, ii, iii, iv, v, vi, vii, viii, ix, x...
  if (/^[ivxlcdm]+$/i.test(str)) {
    return {
      physicalIndex: physicalFallback,
      pageLabel: str,
      isPureIndex: false,
      labelCategory: "roman_numeral",
    };
  }

  // Chapter-hyphenated labels: "3-12", "14-5"
  if (/^\d+-\d+$/.test(str)) {
    return {
      physicalIndex: physicalFallback,
      pageLabel: str,
      isPureIndex: false,
      labelCategory: "chapter_section",
    };
  }

  // Appendix or letter-prefixed: "A-1", "B-12"
  if (/^[a-z]-\d+$/i.test(str)) {
    return {
      physicalIndex: physicalFallback,
      pageLabel: str,
      isPureIndex: false,
      labelCategory: "appendix",
    };
  }

  // Named landmarks: "Cover", "TOC", "Index"
  return {
    physicalIndex: physicalFallback,
    pageLabel: str,
    isPureIndex: false,
    labelCategory: "named_landmark",
  };
}

/**
 * Translate physical page coordinates between child split parts and the root handbook.
 */
export function translateSplitCoordinates(request, lineage) {
  const { direction, page } = request;

  if (direction === "child_to_root") {
    if (page < 1 || page > lineage.childPageCount) {
      return {
        success: false,
        code: "PAGE_OUT_OF_CHILD_BOUNDS",
        error: `Page ${page} is outside this split part (length: ${lineage.childPageCount} pages).`,
      };
    }
    const rootPage = lineage.sourcePageStart + page - 1;
    return {
      success: true,
      sourceMaterialId: lineage.rootMaterialId ?? lineage.parentMaterialId,
      rootPage,
      childPage: page,
      sourceRange: [lineage.sourcePageStart, lineage.sourcePageEnd],
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
      rootPage: page,
      childPage,
      sourceRange: [lineage.sourcePageStart, lineage.sourcePageEnd],
    };
  }

  throw new Error(`Unknown direction: ${direction}`);
}

/**
 * Detect content drift when a document is re-imported, restored, or checked.
 */
export function detectContentDrift(currentBufferOrHex, recordedSha256) {
  let currentSha256;
  if (typeof currentBufferOrHex === "string" && /^[a-f0-9]{64}$/i.test(currentBufferOrHex)) {
    currentSha256 = currentBufferOrHex.toLowerCase();
  } else {
    currentSha256 = crypto.createHash("sha256").update(currentBufferOrHex).digest("hex").toLowerCase();
  }

  const recorded = (recordedSha256 ?? "").trim().toLowerCase();

  if (!recorded) {
    return {
      status: "unrecorded",
      currentSha256,
      drifted: false,
      message: "No previous content hash was recorded.",
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
 * Generate human-intelligible user feedback when native application cannot receive programmatic page jump.
 */
export function formatNativeJumpFallback(materialTitle, pageIndex, pageLabel = null) {
  const pageDisp = pageLabel && pageLabel !== String(pageIndex)
    ? `page ${pageIndex} (printed '${pageLabel}')`
    : `page ${pageIndex}`;

  return {
    action: "open_native",
    userNotice: `Opened '${materialTitle}' in system viewer. Navigate to ${pageDisp}.`,
    targetPhysicalPage: pageIndex,
    targetPageLabel: pageLabel,
  };
}

/**
 * WebKit / Safari compatibility matrix rule check for PDF rendering dependencies.
 */
export const WEBKIT_COMPATIBILITY_RULES = {
  macOS12Monterey: {
    maxSystemSafariVersion: "17.6",
    wkWebViewEngineVersion: 16.0,
    supportsPromiseWithResolvers: false, // Arrived in Safari 17.4
    supportsObjectGroupBy: false,        // Arrived in Safari 17.4
    supportsWasmSimd: false,             // Arrived in Safari 16.4
    supportsWasmThreadsWithoutCoop: false,
    supportsReactPdf11DefaultBuild: false, // Requires Safari 18+
  },
  macOS14Sonoma: {
    maxSystemSafariVersion: "18.x",
    wkWebViewEngineVersion: 18.0,
    supportsPromiseWithResolvers: true,
    supportsObjectGroupBy: true,
    supportsWasmSimd: true,
    supportsWasmThreadsWithoutCoop: false,
    supportsReactPdf11DefaultBuild: true,
  },
};
