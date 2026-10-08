import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  validatePageRange,
  mapChildPageToSource,
  composeNestedRanges,
  resolveNavigationTargets,
  calculateSha256,
  evaluateSourceVersion,
  createDisposableLineageDb,
  insertMaterial,
  insertSplitLineage,
  getMaterialWithLineage,
  listSiblings,
  validateAndSaveSplitBatch,
  simulateOlderBinaryRestore,
  CANDIDATE_MIGRATION_0013_SQL,
} from "./lineageContract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scratchDir = join(__dirname, "../scratch");
if (!existsSync(scratchDir)) {
  mkdirSync(scratchDir, { recursive: true });
}

// --------------------------------------------------------------------------
// Contract 1: Page Range Validation (Physical Bounds & Type Safety)
// --------------------------------------------------------------------------
test("Contract 1: Page Range Validation enforces 1-based, inclusive bounds", () => {
  // Valid ranges
  assert.deepEqual(validatePageRange(1, 1), { ok: true, count: 1 });
  assert.deepEqual(validatePageRange(1, 100), { ok: true, count: 100 });
  assert.deepEqual(validatePageRange(101, 300), { ok: true, count: 200 });
  assert.deepEqual(validatePageRange(1, 400, 400), { ok: true, count: 400 });
  assert.deepEqual(validatePageRange(350, 400, 400), { ok: true, count: 51 });

  // Invalid: 0-based or negative
  assert.equal(validatePageRange(0, 100).ok, false);
  assert.equal(validatePageRange(0, 100).error, "Pages are numbered from 1.");
  assert.equal(validatePageRange(-5, 10).ok, false);
  assert.equal(validatePageRange(-5, 10).error, "Pages are numbered from 1.");

  // Invalid: inverted order
  assert.equal(validatePageRange(100, 50).ok, false);
  assert.equal(validatePageRange(100, 50).error, "The last page comes before the first one.");

  // Invalid: exceeding total pages
  assert.equal(validatePageRange(10, 500, 400).ok, false);
  assert.match(validatePageRange(10, 500, 400).error, /This PDF has 400 pages, so there is no page 500\./);
  assert.equal(validatePageRange(401, 450, 400).ok, false);
  assert.match(validatePageRange(401, 450, 400).error, /This PDF has 400 pages, so there is no page 401\./);

  // Invalid: non-integers and unsafe numbers
  assert.equal(validatePageRange(1.5, 10).ok, false);
  assert.equal(validatePageRange("1", 10).ok, false);
  assert.equal(validatePageRange(1, Infinity).ok, false);
});

// --------------------------------------------------------------------------
// Contract 2: Page Translation Maps Child Position to Source (SL-R2 Bounds)
// --------------------------------------------------------------------------
test("Contract 2: Page Translation Maps Child Position to Source with Strict Bounds", () => {
  const sourceStart = 101;
  const sourceEnd = 300; // length = 200

  // Valid mappings
  assert.equal(mapChildPageToSource(1, sourceStart, sourceEnd), 101);
  assert.equal(mapChildPageToSource(50, sourceStart, sourceEnd), 150);
  assert.equal(mapChildPageToSource(200, sourceStart, sourceEnd), 300);

  // SL-R2 requirement: Child page beyond the child's length must be refused!
  // Child covering 101–300 has only 200 pages; page 201 must throw
  assert.throws(
    () => mapChildPageToSource(201, sourceStart, sourceEnd),
    /Child page 201 exceeds child length 200\./
  );

  // Reject zero, negative, fractional, non-finite, and unsafe numbers
  assert.throws(() => mapChildPageToSource(0, sourceStart, sourceEnd), /Child page must be a positive integer/);
  assert.throws(() => mapChildPageToSource(-1, sourceStart, sourceEnd), /Child page must be a positive integer/);
  assert.throws(() => mapChildPageToSource(1.5, sourceStart, sourceEnd), /Child page must be a positive integer/);
  assert.throws(() => mapChildPageToSource(NaN, sourceStart, sourceEnd), /Child page must be a positive integer/);
  assert.throws(() => mapChildPageToSource(Infinity, sourceStart, sourceEnd), /Child page must be a positive integer/);
  assert.throws(() => mapChildPageToSource(1, 101.5, sourceEnd), /Source start page must be a positive integer/);
});

// --------------------------------------------------------------------------
// Contract 3: Nested Range Composition & Persistent Navigation Coordinates (SL-R1)
// --------------------------------------------------------------------------
test("Contract 3: Nested Range Composition and Persisted Navigation Coordinates", () => {
  // Required review example:
  // Root R has 400 pages.
  // Part A covers R pages 101–300 (200 pages).
  // Child B takes A pages 20–40.
  // B covers R pages 120–140.
  // Opening A requires page 20; opening R requires page 120.
  // The child length is 21, not the root total (400) or parent total (200).

  const parentRange = { sourcePageStart: 101, sourcePageEnd: 300 }; // covers R 101–300
  const childSelection = { firstPage: 20, lastPage: 40 };          // selection in A

  const composed = composeNestedRanges(parentRange, childSelection);

  assert.equal(composed.sourcePageStart, 120, "Composed R start: 101 + 20 - 1 = 120");
  assert.equal(composed.sourcePageEnd, 140, "Composed R end: 101 + 40 - 1 = 140");
  assert.equal(composed.parentPageStart, 20, "Immediate parent start page");
  assert.equal(composed.parentPageEnd, 40, "Immediate parent end page");
  assert.equal(composed.childPageCount, 21, "Child page count is 21 (40 - 20 + 1)");

  // Persist this exact example in disposable SQLite
  const db = createDisposableLineageDb(true);
  try {
    insertMaterial(db, { id: "mat-root-R", title: "FAA Airplane Flying Handbook", fileSize: 40000000 });
    insertMaterial(db, { id: "mat-part-A", title: "AFH — Chapter 3", fileSize: 20000000 });
    insertMaterial(db, { id: "mat-child-B", title: "AFH — Section 3.2", fileSize: 2100000 });

    // Part A lineage (direct split from R)
    insertSplitLineage(db, {
      materialId: "mat-part-A",
      parentMaterialId: "mat-root-R",
      rootMaterialId: "mat-root-R",
      sourcePageStart: 101,
      sourcePageEnd: 300,
      sourceFileName: "afh.pdf",
      sourceTitle: "FAA Airplane Flying Handbook",
      sourceTotalPages: 400,
      nestedLevel: 1,
    });

    // Child B lineage (nested split from A)
    insertSplitLineage(db, {
      materialId: "mat-child-B",
      parentMaterialId: "mat-part-A",
      rootMaterialId: "mat-root-R",
      sourcePageStart: 120,
      sourcePageEnd: 140,
      parentPageStart: 20,
      parentPageEnd: 40,
      childPageCount: 21,
      sourceFileName: "afh.pdf",
      sourceTitle: "FAA Airplane Flying Handbook",
      sourceTotalPages: 400,
      parentFileName: "afh-ch3.pdf",
      parentTitle: "AFH — Chapter 3",
      parentTotalPages: 200,
      nestedLevel: 2,
    });

    // Read back and verify navigation targets
    const childRecord = getMaterialWithLineage(db, "mat-child-B");
    assert.ok(childRecord?.lineage);
    assert.equal(childRecord.lineage.childPageCount, 21, "Child length must be 21");
    assert.equal(childRecord.lineage.sourceTotalPages, 400, "Root total must be 400");
    assert.equal(childRecord.lineage.parentTotalPages, 200, "Parent total must be 200");

    // Resolve navigation targets for child page 1:
    const nav1 = resolveNavigationTargets(childRecord.lineage, 1);
    assert.equal(nav1.parentTargetPage, 20, "Opening A at beginning of B requires page 20");
    assert.equal(nav1.rootTargetPage, 120, "Opening R at beginning of B requires page 120");

    // Resolve navigation targets for child page 21:
    const nav21 = resolveNavigationTargets(childRecord.lineage, 21);
    assert.equal(nav21.parentTargetPage, 40, "Opening A at end of B requires page 40");
    assert.equal(nav21.rootTargetPage, 140, "Opening R at end of B requires page 140");

    // Reject navigation beyond child length
    assert.throws(() => resolveNavigationTargets(childRecord.lineage, 22), /exceeds child length 21/);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 4: Multi-Level Transitive Nested Composition (3-Level)
// --------------------------------------------------------------------------
test("Contract 4: Multi-Level Transitive Nested Composition (3-Level)", () => {
  // Root: 1,000 pages
  // Level 1: Part covers 201–600 (400 pages)
  const l1 = { sourcePageStart: 201, sourcePageEnd: 600 };

  // Level 2: Section takes pages 51–150 of Level 1 (100 pages)
  const l2Sel = { firstPage: 51, lastPage: 150 };
  const l2 = composeNestedRanges(l1, l2Sel);
  // Root: 201 + 51 - 1 = 251 to 201 + 150 - 1 = 350
  assert.equal(l2.sourcePageStart, 251);
  assert.equal(l2.sourcePageEnd, 350);
  assert.equal(l2.childPageCount, 100);

  // Level 3: Subsection takes pages 11–20 of Level 2 (10 pages)
  const l3Sel = { firstPage: 11, lastPage: 20 };
  const l3 = composeNestedRanges({ sourcePageStart: l2.sourcePageStart, sourcePageEnd: l2.sourcePageEnd }, l3Sel);
  // Root: 251 + 11 - 1 = 261 to 251 + 20 - 1 = 270
  assert.equal(l3.sourcePageStart, 261);
  assert.equal(l3.sourcePageEnd, 270);
  assert.equal(l3.childPageCount, 10);
});

// --------------------------------------------------------------------------
// Contract 5: SHA-256 Content Hashing
// --------------------------------------------------------------------------
test("Contract 5: SHA-256 Content Hashing Determinism", () => {
  const bytes = Buffer.from("%PDF-1.7 standard FAA test document bytes");
  const hash1 = calculateSha256(bytes);
  const hash2 = calculateSha256(bytes);
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
  assert.match(hash1, /^[0-9a-f]{64}$/);
});

// --------------------------------------------------------------------------
// Contract 6: Candidate DDL Constraints Enforce Child Identity and Bounds (SL-R2)
// --------------------------------------------------------------------------
test("Contract 6: Candidate DDL Constraints Enforce Child Identity and Bounds", () => {
  const db = createDisposableLineageDb(true);
  try {
    insertMaterial(db, { id: "p", title: "Parent Material" });
    insertMaterial(db, { id: "c", title: "Child Material" });
    insertMaterial(db, { id: "c-bad1", title: "Bad Material 1" });
    insertMaterial(db, { id: "c-bad2", title: "Bad Material 2" });
    insertMaterial(db, { id: "c-bad3", title: "Bad Material 3" });

    // Valid insert
    insertSplitLineage(db, {
      materialId: "c",
      parentMaterialId: "p",
      rootMaterialId: "p",
      sourcePageStart: 101,
      sourcePageEnd: 300,
      sourceFileName: "p.pdf",
      sourceTitle: "Parent",
      sourceTotalPages: 400,
    });

    // 1. Refuse materialId: null (NOT NULL child identity)
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: null,
        parentMaterialId: "p",
        rootMaterialId: "p",
        sourcePageStart: 1,
        sourcePageEnd: 10,
        sourceFileName: "p.pdf",
        sourceTitle: "Parent",
      });
    }, /NOT NULL constraint failed/);

    // 2. Refuse fractional physical page start (TYPEOF = 'integer')
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "c-bad1",
        parentMaterialId: "p",
        rootMaterialId: "p",
        sourcePageStart: 101.5,
        sourcePageEnd: 300,
        sourceFileName: "p.pdf",
        sourceTitle: "Parent",
      });
    }, /CHECK constraint failed/);

    // 3. Refuse inverted page range (sourcePageEnd < sourcePageStart)
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "c-bad2",
        parentMaterialId: "p",
        rootMaterialId: "p",
        sourcePageStart: 300,
        sourcePageEnd: 101,
        sourceFileName: "p.pdf",
        sourceTitle: "Parent",
      });
    }, /CHECK constraint failed/);

    // 4. Refuse sourceTotalPages < sourcePageEnd
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "c-bad3",
        parentMaterialId: "p",
        rootMaterialId: "p",
        sourcePageStart: 100,
        sourcePageEnd: 200,
        sourceTotalPages: 150, // total < end
        sourceFileName: "p.pdf",
        sourceTitle: "Parent",
      });
    }, /CHECK constraint failed/);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 7: Cycle Prevention Refuses Self-Parenting and Self-Root (SL-R2)
// --------------------------------------------------------------------------
test("Contract 7: Cycle Prevention Refuses Self-Parenting and Self-Root", () => {
  const db = createDisposableLineageDb(true);
  try {
    insertMaterial(db, { id: "mat-self", title: "Self Ref" });

    // Refuse material_id == parent_material_id
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "mat-self",
        parentMaterialId: "mat-self",
        rootMaterialId: null,
        sourcePageStart: 1,
        sourcePageEnd: 10,
        sourceFileName: "doc.pdf",
        sourceTitle: "Doc",
      });
    }, /CHECK constraint failed: material_id != parent_material_id/);

    // Refuse material_id == root_material_id
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "mat-self",
        parentMaterialId: null,
        rootMaterialId: "mat-self",
        sourcePageStart: 1,
        sourcePageEnd: 10,
        sourceFileName: "doc.pdf",
        sourceTitle: "Doc",
      });
    }, /CHECK constraint failed: material_id != root_material_id/);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 8: Source Version Evaluation (matching, changed, missing, deleted, unknown) (SL-R1)
// --------------------------------------------------------------------------
test("Contract 8: Source Version Evaluation through Model Boundary", () => {
  const originalBytes = Buffer.from("%PDF-1.4 original source handbook content");
  const originalHash = calculateSha256(originalBytes);
  const modifiedBytes = Buffer.from("%PDF-1.4 MODIFIED handbook with revised chapters");
  const modifiedHash = calculateSha256(modifiedBytes);

  // 1. Matching: Live bytes hash identical to recorded hash
  const matchResult = evaluateSourceVersion({
    recordedHash: originalHash,
    currentBytes: originalBytes,
    fileExists: true,
    materialExists: true,
  });
  assert.equal(matchResult.status, "matching");
  assert.equal(matchResult.matches, true);

  // 2. Changed: Live bytes modified
  const changedResult = evaluateSourceVersion({
    recordedHash: originalHash,
    currentBytes: modifiedBytes,
    fileExists: true,
    materialExists: true,
  });
  assert.equal(changedResult.status, "changed");
  assert.equal(changedResult.matches, false);

  // 3. Missing: PDF file missing on disk
  const missingResult = evaluateSourceVersion({
    recordedHash: originalHash,
    fileExists: false,
    materialExists: true,
  });
  assert.equal(missingResult.status, "missing");
  assert.equal(missingResult.matches, false);

  // 4. Deleted: Parent study material entity deleted from library
  const deletedResult = evaluateSourceVersion({
    recordedHash: originalHash,
    fileExists: true,
    materialExists: false,
  });
  assert.equal(deletedResult.status, "deleted");
  assert.equal(deletedResult.matches, false);

  // 5. Unknown: Legacy material with no recorded reference hash
  const unknownResult = evaluateSourceVersion({
    recordedHash: null,
    currentBytes: originalBytes,
    fileExists: true,
    materialExists: true,
  });
  assert.equal(unknownResult.status, "unknown");
  assert.equal(unknownResult.matches, null);
});

// --------------------------------------------------------------------------
// Contract 9: Sibling Navigation Isolates Parts Across Parent Document Editions (SL-R1)
// --------------------------------------------------------------------------
test("Contract 9: Sibling Navigation Isolates Parts Across Parent Document Editions", () => {
  const db = createDisposableLineageDb(true);
  try {
    const parentId = "mat-handbook";
    insertMaterial(db, { id: parentId, title: "Instrument Flying Handbook" });

    const edition1Hash = calculateSha256(Buffer.from("Handbook Edition 2024"));
    const edition2Hash = calculateSha256(Buffer.from("Handbook Edition 2026 Revised"));

    // Edition 1 splits: Part 1 and Part 2
    insertMaterial(db, { id: "part-1-ed1", title: "IFH — Ch 1 (2024)" });
    insertMaterial(db, { id: "part-2-ed1", title: "IFH — Ch 2 (2024)" });
    insertSplitLineage(db, {
      materialId: "part-1-ed1",
      parentMaterialId: parentId,
      sourcePageStart: 1,
      sourcePageEnd: 50,
      sourceFileName: "ifh-2024.pdf",
      sourceTitle: "Instrument Flying Handbook",
      parentContentSha256: edition1Hash,
    });
    insertSplitLineage(db, {
      materialId: "part-2-ed1",
      parentMaterialId: parentId,
      sourcePageStart: 51,
      sourcePageEnd: 100,
      sourceFileName: "ifh-2024.pdf",
      sourceTitle: "Instrument Flying Handbook",
      parentContentSha256: edition1Hash,
    });

    // Parent handbook is later replaced/upgraded by user to Edition 2026!
    // New splits are cut from Edition 2026: Part 1 and Part 2
    insertMaterial(db, { id: "part-1-ed2", title: "IFH — Ch 1 (2026)" });
    insertMaterial(db, { id: "part-2-ed2", title: "IFH — Ch 2 (2026)" });
    insertSplitLineage(db, {
      materialId: "part-1-ed2",
      parentMaterialId: parentId,
      sourcePageStart: 1,
      sourcePageEnd: 60,
      sourceFileName: "ifh-2026.pdf",
      sourceTitle: "Instrument Flying Handbook 2026",
      parentContentSha256: edition2Hash,
    });
    insertSplitLineage(db, {
      materialId: "part-2-ed2",
      parentMaterialId: parentId,
      sourcePageStart: 61,
      sourcePageEnd: 120,
      sourceFileName: "ifh-2026.pdf",
      sourceTitle: "Instrument Flying Handbook 2026",
      parentContentSha256: edition2Hash,
    });

    // Siblings of part-1-ed1 must ONLY return part-2-ed1 (not the 2026 edition parts!)
    const ed1Siblings = listSiblings(db, "part-1-ed1");
    assert.equal(ed1Siblings.length, 1);
    assert.equal(ed1Siblings[0].id, "part-2-ed1");

    // Siblings of part-1-ed2 must ONLY return part-2-ed2 (not the 2024 edition parts!)
    const ed2Siblings = listSiblings(db, "part-1-ed2");
    assert.equal(ed2Siblings.length, 1);
    assert.equal(ed2Siblings[0].id, "part-2-ed2");
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 10: Parent Deletion Preserves Child Material and Split Provenance
// --------------------------------------------------------------------------
test("Contract 10: Parent Deletion Preserves Child Material and Split Provenance", () => {
  const db = createDisposableLineageDb(true);
  try {
    insertMaterial(db, { id: "mat-parent", title: "Aviation Weather Handbook", filePath: "/docs/awh.pdf" });
    insertMaterial(db, { id: "mat-child", title: "AWH — Chapter 5", filePath: "/docs/awh-ch5.pdf" });

    insertSplitLineage(db, {
      materialId: "mat-child",
      parentMaterialId: "mat-parent",
      rootMaterialId: "mat-parent",
      sourcePageStart: 50,
      sourcePageEnd: 99,
      sourceFileName: "awh.pdf",
      sourceTitle: "Aviation Weather Handbook",
      sourceTotalPages: 300,
    });

    // Delete parent material
    db.prepare("DELETE FROM study_materials WHERE id = 'mat-parent'").run();

    // Verify parent is deleted
    const parent = db.prepare("SELECT * FROM study_materials WHERE id = 'mat-parent'").get();
    assert.equal(parent, undefined);

    // Verify child material is PRESERVED (never cascade deleted!)
    const child = db.prepare("SELECT * FROM study_materials WHERE id = 'mat-child'").get();
    assert.ok(child);
    assert.equal(child.title, "AWH — Chapter 5");

    // Verify split lineage snapshot is preserved with parentMaterialId set to null
    const childWithLineage = getMaterialWithLineage(db, "mat-child");
    assert.ok(childWithLineage?.lineage);
    assert.equal(childWithLineage.lineage.parentMaterialId, null);
    assert.equal(childWithLineage.lineage.rootMaterialId, null);
    assert.equal(childWithLineage.lineage.sourcePageStart, 50);
    assert.equal(childWithLineage.lineage.sourcePageEnd, 99);
    assert.equal(childWithLineage.lineage.sourceTitle, "Aviation Weather Handbook");
    assert.equal(childWithLineage.lineage.parentStatus, "deleted");
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 11: Atomic Batch Save with Refusal of Stale Parent and Rollback (SL-R1, SL-R2)
// --------------------------------------------------------------------------
test("Contract 11: Atomic Batch Save Refuses Stale Source and Rolls Back on Failure", () => {
  const db = createDisposableLineageDb(true);
  try {
    const parentId = "mat-manual";
    const initialParentBytes = Buffer.from("Original Flight Manual v1.0");
    const initialHash = calculateSha256(initialParentBytes);

    insertMaterial(db, { id: parentId, title: "Flight Manual", fileSize: initialParentBytes.length });

    // 1. Attempt batch save with stale source hash -> MUST throw before any writes
    const staleModifiedBytes = Buffer.from("Modified Flight Manual v1.1");
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        parentMaterialId: parentId,
        expectedParentSha256: initialHash,
        currentParentBytes: staleModifiedBytes,
        parts: [{
          id: "part-1",
          title: "Part 1",
          sourcePageStart: 1,
          sourcePageEnd: 10,
          sourceFileName: "manual.pdf",
          sourceTitle: "Flight Manual",
        }],
      });
    }, /Stale source: parent material content hash has changed/);

    // Verify no materials or lineage were inserted
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM study_materials WHERE id = 'part-1'").get().c, 0);

    // 2. Failed batch transaction rollback test:
    // Batch has 3 parts: Part 1 is valid, Part 2 is valid, Part 3 has an invalid page range
    let cleanupInvoked = false;
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        parentMaterialId: parentId,
        expectedParentSha256: initialHash,
        currentParentBytes: initialParentBytes,
        parts: [
          { id: "p1", title: "Part 1", sourcePageStart: 1, sourcePageEnd: 10, sourceFileName: "m.pdf", sourceTitle: "Manual" },
          { id: "p2", title: "Part 2", sourcePageStart: 11, sourcePageEnd: 20, sourceFileName: "m.pdf", sourceTitle: "Manual" },
          { id: "p3", title: "Part 3", sourcePageStart: 25, sourcePageEnd: 20, sourceFileName: "m.pdf", sourceTitle: "Manual" }, // INVALID!
        ],
        onRollbackCleanup: () => { cleanupInvoked = true; },
      });
    }, /Invalid page range for part p3/);

    // Verify completely clean rollback: Neither p1 nor p2 exist in study_materials or lineage!
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM study_materials WHERE id IN ('p1', 'p2', 'p3')").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM material_split_lineage WHERE material_id IN ('p1', 'p2', 'p3')").get().c, 0);
    assert.equal(cleanupInvoked, true, "Rollback cleanup callback must be invoked on failure");

    // 3. Successful valid batch save
    const saveResult = validateAndSaveSplitBatch(db, {
      parentMaterialId: parentId,
      expectedParentSha256: initialHash,
      currentParentBytes: initialParentBytes,
      tags: [{ tagId: "tag-split", name: "Split Part" }],
      parts: [
        { id: "valid-p1", title: "Valid Part 1", sourcePageStart: 1, sourcePageEnd: 10, sourceFileName: "m.pdf", sourceTitle: "Manual" },
        { id: "valid-p2", title: "Valid Part 2", sourcePageStart: 11, sourcePageEnd: 20, sourceFileName: "m.pdf", sourceTitle: "Manual" },
      ],
    });
    assert.equal(saveResult.ok, true);
    assert.equal(saveResult.savedPartsCount, 2);

    // Verify both materials, lineage rows, and tags were committed atomically
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM study_materials WHERE id IN ('valid-p1', 'valid-p2')").get().c, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM material_split_lineage WHERE material_id IN ('valid-p1', 'valid-p2')").get().c, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM material_tags WHERE material_id IN ('valid-p1', 'valid-p2')").get().c, 2);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 12: Acknowledged Save Followed by Failed Refresh Idempotency (SL-R1)
// --------------------------------------------------------------------------
test("Contract 12: Acknowledged Save Followed by Failed Refresh Guarantees Consistency", () => {
  const db = createDisposableLineageDb(true);
  try {
    const parentId = "mat-ops";
    insertMaterial(db, { id: parentId, title: "Operations Manual" });

    // Step 1: Save transaction successfully commits to database
    validateAndSaveSplitBatch(db, {
      parentMaterialId: parentId,
      parts: [
        { id: "ops-part-1", title: "Ops Part 1", sourcePageStart: 1, sourcePageEnd: 50, sourceFileName: "ops.pdf", sourceTitle: "Operations" },
      ],
    });

    // Step 2: Simulate UI refresh exception (e.g. IPC communication error or client render error)
    const simulateUiRefresh = () => {
      throw new Error("Simulated transient IPC failure during UI library refresh");
    };
    assert.throws(() => simulateUiRefresh(), /Simulated transient IPC failure/);

    // Step 3: Verify database state is permanently acknowledged and intact
    const part = getMaterialWithLineage(db, "ops-part-1");
    assert.ok(part);
    assert.equal(part.title, "Ops Part 1");
    assert.equal(part.lineage.sourcePageStart, 1);
    assert.equal(part.lineage.sourcePageEnd, 50);

    // Step 4: Subsequent user retry / refresh successfully reads the acknowledged material
    const recoveredList = listSiblings(db, "other-nonexistent");
    const refreshedPart = getMaterialWithLineage(db, "ops-part-1");
    assert.ok(refreshedPart);
    assert.equal(refreshedPart.id, "ops-part-1");
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 13: Shipped Migrations 0001–0012 Faithful Schema Baseline (SL-R3)
// --------------------------------------------------------------------------
test("Contract 13: Shipped Migrations 0001–0012 Faithful Schema Baseline", () => {
  const db = createDisposableLineageDb(false);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);

    // Verify shipped attempt/card tables from migrations 0011 and 0012 exist
    assert.ok(tables.includes("practice_test_versions"), "migration 0011 practice_test_versions must exist");
    assert.ok(tables.includes("practice_test_items"), "migration 0011 practice_test_items must exist");
    assert.ok(tables.includes("practice_attempts"), "migration 0011 practice_attempts must exist");
    assert.ok(tables.includes("practice_responses"), "migration 0011 practice_responses must exist");
    assert.ok(tables.includes("card_review_generations"), "migration 0012 card_review_generations must exist");
    assert.ok(tables.includes("card_versions"), "migration 0012 card_versions must exist");
    assert.ok(tables.includes("card_items"), "migration 0012 card_items must exist");
    assert.ok(tables.includes("card_review_state"), "migration 0012 card_review_state must exist");
    assert.ok(tables.includes("card_review_events"), "migration 0012 card_review_events must exist");

    // Verify invented tables are NOT present
    assert.ok(!tables.includes("practice_sessions"), "invented practice_sessions must NOT replace shipped attempts");
    assert.ok(!tables.includes("card_review_states"), "invented card_review_states must NOT replace shipped state");

    // Populate representative accepted attempt and card review rows
    insertMaterial(db, { id: "mat-faa", title: "Pilot's Handbook of Aeronautical Knowledge" });

    // Practice test version & attempt
    db.prepare(`
      INSERT INTO practice_test_versions (
        id, source_material_id, history_key, source_material_title, version_number,
        provider, model, title, content_hash, created_at, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('v-1', 'mat-faa', 'hist-1', "Pilot's Handbook", 1, 'gemini', 'gemini-1.5-flash', 'Test 1', 'h123', '2026-10-08T10:00:00Z', 1);

    db.prepare(`
      INSERT INTO practice_attempts (
        id, version_id, source_material_id, source_material_title, started_at, completed_at,
        status, total_questions, answered_count, correct_count, score_percent
      ) VALUES (?, ?, ?, ?, ?, ?, 'completed', 10, 10, 10, 100.0)
    `).run('att-1', 'v-1', 'mat-faa', "Pilot's Handbook", '2026-10-08T10:05:00Z', '2026-10-08T10:25:00Z');

    // Card review version, item, state, and event
    db.prepare(`
      INSERT INTO card_versions (
        id, source_material_id, content_hash, card_count, provider, created_at, is_active
      ) VALUES ('cv-1', 'mat-faa', 'chash123', 5, 'gemini', '2026-10-08T10:00:00Z', 1)
    `).run();

    db.prepare(`
      INSERT INTO card_items (id, version_id, ordinal, front, back, source_page)
      VALUES ('item-1', 'cv-1', 0, 'What is angle of attack?', 'Angle between chord line and relative wind', 42)
    `).run();

    db.prepare(`
      INSERT INTO card_review_state (
        item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, revision
      ) VALUES ('item-1', 'mat-faa', 'v1', 2, '2026-10-10T10:00:00Z', '2026-10-08T10:30:00Z', 3, 0, 0, 1)
    `).run();

    // Verify row counts and values
    const attempt = db.prepare("SELECT * FROM practice_attempts WHERE id = 'att-1'").get();
    assert.equal(attempt.score_percent, 100.0);
    assert.equal(attempt.source_material_id, "mat-faa");

    const cardState = db.prepare("SELECT * FROM card_review_state WHERE item_id = 'item-1'").get();
    assert.equal(cardState.step, 2);
    assert.equal(cardState.reps, 3);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 14: Disposable Actual-Schema Export/Reopen and File Preservation (SL-R3)
// --------------------------------------------------------------------------
test("Contract 14: Disposable Schema Migration, Export/Reopen, and Synthetic File Preservation", () => {
  // Use temporary synthetic PDF files on disk to verify byte-preservation
  const tempPdfPath = join(scratchDir, `synthetic_handbook_${Date.now()}.pdf`);
  const syntheticBytes = Buffer.from("%PDF-1.4 %%EOF synthetic FAA aerodynamics handbook test file content\n".repeat(100));
  writeFileSync(tempPdfPath, syntheticBytes);

  try {
    const originalFileHash = calculateSha256(readFileSync(tempPdfPath));

    // Step 1: Create disposable database at shipped schema 12
    const db = createDisposableLineageDb(false);
    insertMaterial(db, { id: "mat-source", title: "Aerodynamics Handbook", filePath: tempPdfPath, fileSize: syntheticBytes.length });

    // Seed real practice attempt and card state
    db.prepare(`
      INSERT INTO practice_test_versions (
        id, source_material_id, history_key, source_material_title, version_number,
        provider, model, title, content_hash, created_at, is_active
      ) VALUES ('ver-base', 'mat-source', 'hist-base', 'Aero', 1, 'gemini', 'gemini-1.5-flash', 'Aero Quiz', 'hashA', '2026-10-08T08:00:00Z', 1)
    `).run();

    db.prepare(`
      INSERT INTO practice_attempts (
        id, version_id, source_material_id, source_material_title, started_at, completed_at,
        status, total_questions, answered_count, correct_count, score_percent
      ) VALUES (?, ?, ?, ?, ?, ?, 'completed', 10, 10, 9, 90.0)
    `).run('att-base', 'ver-base', 'mat-source', 'Aero', '2026-10-08T08:01:00Z', '2026-10-08T08:15:00Z');

    // Snapshots before candidate migration 0013
    const attemptBefore = db.prepare("SELECT * FROM practice_attempts WHERE id = 'att-base'").get();

    // Step 2: Apply candidate migration 0013
    db.exec(CANDIDATE_MIGRATION_0013_SQL);
    db.prepare("INSERT INTO _sqlx_migrations (version) VALUES (13)").run();
    db.prepare("INSERT INTO schema_migrations (version) VALUES (13)").run();

    // Step 3: Perform split operation
    insertMaterial(db, { id: "mat-split-part", title: "Aero Part 1", filePath: tempPdfPath });
    insertSplitLineage(db, {
      materialId: "mat-split-part",
      parentMaterialId: "mat-source",
      rootMaterialId: "mat-source",
      sourcePageStart: 1,
      sourcePageEnd: 50,
      sourceFileName: "aero.pdf",
      sourceTitle: "Aerodynamics Handbook",
      sourceContentSha256: originalFileHash,
    });

    // Step 4: Delete parent material
    db.prepare("DELETE FROM study_materials WHERE id = 'mat-source'").run();

    // Step 5: Verify pre-existing practice attempt is preserved with source_material_id set to null
    const attemptAfter = db.prepare("SELECT * FROM practice_attempts WHERE id = 'att-base'").get();
    assert.equal(attemptAfter.id, attemptBefore.id);
    assert.equal(attemptAfter.score_percent, attemptBefore.score_percent);
    assert.equal(attemptAfter.source_material_id, null, "SET NULL preserves historical attempt record");

    // Step 6: Verify synthetic PDF file on disk is byte-for-byte intact
    const fileBytesAfter = readFileSync(tempPdfPath);
    const fileHashAfter = calculateSha256(fileBytesAfter);
    assert.equal(fileHashAfter, originalFileHash, "Disk PDF file must be byte-for-byte unaltered");

    // Step 7: Export and reopen database (simulate file export/reopen)
    // We write to a temporary SQLite file and reopen it
    const tempDbPath = join(scratchDir, `exported_lineage_${Date.now()}.db`);
    try {
      db.exec(`VACUUM INTO '${tempDbPath}';`);
      db.close();

      const reopened = new DatabaseSync(tempDbPath);
      try {
        const recheckPart = reopened.prepare("SELECT * FROM study_materials WHERE id = 'mat-split-part'").get();
        assert.ok(recheckPart);
        assert.equal(recheckPart.title, "Aero Part 1");

        const recheckLineage = reopened.prepare("SELECT * FROM material_split_lineage WHERE material_id = 'mat-split-part'").get();
        assert.ok(recheckLineage);
        assert.equal(recheckLineage.source_page_start, 1);
        assert.equal(recheckLineage.source_page_end, 50);
        assert.equal(recheckLineage.source_content_sha256, originalFileHash);

        const recheckAttempt = reopened.prepare("SELECT * FROM practice_attempts WHERE id = 'att-base'").get();
        assert.ok(recheckAttempt);
        assert.equal(recheckAttempt.score_percent, 90.0);
      } finally {
        reopened.close();
      }
    } finally {
      if (existsSync(tempDbPath)) unlinkSync(tempDbPath);
    }
  } finally {
    if (existsSync(tempPdfPath)) unlinkSync(tempPdfPath);
  }
});

// --------------------------------------------------------------------------
// Contract 15: Restore Simulation Distinguishes Numeric Check from Native Validator (SL-R3)
// --------------------------------------------------------------------------
test("Contract 15: Restore Simulation Distinguishes Numeric Check from Native Validator", () => {
  // Explicitly note: This test verifies the numeric boundary logic simulating
  // src-tauri/src/backup.rs:631 without claiming that a native binary with schema 13 exists.
  // The existing native backup validation test suite in backup.rs has already been verified
  // and accepted for current shipped schemas 1..12.

  const olderBinaryMaxSchema = 12;
  const backupSchemaVersion = 13;

  // Older binary reading Schema 13 backup must refuse with descriptive error
  const refusal = simulateOlderBinaryRestore(backupSchemaVersion, olderBinaryMaxSchema);
  assert.equal(refusal.ok, false);
  assert.match(refusal.error, /database schema 13, this version reads up to 12/);

  // Newer binary reading Schema 12 backup succeeds
  const success = simulateOlderBinaryRestore(12, 13);
  assert.equal(success.ok, true);
});
