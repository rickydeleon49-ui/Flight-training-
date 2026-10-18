/**
 * Her Flight Deck - Database Lifecycle, Rollback, Upgrade & Backup Verification (round 2)
 *
 * M4-R21: the shipped migration ledger is discovered from the verified accepted-main reference tree
 * (scratch/accepted-main/), never from this worktree's own stale 13-file src-tauri/migrations/, and
 * the older-binary ceiling is derived from the parsed CURRENT_SCHEMA_VERSION rather than a literal.
 * The provisional candidate version is exercised on a populated, candidate-upgraded database.
 *
 * Retained: populated-before-candidate-DDL ordering, the trigger-fault rollback of the real
 * replacement transaction, file-backed close/reopen, synthetic backup/restore with real document
 * bytes including drift and deletion, and foreign-key cascade.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { DocumentPersistenceProtocol } from "./persistenceProtocol.mjs";
import { detectContentDrift } from "./contractModel.mjs";

import {
  ledgerDir,
  readCeiling,
  loadVerifiedLedger,
  applyShippedMigrations,
  candidateDdlText,
  probeBinaryCompatibility,
  CANDIDATE_PROVISIONAL_VERSION,
} from "./shippedLedger.mjs";

/**
 * Round 5 fixture setup (M4-R34): the corrected protocol authorizes a write only for the exact,
 * currently reserved token, so a fixture that seeds a saved position first reserves that token
 * through the real protocol. Assertions about the seeded state are unchanged.
 */
function reserveExactly(p, materialId, generation) {
  const token = p.reserveOperationOwnership(materialId, generation - 1);
  assert.equal(token, generation, `fixture expected to reserve token ${generation}`);
  return token;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const packRoot = path.resolve(here, "..");

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function getCandidateDdl() {
  return candidateDdlText();
}

function insertStudyMaterial(db, id, title, filePath) {
  db.prepare(
    "INSERT INTO study_materials (id, title, material_type, topic, file_path, created_at, updated_at) VALUES (?,?,'handbook','IFR',?,?,?)"
  ).run(id, title, filePath ?? "/docs/ifh.pdf", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z");
}

// ---------------------------------------------------------------------------

test("[M4-R21] populated schema 1-14 upgrade preserves all prior rows including M3 skills evidence", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const applied = applyShippedMigrations(db);
    assert.equal(applied.count, applied.ceiling, "the suite must apply exactly the accepted-base migration set");
    assert.equal(applied.count, 14, "accepted main ships 0001-0014");
    // Migration 0014 seeds the builtin skill catalog; retention is measured as a delta over that seed.
    const seededSkills = db.prepare("SELECT COUNT(*) AS c FROM skill_catalog_entries").get().c;
    const seededAssessments = db.prepare("SELECT COUNT(*) AS c FROM skill_self_assessments").get().c;

    insertStudyMaterial(db, "mat_01", "Instrument Flying Handbook", "/docs/ifh.pdf");
    insertStudyMaterial(db, "mat_02", "Airplane Flying Handbook", "/docs/afh.pdf");
    insertStudyMaterial(db, "mat_split", "Split Chapter 1", "/docs/split.pdf");
    db.prepare("INSERT INTO notes (id,title,body,pinned,created_at,updated_at) VALUES ('note_01','VOR Nav Notes','Remember radial vs bearing',1,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')").run();
    db.prepare(`
      INSERT INTO material_split_lineage (
        material_id, parent_material_id, root_material_id, source_page_start, source_page_end,
        parent_page_start, parent_page_end, child_page_count, source_file_name, source_title,
        source_total_pages, parent_file_name, parent_title, parent_total_pages, nested_level, created_at
      ) VALUES ('mat_split', NULL, 'mat_01', 1, 16, NULL, NULL, 16, 'ifh.pdf', 'Instrument Flying Handbook', 200, NULL, NULL, NULL, 1, '2026-10-01T00:00:00Z')
    `).run();
    // M3 skills-evidence rows written by the now-shipped migration 0014.
    db.prepare("INSERT INTO skill_catalog_entries (id,origin,label,description,topic,status,revision,created_at,updated_at) VALUES ('custom.steep_turns','custom','Steep Turns','','general','active',1,'2026-10-08T00:00:00Z','2026-10-08T00:00:00Z')").run();
    db.prepare("INSERT INTO skill_self_assessments (id,skill_id,kind,status,confidence,sequence,operation_id,set_at) VALUES ('sa_1','custom.steep_turns','confidence',NULL,3,1,'op_sa_1','2026-10-08T00:00:00Z')").run();

    const before = {
      materials: db.prepare("SELECT COUNT(*) AS c FROM study_materials").get().c,
      notes: db.prepare("SELECT COUNT(*) AS c FROM notes").get().c,
      lineage: db.prepare("SELECT COUNT(*) AS c FROM material_split_lineage").get().c,
      skills: db.prepare("SELECT COUNT(*) AS c FROM skill_catalog_entries").get().c,
      assessments: db.prepare("SELECT COUNT(*) AS c FROM skill_self_assessments").get().c,
      ledgerMax: db.prepare("SELECT MAX(version) AS v FROM _sqlx_migrations").get().v,
    };
    const tablesBefore = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'").get().c;
    assert.equal(before.materials, 3);
    assert.ok(seededSkills >= 1, "precondition: migration 0014 seeds the builtin catalog");
    assert.equal(before.skills, seededSkills + 1, "one custom skill added over the seed");
    assert.equal(before.assessments, seededAssessments + 1);
    assert.equal(before.ledgerMax, 14);

    new DocumentPersistenceProtocol(db).applyCandidateDdl(getCandidateDdl());

    const after = {
      materials: db.prepare("SELECT COUNT(*) AS c FROM study_materials").get().c,
      notes: db.prepare("SELECT COUNT(*) AS c FROM notes").get().c,
      lineage: db.prepare("SELECT COUNT(*) AS c FROM material_split_lineage").get().c,
      skills: db.prepare("SELECT COUNT(*) AS c FROM skill_catalog_entries").get().c,
      assessments: db.prepare("SELECT COUNT(*) AS c FROM skill_self_assessments").get().c,
      ledgerMax: db.prepare("SELECT MAX(version) AS v FROM _sqlx_migrations").get().v,
    };
    assert.deepEqual(after, before, "no shipped row may be lost by applying the candidate DDL");
    const tablesAfter = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'").get().c;
    // Round 5 (M4-R33): the claims table is now declared in the candidate instead of being created
    // on demand at runtime, so the candidate adds four tables.
    assert.equal(tablesAfter, tablesBefore + 4, "candidate adds exactly four navigation tables (including operation claims) and changes nothing else");
    assert.ok(tablesAfter >= 44, `accepted base plus candidate must reach at least 44 tables, got ${tablesAfter}`);
    assert.equal(db.prepare("SELECT title, file_path FROM study_materials WHERE id='mat_01'").get().title, "Instrument Flying Handbook");
    assert.equal(db.prepare("SELECT label, revision FROM skill_catalog_entries WHERE id='custom.steep_turns'").get().revision, 1);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'material_%' ORDER BY name").all().map((r) => r.name);
    for (const need of ["material_bookmarks", "material_content_identities", "material_operation_claims", "material_reading_state"]) {
      assert.ok(tables.includes(need), `candidate table ${need} must exist`);
    }
    assert.equal(db.prepare("SELECT MAX(version) AS v FROM _sqlx_migrations").get().v, 14, "candidate 0015 must NOT be registered");
  } finally { db.close(); }
});

test("[M4-R21] candidate 0015 coexists with shipped 0014 for the navigation writers", () => {
  const db = new DatabaseSync(":memory:");
  try {
    applyShippedMigrations(db);
    insertStudyMaterial(db, "mat_co", "Coexistence", "/docs/co.pdf");
    const p = new DocumentPersistenceProtocol(db);
    p.applyCandidateDdl(getCandidateDdl());
    p.saveContentIdentity("mat_co", SHA_A, 50);
    p.addBookmark({ id: "bmk_co", materialId: "mat_co", pageIndex: 42, originatingContentSha256: SHA_A, title: "Approach plates" });
    reserveExactly(p, "mat_co", 1);
    const verdict = p.commitNavigation(
      { materialId: "mat_co", contentSha256: SHA_A, physicalPage: 42, pageLabel: "forty-two", totalPages: 50, coordinateSpace: "material_physical", provenance: "physical_index" },
      1
    );
    assert.equal(verdict.committed, true);
    assert.equal(verdict.status, "active");
    assert.equal(db.prepare("SELECT status FROM material_bookmarks WHERE id='bmk_co'").get().status, "verified");
    // M3's own tables remain writable alongside the candidate tables.
    const seededSkills = db.prepare("SELECT COUNT(*) AS c FROM skill_catalog_entries").get().c;
    db.prepare("INSERT INTO skill_catalog_entries (id,origin,catalog_version,label,description,topic,status,revision,created_at,updated_at) VALUES ('builtin.co_ex','builtin',1,'Co','x','general','active',1,'t','t')").run();
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM skill_catalog_entries").get().c, seededSkills + 1);
  } finally { db.close(); }
});

test("[M4-R21] pointing the ledger back at this worktree's own migrations fails the verification", () => {
  // Round 4 (Claude): this used to read the surrounding checkout's src-tauri/migrations and
  // assumed it was a stale 13-migration worktree. That only held in the original checkout, so
  // the test failed its precondition anywhere else. A stale ledger is now built explicitly: the
  // verified accepted ledger without 0014. The assertion is unchanged.
  const staleLedger = fs.mkdtempSync(path.join(os.tmpdir(), "hfd-ledger-stale-"));
  try {
    for (const f of fs.readdirSync(ledgerDir())) {
      if (f !== "0014_skills_evidence.sql") fs.copyFileSync(path.join(ledgerDir(), f), path.join(staleLedger, f));
    }
    assert.equal(
      fs.readdirSync(staleLedger).filter((f) => f.endsWith(".sql")).length,
      13,
      "precondition: the stale ledger is behind accepted main"
    );
    assert.throws(() => loadVerifiedLedger(staleLedger), /checksum manifest lists 0014_skills_evidence\.sql/);
  } finally {
    fs.rmSync(staleLedger, { recursive: true, force: true });
  }
});

test("[M4-R21] an altered byte in the extracted ledger fails verification before any database is built", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hfd-ledger-tamper-"));
  try {
    for (const f of fs.readdirSync(ledgerDir())) fs.copyFileSync(path.join(ledgerDir(), f), path.join(tmp, f));
    const target = path.join(tmp, "0014_skills_evidence.sql");
    fs.writeFileSync(target, fs.readFileSync(target).toString().replace("skill_catalog_entries", "skill_catalog_entryX"));
    assert.throws(() => loadVerifiedLedger(tmp), /checksum mismatch for 0014_skills_evidence\.sql/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("[M4-R21] older binary refuses a candidate-upgraded database using the derived ceiling", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const { ceiling } = applyShippedMigrations(db);
    insertStudyMaterial(db, "mat_ver", "Version probe", "/docs/v.pdf");
    const p = new DocumentPersistenceProtocol(db);
    p.applyCandidateDdl(getCandidateDdl());
    p.saveContentIdentity("mat_ver", SHA_A, 50);

    const currentBinary = probeBinaryCompatibility(db, ceiling);
    assert.equal(currentBinary.compatible, true, `accepted base ${ceiling} must accept its own ledger (${currentBinary.newest})`);

    // The documented provisional candidate version, as it would appear once registered.
    db.prepare("INSERT OR REPLACE INTO _sqlx_migrations(version) VALUES (?)").run(CANDIDATE_PROVISIONAL_VERSION);
    const olderBinary = probeBinaryCompatibility(db, ceiling);
    assert.equal(olderBinary.compatible, false, "a binary at the accepted base must refuse the candidate schema");
    assert.equal(olderBinary.newest, CANDIDATE_PROVISIONAL_VERSION);
    assert.equal(olderBinary.ceiling, ceiling);
    assert.match(olderBinary.error, /newer database format/);
    assert.ok(ceiling !== 13, "the ceiling must be derived, not the stale worktree base");

    // A binary that knows the candidate format accepts it.
    assert.equal(probeBinaryCompatibility(db, CANDIDATE_PROVISIONAL_VERSION).compatible, true, "positive control for the probe itself");

    // A database with no ledger at all is refused, as the real gate does.
    const bare = new DatabaseSync(":memory:");
    try {
      const r = probeBinaryCompatibility(bare, ceiling);
      assert.equal(r.compatible, false);
      assert.match(r.error, /migration history/);
    } finally { bare.close(); }
  } finally { db.close(); }
});

test("[M4-R10] atomic replacement transaction rolls back completely upon injected fault", () => {
  const db = new DatabaseSync(":memory:");
  try {
    applyShippedMigrations(db);
    insertStudyMaterial(db, "mat_fault", "Fault Doc", "/docs/f.pdf");
    const protocol = new DocumentPersistenceProtocol(db);
    protocol.applyCandidateDdl(getCandidateDdl());

    protocol.saveContentIdentity("mat_fault", SHA_A, 50);
    protocol.addBookmark({ id: "bmk_fault_1", materialId: "mat_fault", pageIndex: 42, originatingContentSha256: SHA_A, title: "VOR plates" });
    reserveExactly(protocol, "mat_fault", 1);
    protocol.saveReadingState("mat_fault", 42, { contentSha256: SHA_A, generation: 1 });

    db.exec("CREATE TRIGGER fault BEFORE UPDATE ON material_reading_state BEGIN SELECT RAISE(ABORT,'Simulated crash during atomic replacement transaction'); END;");
    assert.throws(
      () => protocol.replaceContentIdentity("mat_fault", SHA_B, 10),
      /Simulated crash during atomic replacement transaction/
    );
    db.exec("DROP TRIGGER fault;");

    const identity = db.prepare("SELECT content_sha256, total_pages FROM material_content_identities WHERE material_id='mat_fault'").get();
    assert.equal(identity.content_sha256, SHA_A, "identity write must roll back");
    assert.equal(identity.total_pages, 50);
    assert.equal(db.prepare("SELECT status FROM material_bookmarks WHERE id='bmk_fault_1'").get().status, "verified", "bookmark invalidation must roll back");
    assert.equal(db.prepare("SELECT status FROM material_reading_state WHERE material_id='mat_fault'").get().status, "active", "reading state must roll back");
    assert.equal(db.prepare("SELECT owner_generation FROM material_reading_state WHERE material_id='mat_fault'").get().owner_generation, 1);
  } finally { db.close(); }
});

test("[M4-R10] file-backed SQLite database safely closes and reopens", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hfd-r2-reopen-"));
  const dbPath = path.join(tmpDir, "test_file_backed.db");
  try {
    const db1 = new DatabaseSync(dbPath);
    applyShippedMigrations(db1);
    const protocol1 = new DocumentPersistenceProtocol(db1);
    protocol1.applyCandidateDdl(getCandidateDdl());
    insertStudyMaterial(db1, "mat_reopen", "Reopen Test", "/docs/r.pdf");
    protocol1.saveContentIdentity("mat_reopen", SHA_A, 50);
    protocol1.addBookmark({ id: "bmk_reopen_1", materialId: "mat_reopen", pageIndex: 15, originatingContentSha256: SHA_A, title: "Chapter 2" });
    reserveExactly(protocol1, "mat_reopen", 7);
    protocol1.commitNavigation(
      { materialId: "mat_reopen", contentSha256: SHA_A, physicalPage: 15, pageLabel: "fifteen", totalPages: 50, coordinateSpace: "material_physical", provenance: "physical_index" },
      7
    );
    db1.close();

    const db2 = new DatabaseSync(dbPath);
    try {
      const bmk = db2.prepare("SELECT id, page_index, status FROM material_bookmarks WHERE id='bmk_reopen_1'").get();
      assert.equal(bmk.status, "verified");
      const row = db2.prepare("SELECT last_requested_page, last_requested_page_label, owner_generation, status FROM material_reading_state WHERE material_id='mat_reopen'").get();
      assert.equal(row.last_requested_page, 15, "persisted page must survive reopen");
      assert.equal(row.last_requested_page_label, "fifteen", "persisted label must survive reopen");
      assert.equal(row.owner_generation, 7, "ownership token must survive reopen");
      assert.equal(row.status, "active");
      assert.equal(db2.prepare("SELECT total_pages FROM material_content_identities WHERE material_id='mat_reopen'").get().total_pages, 50);
    } finally { db2.close(); }
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test("[M4-R10] synthetic backup and restore preserves state and detects drift/missing files", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hfd-r2-backup-"));
  const docsDir = path.join(tmpDir, "documents");
  const backupDir = path.join(tmpDir, "backup");
  const dbPath = path.join(tmpDir, "flight_training.db");
  const backupDbPath = path.join(backupDir, "flight_training.db");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  try {
    const file1 = path.join(docsDir, "guide1.pdf");
    const file2 = path.join(docsDir, "guide2.pdf");
    const bytes1 = Buffer.from("%PDF-1.4 synthetic guide 1 content");
    const bytes2 = Buffer.from("%PDF-1.4 synthetic guide 2 content");
    fs.writeFileSync(file1, bytes1);
    fs.writeFileSync(file2, bytes2);
    const hash1 = crypto.createHash("sha256").update(bytes1).digest("hex");
    const hash2 = crypto.createHash("sha256").update(bytes2).digest("hex");

    const db = new DatabaseSync(dbPath);
    applyShippedMigrations(db);
    const protocol = new DocumentPersistenceProtocol(db);
    protocol.applyCandidateDdl(getCandidateDdl());
    insertStudyMaterial(db, "m_doc1", "Guide 1", file1);
    insertStudyMaterial(db, "m_doc2", "Guide 2", file2);
    db.prepare("UPDATE study_materials SET topic='VFR' WHERE id='m_doc2'").run();
    protocol.saveContentIdentity("m_doc1", hash1, 20);
    protocol.saveContentIdentity("m_doc2", hash2, 30);
    protocol.addBookmark({ id: "b_doc1", materialId: "m_doc1", pageIndex: 5, originatingContentSha256: hash1, title: "Approach Plates" });
    reserveExactly(protocol, "m_doc1", 1);
    protocol.commitNavigation({ materialId: "m_doc1", contentSha256: hash1, physicalPage: 5, pageLabel: null, totalPages: 20, coordinateSpace: "material_physical", provenance: "physical_index" }, 1);
    db.close();

    fs.copyFileSync(dbPath, backupDbPath);
    const backupDocs = path.join(backupDir, "documents");
    fs.mkdirSync(backupDocs, { recursive: true });
    fs.copyFileSync(file1, path.join(backupDocs, "guide1.pdf"));
    fs.copyFileSync(file2, path.join(backupDocs, "guide2.pdf"));

    // Real document drift and deletion in live storage.
    fs.writeFileSync(file1, Buffer.from("%PDF-1.4 MODIFIED CONTENT"));
    assert.equal(detectContentDrift(fs.readFileSync(file1), hash1).driftStatus, "drifted");
    fs.unlinkSync(file2);
    assert.equal(detectContentDrift(null, hash2).driftStatus, "missing_file");

    // Restore both the database and the authoritative document bytes.
    fs.copyFileSync(backupDbPath, dbPath);
    fs.copyFileSync(path.join(backupDocs, "guide1.pdf"), file1);
    fs.copyFileSync(path.join(backupDocs, "guide2.pdf"), file2);
    assert.equal(detectContentDrift(fs.readFileSync(file1), hash1).isMatch, true);
    assert.equal(detectContentDrift(fs.readFileSync(file2), hash2).isMatch, true);

    const restored = new DatabaseSync(dbPath);
    try {
      assert.equal(restored.prepare("SELECT status FROM material_bookmarks WHERE id='b_doc1'").get().status, "verified");
      const r = restored.prepare("SELECT last_requested_page, owner_generation, status FROM material_reading_state WHERE material_id='m_doc1'").get();
      assert.equal(r.last_requested_page, 5, "restored database must carry the authoritative navigation row");
      assert.equal(r.owner_generation, 1, "restored ownership fence must come back with the row");
      assert.equal(r.status, "active");
      assert.equal(probeBinaryCompatibility(restored, readCeiling()).compatible, true, "a restored accepted-base backup stays acceptable");
    } finally { restored.close(); }
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test("[M4-R10] deleting study_materials cascades to content identities, bookmarks, and reading state", () => {
  const db = new DatabaseSync(":memory:");
  try {
    applyShippedMigrations(db);
    insertStudyMaterial(db, "mat_cascade", "Cascade Doc", "/docs/c.pdf");
    const protocol = new DocumentPersistenceProtocol(db);
    protocol.applyCandidateDdl(getCandidateDdl());
    protocol.saveContentIdentity("mat_cascade", SHA_A, 50);
    protocol.addBookmark({ id: "bmk_casc", materialId: "mat_cascade", pageIndex: 10, originatingContentSha256: SHA_A, title: "Cascade Bookmark" });
    reserveExactly(protocol, "mat_cascade", 1);
    protocol.commitNavigation({ materialId: "mat_cascade", contentSha256: SHA_A, physicalPage: 10, pageLabel: null, totalPages: 50, coordinateSpace: "material_physical", provenance: "physical_index" }, 1);

    for (const t of ["material_content_identities", "material_bookmarks", "material_reading_state"]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE material_id='mat_cascade'`).get().c, 1, `${t} row must exist`);
    }
    db.exec("DELETE FROM study_materials WHERE id='mat_cascade';");
    for (const t of ["material_content_identities", "material_bookmarks", "material_reading_state"]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE material_id='mat_cascade'`).get().c, 0, `${t} row must cascade`);
    }
  } finally { db.close(); }
});

test("[M4-R10] replacement of a drifted document leaves prior navigation visible but unverified", () => {
  const db = new DatabaseSync(":memory:");
  try {
    applyShippedMigrations(db);
    insertStudyMaterial(db, "mat_drift", "Drift Doc", "/docs/d.pdf");
    const p = new DocumentPersistenceProtocol(db);
    p.applyCandidateDdl(getCandidateDdl());
    p.saveContentIdentity("mat_drift", SHA_A, 50);
    p.addBookmark({ id: "bmk_drift", materialId: "mat_drift", pageIndex: 42, originatingContentSha256: SHA_A, title: "Engine Failure Checklist" });
    reserveExactly(p, "mat_drift", 1);
    p.commitNavigation({ materialId: "mat_drift", contentSha256: SHA_A, physicalPage: 42, pageLabel: "forty-two", totalPages: 50, coordinateSpace: "material_physical", provenance: "physical_index" }, 1);

    p.replaceContentIdentity("mat_drift", SHA_B, 10);
    const b = db.prepare("SELECT status, originating_content_sha256, page_index FROM material_bookmarks WHERE id='bmk_drift'").get();
    assert.equal(b.status, "unverified");
    assert.equal(b.originating_content_sha256, SHA_A, "original hash retained for audit");
    assert.equal(b.page_index, 42, "original coordinates retained");

    // A stale write for the old generation stays unverified rather than becoming active again.
    reserveExactly(p, "mat_drift", 2);
    const stale = p.commitNavigation({ materialId: "mat_drift", contentSha256: SHA_A, physicalPage: 42, pageLabel: "forty-two", totalPages: 50, coordinateSpace: "material_physical", provenance: "physical_index" }, 2);
    assert.equal(stale.committed, true, "generation 2 owns the row");
    assert.equal(stale.status, "unverified", "content no longer matches, so it cannot be active");
    assert.equal(db.prepare("SELECT status FROM material_reading_state WHERE material_id='mat_drift'").get().status, "unverified");
  } finally { db.close(); }
});
