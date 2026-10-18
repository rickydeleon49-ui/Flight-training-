/**
 * Her Flight Deck - Milestone 4 Comprehensive Proof Suite
 * Covers M4-R9, M4-R10, M4-R11, M4-R12
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  validatePageIndex,
  parsePageReference,
  translateSplitCoordinates,
  reconcileBookmarksOnContentDrift,
  detectContentDrift,
} from "./contractModel.mjs";
import { DocumentPersistenceProtocol } from "./persistenceProtocol.mjs";
import { OpenerController } from "./openerController.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

const sampleMaterial = {
  id: "mat_sample_001",
  title: "Flight Training Handbook",
  filePath: "handbook.pdf",
  contentSha256: SHA_A,
  totalPages: 50,
};

const fullLineage = {
  materialId: "split_ch01",
  rootMaterialId: "root_handbook",
  parentMaterialId: "parent_part_a",
  sourcePageStart: 101,
  sourcePageEnd: 116,
  sourceTotalPages: 200,
  parentPageStart: 21,
  parentPageEnd: 36,
  parentTotalPages: 50,
  childPageCount: 16,
  nestedLevel: 2,
};

const firstLevelLineage = {
  materialId: "split_first_level",
  rootMaterialId: "root_handbook",
  parentMaterialId: null,
  sourcePageStart: 101,
  sourcePageEnd: 116,
  sourceTotalPages: 200,
  parentPageStart: null,
  parentPageEnd: null,
  parentTotalPages: null,
  childPageCount: 16,
  nestedLevel: 1,
};

function held() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

function withTestDb(fn) {
  const db = new DatabaseSync(":memory:");
  try {
    const dir = path.resolve("src-tauri/migrations");
    const names = fs
      .readdirSync(dir)
      .filter((p) => p.endsWith(".sql") && Number(p.slice(0, 4)) <= 13)
      .sort();
    for (const p of names) {
      db.exec(fs.readFileSync(path.join(dir, p), "utf8"));
    }
    const protocol = new DocumentPersistenceProtocol(db);
    protocol.applyCandidateDdl(
      fs.readFileSync(
        path.resolve(
          "docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/candidate/candidate_migration_0015.sql"
        ),
        "utf8"
      )
    );
    db.exec(`
      INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at)
      VALUES ('mat_sample_001', 'Flight Training Handbook', 'study_guide', 'general', '2026-10-11T00:00:00Z', '2026-10-11T00:00:00Z')
    `);
    return fn(db, protocol);
  } finally {
    db.close();
  }
}

// -------------------------------------------------------------
// [M4-R9] Complete Destination Validation Tests
// -------------------------------------------------------------

test("[control] bounded physical reference and complete nested translation work", () => {
  assert.equal(parsePageReference(3, { provenance: "physical_index", totalPages: 50 }).physicalIndex, 3);
  assert.equal(translateSplitCoordinates({ direction: "child_to_parent", page: 3 }, fullLineage).parentPage, 23);
});

test("[control] newer missing-path intent still blocks obsolete opener", async () => {
  const h = held();
  const c = new OpenerController({ injectedOpener: () => h.promise });
  const a = c.requestOpen(sampleMaterial, 42);
  await c.requestOpen({ id: "other", filePath: null }, 1);
  h.resolve();
  assert.equal((await a).success, false);
  assert.equal(c.lastNotice, null);
});

test("[M4-R9] unknown and invalid totals cannot resolve physical destinations", () => {
  for (const totalPages of [undefined, null, NaN, Infinity, 2.5, "50"]) {
    assert.equal(
      parsePageReference(42, { provenance: "physical_index", totalPages }).isResolved,
      false,
      String(totalPages)
    );
  }
});

test("[M4-R9] label maps without bounds cannot resolve a verified destination", () => {
  assert.equal(parsePageReference("iv", { labelToPhysicalMap: { iv: 42 } }).isResolved, false);
});

test("[M4-R9] genuine first-level nullable parent metadata permits root navigation", () => {
  assert.equal(
    translateSplitCoordinates({ direction: "child_to_root", page: 3 }, firstLevelLineage).success,
    true
  );
  assert.equal(
    translateSplitCoordinates({ direction: "child_to_root", page: 3 }, firstLevelLineage).rootPage,
    103
  );
});

test("[M4-R9] live root translation requires complete range metadata", () => {
  const { sourcePageEnd, ...incomplete } = fullLineage;
  assert.equal(translateSplitCoordinates({ direction: "child_to_root", page: 3 }, incomplete).success, false);
});

test("[M4-R9] reverse translation cannot succeed without destination identity", () => {
  const { materialId, ...incomplete } = fullLineage;
  assert.equal(translateSplitCoordinates({ direction: "root_to_child", page: 105 }, incomplete).success, false);
});

test("[M4-R9] translated arithmetic must remain a safe integer", () => {
  const invalid = { childPageCount: 3, sourcePageStart: Number.MAX_SAFE_INTEGER, rootMaterialId: "root" };
  assert.equal(translateSplitCoordinates({ direction: "child_to_root", page: 3 }, invalid).success, false);
});

test("[M4-R9] deleted root document returns structured snapshot guidance", () => {
  const deletedRoot = { ...firstLevelLineage, rootMaterialId: null };
  const res = translateSplitCoordinates({ direction: "child_to_root", page: 3 }, deletedRoot);
  assert.equal(res.success, false);
  assert.equal(res.code, "ROOT_DELETED");
  assert.ok(res.snapshotGuidance.includes("Root document deleted"));
});

test("[M4-R9] physical index validation rejects non-integers, zeros, and out-of-bounds", () => {
  assert.equal(validatePageIndex(0, 50).valid, false);
  assert.equal(validatePageIndex(51, 50).valid, false);
  assert.equal(validatePageIndex(3.5, 50).valid, false);
  assert.equal(validatePageIndex(10, NaN).valid, false);
  assert.equal(validatePageIndex(10, 50).valid, true);
});

// -------------------------------------------------------------
// [M4-R10] Atomic Replacement and Navigation Writers
// -------------------------------------------------------------

test("[M4-R10] persisted bookmark cannot default verified outside active bounds", () =>
  withTestDb((db, p) => {
    p.saveContentIdentity("mat_sample_001", SHA_A, 10);
    p.addBookmark({
      id: "bmk_001",
      materialId: "mat_sample_001",
      pageIndex: 42,
      originatingContentSha256: SHA_A,
      title: "Out of bounds bookmark",
    });
    assert.equal(
      db.prepare("SELECT status FROM material_bookmarks WHERE id='bmk_001'").get().status,
      "unverified"
    );
  }));

test("[M4-R10] identity replacement atomically invalidates bookmark and reading state", () =>
  withTestDb((db, p) => {
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    p.addBookmark({
      id: "bmk_002",
      materialId: "mat_sample_001",
      pageIndex: 42,
      originatingContentSha256: SHA_A,
      title: "Page 42 on Doc A",
    });
    p.saveReadingState("mat_sample_001", 42, { contentSha256: SHA_A });

    // Assert initially verified and active
    assert.equal(
      db.prepare("SELECT status FROM material_bookmarks WHERE id='bmk_002'").get().status,
      "verified"
    );
    assert.equal(
      db.prepare("SELECT status FROM material_reading_state WHERE material_id='mat_sample_001'").get().status,
      "active"
    );

    // Atomic replacement with content B (10 pages)
    p.saveContentIdentity("mat_sample_001", SHA_B, 10);

    // Both must be visibly unverified in database
    assert.equal(
      db.prepare("SELECT status FROM material_bookmarks WHERE id='bmk_002'").get().status,
      "unverified"
    );
    assert.equal(
      db.prepare("SELECT status FROM material_reading_state WHERE material_id='mat_sample_001'").get().status,
      "unverified"
    );
  }));

test("[M4-R10] reading state cannot be active outside persisted content bounds", () =>
  withTestDb((db, p) => {
    p.saveContentIdentity("mat_sample_001", SHA_A, 10);
    p.saveReadingState("mat_sample_001", 42, { contentSha256: SHA_A });
    assert.equal(
      db.prepare("SELECT status FROM material_reading_state WHERE material_id='mat_sample_001'").get().status,
      "unverified"
    );
  }));

test("[M4-R10] unknown bounds cannot reverify a matching-hash bookmark", () => {
  const b = { originatingContentSha256: SHA_A, pageIndex: 42, status: "unverified" };
  assert.equal(reconcileBookmarksOnContentDrift([b], SHA_A)[0].status, "unverified");
  assert.equal(reconcileBookmarksOnContentDrift([b], SHA_A, { totalPages: 50 })[0].status, "verified");
});

test("[M4-R10] content drift detector identifies modified bytes", () => {
  const bytes = Buffer.from("%PDF-1.4 sample bytes");
  const orig = SHA_A;
  const drift = detectContentDrift(bytes, orig);
  assert.equal(drift.isMatch, false);
  assert.equal(drift.driftStatus, "drifted");
});

// -------------------------------------------------------------
// [M4-R11] Durable Save Ownership & Controller Fencing
// -------------------------------------------------------------

test("[M4-R11] same material with different content cannot inherit prior requested page", async () => {
  const c = new OpenerController({
    injectedOpener: async (f) => {
      if (f === "new.pdf") throw new Error("Missing file");
    },
  });
  await c.requestOpen(sampleMaterial, 42);
  const r = await c.requestOpen(
    { ...sampleMaterial, filePath: "new.pdf", contentSha256: SHA_B, totalPages: 10 },
    3
  );
  assert.equal(r.lastRequestedPage, null);
  assert.equal(c.lastRequestedPage, null);
});

test("[M4-R11] held old save commits after newer save and must be fenced", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE progress (id TEXT PRIMARY KEY, page INTEGER)");
  const h = held();
  const c = new OpenerController({
    injectedOpener: async () => {},
    injectedPersistence: async (id, page) => {
      if (page === 42) await h.promise;
      db.prepare(
        "INSERT INTO progress VALUES (?,?) ON CONFLICT(id) DO UPDATE SET page=excluded.page"
      ).run(id, page);
    },
  });

  try {
    const old = c.requestOpen(sampleMaterial, 42);
    await Promise.resolve();
    assert.equal((await c.requestOpen(sampleMaterial, 3)).success, true);
    h.resolve();
    assert.equal((await old).success, false);
    assert.equal(db.prepare("SELECT page FROM progress").get().page, 3);
  } finally {
    db.close();
  }
});

test("[M4-R11] public progress accessor must not leak A after failed B", async () => {
  const c = new OpenerController({ injectedOpener: async () => {} });
  await c.requestOpen(sampleMaterial, 42);
  await c.requestOpen({ id: "B", filePath: null }, 1);
  assert.equal(c.lastRequestedPage, null);
});

test("[M4-R11] opener refuses out-of-bounds destination before native invocation", async () => {
  let calls = 0;
  const c = new OpenerController({
    injectedOpener: async () => {
      calls++;
    },
  });
  assert.equal((await c.requestOpen({ ...sampleMaterial, totalPages: 10 }, 42)).success, false);
  assert.equal(calls, 0);
});

test("[M4-R11] partial save failure offers deliberate save-only retry carrying same ownership", async () => {
  let openerCalls = 0;
  let persistCalls = 0;
  let failPersistence = true;

  const c = new OpenerController({
    injectedOpener: async () => {
      openerCalls++;
    },
    injectedPersistence: async () => {
      persistCalls++;
      if (failPersistence) throw new Error("Disk full");
    },
  });

  const res = await c.requestOpen(sampleMaterial, 5);
  assert.equal(res.success, true);
  assert.equal(res.state, "opened_unsaved");
  assert.equal(res.savePending, true);
  assert.equal(openerCalls, 1);
  assert.equal(persistCalls, 1);

  // Deliberate save-only retry does NOT call native opener again!
  failPersistence = false;
  const retryRes = await res.retrySave();
  assert.equal(retryRes.success, true);
  assert.equal(openerCalls, 1); // Opener NOT called again
  assert.equal(persistCalls, 2); // Persistence called again
});

test("[M4-R11] explicit abort refuses obsolete opener and prevents state publication", async () => {
  const h = held();
  const c = new OpenerController({ injectedOpener: () => h.promise });
  const req = c.requestOpen(sampleMaterial, 10);
  c.abort();
  h.resolve();
  const res = await req;
  assert.equal(res.success, false);
  assert.equal(res.state, "aborted");
  assert.equal(c.lastNotice, null);
});
