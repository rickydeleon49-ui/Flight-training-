import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePageRange,
  mapChildPageToSource,
  composeNestedRanges,
  calculateSha256,
  createDisposableLineageDb,
  insertMaterial,
  insertSplitLineage,
  getMaterialWithLineage,
  listSiblings,
  CANDIDATE_MIGRATION_0013_SQL,
} from "./lineageContract.mjs";

test("Contract 1: Page Range Validation enforces 1-based, inclusive bounds", () => {
  // Valid cases
  assert.deepEqual(validatePageRange(1, 1), { ok: true, count: 1 });
  assert.deepEqual(validatePageRange(1, 100), { ok: true, count: 100 });
  assert.deepEqual(validatePageRange(101, 300), { ok: true, count: 200 });
  assert.deepEqual(validatePageRange(1, 400, 400), { ok: true, count: 400 });
  assert.deepEqual(validatePageRange(350, 400, 400), { ok: true, count: 51 });

  // Invalid cases
  assert.equal(validatePageRange(0, 100).ok, false);
  assert.equal(validatePageRange(0, 100).error, "Pages are numbered from 1.");

  assert.equal(validatePageRange(-5, 10).ok, false);
  assert.equal(validatePageRange(-5, 10).error, "Pages are numbered from 1.");

  assert.equal(validatePageRange(100, 50).ok, false);
  assert.equal(validatePageRange(100, 50).error, "The last page comes before the first one.");

  assert.equal(validatePageRange(10, 500, 400).ok, false);
  assert.match(validatePageRange(10, 500, 400).error, /This PDF has 400 pages, so there is no page 500\./);

  assert.equal(validatePageRange(401, 450, 400).ok, false);
  assert.match(validatePageRange(401, 450, 400).error, /This PDF has 400 pages, so there is no page 401\./);

  // Non-integers
  assert.equal(validatePageRange(1.5, 10).ok, false);
  assert.equal(validatePageRange("1", 10).ok, false);
});

test("Contract 2: Page Translation Maps Child Position to Original Root Page", () => {
  // Child covers pages 101–300 of parent
  const sourceStart = 101;

  // Child page 1 maps to parent page 101
  assert.equal(mapChildPageToSource(1, sourceStart), 101);

  // Child page 50 maps to parent page 150
  assert.equal(mapChildPageToSource(50, sourceStart), 150);

  // Child page 200 maps to parent page 300
  assert.equal(mapChildPageToSource(200, sourceStart), 300);

  // Invalid page positions rejected
  assert.throws(() => mapChildPageToSource(0, sourceStart), /Child page must be a positive integer/);
  assert.throws(() => mapChildPageToSource(-1, sourceStart), /Child page must be a positive integer/);
});

test("Contract 3: Nested Range Composition Combines Split Windows Correctly", () => {
  // Original source: 400-page Airplane Flying Handbook
  // Level 1 split: Child A covers original pages 101–300 (200 pages total)
  const childARange = { sourcePageStart: 101, sourcePageEnd: 300 };

  // Level 2 split: Grandchild B is cut from Child A, selecting pages 20 to 40 of Child A
  const grandchildSelection = { firstPage: 20, lastPage: 40 };

  const composed = composeNestedRanges(childARange, grandchildSelection);

  // Composed range should cover original pages 120–140
  // Math: 101 + 20 - 1 = 120; 101 + 40 - 1 = 140
  assert.equal(composed.sourcePageStart, 120);
  assert.equal(composed.sourcePageEnd, 140);
  assert.equal(composed.totalPages, 21);

  // Grandchild page 1 maps to root page 120
  assert.equal(mapChildPageToSource(1, composed.sourcePageStart), 120);

  // Grandchild page 21 maps to root page 140
  assert.equal(mapChildPageToSource(21, composed.sourcePageStart), 140);

  // Selection exceeding child's page count must be rejected
  assert.throws(
    () => composeNestedRanges(childARange, { firstPage: 1, lastPage: 250 }),
    /This PDF has 200 pages, so there is no page 250\./,
  );
});

test("Contract 4: Multi-Level Transitive Nested Composition (3-Level)", () => {
  // Root: 1,000 pages
  // Level 1 (Part): Pages 201–600 (400 pages)
  const level1 = { sourcePageStart: 201, sourcePageEnd: 600 };

  // Level 2 (Chapter): Pages 51–150 of Level 1 (100 pages)
  const level2Selection = { firstPage: 51, lastPage: 150 };
  const level2 = composeNestedRanges(level1, level2Selection);
  // Root: 201 + 51 - 1 = 251 to 201 + 150 - 1 = 350
  assert.equal(level2.sourcePageStart, 251);
  assert.equal(level2.sourcePageEnd, 350);

  // Level 3 (Section): Pages 10–25 of Level 2 (16 pages)
  const level3Selection = { firstPage: 10, lastPage: 25 };
  const level3 = composeNestedRanges(level2, level3Selection);
  // Root: 251 + 10 - 1 = 260 to 251 + 25 - 1 = 275
  assert.equal(level3.sourcePageStart, 260);
  assert.equal(level3.sourcePageEnd, 275);
  assert.equal(level3.totalPages, 16);
});

test("Contract 5: SQL Schema Constraints Enforce Valid Range & Relational Invariants", () => {
  const db = createDisposableLineageDb(true);

  insertMaterial(db, {
    id: "mat-parent",
    title: "Instrument Flying Handbook",
    filePath: "handbook.pdf",
    originalFileName: "handbook.pdf",
    fileSize: 45000000,
  });

  insertMaterial(db, {
    id: "mat-child",
    title: "IFH - Part 2",
    filePath: "part2.pdf",
    originalFileName: "part2.pdf",
    fileSize: 15000000,
  });

  // Valid lineage insertion succeeds
  insertSplitLineage(db, {
    materialId: "mat-child",
    parentMaterialId: "mat-parent",
    rootMaterialId: "mat-parent",
    sourcePageStart: 101,
    sourcePageEnd: 300,
    sourceFileName: "handbook.pdf",
    sourceTitle: "Instrument Flying Handbook",
    sourceTotalPages: 400,
    nestedLevel: 1,
  });

  const child = getMaterialWithLineage(db, "mat-child");
  assert.ok(child.lineage);
  assert.equal(child.lineage.sourcePageStart, 101);
  assert.equal(child.lineage.sourcePageEnd, 300);
  assert.equal(child.lineage.parentStatus, "available");

  // Constraint Violation: CHECK (source_page_start >= 1)
  insertMaterial(db, { id: "mat-bad-1", title: "Bad Start" });
  assert.throws(() => {
    insertSplitLineage(db, {
      materialId: "mat-bad-1",
      sourcePageStart: 0,
      sourcePageEnd: 10,
      sourceFileName: "doc.pdf",
      sourceTitle: "Doc",
    });
  }, /CHECK constraint failed/);

  // Constraint Violation: CHECK (source_page_end >= source_page_start)
  insertMaterial(db, { id: "mat-bad-2", title: "Reversed Range" });
  assert.throws(() => {
    insertSplitLineage(db, {
      materialId: "mat-bad-2",
      sourcePageStart: 50,
      sourcePageEnd: 20,
      sourceFileName: "doc.pdf",
      sourceTitle: "Doc",
    });
  }, /CHECK constraint failed/);

  // Constraint Violation: CHECK (material_id != parent_material_id)
  insertMaterial(db, { id: "mat-self", title: "Self Parent" });
  assert.throws(() => {
    insertSplitLineage(db, {
      materialId: "mat-self",
      parentMaterialId: "mat-self",
      sourcePageStart: 1,
      sourcePageEnd: 10,
      sourceFileName: "doc.pdf",
      sourceTitle: "Doc",
    });
  }, /CHECK constraint failed/);

  // Constraint Violation: CHECK (source_total_pages >= source_page_end)
  insertMaterial(db, { id: "mat-bad-3", title: "Past Total" });
  assert.throws(() => {
    insertSplitLineage(db, {
      materialId: "mat-bad-3",
      sourcePageStart: 100,
      sourcePageEnd: 250,
      sourceFileName: "doc.pdf",
      sourceTitle: "Doc",
      sourceTotalPages: 200,
    });
  }, /CHECK constraint failed/);
});

test("Contract 6: Parent Deletion Preserves Child Material & Retains Lineage Metadata (ON DELETE SET NULL)", () => {
  const db = createDisposableLineageDb(true);

  insertMaterial(db, {
    id: "mat-handbook",
    title: "Airplane Flying Handbook",
    filePath: "afh.pdf",
    originalFileName: "afh.pdf",
    fileSize: 40000000,
  });

  insertMaterial(db, {
    id: "mat-part-1",
    title: "AFH — Part 1 of 3",
    filePath: "afh-part-1.pdf",
    originalFileName: "afh-part-1.pdf",
    fileSize: 12000000,
    notes: "Pages 1–120 of Airplane Flying Handbook.",
  });

  insertSplitLineage(db, {
    materialId: "mat-part-1",
    parentMaterialId: "mat-handbook",
    rootMaterialId: "mat-handbook",
    sourcePageStart: 1,
    sourcePageEnd: 120,
    sourceFileName: "afh.pdf",
    sourceTitle: "Airplane Flying Handbook",
    sourceContentSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    sourceTotalPages: 380,
  });

  // Verify before deletion
  const before = getMaterialWithLineage(db, "mat-part-1");
  assert.equal(before.lineage.parentStatus, "available");
  assert.equal(before.lineage.parentMaterialId, "mat-handbook");

  // User deletes parent handbook
  db.prepare("DELETE FROM study_materials WHERE id = 'mat-handbook'").run();

  // Invariant 1: Child material MUST NOT be deleted
  const after = getMaterialWithLineage(db, "mat-part-1");
  assert.ok(after, "Child material must still exist after parent deletion");
  assert.equal(after.title, "AFH — Part 1 of 3");
  assert.equal(after.filePath, "afh-part-1.pdf");

  // Invariant 2: Child lineage record MUST survive
  assert.ok(after.lineage, "Lineage record must still exist");

  // Invariant 3: parent_material_id is SET NULL by SQLite FK
  assert.equal(after.lineage.parentMaterialId, null);
  assert.equal(after.lineage.parentStatus, "deleted");

  // Invariant 4: Historical snapshot metadata is preserved intact
  assert.equal(after.lineage.sourceTitle, "Airplane Flying Handbook");
  assert.equal(after.lineage.sourceFileName, "afh.pdf");
  assert.equal(after.lineage.sourcePageStart, 1);
  assert.equal(after.lineage.sourcePageEnd, 120);
  assert.equal(after.lineage.sourceTotalPages, 380);
  assert.equal(after.lineage.sourceContentSha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("Contract 7: Child Deletion Cascades Lineage Row Without Affecting Parent", () => {
  const db = createDisposableLineageDb(true);

  insertMaterial(db, { id: "mat-parent", title: "Parent Handbook" });
  insertMaterial(db, { id: "mat-child", title: "Child Part" });
  insertSplitLineage(db, {
    materialId: "mat-child",
    parentMaterialId: "mat-parent",
    sourcePageStart: 1,
    sourcePageEnd: 50,
    sourceFileName: "parent.pdf",
    sourceTitle: "Parent Handbook",
  });

  // Delete child
  db.prepare("DELETE FROM study_materials WHERE id = 'mat-child'").run();

  // Lineage row is cascade-deleted
  const lineageRow = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = 'mat-child'").get();
  assert.equal(lineageRow, undefined);

  // Parent material is intact
  const parent = db.prepare("SELECT * FROM study_materials WHERE id = 'mat-parent'").get();
  assert.ok(parent);
});

test("Contract 8: Parent Replacement / File Modification Invariance", () => {
  const db = createDisposableLineageDb(true);

  const originalParentHash = calculateSha256("ORIGINAL_EDITION_2024_BYTES");

  insertMaterial(db, {
    id: "mat-handbook",
    title: "Pilot's Handbook of Aeronautical Knowledge",
    filePath: "phak-2024.pdf",
    originalFileName: "phak.pdf",
    fileSize: 50000000,
  });

  insertMaterial(db, {
    id: "mat-part",
    title: "PHAK — Chapter 5",
    filePath: "phak-ch5.pdf",
    originalFileName: "phak-ch5.pdf",
    fileSize: 8000000,
  });

  insertSplitLineage(db, {
    materialId: "mat-part",
    parentMaterialId: "mat-handbook",
    sourcePageStart: 81,
    sourcePageEnd: 110,
    sourceFileName: "phak.pdf",
    sourceTitle: "Pilot's Handbook of Aeronautical Knowledge",
    sourceContentSha256: originalParentHash,
    sourceTotalPages: 520,
  });

  // Pilot replaces handbook file with 2026 Edition (different file path / new hash)
  const newEditionHash = calculateSha256("NEW_EDITION_2026_UPDATED_BYTES");
  assert.notEqual(originalParentHash, newEditionHash);

  db.prepare(`
    UPDATE study_materials
    SET file_path = 'phak-2026-edition.pdf', file_size = 52000000
    WHERE id = 'mat-handbook'
  `).run();

  // Child lineage is completely preserved and retains original hash
  const child = getMaterialWithLineage(db, "mat-part");
  assert.equal(child.lineage.sourceContentSha256, originalParentHash);
  assert.equal(child.lineage.sourcePageStart, 81);
  assert.equal(child.lineage.sourcePageEnd, 110);
  assert.equal(child.lineage.liveParentFilePath, "phak-2026-edition.pdf");

  // Hash difference confirms content version change is detectable without mutating child
  assert.notEqual(child.lineage.sourceContentSha256, newEditionHash);
});

test("Contract 9: Repeated Imports of Same PDF Have Distinct Material Identities", () => {
  const db = createDisposableLineageDb(true);

  const sharedPdfHash = calculateSha256("FAA-H-8083-25C_EXACT_IDENTICAL_BYTES");

  // Import 1
  insertMaterial(db, {
    id: "mat-import-1",
    title: "FAA Handbook Copy 1",
    filePath: "import1.pdf",
    originalFileName: "handbook.pdf",
  });

  // Import 2 (identical file imported a second time)
  insertMaterial(db, {
    id: "mat-import-2",
    title: "FAA Handbook Copy 2",
    filePath: "import2.pdf",
    originalFileName: "handbook.pdf",
  });

  // Child split from Copy 1
  insertMaterial(db, { id: "mat-part-from-1", title: "Part from Copy 1" });
  insertSplitLineage(db, {
    materialId: "mat-part-from-1",
    parentMaterialId: "mat-import-1",
    sourcePageStart: 1,
    sourcePageEnd: 50,
    sourceFileName: "handbook.pdf",
    sourceTitle: "FAA Handbook Copy 1",
    sourceContentSha256: sharedPdfHash,
  });

  const child = getMaterialWithLineage(db, "mat-part-from-1");
  // Linked specifically to Copy 1, not Copy 2
  assert.equal(child.lineage.parentMaterialId, "mat-import-1");
  assert.equal(child.lineage.liveParentTitle, "FAA Handbook Copy 1");
  assert.equal(child.lineage.sourceContentSha256, sharedPdfHash);
});

test("Contract 10: Legacy Materials without Lineage Coexist Safely", () => {
  const db = createDisposableLineageDb(true);

  // Pre-existing legacy material
  insertMaterial(db, {
    id: "mat-legacy-handbook",
    title: "Aviation Weather — Part 1 of 4",
    notes: "Pages 1–50 of Aviation Weather.",
  });

  // Querying legacy material returns null lineage; does not infer from title or notes
  const legacy = getMaterialWithLineage(db, "mat-legacy-handbook");
  assert.ok(legacy);
  assert.equal(legacy.lineage, null, "Must NOT infer lineage from title or notes");

  // Sibling lookup on material without lineage returns empty list
  assert.deepEqual(listSiblings(db, "mat-legacy-handbook"), []);
});

test("Contract 11: Sibling Navigation Lists Other Parts Sharing the Same Parent", () => {
  const db = createDisposableLineageDb(true);

  insertMaterial(db, { id: "mat-parent", title: "Aeronautical Chart User's Guide" });

  insertMaterial(db, { id: "mat-part-1", title: "Chart Guide — Part 1" });
  insertMaterial(db, { id: "mat-part-2", title: "Chart Guide — Part 2" });
  insertMaterial(db, { id: "mat-part-3", title: "Chart Guide — Part 3" });

  insertSplitLineage(db, {
    materialId: "mat-part-1",
    parentMaterialId: "mat-parent",
    sourcePageStart: 1,
    sourcePageEnd: 30,
    sourceFileName: "chart-guide.pdf",
    sourceTitle: "Aeronautical Chart User's Guide",
  });
  insertSplitLineage(db, {
    materialId: "mat-part-2",
    parentMaterialId: "mat-parent",
    sourcePageStart: 31,
    sourcePageEnd: 60,
    sourceFileName: "chart-guide.pdf",
    sourceTitle: "Aeronautical Chart User's Guide",
  });
  insertSplitLineage(db, {
    materialId: "mat-part-3",
    parentMaterialId: "mat-parent",
    sourcePageStart: 61,
    sourcePageEnd: 90,
    sourceFileName: "chart-guide.pdf",
    sourceTitle: "Aeronautical Chart User's Guide",
  });

  // Query siblings of Part 2
  const siblings = listSiblings(db, "mat-part-2");
  assert.equal(siblings.length, 2);
  assert.deepEqual(siblings, [
    { id: "mat-part-1", title: "Chart Guide — Part 1", sourcePageStart: 1, sourcePageEnd: 30 },
    { id: "mat-part-3", title: "Chart Guide — Part 3", sourcePageStart: 61, sourcePageEnd: 90 },
  ]);
});

test("Contract 12: Immutable PDF Bytes & Historical Study Snapshots Are Unchanged", () => {
  const db = createDisposableLineageDb(true);

  // Pre-existing PDF bytes
  const originalPdfBytes = Buffer.from("%PDF-1.4 synthetic handbook content bytes 1234567890");
  const originalPdfHash = calculateSha256(originalPdfBytes);

  // Insert material with study set and card review state
  insertMaterial(db, { id: "mat-source", title: "Source Doc", fileSize: originalPdfBytes.length });

  db.prepare(`
    INSERT INTO ai_study_sets (
      source_material_id, title, summary, sections_json, flashcards_json,
      source_notes, provider, model, generated_at, updated_at
    ) VALUES (
      'mat-source', 'Source Summary', 'Summary text', '[]',
      '[{"front":"What is Vso?","back":"Stall speed in landing config","sourcePage":15}]',
      'Original notes', 'gemini', 'gemini-1.5-flash', '2026-10-06T10:00:00Z', '2026-10-06T10:00:00Z'
    )
  `).run();

  db.prepare(`
    INSERT INTO practice_sessions (
      id, source_material_id, started_at, completed_at, score, total_questions
    ) VALUES ('sess-1', 'mat-source', '2026-10-06T11:00:00Z', '2026-10-06T11:20:00Z', 95, 20)
  `).run();

  db.prepare(`
    INSERT INTO card_review_events (
      id, source_material_id, card_id, rating, reviewed_at
    ) VALUES ('evt-1', 'mat-source', 'card-1', 'good', '2026-10-06T12:00:00Z')
  `).run();

  // Snapshot before split lineage operation
  const setBefore = db.prepare("SELECT * FROM ai_study_sets WHERE source_material_id = 'mat-source'").get();
  const sessionBefore = db.prepare("SELECT * FROM practice_sessions WHERE id = 'sess-1'").get();
  const eventBefore = db.prepare("SELECT * FROM card_review_events WHERE id = 'evt-1'").get();

  // Perform split lineage operation
  insertMaterial(db, { id: "mat-split-child", title: "Child Split" });
  insertSplitLineage(db, {
    materialId: "mat-split-child",
    parentMaterialId: "mat-source",
    sourcePageStart: 1,
    sourcePageEnd: 20,
    sourceFileName: "source.pdf",
    sourceTitle: "Source Doc",
    sourceContentSha256: originalPdfHash,
  });

  // Verify PDF bytes are unaltered
  const currentPdfHash = calculateSha256(originalPdfBytes);
  assert.equal(currentPdfHash, originalPdfHash, "PDF bytes must be byte-for-byte identical");

  // Verify historical study sets, practice sessions, and card events are byte-for-byte identical
  const setAfter = db.prepare("SELECT * FROM ai_study_sets WHERE source_material_id = 'mat-source'").get();
  const sessionAfter = db.prepare("SELECT * FROM practice_sessions WHERE id = 'sess-1'").get();
  const eventAfter = db.prepare("SELECT * FROM card_review_events WHERE id = 'evt-1'").get();

  assert.deepEqual(setAfter, setBefore, "ai_study_sets must be completely unaltered");
  assert.deepEqual(sessionAfter, sessionBefore, "practice_sessions must be completely unaltered");
  assert.deepEqual(eventAfter, eventBefore, "card_review_events must be completely unaltered");
});

test("Contract 13: Schema Migration 0012 -> 0013 and Backup/Restore Simulation", () => {
  // Step 1: Create a database at Schema 12 (shipped current main)
  const dbV12 = createDisposableLineageDb(false);
  const versionBefore = dbV12.prepare("SELECT MAX(version) AS max_v FROM schema_migrations").get().max_v;
  assert.equal(versionBefore, 12, "Baseline schema version must be 12");

  insertMaterial(dbV12, { id: "mat-pre-migration", title: "Existing Material" });

  // Step 2: Apply candidate Migration 0013
  dbV12.exec(CANDIDATE_MIGRATION_0013_SQL);
  dbV12.prepare("INSERT INTO schema_migrations (version) VALUES (13)").run();

  const versionAfter = dbV12.prepare("SELECT MAX(version) AS max_v FROM schema_migrations").get().max_v;
  assert.equal(versionAfter, 13, "Schema version must increment to 13");

  // Step 3: Existing pre-migration rows remain intact
  const existing = dbV12.prepare("SELECT * FROM study_materials WHERE id = 'mat-pre-migration'").get();
  assert.ok(existing);
  assert.equal(existing.title, "Existing Material");

  // Step 4: Older binary simulation (binary at Schema 12 reading Schema 13 database)
  // Per src-tauri/src/backup.rs:631:
  // if newest_migration > CURRENT_SCHEMA_VERSION { return Err(...) }
  const olderBinaryCurrentSchema = 12;
  const dbMaxMigration = versionAfter; // 13

  function simulateOlderBinaryRestore(newestMigration, currentBinarySchema) {
    if (newestMigration > currentBinarySchema) {
      return {
        ok: false,
        error: `That backup was made by a newer version of Her Flight Deck (database schema ${newestMigration}, this version reads up to ${currentBinarySchema}). Update the application to restore it.`,
      };
    }
    return { ok: true };
  }

  const olderRestoreResult = simulateOlderBinaryRestore(dbMaxMigration, olderBinaryCurrentSchema);
  assert.equal(olderRestoreResult.ok, false);
  assert.match(olderRestoreResult.error, /database schema 13, this version reads up to 12/);

  // Step 5: Newer binary restore of older Schema 12 backup succeeds
  const newerBinaryCurrentSchema = 13;
  const newerRestoreResult = simulateOlderBinaryRestore(12, newerBinaryCurrentSchema);
  assert.equal(newerRestoreResult.ok, true);
});
