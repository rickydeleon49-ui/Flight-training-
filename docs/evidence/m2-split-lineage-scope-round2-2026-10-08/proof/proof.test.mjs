import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  CANDIDATE_MIGRATION_0013_SQL,
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
  reconcileFailedRefresh,
  simulateOlderBinaryNumericCheck,
} from "./lineageContract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scratchDir = join(__dirname, "../scratch");
if (!existsSync(scratchDir)) {
  mkdirSync(scratchDir, { recursive: true });
}

// --------------------------------------------------------------------------
// Contract 1: Page Range Validation (1-Based, Inclusive)
// --------------------------------------------------------------------------
test("Contract 1: Page Range Validation enforces 1-based, inclusive bounds", () => {
  // Valid ranges
  assert.deepEqual(validatePageRange(1, 10), { ok: true, count: 10 });
  assert.deepEqual(validatePageRange(5, 5), { ok: true, count: 1 });
  assert.deepEqual(validatePageRange(10, 25, 30), { ok: true, count: 16 });

  // Out of bounds / invalid
  assert.equal(validatePageRange(0, 10).ok, false);
  assert.equal(validatePageRange(-5, 10).ok, false);
  assert.equal(validatePageRange(10, 5).ok, false);
  assert.equal(validatePageRange(1, 50, 40).ok, false);
  assert.equal(validatePageRange(45, 50, 40).ok, false);
  assert.equal(validatePageRange("1", 10).ok, false);
  assert.equal(validatePageRange(1, "10").ok, false);
  assert.equal(validatePageRange(1.5, 10).ok, false);
});

// --------------------------------------------------------------------------
// Contract 2: Page Translation Maps Child Position to Source with Strict Bounds
// --------------------------------------------------------------------------
test("Contract 2: Page Translation Maps Child Position to Source with Strict Bounds & Explicit Options", () => {
  // Positional form: Part covers pages 101–300 of source
  assert.equal(mapChildPageToSource(1, 101, 300), 101);
  assert.equal(mapChildPageToSource(20, 101, 300), 120);
  assert.equal(mapChildPageToSource(200, 101, 300), 300);

  // Explicit options object form: { sourcePageEnd, childLength }
  assert.equal(mapChildPageToSource(1, 101, { sourcePageEnd: 300 }), 101);
  assert.equal(mapChildPageToSource(20, 101, { sourcePageEnd: 300 }), 120);
  assert.equal(mapChildPageToSource(20, 101, { childLength: 200 }), 120);

  // Bounds violations
  assert.throws(() => mapChildPageToSource(0, 101, 300), /positive integer/);
  assert.throws(() => mapChildPageToSource(201, 101, 300), /exceeds child length 200/);
  assert.throws(() => mapChildPageToSource(1, 0, 300), /Source start page must be a positive integer/);
  assert.throws(() => mapChildPageToSource(1.5, 101, 300), /positive integer/);
  assert.equal(mapChildPageToSource(1, 101, { childLength: 10 }), 101);
  assert.throws(() => mapChildPageToSource(11, 101, { childLength: 10 }), /exceeds child length 10/);
});

// --------------------------------------------------------------------------
// Contract 3: Nested Range Composition and Persisted Navigation Coordinates
// --------------------------------------------------------------------------
test("Contract 3: Nested Range Composition and Persisted Navigation Coordinates", () => {
  // Canonical scenario:
  // Root R: 400 pages total.
  // Part A: R pages 101–300 (length 200).
  // Child B: A pages 20–40 (length 21).
  // Composed B in R: pages 120–140.
  const parentRange = { sourcePageStart: 101, sourcePageEnd: 300 };
  const childSelection = { firstPage: 20, lastPage: 40 };

  const composed = composeNestedRanges(parentRange, childSelection);
  assert.equal(composed.sourcePageStart, 120);
  assert.equal(composed.sourcePageEnd, 140);
  assert.equal(composed.parentPageStart, 20);
  assert.equal(composed.parentPageEnd, 40);
  assert.equal(composed.childPageCount, 21);

  // Navigation targets from child B:
  // Opening child B at page 1:
  // - in parent A: page 20
  // - in root R: page 120
  const navStart = resolveNavigationTargets(composed, 1);
  assert.equal(navStart.childPage, 1);
  assert.equal(navStart.parentTargetPage, 20);
  assert.equal(navStart.rootTargetPage, 120);
  assert.equal(navStart.childPageCount, 21);

  // Opening child B at page 21 (last page):
  // - in parent A: page 40
  // - in root R: page 140
  const navEnd = resolveNavigationTargets(composed, 21);
  assert.equal(navEnd.childPage, 21);
  assert.equal(navEnd.parentTargetPage, 40);
  assert.equal(navEnd.rootTargetPage, 140);

  // Child page beyond child length rejected
  assert.throws(() => resolveNavigationTargets(composed, 22), /exceeds child length 21/);
});

// --------------------------------------------------------------------------
// Contract 4: Multi-Level Transitive Nested Composition (3-Level)
// --------------------------------------------------------------------------
test("Contract 4: Multi-Level Transitive Nested Composition (3-Level)", () => {
  // Root R (1000 pages).
  // Part A takes R 201–600 (length 400).
  // Part B takes A 51–150 (length 100) -> R: 201 + 51 - 1 = 251 to 201 + 150 - 1 = 350.
  // Part C takes B 11–30 (length 20) -> B: 11–30; A: 51 + 11 - 1 = 61 to 80; R: 251 + 11 - 1 = 261 to 280.
  const compAB = composeNestedRanges({ sourcePageStart: 201, sourcePageEnd: 600 }, { firstPage: 51, lastPage: 150 });
  assert.equal(compAB.sourcePageStart, 251);
  assert.equal(compAB.sourcePageEnd, 350);

  const compBC = composeNestedRanges({ sourcePageStart: compAB.sourcePageStart, sourcePageEnd: compAB.sourcePageEnd }, { firstPage: 11, lastPage: 30 });
  assert.equal(compBC.sourcePageStart, 261);
  assert.equal(compBC.sourcePageEnd, 280);
  assert.equal(compBC.childPageCount, 20);
});

// --------------------------------------------------------------------------
// Contract 5: SHA-256 Content Hashing Determinism
// --------------------------------------------------------------------------
test("Contract 5: SHA-256 Content Hashing Determinism", () => {
  const sample1 = Buffer.from("FAA-H-8083-25B Pilot Handbook of Aeronautical Knowledge");
  const sample2 = Buffer.from("FAA-H-8083-25B Pilot Handbook of Aeronautical Knowledge");
  const sampleModified = Buffer.from("FAA-H-8083-25C Pilot Handbook of Aeronautical Knowledge");

  const hash1 = calculateSha256(sample1);
  const hash2 = calculateSha256(sample2);
  const hashMod = calculateSha256(sampleModified);

  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
  assert.notEqual(hash1, hashMod);
});

// --------------------------------------------------------------------------
// Contract 6: Candidate DDL Constraints Enforce Child Identity and Bounds
// --------------------------------------------------------------------------
test("Contract 6: Candidate DDL Constraints Enforce Child Identity and Bounds", () => {
  const db = createDisposableLineageDb();
  try {
    insertMaterial(db, { id: "root-doc", title: "Complete FAA Handbook" });
    insertMaterial(db, { id: "valid-child", title: "Aerodynamics Chapter" });

    // Valid direct split row
    assert.doesNotThrow(() => {
      insertSplitLineage(db, {
        materialId: "valid-child",
        parentMaterialId: "root-doc",
        rootMaterialId: "root-doc",
        sourcePageStart: 1,
        sourcePageEnd: 50,
        childPageCount: 50,
        sourceFileName: "handbook.pdf",
        sourceTitle: "Complete FAA Handbook",
        sourceTotalPages: 500,
      });
    });

    // 1. Mandatory child identity (cannot insert lineage without material_id)
    assert.throws(() => {
      db.prepare(`
        INSERT INTO material_split_lineage (
          parent_material_id, root_material_id, source_page_start, source_page_end,
          child_page_count, source_file_name, source_title, created_at
        ) VALUES ('root-doc', 'root-doc', 1, 10, 10, 'h.pdf', 'Handbook', datetime('now'))
      `).run();
    }, /NOT NULL constraint failed/);

    // 2. Fractional page positions rejected (TYPEOF = 'integer')
    insertMaterial(db, { id: "c-bad1", title: "Fractional Child" });
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "c-bad1",
        parentMaterialId: "root-doc",
        rootMaterialId: "root-doc",
        sourcePageStart: 101.5,
        sourcePageEnd: 300,
        sourceFileName: "h.pdf",
        sourceTitle: "Handbook",
      });
    }, /CHECK constraint failed/);

    // 3. Child page count mismatch with page range rejected
    insertMaterial(db, { id: "mismatch-child", title: "Mismatch Child" });
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "mismatch-child",
        parentMaterialId: "root-doc",
        rootMaterialId: "root-doc",
        sourcePageStart: 1,
        sourcePageEnd: 10,
        childPageCount: 999, // Mismatched!
        sourceFileName: "h.pdf",
        sourceTitle: "Handbook",
      });
    }, /CHECK constraint failed/);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 7: Cycle Prevention Refuses Self-Parenting and Self-Root
// --------------------------------------------------------------------------
test("Contract 7: Cycle Prevention Refuses Self-Parenting and Self-Root", () => {
  const db = createDisposableLineageDb();
  try {
    insertMaterial(db, { id: "self-doc", title: "Self Document" });

    // Self-parenting rejected
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "self-doc",
        parentMaterialId: "self-doc",
        rootMaterialId: "other-root",
        sourcePageStart: 1,
        sourcePageEnd: 10,
        sourceFileName: "h.pdf",
        sourceTitle: "Handbook",
      });
    }, /CHECK constraint failed/);

    // Self-root rejected
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "self-doc",
        parentMaterialId: null,
        rootMaterialId: "self-doc",
        sourcePageStart: 1,
        sourcePageEnd: 10,
        sourceFileName: "h.pdf",
        sourceTitle: "Handbook",
      });
    }, /CHECK constraint failed/);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 8: Source Version Evaluation through Model Boundary (SL-R4)
// --------------------------------------------------------------------------
test("Contract 8: Source Version Evaluation through Model Boundary", () => {
  const refBytes = Buffer.from("FAA Handbook Original Content 2026");
  const refHash = calculateSha256(refBytes);

  // 1. Matching bytes
  const evMatch = evaluateSourceVersion({ recordedHash: refHash, currentBytes: refBytes });
  assert.equal(evMatch.status, "matching");
  assert.equal(evMatch.matches, true);

  // 2. Changed bytes
  const modifiedBytes = Buffer.from("FAA Handbook Modified Edition");
  const evChanged = evaluateSourceVersion({ recordedHash: refHash, currentBytes: modifiedBytes });
  assert.equal(evChanged.status, "changed");
  assert.equal(evChanged.matches, false);

  // 3. Unread bytes (unknown)
  const evUnknown = evaluateSourceVersion({ recordedHash: refHash, currentBytes: null, currentHash: null });
  assert.equal(evUnknown.status, "unknown");
  assert.equal(evUnknown.matches, null);

  // 4. Missing file
  const evMissing = evaluateSourceVersion({ recordedHash: refHash, fileExists: false });
  assert.equal(evMissing.status, "missing");
  assert.equal(evMissing.matches, false);

  // 5. Deleted material
  const evDeleted = evaluateSourceVersion({ recordedHash: refHash, materialExists: false });
  assert.equal(evDeleted.status, "deleted");
  assert.equal(evDeleted.matches, false);

  // 6. Direct split resolution through getMaterialWithLineage
  const db = createDisposableLineageDb();
  try {
    insertMaterial(db, { id: "root-dir", title: "Direct Root" });
    insertMaterial(db, { id: "child-dir", title: "Direct Child" });
    insertSplitLineage(db, {
      materialId: "child-dir",
      parentMaterialId: "root-dir",
      rootMaterialId: "root-dir",
      sourcePageStart: 1,
      sourcePageEnd: 10,
      sourceTitle: "Direct Root",
      sourceFileName: "dir.pdf",
      sourceContentSha256: refHash,
      sourceTotalPages: 100,
    });

    // Directly split root with matching live bytes reports matching
    const resMatching = getMaterialWithLineage(db, "child-dir", { currentFileBytes: refBytes });
    assert.equal(resMatching.lineage.parentStatus, "matching");
    assert.equal(resMatching.lineage.rootStatus, "matching");

    // Directly split root with changed live bytes reports changed
    const resChanged = getMaterialWithLineage(db, "child-dir", { currentFileBytes: modifiedBytes });
    assert.equal(resChanged.lineage.parentStatus, "changed");

    // Directly split root with unread bytes reports unknown
    const resUnknown = getMaterialWithLineage(db, "child-dir", {});
    assert.equal(resUnknown.lineage.parentStatus, "unknown");

    // Directly split root with missing file reports missing
    const resMissing = getMaterialWithLineage(db, "child-dir", { fileExists: false });
    assert.equal(resMissing.lineage.parentStatus, "missing");

    // Directly split root with deleted parent material reports deleted
    db.prepare("DELETE FROM study_materials WHERE id = 'root-dir'").run();
    const resDeleted = getMaterialWithLineage(db, "child-dir", {});
    assert.equal(resDeleted.lineage.parentStatus, "deleted");
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 9: Sibling Navigation Isolates Parts Across Editions & IDs (SL-R4)
// --------------------------------------------------------------------------
test("Contract 9: Sibling Navigation Isolates Parts Across Parent Document Editions", () => {
  const db = createDisposableLineageDb();
  try {
    const edition1Hash = calculateSha256("Handbook Edition 1");
    const edition2Hash = calculateSha256("Handbook Edition 2");

    insertMaterial(db, { id: "manual-root", title: "Flight Manual" });

    // Edition 1 parts (direct splits)
    insertMaterial(db, { id: "p1-ed1", title: "Part 1 Ed 1" });
    insertMaterial(db, { id: "p2-ed1", title: "Part 2 Ed 1" });
    insertSplitLineage(db, {
      materialId: "p1-ed1",
      parentMaterialId: "manual-root",
      rootMaterialId: "manual-root",
      sourcePageStart: 1,
      sourcePageEnd: 50,
      sourceTitle: "Manual",
      sourceFileName: "m.pdf",
      sourceContentSha256: edition1Hash,
    });
    insertSplitLineage(db, {
      materialId: "p2-ed1",
      parentMaterialId: "manual-root",
      rootMaterialId: "manual-root",
      sourcePageStart: 51,
      sourcePageEnd: 100,
      sourceTitle: "Manual",
      sourceFileName: "m.pdf",
      sourceContentSha256: edition1Hash,
    });

    // Edition 2 part under same parent material ID
    insertMaterial(db, { id: "p1-ed2", title: "Part 1 Ed 2" });
    insertSplitLineage(db, {
      materialId: "p1-ed2",
      parentMaterialId: "manual-root",
      rootMaterialId: "manual-root",
      sourcePageStart: 1,
      sourcePageEnd: 55,
      sourceTitle: "Manual",
      sourceFileName: "m.pdf",
      sourceContentSha256: edition2Hash,
    });

    // Independent parent material with identical bytes
    insertMaterial(db, { id: "independent-root", title: "Independent Import" });
    insertMaterial(db, { id: "p-indep", title: "Independent Part" });
    insertSplitLineage(db, {
      materialId: "p-indep",
      parentMaterialId: "independent-root",
      rootMaterialId: "independent-root",
      sourcePageStart: 1,
      sourcePageEnd: 50,
      sourceTitle: "Independent",
      sourceFileName: "indep.pdf",
      sourceContentSha256: edition1Hash,
    });

    // Sibling lookup for p1-ed1 must return ONLY p2-ed1 (not p1-ed2, not p-indep)
    const siblings = listSiblings(db, "p1-ed1");
    assert.deepEqual(siblings.map((s) => s.id), ["p2-ed1"]);

    // Part with unknown hash must return empty array (conservative unknown policy)
    insertMaterial(db, { id: "p-unknown", title: "Unknown Hash Part" });
    insertSplitLineage(db, {
      materialId: "p-unknown",
      parentMaterialId: "manual-root",
      rootMaterialId: "manual-root",
      sourcePageStart: 1,
      sourcePageEnd: 10,
      sourceTitle: "Manual",
      sourceFileName: "m.pdf",
      sourceContentSha256: null,
    });
    assert.deepEqual(listSiblings(db, "p-unknown"), []);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 10: Parent Deletion Preserves Child Material and Provenance
// --------------------------------------------------------------------------
test("Contract 10: Parent Deletion Preserves Child Material and Split Provenance", () => {
  const db = createDisposableLineageDb();
  try {
    insertMaterial(db, { id: "parent-doc", title: "Parent Manual" });
    insertMaterial(db, { id: "child-part", title: "Child Section" });
    insertSplitLineage(db, {
      materialId: "child-part",
      parentMaterialId: "parent-doc",
      rootMaterialId: "parent-doc",
      sourcePageStart: 1,
      sourcePageEnd: 25,
      sourceFileName: "parent.pdf",
      sourceTitle: "Parent Manual",
      sourceContentSha256: "abc123hash",
      sourceTotalPages: 100,
    });

    // Delete parent material
    db.prepare("DELETE FROM study_materials WHERE id = 'parent-doc'").run();

    // Verify child material still exists (not cascade deleted!)
    const childMaterial = db.prepare("SELECT * FROM study_materials WHERE id = 'child-part'").get();
    assert.ok(childMaterial);
    assert.equal(childMaterial.title, "Child Section");

    // Verify lineage preserved with parent_material_id and root_material_id set to NULL
    const childLineage = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = 'child-part'").get();
    assert.ok(childLineage);
    assert.equal(childLineage.parent_material_id, null);
    assert.equal(childLineage.root_material_id, null);
    assert.equal(childLineage.source_page_start, 1);
    assert.equal(childLineage.source_page_end, 25);
    assert.equal(childLineage.source_title, "Parent Manual");
    assert.equal(childLineage.source_content_sha256, "abc123hash");
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 11: Atomic Batch Save & Rollback on Failure (SL-R5 & SL-R6)
// --------------------------------------------------------------------------
test("Contract 11: Atomic Batch Save Binds to Authoritative Source and Rolls Back on Failure", () => {
  const db = createDisposableLineageDb();
  try {
    const initialParentBytes = Buffer.from("FAA Manual Edition 1 Original Content");
    const initialHash = calculateSha256(initialParentBytes);
    const staleModifiedBytes = Buffer.from("FAA Manual Edition 1 Stale Altered Content");

    const parentId = "mat-parent-save";
    insertMaterial(db, { id: parentId, title: "Flight Manual" });

    // 1. Refusal: expectedParentSha256 provided without currentParentBytes (SL-R5)
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        parentMaterialId: parentId,
        expectedParentSha256: initialHash,
        // currentParentBytes omitted!
        parts: [{ id: "unverified-part", title: "Part", sourcePageStart: 1, sourcePageEnd: 10 }],
      });
    }, /Source verification unavailable: current source bytes\/hash required/);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM study_materials WHERE id = 'unverified-part'").get().c, 0);

    // 2. Refusal: stale source content hash mismatch
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        parentMaterialId: parentId,
        expectedParentSha256: initialHash,
        currentParentBytes: staleModifiedBytes,
        parts: [{ id: "stale-part", title: "Stale Part", sourcePageStart: 1, sourcePageEnd: 10 }],
      });
    }, /Stale source: parent material content hash has changed/);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM study_materials WHERE id = 'stale-part'").get().c, 0);

    // 3. Refusal: nested save with contradictory root range (SL-R5)
    // Setup nested parent A covering root 101–300
    insertMaterial(db, { id: "nested-parent-A", title: "Parent A" });
    insertSplitLineage(db, {
      materialId: "nested-parent-A",
      parentMaterialId: parentId,
      rootMaterialId: parentId,
      sourcePageStart: 101,
      sourcePageEnd: 300,
      sourceTotalPages: 400,
      sourceTitle: "Flight Manual",
      sourceFileName: "m.pdf",
      sourceContentSha256: initialHash,
    });

    // Attempt to save child B with parent 20–40 but contradictory root 1–21 (should be 120–140)
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        parentMaterialId: "nested-parent-A",
        expectedParentSha256: initialHash,
        currentParentBytes: initialParentBytes,
        parts: [{
          id: "contradictory-B",
          title: "Child B",
          parentPageStart: 20,
          parentPageEnd: 40,
          parentTotalPages: 200,
          sourcePageStart: 1, // Contradictory!
          sourcePageEnd: 21,
          rootMaterialId: parentId,
          nestedLevel: 2,
        }],
      });
    }, /contradicts parent-derived root start/);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM study_materials WHERE id = 'contradictory-B'").get().c, 0);

    // 4. Promoted Mid-Transaction Failure Rollback with Real File Cleanup (SL-R6)
    // Injects a trigger that raises failure during the second lineage insert after earlier material & tag writes
    db.exec(`
      CREATE TRIGGER injected_failure_on_second
      BEFORE INSERT ON material_split_lineage
      WHEN NEW.material_id = 'fail-second-part'
      BEGIN
        SELECT RAISE(FAIL, 'injected mid-transaction rollback failure');
      END;
    `);

    const stagedTempFile = join(scratchDir, `staging_artifact_${Date.now()}.pdf`);
    writeFileSync(stagedTempFile, "real temporary staged bytes on disk");
    assert.equal(existsSync(stagedTempFile), true);

    let rollbackCleanupInvoked = false;
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        parentMaterialId: parentId,
        expectedParentSha256: initialHash,
        currentParentBytes: initialParentBytes,
        tags: [{ tagId: "tag-rollback", name: "Rollback Test Tag" }],
        parts: [
          { id: "saved-first-part", title: "First Part", sourcePageStart: 1, sourcePageEnd: 10 },
          { id: "fail-second-part", title: "Second Part", sourcePageStart: 11, sourcePageEnd: 20 },
        ],
        onRollbackCleanup: () => {
          rollbackCleanupInvoked = true;
          if (existsSync(stagedTempFile)) {
            unlinkSync(stagedTempFile);
          }
        },
      });
    }, /injected mid-transaction rollback failure/);

    // Assert that temporary file was cleaned up
    assert.equal(rollbackCleanupInvoked, true);
    assert.equal(existsSync(stagedTempFile), false, "Staged file on disk must be removed by rollback cleanup");

    // Assert complete rollback: no batch rows, orphan tags, or partial materials remain
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM study_materials WHERE id IN ('saved-first-part', 'fail-second-part')").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM material_split_lineage WHERE material_id IN ('saved-first-part', 'fail-second-part')").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM material_tags WHERE material_id IN ('saved-first-part', 'fail-second-part')").get().c, 0);

    // Remove trigger to allow subsequent valid operations
    db.exec("DROP TRIGGER injected_failure_on_second;");

    // 5. Successful valid batch save commits atomically
    const validSave = validateAndSaveSplitBatch(db, {
      parentMaterialId: parentId,
      expectedParentSha256: initialHash,
      currentParentBytes: initialParentBytes,
      tags: [{ tagId: "tag-valid", name: "Valid Split Tag" }],
      parts: [
        { id: "valid-p1", title: "Valid Part 1", sourcePageStart: 1, sourcePageEnd: 10 },
        { id: "valid-p2", title: "Valid Part 2", sourcePageStart: 11, sourcePageEnd: 20 },
      ],
    });
    assert.equal(validSave.ok, true);
    assert.equal(validSave.savedPartsCount, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM study_materials WHERE id IN ('valid-p1', 'valid-p2')").get().c, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM material_split_lineage WHERE material_id IN ('valid-p1', 'valid-p2')").get().c, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM material_tags WHERE material_id IN ('valid-p1', 'valid-p2')").get().c, 2);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 12: Acknowledged Save Followed by Failed Refresh
// --------------------------------------------------------------------------
test("Contract 12: Acknowledged Save Followed by Failed Refresh Guarantees Consistency", () => {
  const db = createDisposableLineageDb();
  try {
    const parentId = "parent-refresh-test";
    insertMaterial(db, { id: parentId, title: "Parent Material" });

    // Save batch successfully
    const saveResult = validateAndSaveSplitBatch(db, {
      parentMaterialId: parentId,
      parts: [
        { id: "part-ack-1", title: "Part 1", sourcePageStart: 1, sourcePageEnd: 25 },
        { id: "part-ack-2", title: "Part 2", sourcePageStart: 26, sourcePageEnd: 50 },
      ],
    });
    assert.equal(saveResult.ok, true);

    // Simulate failed UI refresh / network error after commit acknowledged:
    // Model boundary invokes idempotent reconcileFailedRefresh
    const reconciliation = reconcileFailedRefresh(db, {
      savedPartIds: ["part-ack-1", "part-ack-2"],
      expectedParentMaterialId: parentId,
    });

    assert.equal(reconciliation.reconciled, true);
    assert.equal(reconciliation.parts.length, 2);
    assert.equal(reconciliation.parts[0].id, "part-ack-1");
    assert.equal(reconciliation.parts[1].id, "part-ack-2");

    // Ensure no duplicate parts were created
    const totalParts = db.prepare("SELECT COUNT(*) AS c FROM study_materials WHERE id IN ('part-ack-1', 'part-ack-2')").get().c;
    assert.equal(totalParts, 2);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 13: Shipped Migrations 0001–0012 Faithful Schema Baseline
// --------------------------------------------------------------------------
test("Contract 13: Shipped Migrations 0001–0012 Faithful Schema Baseline", () => {
  const db = createDisposableLineageDb(false); // Shipped schema only, no migration 13
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);

    // Verify presence of all expected tables from shipped migrations 0001 - 0012
    const requiredTables = [
      "study_materials",
      "tags",
      "material_tags",
      "notes",
      "practice_tests",
      "practice_test_versions",
      "practice_test_items",
      "practice_attempts",
      "practice_responses",
      "practice_session_operations",
      "card_review_generations",
      "card_versions",
      "card_items",
      "card_review_state",
      "card_review_events",
      "card_review_operations",
    ];

    for (const t of requiredTables) {
      assert.ok(tables.includes(t), `Table ${t} from shipped migrations 0001–0012 must exist in baseline schema`);
    }

    // Lineage table must NOT exist prior to candidate migration 0013
    assert.equal(tables.includes("material_split_lineage"), false);

    // Verify migration version tracking
    const versions = db.prepare("SELECT version FROM _sqlx_migrations ORDER BY version ASC").all().map((r) => r.version);
    assert.deepEqual(versions, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 14: Retained Child History Lifecycle, Export/Reopen & Files (SL-R6)
// --------------------------------------------------------------------------
test("Contract 14: Disposable Schema Migration, Export/Reopen, and Synthetic File Preservation", () => {
  // Use distinct synthetic PDF files on disk for parent and child
  const parentPdfPath = join(scratchDir, `synthetic_parent_${Date.now()}.pdf`);
  const childPdfPath = join(scratchDir, `synthetic_child_${Date.now()}.pdf`);

  const parentBytes = Buffer.from("%PDF-1.4 %%EOF synthetic FAA parent handbook content\n".repeat(50));
  const childBytes = Buffer.from("%PDF-1.4 %%EOF synthetic split child part content\n".repeat(25));

  writeFileSync(parentPdfPath, parentBytes);
  writeFileSync(childPdfPath, childBytes);

  try {
    const parentFileHash = calculateSha256(parentBytes);
    const childFileHash = calculateSha256(childBytes);

    // Step 1: Initialize disposable DB at shipped schema 12
    const db = createDisposableLineageDb(false);
    insertMaterial(db, { id: "mat-parent", title: "Parent Handbook", filePath: parentPdfPath, fileSize: parentBytes.length });

    // Seed parent practice test version, item, attempt, response
    db.prepare(`
      INSERT INTO practice_test_versions (
        id, source_material_id, history_key, source_material_title, version_number,
        provider, model, title, content_hash, created_at, is_active
      ) VALUES ('ver-parent', 'mat-parent', 'hist-parent', 'Parent Handbook', 1, 'gemini', 'gemini-1.5-flash', 'Parent Quiz', 'hashP', '2026-10-08T08:00:00Z', 1)
    `).run();

    db.prepare(`
      INSERT INTO practice_test_items (
        id, version_id, ordinal, question_text, options_json, correct_index, explanation, source_page
      ) VALUES ('item-parent-1', 'ver-parent', 1, 'What is lift?', '["A","B","C"]', 0, 'Aerodynamic force', 10)
    `).run();

    db.prepare(`
      INSERT INTO practice_attempts (
        id, version_id, source_material_id, source_material_title, started_at, completed_at,
        status, total_questions, answered_count, correct_count, score_percent
      ) VALUES ('att-parent', 'ver-parent', 'mat-parent', 'Parent Handbook', '2026-10-08T08:01:00Z', '2026-10-08T08:15:00Z', 'completed', 1, 1, 1, 100.0)
    `).run();

    db.prepare(`
      INSERT INTO practice_responses (
        id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at
      ) VALUES ('resp-parent-1', 'att-parent', 'item-parent-1', 0, 0, 1, '2026-10-08T08:05:00Z')
    `).run();

    // Step 2: Apply candidate migration 0013
    db.exec(CANDIDATE_MIGRATION_0013_SQL);
    db.prepare("INSERT INTO _sqlx_migrations (version) VALUES (13)").run();
    db.prepare("INSERT INTO schema_migrations (version) VALUES (13)").run();

    // Step 3: Perform split operation to create retained child material
    insertMaterial(db, { id: "mat-child", title: "Child Section", filePath: childPdfPath, fileSize: childBytes.length });
    insertSplitLineage(db, {
      materialId: "mat-child",
      parentMaterialId: "mat-parent",
      rootMaterialId: "mat-parent",
      sourcePageStart: 1,
      sourcePageEnd: 50,
      sourceFileName: "parent.pdf",
      sourceTitle: "Parent Handbook",
      sourceContentSha256: parentFileHash,
      sourceTotalPages: 500,
    });

    // Step 4: Seed real practice and card histories owned by the RETAINED CHILD (SL-R6)
    // Child practice history:
    db.prepare(`
      INSERT INTO practice_test_versions (
        id, source_material_id, history_key, source_material_title, version_number,
        provider, model, title, content_hash, created_at, is_active
      ) VALUES ('ver-child', 'mat-child', 'hist-child', 'Child Section', 1, 'gemini', 'gemini-1.5-flash', 'Child Quiz', 'hashC', '2026-10-08T09:00:00Z', 1)
    `).run();

    db.prepare(`
      INSERT INTO practice_test_items (
        id, version_id, ordinal, question_text, options_json, correct_index, explanation, source_page
      ) VALUES ('item-child-1', 'ver-child', 1, 'What is drag?', '["X","Y","Z"]', 1, 'Resistance force', 5)
    `).run();

    db.prepare(`
      INSERT INTO practice_attempts (
        id, version_id, source_material_id, source_material_title, started_at, completed_at,
        status, total_questions, answered_count, correct_count, score_percent
      ) VALUES ('att-child', 'ver-child', 'mat-child', 'Child Section', '2026-10-08T09:05:00Z', '2026-10-08T09:20:00Z', 'completed', 1, 1, 1, 100.0)
    `).run();

    db.prepare(`
      INSERT INTO practice_responses (
        id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at
      ) VALUES ('resp-child-1', 'att-child', 'item-child-1', 1, 0, 1, '2026-10-08T09:10:00Z')
    `).run();

    // Child card review history:
    db.prepare(`
      INSERT INTO card_versions (
        id, source_material_id, content_hash, card_count, provider, created_at, is_active
      ) VALUES ('cardver-child', 'mat-child', 'cardhashC', 1, 'gemini', '2026-10-08T09:00:00Z', 1)
    `).run();

    db.prepare(`
      INSERT INTO card_items (
        id, version_id, ordinal, front, back, source_page
      ) VALUES ('carditem-child-1', 'cardver-child', 0, 'Parasite Drag vs Induced Drag', 'Explanation of drag types', 5)
    `).run();

    db.prepare(`
      INSERT INTO card_review_state (
        item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, revision
      ) VALUES ('carditem-child-1', 'mat-child', 'v1', 1, '2026-10-09T09:00:00Z', '2026-10-08T09:15:00Z', 1, 0, 0, 1)
    `).run();

    db.prepare(`
      INSERT INTO card_review_events (
        id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json
      ) VALUES ('cardev-child-1', 'carditem-child-1', 0, 'good', '2026-10-08T09:15:00Z', 'v1', '{"step":0}', '{"step":1}')
    `).run();

    // Step 5: Delete parent material
    db.prepare("DELETE FROM study_materials WHERE id = 'mat-parent'").run();

    // Verify parent's attempt preserved with source_material_id set to null (SET NULL transition)
    const parentAttempt = db.prepare("SELECT * FROM practice_attempts WHERE id = 'att-parent'").get();
    assert.ok(parentAttempt);
    assert.equal(parentAttempt.source_material_id, null, "Parent attempt source_material_id transitioned to NULL");
    assert.equal(parentAttempt.score_percent, 100.0);

    // Verify parent's response preserved
    const parentResponse = db.prepare("SELECT * FROM practice_responses WHERE id = 'resp-parent-1'").get();
    assert.ok(parentResponse);

    // Step 6: Verify retained child material, lineage, practice & card histories survive intact
    const childMaterial = db.prepare("SELECT * FROM study_materials WHERE id = 'mat-child'").get();
    assert.ok(childMaterial);
    assert.equal(childMaterial.title, "Child Section");

    const childLineage = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = 'mat-child'").get();
    assert.ok(childLineage);
    assert.equal(childLineage.parent_material_id, null, "Parent material id was set to null on parent deletion");
    assert.equal(childLineage.source_page_start, 1);
    assert.equal(childLineage.source_page_end, 50);

    const childAttempt = db.prepare("SELECT * FROM practice_attempts WHERE id = 'att-child'").get();
    assert.ok(childAttempt);
    assert.equal(childAttempt.source_material_id, "mat-child", "Child attempt still references mat-child");
    assert.equal(childAttempt.score_percent, 100.0);

    const childCardState = db.prepare("SELECT * FROM card_review_state WHERE item_id = 'carditem-child-1'").get();
    assert.ok(childCardState);
    assert.equal(childCardState.source_material_id, "mat-child");
    assert.equal(childCardState.reps, 1);

    const childCardEvent = db.prepare("SELECT * FROM card_review_events WHERE id = 'cardev-child-1'").get();
    assert.ok(childCardEvent);
    assert.equal(childCardEvent.rating, "good");

    // Step 7: Verify distinct synthetic PDF files on disk remain unaltered
    assert.equal(calculateSha256(readFileSync(parentPdfPath)), parentFileHash, "Parent PDF file unaltered");
    assert.equal(calculateSha256(readFileSync(childPdfPath)), childFileHash, "Child PDF file unaltered");

    // Step 8: Database export & reopen simulation (VACUUM INTO)
    const exportDbPath = join(scratchDir, `exported_round2_${Date.now()}.db`);
    try {
      db.exec(`VACUUM INTO '${exportDbPath}';`);
      db.close();

      const reopened = new DatabaseSync(exportDbPath);
      try {
        const reopenedChild = reopened.prepare("SELECT * FROM study_materials WHERE id = 'mat-child'").get();
        assert.ok(reopenedChild);

        const reopenedLineage = reopened.prepare("SELECT * FROM material_split_lineage WHERE material_id = 'mat-child'").get();
        assert.ok(reopenedLineage);
        assert.equal(reopenedLineage.source_content_sha256, parentFileHash);

        const reopenedChildAttempt = reopened.prepare("SELECT * FROM practice_attempts WHERE id = 'att-child'").get();
        assert.ok(reopenedChildAttempt);
        assert.equal(reopenedChildAttempt.score_percent, 100.0);

        const reopenedChildCard = reopened.prepare("SELECT * FROM card_review_state WHERE item_id = 'carditem-child-1'").get();
        assert.ok(reopenedChildCard);
        assert.equal(reopenedChildCard.reps, 1);

        const reopenedParentAttempt = reopened.prepare("SELECT * FROM practice_attempts WHERE id = 'att-parent'").get();
        assert.ok(reopenedParentAttempt);
        assert.equal(reopenedParentAttempt.source_material_id, null);
      } finally {
        reopened.close();
      }
    } finally {
      if (existsSync(exportDbPath)) unlinkSync(exportDbPath);
    }
  } finally {
    if (existsSync(parentPdfPath)) unlinkSync(parentPdfPath);
    if (existsSync(childPdfPath)) unlinkSync(childPdfPath);
  }
});

// --------------------------------------------------------------------------
// Contract 15: Restore Simulation Distinguishes Numeric Check from Native Validator
// --------------------------------------------------------------------------
test("Contract 15: Restore Simulation Distinguishes Numeric Check from Native Validator", () => {
  // Explicitly note: This test verifies the numeric boundary logic simulating
  // src-tauri/src/backup.rs:631 without claiming that a native binary with schema 13 exists.
  // The existing native backup validation test suite in backup.rs has already been verified
  // and accepted for current shipped schemas 1..12.
  assert.equal(simulateOlderBinaryNumericCheck(12).allowed, true);
  assert.equal(simulateOlderBinaryNumericCheck(11).allowed, true);
  assert.equal(simulateOlderBinaryNumericCheck(1).allowed, true);

  const refused13 = simulateOlderBinaryNumericCheck(13);
  assert.equal(refused13.allowed, false);
  assert.match(refused13.reason, /exceeds maximum supported version 12/);

  const refused99 = simulateOlderBinaryNumericCheck(99);
  assert.equal(refused99.allowed, false);
});

// --------------------------------------------------------------------------
// Contract 16: Explicit Page Bounds and Storage Limit Specification
// --------------------------------------------------------------------------
test("Contract 16: Explicit Page Bounds and Storage Limit Specification", () => {
  // Verifies engine bounds:
  // JavaScript IEEE 754 safe integer limit
  assert.equal(Number.isSafeInteger(Number.MAX_SAFE_INTEGER), true);
  assert.equal(Number.isSafeInteger(Number.MAX_SAFE_INTEGER + 1), false);

  // SQLite INTEGER affinity handles signed 64-bit integers
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE test_int (val INTEGER);");
    db.prepare("INSERT INTO test_int VALUES (?)").run(9007199254740991); // 2^53 - 1
    const row = db.prepare("SELECT val FROM test_int").get();
    assert.equal(row.val, 9007199254740991);
  } finally {
    db.close();
  }

  // Contract maps bounds explicitly without guessing
  assert.throws(() => mapChildPageToSource(1, 1, { sourcePageEnd: 0 }), /sourcePageEnd must be an integer >= sourcePageStart/);
});
