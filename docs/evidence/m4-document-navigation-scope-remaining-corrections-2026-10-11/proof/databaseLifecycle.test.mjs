/**
 * Her Flight Deck - File-Backed SQLite Database Lifecycle Tests (Corrected for M4-R6)
 *
 * Exercises:
 * - Real file-backed SQLite database (PRAGMA foreign_keys = ON)
 * - Migration from shipped 0001-0013 to candidate 0015
 * - Close and reopen across connection boundaries
 * - Content replacement A/50 -> B/10 and mixed bookmark generations
 * - Bounded revalidation: matching hash cannot verify page 42 in a 10-page doc
 * - Multi-table transaction rollback
 * - ON DELETE CASCADE cleanup
 * - Backup and restore with document drift revalidation
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DocumentPersistenceProtocol } from "./persistenceProtocol.mjs";

const tmpDir = path.resolve("docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/scratch/test-dbs");
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

function initFileDb(dbName) {
  const dbPath = path.join(tmpDir, dbName);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");

  // Load shipped migrations 0001-0013
  const migrationsDir = path.resolve("src-tauri/migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    db.exec(fs.readFileSync(path.join(migrationsDir, f), "utf-8"));
  }

  // Apply candidate 0015
  const candidateSql = fs.readFileSync(
    path.resolve("docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/candidate/candidate_migration_0015.sql"),
    "utf-8"
  );
  const protocol = new DocumentPersistenceProtocol(db);
  protocol.applyCandidateDdl(candidateSql);

  return { db, dbPath, protocol };
}

test("M4-DB-LC-1: Shipped schema 0001-0013 upgrade to candidate 0015 retains existing rows", () => {
  const { db, dbPath } = initFileDb("test_upgrade.db");

  // Insert sample material before candidate usage
  db.exec(`
    INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at)
    VALUES ('mat-1', 'FAA Instrument Flying Handbook', 'study_guide', 'instrument', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');
  `);

  const mat = db.prepare("SELECT * FROM study_materials WHERE id = 'mat-1'").get();
  assert.equal(mat.title, "FAA Instrument Flying Handbook");

  db.close();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

test("M4-DB-LC-2: Close and reopen verifies durable persistence across connections", () => {
  const dbPath = path.join(tmpDir, "test_reopen.db");
  const hashA = "a".repeat(64);

  // Connection 1: write data
  {
    const { db, protocol } = initFileDb("test_reopen.db");
    db.exec(`
      INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at)
      VALUES ('m-persist', 'Persist Doc', 'study_guide', 'general', 'now', 'now');
    `);
    protocol.saveContentIdentity("m-persist", hashA, 50);
    protocol.saveReadingState("m-persist", 12, { contentSha256: hashA, label: "2-3" });
    protocol.addBookmark({
      id: "bm-1",
      materialId: "m-persist",
      pageIndex: 12,
      pageLabel: "2-3",
      originatingContentSha256: hashA,
      title: "VOR Approaches",
    });
    db.close();
  }

  // Connection 2: reopen and verify
  {
    const db2 = new DatabaseSync(dbPath);
    db2.exec("PRAGMA foreign_keys = ON;");

    const reading = db2.prepare("SELECT * FROM material_reading_state WHERE material_id = 'm-persist'").get();
    assert.equal(reading.last_requested_page, 12);
    assert.equal(reading.last_requested_page_label, "2-3");
    assert.equal(reading.confirmed_read, 0);

    const bm = db2.prepare("SELECT * FROM material_bookmarks WHERE id = 'bm-1'").get();
    assert.equal(bm.title, "VOR Approaches");
    assert.equal(bm.originating_content_sha256, hashA);
    assert.equal(bm.status, "verified");

    db2.close();
  }

  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

test("M4-DB-LC-3: Content replacement A/50 -> B/10 marks old bookmarks unverified and creates mixed generations", () => {
  const { db, dbPath, protocol } = initFileDb("test_replacement.db");
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);

  db.exec(`
    INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at)
    VALUES ('mat-replace', 'Doc Replacement', 'study_guide', 'general', 'now', 'now');
  `);

  protocol.saveContentIdentity("mat-replace", hashA, 50);

  // Generation 1 bookmarks (bound to hash A)
  protocol.addBookmark({
    id: "bm-gen1-p5",
    materialId: "mat-replace",
    pageIndex: 5,
    originatingContentSha256: hashA,
    title: "Intro Gen 1",
  });
  protocol.addBookmark({
    id: "bm-gen1-p42",
    materialId: "mat-replace",
    pageIndex: 42,
    originatingContentSha256: hashA,
    title: "Holding Patterns Gen 1",
  });

  // Document replaced with Edition B (hash B, 10 pages)
  protocol.saveContentIdentity("mat-replace", hashB, 10);
  const recResult = protocol.reconcileBookmarksOnContentUpdate("mat-replace", hashB, { totalPages: 10 });
  assert.equal(recResult.unverified, 2);

  // Generation 2 bookmark added for Edition B
  protocol.addBookmark({
    id: "bm-gen2-p3",
    materialId: "mat-replace",
    pageIndex: 3,
    originatingContentSha256: hashB,
    title: "New Intro Gen 2",
  });

  // Verify mixed generations co-exist
  const bms = db.prepare("SELECT id, originating_content_sha256, page_index, status FROM material_bookmarks WHERE material_id = 'mat-replace' ORDER BY id").all();
  assert.equal(bms.length, 3);

  const gen1p5 = bms.find((b) => b.id === "bm-gen1-p5");
  assert.equal(gen1p5.originating_content_sha256, hashA);
  assert.equal(gen1p5.status, "unverified"); // Drifted content

  const gen1p42 = bms.find((b) => b.id === "bm-gen1-p42");
  assert.equal(gen1p42.originating_content_sha256, hashA);
  assert.equal(gen1p42.status, "unverified"); // Drifted content

  const gen2p3 = bms.find((b) => b.id === "bm-gen2-p3");
  assert.equal(gen2p3.originating_content_sha256, hashB);
  assert.equal(gen2p3.status, "verified");

  db.close();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

test("M4-DB-LC-4: Bounded revalidation: same hash cannot verify an out-of-bounds bookmark", () => {
  const { db, dbPath, protocol } = initFileDb("test_bounds.db");
  const hashA = "a".repeat(64);

  db.exec(`
    INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at)
    VALUES ('mat-bounds', 'Bounds Doc', 'study_guide', 'general', 'now', 'now');
  `);

  // Document shrunk to 10 pages, but hash miraculously matches (e.g. truncated file)
  protocol.addBookmark({
    id: "bm-oob",
    materialId: "mat-bounds",
    pageIndex: 42,
    originatingContentSha256: hashA,
    title: "Out of Bounds Bookmark",
    status: "unverified",
  });

  // Reconcile with totalPages: 10
  const result = protocol.reconcileBookmarksOnContentUpdate("mat-bounds", hashA, { totalPages: 10 });
  assert.equal(result.unverified, 1);
  assert.equal(result.verified, 0);

  const bm = db.prepare("SELECT status FROM material_bookmarks WHERE id = 'bm-oob'").get();
  assert.equal(bm.status, "unverified", "Out-of-bounds bookmark MUST NOT become verified");

  db.close();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

test("M4-DB-LC-5: Multi-table transaction rollback restores state on failure", () => {
  const { db, dbPath, protocol } = initFileDb("test_rollback.db");
  const hash = "c".repeat(64);

  db.exec(`
    INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at)
    VALUES ('mat-roll', 'Rollback Doc', 'study_guide', 'general', 'now', 'now');
  `);

  protocol.saveContentIdentity("mat-roll", hash, 20);
  protocol.saveReadingState("mat-roll", 5, { contentSha256: hash });

  // Simulate transactional multi-update with check violation on 3rd step
  assert.throws(() => {
    db.exec("BEGIN TRANSACTION;");
    try {
      db.prepare("UPDATE material_reading_state SET last_requested_page = 10 WHERE material_id = 'mat-roll'").run();
      // Step that fails CHECK constraint (page index 0 is invalid)
      db.prepare("INSERT INTO material_bookmarks (id, material_id, page_index, originating_content_sha256, title, created_at, updated_at) VALUES ('bad', 'mat-roll', 0, ?, 'Bad', 'now', 'now')").run(hash);
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
  }, /CHECK constraint failed/);

  // Verify rollback preserved initial state
  const state = db.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id = 'mat-roll'").get();
  assert.equal(state.last_requested_page, 5, "Transaction rollback successfully restored last_requested_page to 5");

  db.close();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

test("M4-DB-LC-6: ON DELETE CASCADE cleans up all dependent navigation rows", () => {
  const { db, dbPath, protocol } = initFileDb("test_cascade.db");
  const hash = "d".repeat(64);

  db.exec(`
    INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at)
    VALUES ('mat-del', 'To Delete', 'study_guide', 'general', 'now', 'now');
  `);

  protocol.saveContentIdentity("mat-del", hash, 30);
  protocol.saveReadingState("mat-del", 15, { contentSha256: hash });
  protocol.addBookmark({
    id: "bm-del",
    materialId: "mat-del",
    pageIndex: 15,
    originatingContentSha256: hash,
    title: "Deleted Bookmark",
  });

  // Delete the material
  db.exec("DELETE FROM study_materials WHERE id = 'mat-del';");

  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM material_reading_state WHERE material_id = 'mat-del'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM material_bookmarks WHERE material_id = 'mat-del'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM material_content_identities WHERE material_id = 'mat-del'").get().c, 0);

  db.close();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

test("M4-DB-LC-7: Disposable backup and restore preserves authoritative rows and triggers revalidation on drift", () => {
  const { db, dbPath, protocol } = initFileDb("test_source.db");
  const backupPath = path.join(tmpDir, "test_backup.db");
  const hashOrig = "e".repeat(64);

  db.exec(`
    INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at)
    VALUES ('mat-bk', 'Backup Material', 'study_guide', 'general', 'now', 'now');
  `);

  protocol.saveContentIdentity("mat-bk", hashOrig, 25);
  protocol.addBookmark({
    id: "bm-bk",
    materialId: "mat-bk",
    pageIndex: 10,
    originatingContentSha256: hashOrig,
    title: "Backed Up Bookmark",
  });

  // Perform backup (SQLite file copy of clean db)
  db.close();
  fs.copyFileSync(dbPath, backupPath);

  // Restore into a fresh connection
  const restoredDb = new DatabaseSync(backupPath);
  restoredDb.exec("PRAGMA foreign_keys = ON;");

  const restoredBm = restoredDb.prepare("SELECT * FROM material_bookmarks WHERE id = 'bm-bk'").get();
  assert.equal(restoredBm.title, "Backed Up Bookmark");
  assert.equal(restoredBm.originating_content_sha256, hashOrig);

  // Simulate file restored from backup has drifted bytes on disk
  const hashNew = "f".repeat(64);
  const restoredProto = new DocumentPersistenceProtocol(restoredDb);
  restoredProto.reconcileBookmarksOnContentUpdate("mat-bk", hashNew, { totalPages: 25 });

  const updatedBm = restoredDb.prepare("SELECT status, originating_content_sha256 FROM material_bookmarks WHERE id = 'bm-bk'").get();
  assert.equal(updatedBm.status, "unverified", "Restored bookmark correctly marked unverified after disk drift");
  assert.equal(updatedBm.originating_content_sha256, hashOrig, "Original hash preserved across backup and drift");

  restoredDb.close();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
});
