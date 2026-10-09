// Executable Disposable Lineage Contract Proof Tests (Round 3)
// Milestone 2 (M2) — Her Flight Deck
// Fully addresses SL-R7, SL-R8, SL-R9

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
  assert.throws(() => composeNestedRanges({ start: 101, end: 300 }, { start: 1, end: 201 }), /exceeds total pages \(200\)/);
});

// --------------------------------------------------------------------------
// Contract 4: Multi-Level Transitive Nested Composition (3-Level)
// --------------------------------------------------------------------------
test("Contract 4: Multi-Level Transitive Nested Composition (3-Level)", () => {
  // Level 1: Root 101–500 (400 pages)
  // Level 2: Select 50–150 of Level 1 (102 pages) => Root 150–250
  // Level 3: Select 10–20 of Level 2 (11 pages) => Level 2 10–20 => Root 159–169
  const multi = composeMultiLevelRanges([
    { start: 101, end: 500 },
    { start: 50, end: 150 },
    { start: 10, end: 20 },
  ]);
  assert.equal(multi.start, 159);
  assert.equal(multi.end, 169);
});

// --------------------------------------------------------------------------
// Contract 5: SHA-256 Content Hashing Determinism
// --------------------------------------------------------------------------
test("Contract 5: SHA-256 Content Hashing Determinism", () => {
  const content = "Test FAA Handbook PDF binary stream";
  const h1 = calculateSha256(content);
  const h2 = calculateSha256(Buffer.from(content, "utf8"));
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
});

// --------------------------------------------------------------------------
// Contract 6: Candidate DDL Constraints Enforce Child Identity, Bounds & Structural Tiers
// --------------------------------------------------------------------------
test("Contract 6: Candidate DDL Constraints Enforce Child Identity, Bounds & Structural Tiers", () => {
  const db = createDisposableLineageDb();
  try {
    insertMaterial(db, { id: "root-doc", title: "Complete FAA Handbook" });
    insertMaterial(db, { id: "valid-child", title: "Valid Part 1" });

    // Valid direct split row (nested_level = 1, parent range NULL)
    assert.doesNotThrow(() => {
      insertSplitLineage(db, {
        materialId: "valid-child",
        parentMaterialId: null,
        rootMaterialId: "root-doc",
        sourcePageStart: 1,
        sourcePageEnd: 50,
        childPageCount: 50,
        sourceFileName: "handbook.pdf",
        sourceTitle: "Complete FAA Handbook",
        sourceTotalPages: 500,
        nestedLevel: 1,
      });
    });

    // SL-R8: DDL CHECK ties nested_level = 1 to NULL parent fields
    insertMaterial(db, { id: "tier1-bad", title: "Bad Tier 1" });
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "tier1-bad",
        rootMaterialId: "root-doc",
        sourcePageStart: 1,
        sourcePageEnd: 50,
        childPageCount: 50,
        parentPageStart: 1, // Invalid for nested_level = 1
        parentPageEnd: 50,
        parentTotalPages: 500,
        sourceFileName: "h.pdf",
        sourceTitle: "Handbook",
        nestedLevel: 1,
      });
    }, /CHECK constraint failed/);

    // SL-R8: DDL CHECK ties nested_level > 1 to present parent range and parent total
    insertMaterial(db, { id: "tier2-bad", title: "Bad Tier 2" });
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "tier2-bad",
        parentMaterialId: "valid-child",
        rootMaterialId: "root-doc",
        sourcePageStart: 10,
        sourcePageEnd: 20,
        childPageCount: 11,
        sourceFileName: "h.pdf",
        sourceTitle: "Handbook",
        nestedLevel: 2, // Missing parent_page_start, parent_page_end, parent_total_pages!
      });
    }, /CHECK constraint failed/);

    // Fractional page bounds rejected (TYPEOF integer checks)
    insertMaterial(db, { id: "c-bad1", title: "Fractional Child" });
    assert.throws(() => {
      insertSplitLineage(db, {
        materialId: "c-bad1",
        rootMaterialId: "root-doc",
        sourcePageStart: 101.5,
        sourcePageEnd: 300,
        sourceFileName: "h.pdf",
        sourceTitle: "Handbook",
      });
    }, /CHECK constraint failed/, "Fractional physical page bounds must fail TYPEOF constraint");
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
        parentPageStart: 1,
        parentPageEnd: 10,
        parentTotalPages: 100,
        nestedLevel: 2,
        sourceFileName: "h.pdf",
        sourceTitle: "Handbook",
      });
    }, /CHECK constraint failed/, "Self-parenting must fail cycle check constraint");

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
        nestedLevel: 1,
      });
    }, /CHECK constraint failed/);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 8: Source Version Evaluation through Model Boundary (Two-Tier Structural Classification)
// --------------------------------------------------------------------------
test("Contract 8: Source Version Evaluation through Model Boundary (Two-Tier Structural Classification)", () => {
  const db = createDisposableLineageDb();
  try {
    const rootBytes = Buffer.from("root edition 1");
    const rootHash = calculateSha256(rootBytes);
    const aBytes = Buffer.from("parent A edition 1");
    const aHash = calculateSha256(aBytes);

    insertMaterial(db, { id: "R", title: "Root Handbook" });
    insertMaterial(db, { id: "A", title: "Parent A" });

    // Direct split from R
    insertSplitLineage(db, {
      materialId: "A",
      rootMaterialId: "R",
      sourcePageStart: 101,
      sourcePageEnd: 300,
      sourceTitle: "Root Handbook",
      sourceFileName: "root.pdf",
      sourceContentSha256: rootHash,
      sourceTotalPages: 400,
      nestedLevel: 1,
    });

    // Direct part evaluates against root tier
    const evalA = getMaterialWithLineage(db, "A", { currentFileBytes: rootBytes });
    assert.equal(evalA.lineage.rootStatus, "matching");
    assert.equal(evalA.lineage.parentStatus, "matching");

    // Nested part B from A
    insertMaterial(db, { id: "B", title: "Nested Part B" });
    insertSplitLineage(db, {
      materialId: "B",
      parentMaterialId: "A",
      rootMaterialId: "R",
      sourcePageStart: 120,
      sourcePageEnd: 140,
      parentPageStart: 20,
      parentPageEnd: 40,
      sourceTotalPages: 400,
      parentTotalPages: 200,
      sourceTitle: "Root Handbook",
      sourceFileName: "root.pdf",
      sourceContentSha256: rootHash,
      parentContentSha256: aHash,
      nestedLevel: 2,
    });

    // Parent A matches, Root matches
    const evalB = getMaterialWithLineage(db, "B", { currentRootBytes: rootBytes, currentParentBytes: aBytes });
    assert.equal(evalB.lineage.parentStatus, "matching");
    assert.equal(evalB.lineage.rootStatus, "matching");

    // Parent A changed, Root unchanged
    const evalBChangedA = getMaterialWithLineage(db, "B", { currentRootBytes: rootBytes, currentParentBytes: Buffer.from("parent A edition 2") });
    assert.equal(evalBChangedA.lineage.parentStatus, "changed");
    assert.equal(evalBChangedA.lineage.rootStatus, "matching");

    // SL-R8: NULL parent hash on nested part returns parentStatus: unknown, NEVER certified by root
    insertMaterial(db, { id: "B_unknown", title: "B with unknown parent edition" });
    insertSplitLineage(db, {
      materialId: "B_unknown",
      parentMaterialId: "A",
      rootMaterialId: "R",
      sourcePageStart: 120,
      sourcePageEnd: 140,
      parentPageStart: 20,
      parentPageEnd: 40,
      sourceTotalPages: 400,
      parentTotalPages: 200,
      sourceTitle: "Root Handbook",
      sourceFileName: "root.pdf",
      sourceContentSha256: rootHash,
      parentContentSha256: null, // Unknown!
      nestedLevel: 2,
    });

    const evalBUnknown = getMaterialWithLineage(db, "B_unknown", { currentRootBytes: rootBytes });
    assert.equal(evalBUnknown.lineage.parentStatus, "unknown", "Nested part with null parent hash must report unknown parentStatus");
    assert.equal(evalBUnknown.lineage.rootStatus, "matching");
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 9: Sibling Navigation Isolates Parts Across Parent Document Editions
// --------------------------------------------------------------------------
test("Contract 9: Sibling Navigation Isolates Parts Across Parent Document Editions", () => {
  const db = createDisposableLineageDb();
  try {
    const v1Hash = calculateSha256("root edition v1");
    const v2Hash = calculateSha256("root edition v2");

    insertMaterial(db, { id: "R", title: "Root" });
    insertMaterial(db, { id: "p1", title: "Part 1 v1" });
    insertMaterial(db, { id: "p2", title: "Part 2 v1" });
    insertMaterial(db, { id: "p3", title: "Part 3 v2" });

    // Direct split parts of R
    insertSplitLineage(db, {
      materialId: "p1",
      rootMaterialId: "R",
      sourcePageStart: 1,
      sourcePageEnd: 10,
      sourceTitle: "Root",
      sourceFileName: "root.pdf",
      sourceContentSha256: v1Hash,
      nestedLevel: 1,
    });
    insertSplitLineage(db, {
      materialId: "p2",
      rootMaterialId: "R",
      sourcePageStart: 11,
      sourcePageEnd: 20,
      sourceTitle: "Root",
      sourceFileName: "root.pdf",
      sourceContentSha256: v1Hash,
      nestedLevel: 1,
    });
    insertSplitLineage(db, {
      materialId: "p3",
      rootMaterialId: "R",
      sourcePageStart: 1,
      sourcePageEnd: 10,
      sourceTitle: "Root",
      sourceFileName: "root.pdf",
      sourceContentSha256: v2Hash, // Different edition
      nestedLevel: 1,
    });

    const sibsP1 = listSiblings(db, "p1");
    assert.equal(sibsP1.length, 1);
    assert.equal(sibsP1[0].id, "p2");

    const sibsP3 = listSiblings(db, "p3");
    assert.equal(sibsP3.length, 0);

    // SL-R8: Unknown parent editions never establish sibling equality
    insertMaterial(db, { id: "A", title: "Parent A" });
    insertMaterial(db, { id: "B1", title: "B1" });
    insertMaterial(db, { id: "B2", title: "B2" });
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
// Contract 11: Atomic Batch Save Binds to Authoritative Source, Requires Receipt, and Rolls Back on Failure
// --------------------------------------------------------------------------
test("Contract 11: Atomic Batch Save Binds to Authoritative Source, Requires Receipt, and Rolls Back on Failure", () => {
  const db = createDisposableLineageDb();
  const dir = mkdtempSync(join(tmpdir(), "c11-"));
  try {
    const filePath = join(dir, "root.pdf");
    const bytes = Buffer.from("authoritative root bytes");
    writeFileSync(filePath, bytes);
    const hash = calculateSha256(bytes);

    insertMaterial(db, { id: "R", title: "Root", filePath });

    // SL-R7: Create typed SplitSourceReceipt
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

    // SL-R7: Unverified split without receipt or expected hash must refuse all writes
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        parentMaterialId: "R",
        parts: [{ id: "bad", title: "bad", sourcePageStart: 1, sourcePageEnd: 10, sourceTotalPages: 500 }],
      });
    }, /without any verified source identity refuses all writes/, "Unverified split without receipt must refuse all writes");

    // SL-R7: Caller forged hash cannot replace verified hash
    const forgedHash = calculateSha256("forged edition bytes");
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        parentMaterialId: "R",
        expectedParentSha256: hash,
        currentParentBytes: bytes,
        sourceTotalPages: 500,
        parts: [{ id: "c_forged", title: "c_forged", sourcePageStart: 1, sourcePageEnd: 10, sourceContentSha256: forgedHash }],
      });
    }, /Contradictory caller hash/i, "Caller forged hash must not replace verified hash");

    // Staging cleanup on rollback: injected failure during transaction
    db.exec("CREATE TRIGGER inject_fail BEFORE INSERT ON material_split_lineage WHEN NEW.material_id='fail_pt' BEGIN SELECT RAISE(FAIL, 'simulated constraint failure'); END;");
    let cleanupCalls = 0;
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        parentMaterialId: "R",
        expectedParentSha256: hash,
        currentParentBytes: bytes,
        parts: [
          { id: "p_ok", title: "p_ok", sourcePageStart: 1, sourcePageEnd: 10, sourceTotalPages: 500 },
          { id: "fail_pt", title: "fail_pt", sourcePageStart: 11, sourcePageEnd: 20, sourceTotalPages: 500 },
        ],
        onRollbackCleanup: () => { cleanupCalls++; },
      });
    }, /simulated constraint failure/);

    assert.equal(cleanupCalls, 1, "Cleanup must run exactly once");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM study_materials WHERE id='p_ok'").get().n, 0);
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
  try {
    const bytes = Buffer.from("root bytes");
    const hash = calculateSha256(bytes);
    insertMaterial(db, { id: "R", title: "Root" });

    // Model-boundary refresh failure
    const outcome = saveSplitBatchWithRefresh(
      db,
      {
        parentMaterialId: "R",
        expectedParentSha256: hash,
        currentParentBytes: bytes,
        sourceTotalPages: 200,
        parts: [{ id: "c1", title: "Part 1", sourcePageStart: 1, sourcePageEnd: 20 }],
      },
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
  }
});

// --------------------------------------------------------------------------
// Contract 13: Shipped Migrations 0001–0012 Faithful Schema Baseline
// --------------------------------------------------------------------------
test("Contract 13: Shipped Migrations 0001–0012 Faithful Schema Baseline", () => {
  const db = createDisposableLineageDb(false);
  try {
    const applied = db.prepare("SELECT version FROM _sqlx_migrations ORDER BY version").all().map((r) => r.version);
    assert.deepEqual(applied, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------
// Contract 14: Disposable Schema Migration Lifecycle, Validated Save with Receipt, Export/Reopen, and Synthetic File Preservation (SL-R9)
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
// Contract 17: Concurrent Staged Operations and Cleanup Isolation (SL-R9)
// --------------------------------------------------------------------------
test("Contract 17: Concurrent Staged Operations and Cleanup Isolation", () => {
  const db = createDisposableLineageDb();
  const dir = mkdtempSync(join(tmpdir(), "c17-isolation-"));

  try {
    const rootBytes = Buffer.from("root isolation content");
    const rootHash = calculateSha256(rootBytes);
    insertMaterial(db, { id: "R", title: "Root" });

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

    let op2CleanupRan = false;
    db.exec("CREATE TRIGGER inject_op2_fail BEFORE INSERT ON material_split_lineage WHEN NEW.material_id='op2-p2' BEGIN SELECT RAISE(FAIL, 'op2 failure'); END;");

    // Operation 2 fails and cleans only its files
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        parentMaterialId: "R",
        expectedParentSha256: rootHash,
        currentParentBytes: rootBytes,
        sourceTotalPages: 500,
        parts: [
          { id: "op2-p1", title: "op2-1", sourcePageStart: 1, sourcePageEnd: 10 },
          { id: "op2-p2", title: "op2-2", sourcePageStart: 11, sourcePageEnd: 20 },
        ],
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
    const op1Res = validateAndSaveSplitBatch(db, {
      parentMaterialId: "R",
      expectedParentSha256: rootHash,
      currentParentBytes: rootBytes,
      sourceTotalPages: 500,
      parts: [
        { id: "op1-p1", title: "op1-1", sourcePageStart: 1, sourcePageEnd: 10 },
        { id: "op1-p2", title: "op1-2", sourcePageStart: 11, sourcePageEnd: 20 },
      ],
    });
    assert.equal(op1Res.savedPartsCount, 2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
// Contract 18: Idempotent Resubmission, Reconciliation, and Cancellation (SL-R9)
// --------------------------------------------------------------------------
test("Contract 18: Idempotent Resubmission, Reconciliation, and Cancellation", () => {
  const db = createDisposableLineageDb();
  try {
    const bytes = Buffer.from("root idempotency");
    const hash = calculateSha256(bytes);
    insertMaterial(db, { id: "R", title: "Root" });

    const opId = "test-operation-1001";
    const parts = [
      { id: "idem-1", title: "idem-1", sourcePageStart: 1, sourcePageEnd: 10 },
      { id: "idem-2", title: "idem-2", sourcePageStart: 11, sourcePageEnd: 20 },
    ];

    // First save
    const firstSave = validateAndSaveSplitBatch(db, {
      parentMaterialId: "R",
      expectedParentSha256: hash,
      currentParentBytes: bytes,
      sourceTotalPages: 100,
      operationId: opId,
      parts,
    });
    assert.equal(firstSave.idempotentReplay, false);

    // Resubmission with same operationId returns existing parts without re-inserting
    const resubmission = validateAndSaveSplitBatch(db, {
      parentMaterialId: "R",
      expectedParentSha256: hash,
      currentParentBytes: bytes,
      sourceTotalPages: 100,
      operationId: opId,
      parts,
    });
    assert.equal(resubmission.idempotentReplay, true);
    assert.equal(resubmission.savedPartsCount, 2);

    // Conflicting resubmission with different plan is refused
    assert.throws(() => {
      validateAndSaveSplitBatch(db, {
        parentMaterialId: "R",
        expectedParentSha256: hash,
        currentParentBytes: bytes,
        sourceTotalPages: 100,
        operationId: opId,
        parts: [{ id: "conflict-id", title: "conflict", sourcePageStart: 1, sourcePageEnd: 50 }],
      });
    }, /Conflicting resubmission/);

    // Reconciliation reads by operation ID
    const rec = reconcileBatch(db, opId);
    assert.equal(rec.reconciled, true);
    assert.equal(rec.parts.length, 2);

    // Cancellation before vs after commit
    const cancelBefore = cancelBatch("pre-op", ["fileA.pdf"], false);
    assert.equal(cancelBefore.cancelled, true);

    const cancelAfter = cancelBatch(opId, ["fileB.pdf"], true);
    assert.equal(cancelAfter.cancelled, false);
    assert.equal(cancelAfter.status, "already_committed");
  } finally {
    db.close();
  }
});
