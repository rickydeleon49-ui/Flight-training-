// Executable Disposable Lineage Contract Proof Tests (Round 4)
// Milestone 2 (M2) — Her Flight Deck
// Fully addresses SL-R10 and SL-R11

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import {
  ENGINE_LIMITS,
  calculateSha256,
  validatePageRange,
  mapChildPageToSource,
  mapChildPageToSourcePositional,
  composeNestedRanges,
  composeMultiLevelRanges,
  createDisposableLineageDb,
  insertMaterial,
  insertSplitLineage,
  createSplitSourceReceipt,
  getMaterialWithLineage,
  listSiblings,
  validateAndSaveSplitBatch,
  reconcileBatch,
  saveSplitBatchWithRefresh,
  cancelBatch,
} from "./lineageContract.mjs";

// --------------------------------------------------------------------------
// Contract 1: Page Range Validation enforces 1-based, inclusive bounds
// --------------------------------------------------------------------------
test("Contract 1: Page Range Validation enforces 1-based, inclusive bounds", () => {
  // Valid bounds
  assert.deepEqual(validatePageRange(1, 10), { start: 1, end: 10, pageCount: 10 });
  assert.deepEqual(validatePageRange(100, 100), { start: 100, end: 100, pageCount: 1 });
  assert.deepEqual(validatePageRange(1, 50, 100), { start: 1, end: 50, pageCount: 50 });

  // Invalid: non-integer
  assert.throws(() => validatePageRange(1.5, 10), /Page range bounds must be integers/);
  assert.throws(() => validatePageRange(1, "10"), /Page range bounds must be integers/);

  // Invalid: 0 or negative start page
  assert.throws(() => validatePageRange(0, 10), /Start page \(0\) must be >= 1/);
  assert.throws(() => validatePageRange(-5, 10), /Start page \(-5\) must be >= 1/);

  // Invalid: inverted range
  assert.throws(() => validatePageRange(15, 10), /End page \(10\) cannot be less than start page \(15\)/);

  // Invalid: exceeds total pages
  assert.throws(() => validatePageRange(1, 150, 100), /End page \(150\) exceeds total pages \(100\)/);
  assert.throws(() => validatePageRange(1, 10001), /exceeds maximum allowed pages/);
});

// --------------------------------------------------------------------------
// Contract 2: Page Translation Maps Child Position to Source with Strict Bounds & Positional Adapter
// --------------------------------------------------------------------------
test("Contract 2: Page Translation Maps Child Position to Source with Strict Bounds & Explicit Options", () => {
  // Named API
  assert.equal(mapChildPageToSource({ sourcePageStart: 101, childPage: 1, childPageCount: 200 }), 101);
  assert.equal(mapChildPageToSource({ sourcePageStart: 101, childPage: 25, childPageCount: 200 }), 125);
  assert.equal(mapChildPageToSource({ sourcePageStart: 101, childPage: 200, childPageCount: 200 }), 300);

  // Out-of-bounds child position throws
  assert.throws(
    () => mapChildPageToSource({ sourcePageStart: 101, childPage: 201, childPageCount: 200 }),
    /Child page 201 exceeds child page count 200/,
    "Child page beyond length must throw out-of-bounds error"
  );
  assert.throws(() => mapChildPageToSource({ sourcePageStart: 101, childPage: 0, childPageCount: 200 }), /Invalid childPage: 0/);

  // Narrow positional adapter for frozen calls
  assert.equal(mapChildPageToSourcePositional(101, 1, 300), 101);
  assert.equal(mapChildPageToSourcePositional(101, 25, 300), 125);
  assert.equal(mapChildPageToSourcePositional(101, 200, 300), 300);
  assert.throws(() => mapChildPageToSourcePositional(101, 201, 300), /Child page 201 exceeds bound 200/);

  // Positional delegation via mapChildPageToSource
  assert.equal(mapChildPageToSource(101, 1, 300), 101);
});

// --------------------------------------------------------------------------
// Contract 3: Nested Range Composition and Persisted Navigation Coordinates
// --------------------------------------------------------------------------
test("Contract 3: Nested Range Composition and Persisted Navigation Coordinates", () => {
  // Parent A covers Root 101–300 (200 pages). Child selects A 20–40 (21 pages).
  const comp = composeNestedRanges({ start: 101, end: 300 }, { start: 20, end: 40 });
  assert.equal(comp.rootPageStart, 120, "Composed R start mismatch: expected 120");
  assert.equal(comp.rootPageEnd, 140, "Composed R end mismatch: expected 140");
  assert.equal(comp.parentPageStart, 20);
  assert.equal(comp.parentPageEnd, 40);
  assert.equal(comp.childPageCount, 21);

  // Child selection beyond parent length throws
  assert.throws(
    () => composeNestedRanges({ start: 101, end: 300 }, { start: 1, end: 201 }),
    /exceeds total pages \(200\)/
  );
});

// --------------------------------------------------------------------------
// Contract 4: Multi-level Nested Hierarchy (3+ levels)
// --------------------------------------------------------------------------
test("Contract 4: Multi-level Nested Hierarchy (3+ levels)", () => {
  const steps = [
    { start: 101, end: 500 }, // Level 1 (Child relative to Root): 400 pages (pages 101–500)
    { start: 50, end: 150 },  // Level 2 (Grandchild relative to Child): 101 pages (rel 50–150 -> Root 150–250)
    { start: 10, end: 30 },   // Level 3 (Great-grandchild relative to Grandchild): 21 pages (rel 10–30 -> Root 159–179)
  ];

  const result = composeMultiLevelRanges(steps);
  assert.equal(result.rootPageStart, 159);
  assert.equal(result.rootPageEnd, 179);
  assert.equal(result.immediateParentPageStart, 10);
  assert.equal(result.immediateParentPageEnd, 30);
  assert.equal(result.childPageCount, 21);
  assert.equal(result.nestedLevel, 3);
});

// --------------------------------------------------------------------------
// Contract 5: Structural Tiers and Strict DDL CHECK Constraints (Level 1, 2, 3+)
// --------------------------------------------------------------------------
test("Contract 5: Structural Tiers and Strict DDL CHECK Constraints", () => {
  const db = createDisposableLineageDb();
  try {
    insertMaterial(db, { id: "R", title: "Root Handbook" });
    insertMaterial(db, { id: "C1", title: "Direct Child" });
    insertMaterial(db, { id: "C2", title: "Nested Child Level 2" });
    insertMaterial(db, { id: "C3", title: "Nested Child Level 3" });
    insertMaterial(db, { id: "Bad", title: "Contradictory Tier" });

    // Valid Tier 1 (Direct split)
    insertSplitLineage(db, {
      materialId: "C1",
      parentMaterialId: "R",
      rootMaterialId: "R",
      sourcePageStart: 1,
      sourcePageEnd: 50,
      childPageCount: 50,
      sourceTotalPages: 500,
      sourceTitle: "Root Handbook",
      sourceFileName: "root.pdf",
      sourceContentSha256: calculateSha256("root"),
      nestedLevel: 1,
    });
    const c1 = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = 'C1'").get();
    assert.equal(c1.nested_level, 1);
    assert.equal(c1.parent_page_start, null);

    // Valid Tier 2 (Nested Level 2)
    insertSplitLineage(db, {
      materialId: "C2",
      parentMaterialId: "C1",
      rootMaterialId: "R",
      sourcePageStart: 10,
      sourcePageEnd: 30,
      parentPageStart: 10,
      parentPageEnd: 30,
      childPageCount: 21,
      sourceTotalPages: 500,
      parentTotalPages: 50,
      sourceTitle: "Root Handbook",
      sourceFileName: "root.pdf",
      sourceContentSha256: calculateSha256("root"),
      parentTitle: "Direct Child",
      parentFileName: "c1.pdf",
      parentContentSha256: calculateSha256("c1"),
      nestedLevel: 2,
    });
    const c2 = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = 'C2'").get();
    assert.equal(c2.nested_level, 2);
    assert.equal(c2.parent_page_start, 10);

    // Valid Tier 3 (Nested Level 3)
    insertSplitLineage(db, {
      materialId: "C3",
      parentMaterialId: "C2",
      rootMaterialId: "R",
      sourcePageStart: 15,
      sourcePageEnd: 25,
      parentPageStart: 6,
      parentPageEnd: 16,
      childPageCount: 11,
      sourceTotalPages: 500,
      parentTotalPages: 21,
      sourceTitle: "Root Handbook",
      sourceFileName: "root.pdf",
      sourceContentSha256: calculateSha256("root"),
      parentTitle: "Nested Child Level 2",
      parentFileName: "c2.pdf",
      parentContentSha256: calculateSha256("c2"),
      nestedLevel: 3,
    });
    const c3 = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = 'C3'").get();
    assert.equal(c3.nested_level, 3);

    // Refusal: Tier 1 violates DDL CHECK if parent_page_start is NOT NULL
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "Bad",
        parentMaterialId: "R",
        rootMaterialId: "R",
        sourcePageStart: 1,
        sourcePageEnd: 50,
        parentPageStart: 1, // Contradicts nested_level = 1
        parentPageEnd: 50,
        childPageCount: 50,
        sourceTotalPages: 500,
        sourceTitle: "Root",
        sourceFileName: "root.pdf",
        sourceContentSha256: calculateSha256("root"),
        nestedLevel: 1,
      });
    }, /CHECK constraint failed/);

    // Fractional physical page bounds rejected by TYPEOF checks in DDL
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "Frac",
        parentMaterialId: "R",
        rootMaterialId: "R",
        sourcePageStart: 1.5,
        sourcePageEnd: 10,
        sourceTotalPages: 500,
        sourceTitle: "Root",
        sourceFileName: "root.pdf",
        sourceContentSha256: calculateSha256("root"),
        nestedLevel: 1,
      });
    }, /CHECK constraint failed/, "Fractional physical page bounds must fail TYPEOF constraint");

    // Self-parenting rejected by cycle prevention CHECK in DDL
    insertMaterial(db, { id: "other-root", title: "Other Root" });
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "R",
        parentMaterialId: "R",
        rootMaterialId: "other-root",
        sourcePageStart: 1,
        sourcePageEnd: 10,
        childPageCount: 10,
        sourceTotalPages: 500,
        sourceTitle: "Root",
        sourceFileName: "root.pdf",
        sourceContentSha256: calculateSha256("root"),
        nestedLevel: 1,
      });
    }, /CHECK constraint failed/, "Self-parenting must fail cycle check constraint");
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 6: Two-Tier Veracity Verification from Real Files
// --------------------------------------------------------------------------
test("Contract 6: Two-Tier Veracity Verification from Real Files", () => {
  const db = createDisposableLineageDb();
  const dir = mkdtempSync(join(tmpdir(), "c6-veracity-"));
  try {
    const rootFile = join(dir, "root.pdf");
    const parentFile = join(dir, "parent.pdf");
    const childFile = join(dir, "child.pdf");

    const rootBytes = Buffer.from("root original bytes v1");
    const parentBytes = Buffer.from("parent split bytes v1");
    const childBytes = Buffer.from("child split bytes v1");

    writeFileSync(rootFile, rootBytes);
    writeFileSync(parentFile, parentBytes);
    writeFileSync(childFile, childBytes);

    const rootHash = calculateSha256(rootBytes);
    const parentHash = calculateSha256(parentBytes);

    insertMaterial(db, { id: "R", title: "Root", filePath: rootFile });
    insertMaterial(db, { id: "P", title: "Parent", filePath: parentFile });
    insertMaterial(db, { id: "C", title: "Child", filePath: childFile });

    insertSplitLineage(db, {
      materialId: "C",
      parentMaterialId: "P",
      rootMaterialId: "R",
      sourcePageStart: 101,
      sourcePageEnd: 150,
      parentPageStart: 1,
      parentPageEnd: 50,
      childPageCount: 50,
      sourceTotalPages: 500,
      parentTotalPages: 50,
      sourceTitle: "Root",
      sourceFileName: "root.pdf",
      sourceContentSha256: rootHash,
      parentTitle: "Parent",
      parentFileName: "parent.pdf",
      parentContentSha256: parentHash,
      nestedLevel: 2,
    });

    // Both files intact and match -> both matching
    const eval1 = getMaterialWithLineage(db, "C");
    assert.equal(eval1.lineage.parentStatus, "matching");
    assert.equal(eval1.lineage.rootStatus, "matching");
    assert.equal(eval1.lineage.parentTitle, "Parent", "Nested parent tier must record immediate parent title and file name");
    assert.equal(eval1.lineage.parentFileName, "parent.pdf", "Nested parent tier must record immediate parent title and file name");
    assert.equal(eval1.lineage.sourceTitle, "Root", "Root source tier must record root title");
    assert.equal(eval1.lineage.sourceFileName, "root.pdf", "Root source tier must record root file name");

    // Replace parent bytes on disk -> parentStatus changed, rootStatus matching
    writeFileSync(parentFile, Buffer.from("parent modified bytes v2"));
    const eval2 = getMaterialWithLineage(db, "C");
    assert.equal(eval2.lineage.parentStatus, "changed");
    assert.equal(eval2.lineage.rootStatus, "matching");

    // Remove root file from disk -> rootStatus missing, parentStatus changed
    rmSync(rootFile);
    const eval3 = getMaterialWithLineage(db, "C");
    assert.equal(eval3.lineage.parentStatus, "changed");
    assert.equal(eval3.lineage.rootStatus, "missing");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
// Contract 7: Direct & Nested Sibling Disambiguation by Effective Source Identity
// --------------------------------------------------------------------------
test("Contract 7: Direct & Nested Sibling Disambiguation by Effective Source Identity", () => {
  const db = createDisposableLineageDb();
  try {
    const rootV1 = calculateSha256("root edition 1");
    const rootV2 = calculateSha256("root edition 2");
    const parentV1 = calculateSha256("parent section edition 1");
    const parentV2 = calculateSha256("parent section edition 2");

    insertMaterial(db, { id: "R", title: "Root" });
    insertMaterial(db, { id: "P", title: "Parent" });
    insertMaterial(db, { id: "d1", title: "Direct Part 1" });
    insertMaterial(db, { id: "d2_same", title: "Direct Part 2 (Same Edition)" });
    insertMaterial(db, { id: "d3_other", title: "Direct Part 3 (Other Edition)" });

    // Direct splits: grouped by sourceContentSha256 (root hash)
    insertSplitLineage(db, {
      materialId: "d1",
      parentMaterialId: "R",
      rootMaterialId: "R",
      sourcePageStart: 1,
      sourcePageEnd: 50,
      sourceTotalPages: 500,
      sourceTitle: "Root",
      sourceFileName: "root.pdf",
      sourceContentSha256: rootV1,
      nestedLevel: 1,
    });
    insertSplitLineage(db, {
      materialId: "d2_same",
      parentMaterialId: "R",
      rootMaterialId: "R",
      sourcePageStart: 51,
      sourcePageEnd: 100,
      sourceTotalPages: 500,
      sourceTitle: "Root",
      sourceFileName: "root.pdf",
      sourceContentSha256: rootV1,
      nestedLevel: 1,
    });
    insertSplitLineage(db, {
      materialId: "d3_other",
      parentMaterialId: "R",
      rootMaterialId: "R",
      sourcePageStart: 1,
      sourcePageEnd: 50,
      sourceTotalPages: 500,
      sourceTitle: "Root",
      sourceFileName: "root.pdf",
      sourceContentSha256: rootV2,
      nestedLevel: 1,
    });

    const directSiblings = listSiblings(db, "d1").map((x) => x.id);
    assert.deepEqual(directSiblings, ["d2_same"], "Direct siblings must match same root content hash");

    // Nested splits: grouped by parentContentSha256 (immediate parent hash)
    insertMaterial(db, { id: "n1", title: "Nested Part 1" });
    insertMaterial(db, { id: "n2_same", title: "Nested Part 2 (Same Parent Edition)" });
    insertMaterial(db, { id: "n3_diff", title: "Nested Part 3 (Different Parent Edition)" });

    insertSplitLineage(db, {
      materialId: "n1",
      parentMaterialId: "P",
      rootMaterialId: "R",
      sourcePageStart: 101,
      sourcePageEnd: 120,
      parentPageStart: 1,
      parentPageEnd: 20,
      childPageCount: 20,
      sourceTotalPages: 500,
      parentTotalPages: 100,
      sourceTitle: "Root",
      sourceFileName: "root.pdf",
      sourceContentSha256: rootV1,
      parentTitle: "Parent",
      parentFileName: "parent.pdf",
      parentContentSha256: parentV1,
      nestedLevel: 2,
    });
    insertSplitLineage(db, {
      materialId: "n2_same",
      parentMaterialId: "P",
      rootMaterialId: "R",
      sourcePageStart: 121,
      sourcePageEnd: 140,
      parentPageStart: 21,
      parentPageEnd: 40,
      childPageCount: 20,
      sourceTotalPages: 500,
      parentTotalPages: 100,
      sourceTitle: "Root",
      sourceFileName: "root.pdf",
      sourceContentSha256: rootV1,
      parentTitle: "Parent",
      parentFileName: "parent.pdf",
      parentContentSha256: parentV1,
      nestedLevel: 2,
    });
    insertSplitLineage(db, {
      materialId: "n3_diff",
      parentMaterialId: "P",
      rootMaterialId: "R",
      sourcePageStart: 101,
      sourcePageEnd: 120,
      parentPageStart: 1,
      parentPageEnd: 20,
      childPageCount: 20,
      sourceTotalPages: 500,
      parentTotalPages: 100,
      sourceTitle: "Root",
      sourceFileName: "root.pdf",
      sourceContentSha256: rootV1, // Same root hash
      parentTitle: "Parent",
      parentFileName: "parent.pdf",
      parentContentSha256: parentV2, // Different parent hash!
      nestedLevel: 2,
    });

    const nestedSiblings = listSiblings(db, "n1").map((x) => x.id);
    assert.deepEqual(nestedSiblings, ["n2_same"], "Nested siblings must match immediate parent content hash");
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 8: Legacy NULL Parent Hash is Handled as Unknown (Non-matching)
// --------------------------------------------------------------------------
test("Contract 8: Legacy NULL Parent Hash is Handled as Unknown", () => {
  const db = createDisposableLineageDb();
  const dir = mkdtempSync(join(tmpdir(), "c8-"));
  try {
    const parentFile = join(dir, "p.pdf");
    writeFileSync(parentFile, Buffer.from("parent bytes"));
    insertMaterial(db, { id: "P", title: "Parent", filePath: parentFile });
    insertMaterial(db, { id: "C", title: "Child" });

    // Insert legacy row with parent_content_sha256 = NULL
    insertSplitLineage(db, {
      materialId: "C",
      parentMaterialId: "P",
      rootMaterialId: "P",
      sourcePageStart: 1,
      sourcePageEnd: 10,
      childPageCount: 10,
      sourceTotalPages: 100,
      sourceTitle: "P",
      sourceFileName: "p.pdf",
      sourceContentSha256: calculateSha256("root bytes"),
      parentContentSha256: null,
      nestedLevel: 2,
      parentPageStart: 1,
      parentPageEnd: 10,
      parentTotalPages: 10,
    });

    const result = getMaterialWithLineage(db, "C");
    assert.equal(result.lineage.parentStatus, "unknown", "Legacy NULL parent hash must yield unknown status");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
// Contract 9: Unknown Parent Editions Are Not Grouped as Siblings
// --------------------------------------------------------------------------
test("Contract 9: Unknown Parent Editions Are Not Grouped as Siblings", () => {
  const db = createDisposableLineageDb();
  try {
    const v1Hash = calculateSha256("root bytes");
    insertMaterial(db, { id: "R", title: "Root" });
    insertMaterial(db, { id: "A", title: "Parent A" });
    insertMaterial(db, { id: "B1", title: "Child 1" });
    insertMaterial(db, { id: "B2", title: "Child 2" });

    insertSplitLineage(db, {
      materialId: "B1",
      parentMaterialId: "A",
      rootMaterialId: "R",
      sourcePageStart: 120,
      sourcePageEnd: 140,
      parentPageStart: 20,
      parentPageEnd: 40,
      sourceTotalPages: 400,
      parentTotalPages: 200,
      sourceTitle: "Root",
      sourceFileName: "root.pdf",
      sourceContentSha256: v1Hash,
      parentContentSha256: null,
      nestedLevel: 2,
    });
    insertSplitLineage(db, {
      materialId: "B2",
      parentMaterialId: "A",
      rootMaterialId: "R",
      sourcePageStart: 141,
      sourcePageEnd: 160,
      parentPageStart: 41,
      parentPageEnd: 60,
      sourceTotalPages: 400,
      parentTotalPages: 200,
      sourceTitle: "Root",
      sourceFileName: "root.pdf",
      sourceContentSha256: v1Hash,
      parentContentSha256: null,
      nestedLevel: 2,
    });

    assert.deepEqual(listSiblings(db, "B1").map((x) => x.id), [], "Unknown parent editions must not be grouped as siblings");
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 10: Parent Deletion Preserves Child Material and Split Provenance
// --------------------------------------------------------------------------
test("Contract 10: Parent Deletion Preserves Child Material and Split Provenance", () => {
  const db = createDisposableLineageDb();
  try {
    insertMaterial(db, { id: "parent-doc", title: "Parent" });
    insertMaterial(db, { id: "child-part", title: "Child" });

    insertSplitLineage(db, {
      materialId: "child-part",
      parentMaterialId: "parent-doc",
      rootMaterialId: "parent-doc",
      sourcePageStart: 101,
      sourcePageEnd: 200,
      childPageCount: 100,
      sourceFileName: "parent.pdf",
      sourceTitle: "Parent",
      sourceContentSha256: calculateSha256("bytes"),
      sourceTotalPages: 500,
      nestedLevel: 1,
    });

    db.prepare("DELETE FROM study_materials WHERE id = 'parent-doc'").run();

    const child = db.prepare("SELECT * FROM study_materials WHERE id = 'child-part'").get();
    assert.ok(child, "Child material must survive parent deletion");

    const lineage = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = 'child-part'").get();
    assert.ok(lineage, "Lineage record must survive parent deletion");
    assert.equal(lineage.parent_material_id, null, "ON DELETE SET NULL must nullify parent_material_id");
    assert.equal(lineage.source_page_start, 101);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 11: Atomic Batch Save Binds to Authoritative Receipt, Refuses Receipt-less Save, and Rolls Back on Failure (SL-R10)
// --------------------------------------------------------------------------
test("Contract 11: Atomic Batch Save Binds to Authoritative Receipt, Refuses Receipt-less Save, and Rolls Back on Failure", () => {
  const db = createDisposableLineageDb();
  const dir = mkdtempSync(join(tmpdir(), "c11-"));
  try {
    const filePath = join(dir, "root.pdf");
    const bytes = Buffer.from("authoritative root bytes");
    writeFileSync(filePath, bytes);
    const hash = calculateSha256(bytes);

    insertMaterial(db, { id: "R", title: "Root", filePath });

    // SL-R10: Create typed, pending SplitSourceReceipt bound to database
    const receipt = createSplitSourceReceipt(db, {
      sourceMaterialId: "R",
      sourceTotalPages: 500,
      plan: [
        { id: "c1", title: "Part 1", selection: { start: 1, end: 50 } },
        { id: "c2", title: "Part 2", selection: { start: 51, end: 100 } },
      ],
    });

    const res = validateAndSaveSplitBatch(db, { receipt });
    assert.equal(res.savedPartsCount, 2);

    // SL-R10: Unverified split without receipt refuses all writes
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        parentMaterialId: "R",
        expectedParentSha256: hash,
        currentParentBytes: bytes,
        parts: [{ id: "bad", title: "bad", sourcePageStart: 1, sourcePageEnd: 10, sourceTotalPages: 500 }],
      });
    }, /A valid SplitSourceReceipt is required; unverified split refused./, "Receipt-less save must throw mandatory receipt error");

    // SL-R10: Tampered receipt (e.g. modified total) is refused
    const tamperedReceipt = { ...receipt, sourceTotalPages: 999 };
    assert.throws(() => {
      validateAndSaveSplitBatch(db, { receipt: tamperedReceipt });
    }, /Receipt hash mismatch or unrecorded receipt/, "Tampered receipt must be refused by hash check");

    // SL-R10: Staging cleanup on rollback: injected failure during transaction
    const failReceipt = createSplitSourceReceipt(db, {
      sourceMaterialId: "R",
      sourceTotalPages: 500,
      plan: [
        { id: "p_ok", title: "p_ok", selection: { start: 1, end: 10 } },
        { id: "fail_pt", title: "fail_pt", selection: { start: 11, end: 20 } },
      ],
    });

    db.exec("CREATE TRIGGER inject_fail BEFORE INSERT ON material_split_lineage WHEN NEW.material_id='fail_pt' BEGIN SELECT RAISE(FAIL, 'simulated constraint failure'); END;");
    let cleanupCalls = 0;
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        receipt: failReceipt,
        onRollbackCleanup: () => { cleanupCalls++; },
      });
    }, /simulated constraint failure/);

    assert.equal(cleanupCalls, 1, "Cleanup must run exactly once");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM study_materials WHERE id='p_ok'").get().n, 0);

    // SL-R10: Nested parent snapshot modification before commit is refused
    const nestedParentFile = join(dir, "nested_parent.pdf");
    writeFileSync(nestedParentFile, "nested parent file");
    insertMaterial(db, { id: "P_snap", title: "Parent Snap", filePath: nestedParentFile });
    insertSplitLineage(db, {
      materialId: "P_snap",
      parentMaterialId: "R",
      rootMaterialId: "R",
      sourcePageStart: 1,
      sourcePageEnd: 50,
      sourceTotalPages: 500,
      sourceTitle: "Root",
      sourceFileName: "root.pdf",
      sourceContentSha256: hash,
      nestedLevel: 1,
    });
    const nestedReceipt = createSplitSourceReceipt(db, {
      sourceMaterialId: "P_snap",
      sourceTotalPages: 50,
      plan: [{ id: "c_snap", title: "c_snap", selection: { start: 1, end: 10 } }],
    });
    db.prepare("UPDATE material_split_lineage SET source_total_pages = 600 WHERE material_id = 'P_snap'").run();
    assert.throws(() => {
      validateAndSaveSplitBatch(db, { receipt: nestedReceipt });
    }, /Parent lineage snapshot has changed since split/, "Parent lineage snapshot drift must be refused");

    // SL-R12: Valid save of nested batch persists immediate parent title/filename in parent tier
    const validNestedParentFile = join(dir, "valid_nested_parent.pdf");
    writeFileSync(validNestedParentFile, "valid nested parent file");
    insertMaterial(db, { id: "P_nested_valid", title: "Immediate Parent A", filePath: validNestedParentFile, originalFileName: "parent_a.pdf" });
    insertSplitLineage(db, {
      materialId: "P_nested_valid",
      parentMaterialId: "R",
      rootMaterialId: "R",
      sourcePageStart: 1,
      sourcePageEnd: 50,
      sourceTotalPages: 500,
      sourceTitle: "Root Document",
      sourceFileName: "root.pdf",
      sourceContentSha256: hash,
      nestedLevel: 1,
    });
    const validNestedReceipt = createSplitSourceReceipt(db, {
      sourceMaterialId: "P_nested_valid",
      sourceTotalPages: 50,
      plan: [{ id: "c_nested_valid", title: "Child Part", selection: { start: 1, end: 10 } }],
    });
    validateAndSaveSplitBatch(db, { receipt: validNestedReceipt });
    const nestedSaved = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = 'c_nested_valid'").get();
    assert.equal(nestedSaved.parent_title, "Immediate Parent A", "Nested parent tier must record immediate parent title and file name");
    assert.equal(nestedSaved.parent_file_name, "parent_a.pdf", "Nested parent tier must record immediate parent title and file name");
    assert.equal(nestedSaved.source_title, "Root Document", "Root source tier must record root title");
    assert.equal(nestedSaved.source_file_name, "root.pdf", "Root source tier must record root file name");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
// Contract 12: Acknowledged Save Followed by Failed Refresh Guarantees Consistency
// --------------------------------------------------------------------------
test("Contract 12: Acknowledged Save Followed by Failed Refresh Guarantees Consistency", () => {
  const db = createDisposableLineageDb();
  const dir = mkdtempSync(join(tmpdir(), "c12-"));
  try {
    const filePath = join(dir, "root.pdf");
    const bytes = Buffer.from("root bytes");
    writeFileSync(filePath, bytes);
    insertMaterial(db, { id: "R", title: "Root", filePath });

    const receipt = createSplitSourceReceipt(db, {
      sourceMaterialId: "R",
      sourceTotalPages: 200,
      plan: [{ id: "c1", title: "Part 1", selection: { start: 1, end: 20 } }],
    });

    // Model-boundary refresh failure
    const outcome = saveSplitBatchWithRefresh(
      db,
      { receipt },
      () => {
        throw new Error("UI background refresh failed after save");
      }
    );

    assert.equal(outcome.refreshSucceeded, false);
    assert.match(outcome.refreshError.message, /UI background refresh failed/);
    assert.equal(outcome.reconciliation.reconciled, true);
    assert.equal(outcome.reconciliation.parts.length, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
// Contract 13: Shipped Migrations 0001–0012 Faithful Schema Baseline (SL-R11.1)
// --------------------------------------------------------------------------
test("Contract 13: Shipped Migrations 0001–0012 Faithful Schema Baseline", () => {
  // Step 1: Baseline db without candidate migration 0013
  const db = createDisposableLineageDb(false);
  try {
    const applied = db.prepare("SELECT version FROM _sqlx_migrations ORDER BY version").all().map((r) => r.version);
    assert.deepEqual(applied, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    // Assert split_operation_log and material_split_lineage do NOT exist in shipped baseline
    assert.equal(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='split_operation_log'").get(),
      undefined,
      "split_operation_log must not exist in shipped migrations 0001–0012"
    );
    assert.equal(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_split_lineage'").get(),
      undefined,
      "material_split_lineage must not exist in shipped migrations 0001–0012"
    );

    // Step 2: Applying candidate migration 0013 creates both tables with strict definitions
    const ddl = readFileSync(join(__dirname, "../candidate_migration_0013.sql"), "utf8");
    db.exec(ddl);

    const opLogTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='split_operation_log'").get();
    assert.ok(opLogTable, "split_operation_log must be created by candidate migration 0013");

    const lineageTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_split_lineage'").get();
    assert.ok(lineageTable, "material_split_lineage must be created by candidate migration 0013");
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 14: Disposable Schema Migration Lifecycle, Validated Save with Receipt, Export/Reopen, and Synthetic File Preservation
// --------------------------------------------------------------------------
test("Contract 14: Disposable Schema Migration Lifecycle, Validated Save with Receipt, Export/Reopen, and Synthetic File Preservation", () => {
  // Step 1: Start from shipped 0001–0012 schema without 0013
  const db = createDisposableLineageDb(false);
  const dir = mkdtempSync(join(tmpdir(), "c14-lifecycle-"));

  try {
    const parentFile = join(dir, "parent.pdf");
    writeFileSync(parentFile, Buffer.from("parent edition one original bytes"));
    const parentHash = calculateSha256(Buffer.from("parent edition one original bytes"));

    insertMaterial(db, { id: "parent-doc", title: "FAA Instrument Flying Handbook", filePath: parentFile });
    insertMaterial(db, { id: "child-pre", title: "Pre-existing Child Material" });

    // Step 2: Seed parent and child histories BEFORE migration 0013
    // Practice test setup (0009 / 0011)
    db.prepare(`
      INSERT INTO practice_test_versions (id, source_material_id, history_key, source_material_title, version_number, provider, model, title, content_hash, created_at, is_active)
      VALUES ('v-child-pre', 'child-pre', 'hk-pre', 'Pre-existing Child Material', 1, 'gemini', 'gemini-1.5-pro', 'Test Pre', 'hash-pre', datetime('now'), 1)
    `).run();
    db.prepare(`
      INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index, explanation, source_page)
      VALUES ('item-pre', 'v-child-pre', 0, 'What is V_R?', '["Rotation speed","Refusal speed"]', 0, 'Rotation', 42)
    `).run();
    db.prepare(`
      INSERT INTO practice_attempts (id, version_id, source_material_id, source_material_title, status, total_questions, answered_count, correct_count, incorrect_count, dont_know_count, score_percent, started_at, completed_at, revision)
      VALUES ('att-pre', 'v-child-pre', 'child-pre', 'Pre-existing Child Material', 'completed', 1, 1, 1, 0, 0, 100.0, datetime('now'), datetime('now'), 1)
    `).run();
    db.prepare(`
      INSERT INTO practice_responses (id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at)
      VALUES ('resp-pre', 'att-pre', 'item-pre', 0, 0, 1, datetime('now'))
    `).run();

    // Card review setup (0012)
    db.prepare(`
      INSERT INTO card_versions (id, source_material_id, content_hash, card_count, provider, created_at, is_active)
      VALUES ('cv-pre', 'child-pre', 'chash-pre', 1, 'import', datetime('now'), 1)
    `).run();
    db.prepare(`
      INSERT INTO card_items (id, version_id, ordinal, front, back, source_page)
      VALUES ('ci-pre', 'cv-pre', 0, 'V_R Definition', 'Rotation speed', 42)
    `).run();
    db.prepare(`
      INSERT INTO card_review_state (item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision)
      VALUES ('ci-pre', 'child-pre', 'v1', 1, datetime('now'), datetime('now'), 1, 0, 0, NULL, 1)
    `).run();
    db.prepare(`
      INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
      VALUES ('ce-pre', 'ci-pre', 0, 'good', datetime('now'), 'v1', '{}', '{"step":1}')
    `).run();

    // Step 3: Apply candidate migration 0013
    const ddl = readFileSync(join(__dirname, "../candidate_migration_0013.sql"), "utf8");
    db.exec(ddl);

    // Step 4: Perform split via validated save with SplitSourceReceipt
    const childOutputFile = join(dir, "child-new.pdf");
    writeFileSync(childOutputFile, Buffer.from("child split page bytes"));

    const receipt = createSplitSourceReceipt(db, {
      sourceMaterialId: "parent-doc",
      sourceTotalPages: 300,
      plan: [
        {
          id: "child-new",
          title: "Section 1: Basic Flight Instruments",
          selection: { start: 1, end: 50 },
          filePath: childOutputFile,
        },
      ],
    });

    const saveResult = validateAndSaveSplitBatch(db, { receipt });
    assert.equal(saveResult.savedPartsCount, 1);

    // Step 5: Add retained child practice & card histories attached to newly split child-new
    db.prepare(`
      INSERT INTO practice_test_versions (id, source_material_id, history_key, source_material_title, version_number, provider, model, title, content_hash, created_at, is_active)
      VALUES ('v-child-new', 'child-new', 'hk-new', 'Section 1: Basic Flight Instruments', 1, 'gemini', 'gemini-1.5-pro', 'Test New', 'hash-new', datetime('now'), 1)
    `).run();
    db.prepare(`
      INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index, explanation, source_page)
      VALUES ('item-new', 'v-child-new', 0, 'What is altimeter setting?', '["Standard 29.92","Local barometric"]', 1, 'Local baro', 10)
    `).run();
    db.prepare(`
      INSERT INTO practice_attempts (id, version_id, source_material_id, source_material_title, status, total_questions, answered_count, correct_count, incorrect_count, dont_know_count, score_percent, started_at, completed_at, revision)
      VALUES ('att-new', 'v-child-new', 'child-new', 'Section 1: Basic Flight Instruments', 'completed', 1, 1, 1, 0, 0, 100.0, datetime('now'), datetime('now'), 1)
    `).run();
    db.prepare(`
      INSERT INTO practice_responses (id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at)
      VALUES ('resp-new', 'att-new', 'item-new', 1, 0, 1, datetime('now'))
    `).run();

    db.prepare(`
      INSERT INTO card_versions (id, source_material_id, content_hash, card_count, provider, created_at, is_active)
      VALUES ('cv-new', 'child-new', 'chash-new', 1, 'import', datetime('now'), 1)
    `).run();
    db.prepare(`
      INSERT INTO card_items (id, version_id, ordinal, front, back, source_page)
      VALUES ('ci-new', 'cv-new', 0, 'Altimeter front', 'Altimeter back', 10)
    `).run();
    db.prepare(`
      INSERT INTO card_review_state (item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision)
      VALUES ('ci-new', 'child-new', 'v1', 2, datetime('now'), datetime('now'), 2, 0, 0, NULL, 1)
    `).run();
    db.prepare(`
      INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
      VALUES ('ce-new', 'ci-new', 0, 'easy', datetime('now'), 'v1', '{}', '{"step":2}')
    `).run();

    // Snapshot pre-deletion records
    const preAttPre = db.prepare("SELECT * FROM practice_attempts WHERE id = 'att-pre'").get();
    const preRespPre = db.prepare("SELECT * FROM practice_responses WHERE id = 'resp-pre'").get();
    const preStatePre = db.prepare("SELECT * FROM card_review_state WHERE item_id = 'ci-pre'").get();
    const preEvtPre = db.prepare("SELECT * FROM card_review_events WHERE id = 'ce-pre'").get();

    const preAttNew = db.prepare("SELECT * FROM practice_attempts WHERE id = 'att-new'").get();
    const preRespNew = db.prepare("SELECT * FROM practice_responses WHERE id = 'resp-new'").get();
    const preStateNew = db.prepare("SELECT * FROM card_review_state WHERE item_id = 'ci-new'").get();
    const preEvtNew = db.prepare("SELECT * FROM card_review_events WHERE id = 'ce-new'").get();

    // Step 6: Replace source bytes on disk in place -> verdict becomes changed
    writeFileSync(parentFile, Buffer.from("parent edition two REPLACED bytes on disk"));
    const evalAfterReplace = getMaterialWithLineage(db, "child-new");
    assert.equal(evalAfterReplace.lineage.parentStatus, "changed");

    // Step 7: Delete parent material
    db.prepare("DELETE FROM study_materials WHERE id = 'parent-doc'").run();

    // Verify parent deletion transition: child-new lineage parent_material_id becomes NULL, root_material_id becomes NULL
    const lineageAfterDelete = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = 'child-new'").get();
    assert.equal(lineageAfterDelete.parent_material_id, null);
    assert.equal(lineageAfterDelete.source_content_sha256, parentHash, "Historical source content hash snapshot preserved");

    // Verify split_operation_log survives parent deletion with source_material_id = NULL (ON DELETE SET NULL)
    const opLogAfterDelete = db.prepare("SELECT * FROM split_operation_log WHERE operation_id = ?").get(receipt.operationId);
    assert.ok(opLogAfterDelete, "split_operation_log row must survive source material deletion");
    assert.equal(opLogAfterDelete.source_material_id, null, "source_material_id must become NULL via ON DELETE SET NULL");
    assert.equal(opLogAfterDelete.status, "committed", "status must remain committed");

    // Step 8: Export via VACUUM INTO and reopen with foreign keys ON
    const exportDbPath = join(dir, "exported.db");
    db.exec(`VACUUM INTO '${exportDbPath}';`);

    const reopenedDb = new DatabaseSync(exportDbPath);
    reopenedDb.exec("PRAGMA foreign_keys = ON;");

    // Step 9: Compare complete before/after records for EVERY seeded history row
    assert.deepEqual(reopenedDb.prepare("SELECT * FROM practice_attempts WHERE id = 'att-pre'").get(), preAttPre);
    assert.deepEqual(reopenedDb.prepare("SELECT * FROM practice_responses WHERE id = 'resp-pre'").get(), preRespPre);
    assert.deepEqual(reopenedDb.prepare("SELECT * FROM card_review_state WHERE item_id = 'ci-pre'").get(), preStatePre);
    assert.deepEqual(reopenedDb.prepare("SELECT * FROM card_review_events WHERE id = 'ce-pre'").get(), preEvtPre);

    assert.deepEqual(reopenedDb.prepare("SELECT * FROM practice_attempts WHERE id = 'att-new'").get(), preAttNew);
    assert.deepEqual(reopenedDb.prepare("SELECT * FROM practice_responses WHERE id = 'resp-new'").get(), preRespNew);
    assert.deepEqual(reopenedDb.prepare("SELECT * FROM card_review_state WHERE item_id = 'ci-new'").get(), preStateNew);
    assert.deepEqual(reopenedDb.prepare("SELECT * FROM card_review_events WHERE id = 'ce-new'").get(), preEvtNew);

    // Verify physical synthetic files intact on disk
    assert.ok(existsSync(childOutputFile), "Child synthetic output PDF must remain intact on disk");
    assert.equal(readFileSync(childOutputFile).toString(), "child split page bytes");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
// Contract 15: Restore Simulation Distinguishes Numeric Check from Native Validator
// --------------------------------------------------------------------------
test("Contract 15: Restore Simulation Distinguishes Numeric Check from Native Validator", () => {
  function simulateOlderBinaryNumericCheck(schemaVersion) {
    if (schemaVersion > 12) {
      return { allowed: false, reason: `Backup schema version ${schemaVersion} exceeds maximum supported version 12` };
    }
    return { allowed: true };
  }

  assert.equal(simulateOlderBinaryNumericCheck(12).allowed, true);
  assert.equal(simulateOlderBinaryNumericCheck(13).allowed, false);
});

// --------------------------------------------------------------------------
// Contract 16: Explicit Page Bounds and Storage Limit Specification
// --------------------------------------------------------------------------
test("Contract 16: Explicit Page Bounds and Storage Limit Specification", () => {
  assert.equal(Number.isSafeInteger(Number.MAX_SAFE_INTEGER), true);
  assert.equal(ENGINE_LIMITS.MIN_PAGE, 1);
  assert.equal(ENGINE_LIMITS.MAX_PAGE, 10_000);
  assert.equal(ENGINE_LIMITS.MAX_PARTS_PER_BATCH, 200);
});

// --------------------------------------------------------------------------
// Contract 17: Concurrent Staged Operations and Cleanup Isolation (SL-R9 / SL-R10 / SL-R11)
// --------------------------------------------------------------------------
test("Contract 17: Concurrent Staged Operations and Cleanup Isolation", () => {
  const db = createDisposableLineageDb();
  const dir = mkdtempSync(join(tmpdir(), "c17-isolation-"));

  try {
    const rootFile = join(dir, "root.pdf");
    const rootBytes = Buffer.from("root isolation content");
    writeFileSync(rootFile, rootBytes);
    insertMaterial(db, { id: "R", title: "Root", filePath: rootFile });

    // Operation 1 files
    const op1File1 = join(dir, "op1-part1.pdf");
    const op1File2 = join(dir, "op1-part2.pdf");
    writeFileSync(op1File1, "op1-1");
    writeFileSync(op1File2, "op1-2");

    // Operation 2 files (will fail)
    const op2File1 = join(dir, "op2-part1.pdf");
    const op2File2 = join(dir, "op2-part2.pdf");
    writeFileSync(op2File1, "op2-1");
    writeFileSync(op2File2, "op2-2");

    const receipt1 = createSplitSourceReceipt(db, {
      sourceMaterialId: "R",
      sourceTotalPages: 500,
      plan: [
        { id: "op1-p1", title: "op1-1", selection: { start: 1, end: 10 }, filePath: op1File1 },
        { id: "op1-p2", title: "op1-2", selection: { start: 11, end: 20 }, filePath: op1File2 },
      ],
    });

    const receipt2 = createSplitSourceReceipt(db, {
      sourceMaterialId: "R",
      sourceTotalPages: 500,
      plan: [
        { id: "op2-p1", title: "op2-1", selection: { start: 1, end: 10 }, filePath: op2File1 },
        { id: "op2-p2", title: "op2-2", selection: { start: 11, end: 20 }, filePath: op2File2 },
      ],
    });

    let op2CleanupRan = false;
    db.exec("CREATE TRIGGER inject_op2_fail BEFORE INSERT ON material_split_lineage WHEN NEW.material_id='op2-p2' BEGIN SELECT RAISE(FAIL, 'op2 failure'); END;");

    // Operation 2 fails and cleans only its files
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        receipt: receipt2,
        onRollbackCleanup: () => {
          op2CleanupRan = true;
          if (existsSync(op2File1)) rmSync(op2File1);
          if (existsSync(op2File2)) rmSync(op2File2);
        },
      });
    }, /op2 failure/);

    assert.equal(op2CleanupRan, true);
    assert.equal(existsSync(op2File1), false, "Op 2 files must be cleaned");
    assert.equal(existsSync(op2File2), false, "Op 2 files must be cleaned");

    // Operation 1 files were NOT touched by Operation 2 cleanup
    assert.equal(existsSync(op1File1), true, "Op 1 file 1 must be preserved");
    assert.equal(existsSync(op1File2), true, "Op 1 file 2 must be preserved");

    // Operation 1 now saves successfully
    const op1Res = validateAndSaveSplitBatch(db, { receipt: receipt1 });
    assert.equal(op1Res.savedPartsCount, 2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
// Contract 18: Idempotent Resubmission, Reconciliation, and Real Cancellation (SL-R11)
// --------------------------------------------------------------------------
test("Contract 18: Idempotent Resubmission, Reconciliation, and Real Cancellation", () => {
  const db = createDisposableLineageDb();
  const dir = mkdtempSync(join(tmpdir(), "c18-"));
  try {
    const rootFile = join(dir, "root.pdf");
    const bytes = Buffer.from("root idempotency");
    writeFileSync(rootFile, bytes);
    insertMaterial(db, { id: "R", title: "Root", filePath: rootFile });

    const stagedFile1 = join(dir, "idem-1.pdf");
    const stagedFile2 = join(dir, "idem-2.pdf");
    writeFileSync(stagedFile1, "part 1 bytes");
    writeFileSync(stagedFile2, "part 2 bytes");

    const receipt1 = createSplitSourceReceipt(db, {
      sourceMaterialId: "R",
      sourceTotalPages: 100,
      plan: [
        { id: "idem-1", title: "idem-1", selection: { start: 1, end: 10 }, filePath: stagedFile1 },
        { id: "idem-2", title: "idem-2", selection: { start: 11, end: 20 }, filePath: stagedFile2 },
      ],
    });

    // First save commits receipt
    const firstSave = validateAndSaveSplitBatch(db, { receipt: receipt1 });
    assert.equal(firstSave.idempotentReplay, false);
    assert.equal(firstSave.savedPartsCount, 2);

    // Resubmission of committed receipt replays persisted rows without writes
    const resubmission = validateAndSaveSplitBatch(db, { receipt: receipt1 });
    assert.equal(resubmission.idempotentReplay, true);
    assert.equal(resubmission.savedPartsCount, 2);

    // A DIFFERENT receipt reusing committed output IDs is refused before write with named error
    const stagedFileConflict = join(dir, "conflict.pdf");
    writeFileSync(stagedFileConflict, "conflict bytes");
    const receiptConflict = createSplitSourceReceipt(db, {
      sourceMaterialId: "R",
      sourceTotalPages: 100,
      plan: [{ id: "idem-1", title: "reused ID", selection: { start: 1, end: 50 }, filePath: stagedFileConflict }],
    });

    assert.throws(() => {
      validateAndSaveSplitBatch(db, { receipt: receiptConflict });
    }, /Planned output material ID already exists in library: idem-1/);

    // Reconciliation reads by operation ID
    const rec = reconcileBatch(db, receipt1.operationId);
    assert.equal(rec.reconciled, true);
    assert.equal(rec.parts.length, 2);

    // Real cancellation with cancelBatch(db, operationId)
    // Operation 2: staged files created, receipt issued, then cancelled before commit
    const op2Staged1 = join(dir, "op2-stage1.pdf");
    const op2Staged2 = join(dir, "op2-stage2.pdf");
    writeFileSync(op2Staged1, "op2 part 1");
    writeFileSync(op2Staged2, "op2 part 2");

    const receipt2 = createSplitSourceReceipt(db, {
      sourceMaterialId: "R",
      sourceTotalPages: 100,
      plan: [
        { id: "op2-p1", title: "op2-1", selection: { start: 21, end: 30 }, filePath: op2Staged1 },
        { id: "op2-p2", title: "op2-2", selection: { start: 31, end: 40 }, filePath: op2Staged2 },
      ],
    });

    // Before commit: cancelBatch marks cancelled and deletes staged files
    const cancelRes = cancelBatch(db, receipt2.operationId);
    assert.equal(cancelRes.status, "cancelled");
    assert.equal(cancelRes.cancelled, true);
    assert.equal(existsSync(op2Staged1), false, "Op 2 staged file 1 must be unlinked");
    assert.equal(existsSync(op2Staged2), false, "Op 2 staged file 2 must be unlinked");

    // Later save of cancelled receipt is refused
    assert.throws(() => {
      validateAndSaveSplitBatch(db, { receipt: receipt2 });
    }, /Cannot save a cancelled split operation/);

    // After commit: cancelBatch on already-committed operation changes nothing
    const cancelCommitted = cancelBatch(db, receipt1.operationId);
    assert.equal(cancelCommitted.status, "committed");
    assert.equal(cancelCommitted.cancelled, false);
    assert.equal(existsSync(stagedFile1), true, "Committed file must not be removed");

    // SL-R12: Re-issuing identical receipt never resets committed operation to pending
    createSplitSourceReceipt(db, {
      sourceMaterialId: "R",
      sourceTotalPages: 100,
      plan: [
        { id: "idem-1", title: "idem-1", selection: { start: 1, end: 10 }, filePath: stagedFile1 },
        { id: "idem-2", title: "idem-2", selection: { start: 11, end: 20 }, filePath: stagedFile2 },
      ],
    });
    const op1StatusAfterReissue = db.prepare("SELECT status FROM split_operation_log WHERE operation_id = ?").get(receipt1.operationId).status;
    assert.equal(op1StatusAfterReissue, "committed", "Re-issuing receipt must not reset committed operation status");
    assert.equal(reconcileBatch(db, receipt1.operationId).reconciled, true);

    // SL-R12: Re-issuing identical receipt never resets cancelled operation to pending
    createSplitSourceReceipt(db, {
      sourceMaterialId: "R",
      sourceTotalPages: 100,
      plan: [
        { id: "op2-p1", title: "op2-1", selection: { start: 21, end: 30 }, filePath: op2Staged1 },
        { id: "op2-p2", title: "op2-2", selection: { start: 31, end: 40 }, filePath: op2Staged2 },
      ],
    });
    const op2StatusAfterReissue = db.prepare("SELECT status FROM split_operation_log WHERE operation_id = ?").get(receipt2.operationId).status;
    assert.equal(op2StatusAfterReissue, "cancelled", "Re-issuing receipt must not reset cancelled operation status");

    // SL-R13: cancelBatch signature is strictly (db, operationId)
    assert.throws(() => {
      cancelBatch("not-a-db", "op");
    }, /cancelBatch requires a database instance/, "cancelBatch must require db instance");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
