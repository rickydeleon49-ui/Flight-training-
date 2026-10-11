/**
 * Disposable Proof Suite for M4 Document Navigation & Viewer Evaluation
 * Executed via node:test (Node 22/26 native test runner).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  validatePageIndex,
  parsePageReference,
  translateSplitCoordinates,
  detectContentDrift,
  formatNativeJumpFallback,
  WEBKIT_COMPATIBILITY_RULES,
} from "./contractModel.mjs";

test("M4-P1: Physical Page Indexing & Clamping", () => {
  const totalPages = 50;

  // Valid pages
  assert.deepEqual(validatePageIndex(1, totalPages), { valid: true, normalizedPage: 1, code: "OK" });
  assert.deepEqual(validatePageIndex(25, totalPages), { valid: true, normalizedPage: 25, code: "OK" });
  assert.deepEqual(validatePageIndex(50, totalPages), { valid: true, normalizedPage: 50, code: "OK" });

  // Out of bounds - below 1
  const belowZero = validatePageIndex(0, totalPages);
  assert.equal(belowZero.valid, false);
  assert.equal(belowZero.normalizedPage, 1);
  assert.equal(belowZero.code, "CLAMPED_TO_FIRST");

  const negative = validatePageIndex(-10, totalPages);
  assert.equal(negative.valid, false);
  assert.equal(negative.normalizedPage, 1);
  assert.equal(negative.code, "CLAMPED_TO_FIRST");

  // Out of bounds - above totalPages
  const aboveMax = validatePageIndex(51, totalPages);
  assert.equal(aboveMax.valid, false);
  assert.equal(aboveMax.normalizedPage, 50);
  assert.equal(aboveMax.code, "CLAMPED_TO_LAST");

  const wayAbove = validatePageIndex(999, totalPages);
  assert.equal(wayAbove.valid, false);
  assert.equal(wayAbove.normalizedPage, 50);
  assert.equal(wayAbove.code, "CLAMPED_TO_LAST");

  // Malformed types
  assert.equal(validatePageIndex(3.14, totalPages).code, "INVALID_PAGE_INDEX");
  assert.equal(validatePageIndex(NaN, totalPages).code, "INVALID_PAGE_INDEX");
  assert.equal(validatePageIndex(Infinity, totalPages).code, "INVALID_PAGE_INDEX");
  assert.equal(validatePageIndex("42", totalPages).code, "INVALID_PAGE_INDEX");
  assert.equal(validatePageIndex(null, totalPages).code, "INVALID_PAGE_INDEX");
});

test("M4-P2: Printed Page Labels vs Physical Page Indexes", () => {
  // Pure arabic numbers
  const arabicNum = parsePageReference(42);
  assert.equal(arabicNum.physicalIndex, 42);
  assert.equal(arabicNum.isPureIndex, true);
  assert.equal(arabicNum.labelCategory, "arabic_number");

  const arabicStr = parsePageReference("42");
  assert.equal(arabicStr.physicalIndex, 42);
  assert.equal(arabicStr.isPureIndex, true);
  assert.equal(arabicStr.labelCategory, "arabic_number");

  // Roman numerals (front matter)
  const roman = parsePageReference("iv", 4);
  assert.equal(roman.physicalIndex, 4);
  assert.equal(roman.pageLabel, "iv");
  assert.equal(roman.isPureIndex, false);
  assert.equal(roman.labelCategory, "roman_numeral");

  const romanUpper = parsePageReference("XII", 12);
  assert.equal(romanUpper.pageLabel, "XII");
  assert.equal(romanUpper.labelCategory, "roman_numeral");

  // Chapter-section hyphenated (e.g. FAA PHAK "3-12")
  const chapterSection = parsePageReference("3-12", 45);
  assert.equal(chapterSection.physicalIndex, 45);
  assert.equal(chapterSection.pageLabel, "3-12");
  assert.equal(chapterSection.isPureIndex, false);
  assert.equal(chapterSection.labelCategory, "chapter_section");

  // Appendix (e.g. "A-1")
  const appendix = parsePageReference("A-1", 350);
  assert.equal(appendix.pageLabel, "A-1");
  assert.equal(appendix.labelCategory, "appendix");

  // Landmark names
  const cover = parsePageReference("Cover", 1);
  assert.equal(cover.pageLabel, "Cover");
  assert.equal(cover.labelCategory, "named_landmark");
});

test("M4-P3: Split-Lineage Page Coordinate Translation", () => {
  // Lineage fixture representing Chapter 2 (root pages 10..25, total 16 pages)
  const lineage = {
    materialId: "split-ch2",
    rootMaterialId: "root-handbook",
    parentMaterialId: null,
    sourcePageStart: 10,
    sourcePageEnd: 25,
    childPageCount: 16,
    nestedLevel: 1,
  };

  // Child to root
  const childFirst = translateSplitCoordinates({ direction: "child_to_root", page: 1 }, lineage);
  assert.equal(childFirst.success, true);
  assert.equal(childFirst.rootPage, 10);

  const childMiddle = translateSplitCoordinates({ direction: "child_to_root", page: 6 }, lineage);
  assert.equal(childMiddle.success, true);
  assert.equal(childMiddle.rootPage, 15);

  const childLast = translateSplitCoordinates({ direction: "child_to_root", page: 16 }, lineage);
  assert.equal(childLast.success, true);
  assert.equal(childLast.rootPage, 25);

  // Child out of bounds
  const childOver = translateSplitCoordinates({ direction: "child_to_root", page: 17 }, lineage);
  assert.equal(childOver.success, false);
  assert.equal(childOver.code, "PAGE_OUT_OF_CHILD_BOUNDS");

  // Root to child
  const rootInside = translateSplitCoordinates({ direction: "root_to_child", page: 15 }, lineage);
  assert.equal(rootInside.success, true);
  assert.equal(rootInside.childPage, 6);

  // Root outside bounds (before)
  const rootBefore = translateSplitCoordinates({ direction: "root_to_child", page: 9 }, lineage);
  assert.equal(rootBefore.success, false);
  assert.equal(rootBefore.code, "PAGE_OUTSIDE_SPLIT_RANGE");

  // Root outside bounds (after)
  const rootAfter = translateSplitCoordinates({ direction: "root_to_child", page: 26 }, lineage);
  assert.equal(rootAfter.success, false);
  assert.equal(rootAfter.code, "PAGE_OUTSIDE_SPLIT_RANGE");
});

test("M4-P4: Content Replacement & Hash Drift Detection", () => {
  const originalBytes = Buffer.from("Original Handbook Edition 2024", "utf-8");
  const originalHash = crypto.createHash("sha256").update(originalBytes).digest("hex");

  // Same content
  const verified = detectContentDrift(originalBytes, originalHash);
  assert.equal(verified.status, "verified");
  assert.equal(verified.drifted, false);

  // Modified content (replacement with Edition 2026)
  const replacementBytes = Buffer.from("New Handbook Edition 2026 With Changed Pages", "utf-8");
  const drifted = detectContentDrift(replacementBytes, originalHash);
  assert.equal(drifted.status, "drifted");
  assert.equal(drifted.drifted, true);
  assert.equal(drifted.requiresReview, true);

  // No recorded hash
  const unrecorded = detectContentDrift(originalBytes, null);
  assert.equal(unrecorded.status, "unrecorded");
  assert.equal(unrecorded.drifted, false);
});

test("M4-P5: Native Jump Fallback Messaging", () => {
  // Pure page index
  const msg1 = formatNativeJumpFallback("Pilot's Handbook", 42);
  assert.equal(msg1.action, "open_native");
  assert.equal(msg1.userNotice, "Opened 'Pilot's Handbook' in system viewer. Navigate to page 42.");
  assert.equal(msg1.targetPhysicalPage, 42);

  // Page index with printed label
  const msg2 = formatNativeJumpFallback("Instrument Flying Handbook", 125, "4-15");
  assert.equal(msg2.userNotice, "Opened 'Instrument Flying Handbook' in system viewer. Navigate to page 125 (printed '4-15').");
  assert.equal(msg2.targetPhysicalPage, 125);
  assert.equal(msg2.targetPageLabel, "4-15");
});

test("M4-P6: WebKit & Browser Compatibility Constraints Audit", () => {
  const m12 = WEBKIT_COMPATIBILITY_RULES.macOS12Monterey;
  const m14 = WEBKIT_COMPATIBILITY_RULES.macOS14Sonoma;

  // Monterey baseline (Safari 17.6 / WKWebView 16.0) cannot guarantee Safari 18 requirements
  assert.equal(m12.supportsReactPdf11DefaultBuild, false, "React-PDF 11 requires Safari 18+");
  assert.equal(m12.supportsWasmSimd, false, "WASM SIMD requires Safari 16.4+");
  assert.equal(m12.supportsPromiseWithResolvers, false, "Promise.withResolvers requires Safari 17.4+");

  // Sonoma baseline supports modern features
  assert.equal(m14.supportsReactPdf11DefaultBuild, true);
  assert.equal(m14.supportsWasmSimd, true);
  assert.equal(m14.supportsPromiseWithResolvers, true);
});

test("M4-P7: Synthetic PDF Fixtures Structural Integrity", () => {
  const fixturesDir = path.resolve("docs/evidence/m4-document-navigation-eval-2026-10-11/fixtures");
  const manifestPath = path.join(fixturesDir, "fixtures-manifest.json");

  assert.equal(fs.existsSync(manifestPath), true, "Fixtures manifest exists");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  assert.equal(manifest.length, 5, "5 synthetic fixtures generated");

  for (const entry of manifest) {
    const filePath = path.join(fixturesDir, entry.file);
    assert.equal(fs.existsSync(filePath), true, `Fixture file ${entry.file} exists`);
    const bytes = fs.readFileSync(filePath);
    assert.equal(bytes.length, entry.bytes, `Fixture ${entry.file} size matches manifest`);

    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    assert.equal(hash, entry.sha256, `Fixture ${entry.file} sha256 matches manifest`);

    if (entry.file !== "malformed_sample.pdf") {
      // Must start with %PDF-1.4 and contain trailer / startxref / %%EOF
      const head = bytes.subarray(0, 8).toString("latin1");
      assert.match(head, /^%PDF-1\.[34]/, `Valid PDF header in ${entry.file}`);
      const tail = bytes.subarray(bytes.length - 64).toString("latin1");
      assert.match(tail, /%%EOF\n?$/, `Valid PDF trailer termination in ${entry.file}`);
    } else {
      // Corrupted fixture has explicit corruption marker
      const text = bytes.toString("latin1");
      assert.match(text, /%%EOF_CORRUPT/, "Malformed fixture has corruption marker");
    }
  }
});
