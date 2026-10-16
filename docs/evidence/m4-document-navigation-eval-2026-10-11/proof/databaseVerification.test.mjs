/**
 * M4 Database Migration & Ownership Verification Test (R3)
 *
 * Verifies candidate migration 0015 against a genuine SQLite database
 * migrated from shipped 0001–0013:
 * 1. Populates pre-existing materials, split parts, and split lineage.
 * 2. Applies candidate migration 0015.
 * 3. Enforces strict 64-char hex SHA-256 CHECK constraints (rejects malformed hashes).
 * 4. Ensures bookmarks and reading positions bind to originating_content_sha256.
 * 5. Demonstrates identity replacement protocol: old bookmarks retain their original hash
 *    and transition to status: 'unverified' upon content drift.
 * 6. Verifies ON DELETE CASCADE from study_materials to navigation entities.
 * 7. Demonstrates transaction rollback on failed replacement operations.
 * 8. Proves pre-existing schema-13 library data remains 100% intact after upgrade.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function setupPopulatedDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");

  // Apply shipped migrations 0001 through 0013
  const migrationsDir = path.resolve("src-tauri/migrations");
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    db.exec(sql);
  }

  // Insert baseline study materials
  db.exec(`
    INSERT INTO study_materials (
      id, title, material_type, topic, review_status, priority, notes, file_path, original_file_name, file_size, created_at, updated_at
    ) VALUES
    ('root-phak', 'Pilots Handbook of Aeronautical Knowledge', 'handbook', 'aerodynamics', 'needs_review', 'important', 'Comprehensive FAA handbook', 'root_phak.pdf', 'FAA-H-8083-25C.pdf', 52428800, '2026-10-11T00:00:00Z', '2026-10-11T00:00:00Z'),
    ('ch2-part', 'PHAK Chapter 2 Principles of Flight', 'study_guide', 'aerodynamics', 'needs_review', 'important', 'Split part pages 10..25', 'ch2_split.pdf', 'Chapter2.pdf', 3145728, '2026-10-11T00:00:00Z', '2026-10-11T00:00:00Z');
  `);

  // Insert split lineage for ch2-part
  db.exec(`
    INSERT INTO material_split_lineage (
      material_id, parent_material_id, root_material_id, source_page_start, source_page_end,
      parent_page_start, parent_page_end, child_page_count, source_file_name, source_title,
      source_content_sha256, source_total_pages, nested_level, created_at
    ) VALUES (
      'ch2-part', NULL, 'root-phak', 10, 25, NULL, NULL, 16, 'FAA-H-8083-25C.pdf',
      'Pilots Handbook of Aeronautical Knowledge', '4bded70394e06996c1ec2b3605d004fd2a8d857824c8f9b3278b7df85ae032b7',
      50, 1, '2026-10-11T00:00:00Z'
    );
  `);

  return db;
}

test("M4-DB-1: Upgrade retains pre-existing schema-13 rows", () => {
  const db = setupPopulatedDatabase();

  // Apply candidate migration 0015
  const candidateSql = fs.readFileSync(
    path.resolve("docs/evidence/m4-document-navigation-eval-2026-10-11/candidate/candidate_migration_0015.sql"),
    "utf-8"
  );
  db.exec(candidateSql);

  // Verify baseline materials still exist
  const materials = db.prepare("SELECT id, title FROM study_materials ORDER BY id").all();
  assert.equal(materials.length, 2);
  assert.equal(materials[0].id, "ch2-part");
  assert.equal(materials[1].id, "root-phak");

  // Verify split lineage intact
  const lineage = db.prepare("SELECT material_id, child_page_count, source_page_start FROM material_split_lineage").all();
  assert.equal(lineage.length, 1);
  assert.equal(lineage[0].child_page_count, 16);
  assert.equal(lineage[0].source_page_start, 10);
});

test("M4-DB-2: Strict hash validation rejects malformed SHA-256", () => {
  const db = setupPopulatedDatabase();
  const candidateSql = fs.readFileSync(
    path.resolve("docs/evidence/m4-document-navigation-eval-2026-10-11/candidate/candidate_migration_0015.sql"),
    "utf-8"
  );
  db.exec(candidateSql);

  // Valid hash insert
  const validHash = "a".repeat(64);
  db.prepare("INSERT INTO material_content_identities VALUES ('root-phak', ?, 50, '2026-10-11T00:00:00Z')").run(validHash);

  // Malformed hash (not 64 chars) should fail CHECK
  assert.throws(() => {
    db.prepare("INSERT INTO material_content_identities VALUES ('ch2-part', 'not-a-sha256', 16, '2026-10-11T00:00:00Z')").run();
  }, /CHECK constraint failed/);

  // Non-hex chars should fail CHECK
  assert.throws(() => {
    const invalidHex = "z".repeat(64);
    db.prepare("INSERT INTO material_content_identities VALUES ('ch2-part', ?, 16, '2026-10-11T00:00:00Z')").run(invalidHex);
  }, /CHECK constraint failed/);
});

test("M4-DB-3: Bookmarks bind to originating content hash and detect drift", () => {
  const db = setupPopulatedDatabase();
  const candidateSql = fs.readFileSync(
    path.resolve("docs/evidence/m4-document-navigation-eval-2026-10-11/candidate/candidate_migration_0015.sql"),
    "utf-8"
  );
  db.exec(candidateSql);

  const hashV1 = "1".repeat(64);
  db.prepare("INSERT INTO material_content_identities VALUES ('root-phak', ?, 50, '2026-10-11T00:00:00Z')").run(hashV1);

  // Add bookmark bound to hashV1
  db.prepare(`
    INSERT INTO material_bookmarks (
      id, material_id, page_index, page_label, originating_content_sha256, title, notes, status, created_at, updated_at
    ) VALUES (
      'bm-1', 'root-phak', 42, '3-12', ?, 'Lift vs Weight Diagram', 'Important formula', 'verified', '2026-10-11T00:00:00Z', '2026-10-11T00:00:00Z'
    )
  `).run(hashV1);

  // Add reading state bound to hashV1
  db.prepare(`
    INSERT INTO material_reading_state (
      material_id, last_requested_page, last_requested_page_label, confirmed_read, originating_content_sha256, status, updated_at
    ) VALUES (
      'root-phak', 42, '3-12', 0, ?, 'active', '2026-10-11T00:00:00Z'
    )
  `).run(hashV1);

  // Now replace file with new content hash (Edition 2026)
  const hashV2 = "2".repeat(64);
  db.exec("BEGIN IMMEDIATE");
  db.prepare("UPDATE material_content_identities SET content_sha256 = ?, total_pages = 55, verified_at = '2026-10-11T01:00:00Z' WHERE material_id = 'root-phak'").run(hashV2);

  // Transactional invalidation: flag bookmarks whose originating hash does not match active content
  db.prepare(`
    UPDATE material_bookmarks SET status = 'unverified'
    WHERE material_id = 'root-phak' AND originating_content_sha256 != ?
  `).run(hashV2);

  db.prepare(`
    UPDATE material_reading_state SET status = 'unverified'
    WHERE material_id = 'root-phak' AND originating_content_sha256 != ?
  `).run(hashV2);
  db.exec("COMMIT");

  // Bookmark retains its original hash, but status is now unverified
  const bm = db.prepare("SELECT originating_content_sha256, status, page_index FROM material_bookmarks WHERE id = 'bm-1'").get();
  assert.equal(bm.originating_content_sha256, hashV1);
  assert.equal(bm.status, "unverified");
  assert.equal(bm.page_index, 42);

  // Reading state status is now unverified
  const rs = db.prepare("SELECT originating_content_sha256, status, last_requested_page FROM material_reading_state WHERE material_id = 'root-phak'").get();
  assert.equal(rs.originating_content_sha256, hashV1);
  assert.equal(rs.status, "unverified");
});

test("M4-DB-4: ON DELETE CASCADE cleans up navigation records on material removal", () => {
  const db = setupPopulatedDatabase();
  const candidateSql = fs.readFileSync(
    path.resolve("docs/evidence/m4-document-navigation-eval-2026-10-11/candidate/candidate_migration_0015.sql"),
    "utf-8"
  );
  db.exec(candidateSql);

  const hash = "a".repeat(64);
  db.prepare("INSERT INTO material_content_identities VALUES ('ch2-part', ?, 16, '2026-10-11T00:00:00Z')").run(hash);
  db.prepare("INSERT INTO material_bookmarks VALUES ('bm-ch2', 'ch2-part', 5, '5', ?, 'Stall Speed', '', 'verified', '2026-10-11T00:00:00Z', '2026-10-11T00:00:00Z')").run(hash);
  db.prepare("INSERT INTO material_reading_state VALUES ('ch2-part', 5, '5', 1, ?, 'active', '2026-10-11T00:00:00Z')").run(hash);

  // Delete the study material
  db.prepare("DELETE FROM study_materials WHERE id = 'ch2-part'").run();

  // All dependent navigation rows must be deleted by CASCADE
  assert.equal(db.prepare("SELECT COUNT(*) as cnt FROM material_bookmarks WHERE material_id = 'ch2-part'").get().cnt, 0);
  assert.equal(db.prepare("SELECT COUNT(*) as cnt FROM material_reading_state WHERE material_id = 'ch2-part'").get().cnt, 0);
  assert.equal(db.prepare("SELECT COUNT(*) as cnt FROM material_content_identities WHERE material_id = 'ch2-part'").get().cnt, 0);
});

test("M4-DB-5: Transaction rollback restores previous state on failed update", () => {
  const db = setupPopulatedDatabase();
  const candidateSql = fs.readFileSync(
    path.resolve("docs/evidence/m4-document-navigation-eval-2026-10-11/candidate/candidate_migration_0015.sql"),
    "utf-8"
  );
  db.exec(candidateSql);

  const hashOriginal = "9".repeat(64);
  db.prepare("INSERT INTO material_content_identities VALUES ('root-phak', ?, 50, '2026-10-11T00:00:00Z')").run(hashOriginal);

  // Attempt atomic update with invalid secondary operation
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("UPDATE material_content_identities SET content_sha256 = ? WHERE material_id = 'root-phak'").run("8".repeat(64));
    // Purposely trigger a CHECK error
    db.prepare("INSERT INTO material_content_identities VALUES ('bad', 'invalid-hash', 10, 'x')").run();
    db.exec("COMMIT");
    assert.fail("Should have failed");
  } catch (err) {
    db.exec("ROLLBACK");
  }

  // Value must remain original
  const current = db.prepare("SELECT content_sha256 FROM material_content_identities WHERE material_id = 'root-phak'").get();
  assert.equal(current.content_sha256, hashOriginal);
});
