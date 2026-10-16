/**
 * Her Flight Deck - Navigation Contract Regressions (round 2)
 *
 * Preserves the accepted round's positive controls and refusals, and adds the M4-R13–R19 cases.
 * Every assertion names the guard it exercises, so a case cannot pass through an unrelated check
 * (the defect class fixed by M4-R18).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parsePageReference,
  resolveDestination,
  translateSplitCoordinates,
  validatePageIndex,
  reconcileBookmarksOnContentDrift,
  detectContentDrift,
  canonicalContentHash,
  isResolvedDestination,
} from "./contractModel.mjs";
import { DocumentPersistenceProtocol } from "./persistenceProtocol.mjs";
import { OpenerController } from "./openerController.mjs";
import {
  liveInstallAudit,
  markOutcomesIncomplete,
  validateTraceability,
  verificationResult,
  verifyManifest,
  ENGINE_BOUND_FILES,
  INSTALL_EXECUTION_SCHEMA,
  engineBindings,
  installCommandFor,
  validateInstallExecution,
} from "../scripts/evidenceChecks.mjs";

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
const identityA = { contentSha256: SHA_A, totalPages: 50 };
const sampleMaterial = { id: "mat_sample_001", title: "IFH", filePath: "ifh.pdf", contentSha256: SHA_A, totalPages: 50 };

const held = () => { let r; const p = new Promise((res) => (r = res)); return { promise: p, resolve: r }; };
const dest = (over = {}) => ({ materialId: "mat_sample_001", coordinateSpace: "material_physical", contentSha256: SHA_A, physicalPage: 42, totalPages: 50, pageLabel: null, provenance: "physical_index", ...over });
const rec = (d) => ({ status: "resolved", destination: d });

/** Full lineage with every trusted field the directions need. */
const fullLineage = {
  materialId: "mat_child",
  childPageCount: 16,
  rootMaterialId: "mat_root",
  rootContentSha256: SHA_A,
  sourcePageStart: 101,
  sourcePageEnd: 116,
  sourceTotalPages: 200,
  parentMaterialId: "mat_parent",
  parentContentSha256: SHA_B,
  parentPageStart: 21,
  parentPageEnd: 36,
  parentTotalPages: 100,
};
/** The genuine shipped schema-13 first-level row: parent columns are nullable and absent. */
const firstLevelLineage = {
  materialId: "mat_child",
  childPageCount: 16,
  rootMaterialId: "mat_root",
  rootContentSha256: SHA_A,
  sourcePageStart: 101,
  sourcePageEnd: 116,
  sourceTotalPages: 200,
  parentMaterialId: null,
  parentPageStart: null,
  parentPageEnd: null,
  parentTotalPages: null,
  childContentSha256: SHA_B,
};

// ---------------------------------------------------------------------------
// Prior positive controls (substance preserved; the bounded reference now also
// carries the trusted identity it always needed, per M4-R17)
// ---------------------------------------------------------------------------

test("[control] bounded physical reference with trusted identity and complete nested translation work", () => {
  const resolved = resolveDestination({ materialId: "mat_sample_001", reference: 3, identity: identityA, provenance: "physical_index" });
  assert.equal(resolved.isResolved, true, "bounded physical reference must resolve");
  assert.equal(resolved.physicalIndex, 3);
  assert.equal(resolved.destination.totalPages, 50);
  assert.equal(resolved.destination.contentSha256, SHA_A);

  const nested = translateSplitCoordinates({ direction: "child_to_parent", page: 3 }, fullLineage);
  assert.equal(nested.success, true, nested.error);
  assert.equal(nested.parentPage, 23);
});

test("[control] newer missing-path intent still blocks obsolete opener", async () => {
  const h = held();
  let openerCalls = 0;
  const c = new OpenerController({
    injectedOpener: async (f) => {
      openerCalls += 1;
      if (f === null) throw new Error("missing path");
      await h.promise;
    },
  });
  const a = c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 42 })));
  const b = c.requestOpen({ id: "other", title: "Other", filePath: null }, rec(dest({ materialId: "other", physicalPage: 1 })));
  h.resolve();
  const resA = await a;
  await b;
  assert.equal(resA.success, false);
  assert.equal(c.lastNotice, null, "an aborted operation must not publish a notice");
});

// ---------------------------------------------------------------------------
// M4-R9 retained refusals
// ---------------------------------------------------------------------------

test("[M4-R9] unknown and invalid totals cannot resolve physical destinations", () => {
  for (const totalPages of [undefined, null, NaN, Infinity, 2.5, "50"]) {
    const r = resolveDestination({
      materialId: "mat_sample_001",
      reference: 42,
      identity: { contentSha256: SHA_A, totalPages },
      provenance: "physical_index",
    });
    assert.equal(r.isResolved, false, `totalPages ${String(totalPages)} must not resolve`);
  }
});

test("[M4-R9] printed label map without a declared identity cannot resolve", () => {
  const r = parsePageReference("iv", { provenance: "printed_label", labelToPhysicalMap: { map: { iv: 42 } }, materialId: "m", contentSha256: SHA_A, totalPages: 50 });
  assert.equal(r.isResolved, false, "a bare map with no content binding must stay unresolved");
  assert.equal(r.destination, null);
});

test("[M4-R9] genuine first-level nullable parent metadata permits root navigation", () => {
  const r = translateSplitCoordinates({ direction: "child_to_root", page: 3 }, firstLevelLineage);
  assert.equal(r.success, true, `first-level schema-13 row must navigate: ${r.error ?? ""}`);
  assert.equal(r.rootPage, 103);
  assert.equal(r.destination.coordinateSpace, "root_physical");
  assert.equal(r.destination.totalPages, 200);
});

test("[M4-R9] live root translation requires complete range metadata", () => {
  const { sourcePageEnd, ...incomplete } = fullLineage;
  assert.equal(translateSplitCoordinates({ direction: "child_to_root", page: 3 }, incomplete).success, false);
});

test("[M4-R9] reverse translation cannot succeed without destination identity", () => {
  const { materialId, ...incomplete } = fullLineage;
  assert.equal(translateSplitCoordinates({ direction: "root_to_child", page: 105 }, incomplete).success, false);
});

test("[M4-R9] deleted root document returns structured snapshot guidance", () => {
  const r = translateSplitCoordinates({ direction: "child_to_root", page: 3 }, { ...firstLevelLineage, rootMaterialId: null });
  assert.equal(r.success, false);
  assert.equal(r.code, "ROOT_DELETED");
  assert.ok(r.snapshotGuidance.includes("Root document deleted"));
  assert.equal(r.destination, undefined, "deleted destinations must not produce a destination record");
});

test("[M4-R9] deleted parent document returns structured snapshot guidance", () => {
  const r = translateSplitCoordinates({ direction: "child_to_parent", page: 3 }, { ...fullLineage, parentMaterialId: null });
  assert.equal(r.success, false);
  assert.equal(r.code, "PARENT_DELETED");
  assert.ok(r.snapshotGuidance.includes("Parent document deleted"));
});

test("[M4-R9] physical index validation rejects non-integers, zeros, and out-of-bounds", () => {
  assert.equal(validatePageIndex(0, 50).valid, false);
  assert.equal(validatePageIndex(51, 50).valid, false);
  assert.equal(validatePageIndex(3.5, 50).valid, false);
  assert.equal(validatePageIndex(10, NaN).valid, false);
  assert.equal(validatePageIndex(10, 50).valid, true);
});

// ---------------------------------------------------------------------------
// M4-R15: destination counts are mandatory for successful translation
// ---------------------------------------------------------------------------

test("[M4-R15] unknown or malformed destination count cannot produce a verified destination", () => {
  const badCounts = [null, undefined, NaN, Infinity, 2.5, "200", "abc"];
  for (const sourceTotalPages of badCounts) {
    const r = translateSplitCoordinates({ direction: "child_to_root", page: 12 }, { ...fullLineage, sourceTotalPages });
    assert.equal(r.success, false, `child_to_root with sourceTotalPages=${String(sourceTotalPages)} must not succeed`);
    assert.equal(r.code, "DESTINATION_COUNT_UNKNOWN");
    assert.equal(r.destination, undefined);
  }
  for (const parentTotalPages of badCounts) {
    const r = translateSplitCoordinates({ direction: "child_to_parent", page: 5 }, { ...fullLineage, parentTotalPages });
    assert.equal(r.success, false, `child_to_parent with parentTotalPages=${String(parentTotalPages)} must not succeed`);
    assert.equal(r.code, "DESTINATION_COUNT_UNKNOWN");
  }
  // A count that contradicts the recorded range is still refused, as before.
  const inconsistent = translateSplitCoordinates({ direction: "child_to_root", page: 12 }, { ...fullLineage, sourceTotalPages: 110 });
  assert.equal(inconsistent.success, false);
  assert.match(inconsistent.error, /exceeds its total pages/);
});

// ---------------------------------------------------------------------------
// M4-R16: printed label maps are content-bound
// ---------------------------------------------------------------------------

test("[M4-R16] a label map bound to different content is stale and cannot resolve", () => {
  const mapForA = { map: { iv: 4 }, contentSha256: SHA_A };
  const fresh = parsePageReference("iv", { provenance: "printed_label", labelToPhysicalMap: mapForA, materialId: "m", contentSha256: SHA_A, totalPages: 50 });
  assert.equal(fresh.isResolved, true, "a correctly bound map resolves");
  assert.equal(fresh.destination.contentSha256, SHA_A);
  assert.equal(fresh.destination.physicalPage, 4);

  const stale = parsePageReference("iv", { provenance: "printed_label", labelToPhysicalMap: mapForA, materialId: "m", contentSha256: SHA_B, totalPages: 50 });
  assert.equal(stale.isResolved, false, "the same map must not resolve against new document bytes");
  assert.match(stale.reason, /stale/i);

  const uppercased = parsePageReference("iv", { provenance: "printed_label", labelToPhysicalMap: { map: { iv: 4 }, contentSha256: SHA_A.toUpperCase() }, materialId: "m", contentSha256: SHA_A, totalPages: 50 });
  assert.equal(uppercased.isResolved, true, "hash comparison is canonical");
});

test("[M4-R16] a bound map still cannot resolve a mapped page outside the trusted count", () => {
  const r = parsePageReference("iv", { provenance: "printed_label", labelToPhysicalMap: { map: { iv: 51 }, contentSha256: SHA_A }, materialId: "m", contentSha256: SHA_A, totalPages: 50 });
  assert.equal(r.isResolved, false);
  assert.match(r.reason, /exceeds total pages/);
});

// ---------------------------------------------------------------------------
// M4-R17: one validated destination record, used end to end
// ---------------------------------------------------------------------------

test("[M4-R17] resolveDestination refuses any reference without a trusted identity", () => {
  const noIdentity = resolveDestination({ materialId: "m", reference: 42, identity: null, provenance: "physical_index" });
  assert.equal(noIdentity.isResolved, false);
  assert.equal(noIdentity.destination, null);
  assert.match(noIdentity.guidance, /open the document/i);
});

test("[M4-R17] a caller-inflated count cannot open a destination beyond persisted identity", async () => {
  let openerCalls = 0;
  const c = new OpenerController({
    injectedOpener: async () => { openerCalls += 1; },
    identityProvider: () => ({ contentSha256: SHA_A, totalPages: 10 }),
  });
  const r = await c.requestOpen({ ...sampleMaterial, totalPages: 50 }, rec(dest({ physicalPage: 42, totalPages: 50 })));
  assert.equal(r.success, false, "inflated caller count must be refused");
  assert.equal(openerCalls, 0, "the native opener must not be invoked");
  assert.match(r.error, /does not match persisted identity/);
});

test("[M4-R17] resolver -> controller -> protocol compose into one durable destination", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const resolved = resolveDestination({ materialId: "mat_sample_001", reference: 42, identity: p.getCurrentIdentity("mat_sample_001"), provenance: "physical_index" });
    assert.ok(isResolvedDestination(resolved));
    const c = new OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => p.commitNavigation(d, g),
    });
    const r = await c.requestOpen(sampleMaterial, resolved);
    assert.equal(r.success, true, r.error ?? "");
    assert.equal(r.persistedStatus, "active");
    const row = db.prepare("SELECT last_requested_page, originating_content_sha256, last_requested_page_label, owner_generation FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(row.last_requested_page, 42);
    assert.equal(row.originating_content_sha256, SHA_A);
    assert.equal(row.owner_generation, 1);
  } finally { db.close(); }
});

// ---------------------------------------------------------------------------
// M4-R18: the arithmetic invariant is pinned by the guard that actually holds
// ---------------------------------------------------------------------------

test("[M4-R18] translated pages stay inside the bounded root range so arithmetic cannot overflow", () => {
  const widest = { childPageCount: 16, rootMaterialId: "r", rootContentSha256: SHA_A, sourcePageStart: Number.MAX_SAFE_INTEGER - 15, sourcePageEnd: Number.MAX_SAFE_INTEGER, sourceTotalPages: Number.MAX_SAFE_INTEGER };
  const last = translateSplitCoordinates({ direction: "child_to_root", page: 16 }, widest);
  assert.equal(last.success, true, last.error ?? "");
  assert.equal(last.rootPage, Number.MAX_SAFE_INTEGER, "the widest legal range lands exactly on its end");
  assert.ok(Number.isSafeInteger(last.rootPage));

  const beyond = translateSplitCoordinates({ direction: "child_to_root", page: 17 }, widest);
  assert.equal(beyond.success, false, "a page above childPageCount is refused before any arithmetic");
  assert.match(beyond.error, /Child page must be a safe integer/);

  const mismatched = translateSplitCoordinates({ direction: "child_to_root", page: 5 }, { ...widest, sourcePageEnd: widest.sourcePageStart });
  assert.equal(mismatched.success, false);
  assert.match(mismatched.error, /range length does not match childPageCount/);
});

// ---------------------------------------------------------------------------
// M4-R10 retained: atomic replacement and bound-checked writers
// ---------------------------------------------------------------------------

function applySchema(db) {
  const migDir = path.join(packRoot, "scratch", "accepted-main", "src-tauri", "migrations");
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) db.exec(fs.readFileSync(path.join(migDir, f), "utf8"));
  const p = new DocumentPersistenceProtocol(db);
  p.applyCandidateDdl(fs.readFileSync(path.join(packRoot, "candidate", "candidate_migration_0015.sql"), "utf8"));
  db.prepare("INSERT INTO study_materials (id,title,material_type,topic,file_path,created_at,updated_at) VALUES ('mat_sample_001','IFH','handbook','x','/ifh.pdf','x','x')").run();
  return p;
}

test("[M4-R10] persisted bookmark cannot default verified outside active bounds", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 10);
    const applied = p.addBookmark({ id: "bmk_001", materialId: "mat_sample_001", pageIndex: 42, originatingContentSha256: SHA_A, title: "Out of bounds" });
    assert.equal(applied.status, "unverified");
    assert.equal(db.prepare("SELECT status FROM material_bookmarks WHERE id='bmk_001'").get().status, "unverified");
  } finally { db.close(); }
});

test("[M4-R10] identity replacement atomically invalidates bookmark and reading state", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    p.addBookmark({ id: "bmk_002", materialId: "mat_sample_001", pageIndex: 42, originatingContentSha256: SHA_A, title: "Page 42 on Doc A" });
    reserveExactly(p, "mat_sample_001", 1);
    p.saveReadingState("mat_sample_001", 42, { contentSha256: SHA_A, generation: 1 });
    assert.equal(db.prepare("SELECT status FROM material_bookmarks WHERE id='bmk_002'").get().status, "verified");
    assert.equal(db.prepare("SELECT status FROM material_reading_state WHERE material_id='mat_sample_001'").get().status, "active");

    p.replaceContentIdentity("mat_sample_001", SHA_B, 10);
    const b = db.prepare("SELECT status, originating_content_sha256, page_index FROM material_bookmarks WHERE id='bmk_002'").get();
    const r = db.prepare("SELECT status, originating_content_sha256 FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(b.status, "unverified", "bookmark must not remain verified after content replacement");
    assert.equal(b.originating_content_sha256, SHA_A, "prior content hash is retained");
    assert.equal(b.page_index, 42, "prior coordinates are retained");
    assert.equal(r.status, "unverified", "reading state must not remain active after content replacement");
  } finally { db.close(); }
});

test("[M4-R10] unknown bounds cannot reverify a matching-hash bookmark", () => {
  const b = { originatingContentSha256: SHA_A, pageIndex: 42, status: "unverified" };
  assert.equal(reconcileBookmarksOnContentDrift([b], SHA_A)[0].status, "unverified");
  assert.equal(reconcileBookmarksOnContentDrift([b], SHA_A, { totalPages: 50 })[0].status, "verified");
  assert.equal(reconcileBookmarksOnContentDrift([b], SHA_A.toUpperCase(), { totalPages: 50 })[0].status, "verified", "hash comparison is canonical");
});

test("[M4-R10] content drift detector distinguishes verified, drifted and unknown", () => {
  const bytes = Buffer.from("%PDF-1.4 sample bytes");
  assert.equal(detectContentDrift(bytes, SHA_A).driftStatus, "drifted");
  assert.equal(detectContentDrift(bytes, null).driftStatus, "unknown");
  assert.equal(detectContentDrift(null, SHA_A).driftStatus, "missing_file");
  const same = canonicalContentHash("a".repeat(64));
  assert.equal(detectContentDrift(bytes, same).isMatch, false);
});

// ---------------------------------------------------------------------------
// M4-R19: unknown identity is a persisted, defined state
// ---------------------------------------------------------------------------

test("[M4-R19] navigation writers with unknown or malformed identity persist unverified without throwing", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);

    const cases = [
      ["bmk_missing", undefined],
      ["bmk_malformed", "not-a-hash"],
      ["bmk_mismatch", SHA_B],
    ];
    for (const [id, hash] of cases) {
      const applied = p.addBookmark({ id, materialId: "mat_sample_001", pageIndex: 5, title: id, originatingContentSha256: hash });
      assert.equal(applied.status, "unverified", `${id} must be unverified`);
      assert.doesNotThrow(() => applied, `${id} must not throw`);
      const row = db.prepare("SELECT status, originating_content_sha256 FROM material_bookmarks WHERE id=?").get(id);
      assert.equal(row.status, "unverified");
      assert.ok(row.originating_content_sha256 === canonicalContentHash(hash) || row.originating_content_sha256 === null);
    }

    // An uppercase digest of the ACTIVE content is the same identity, not an unknown one:
    // canonicalization makes it verifiable and it is stored in canonical lowercase form.
    const upper = p.addBookmark({ id: "bmk_uppercase", materialId: "mat_sample_001", pageIndex: 5, title: "upper", originatingContentSha256: SHA_A.toUpperCase() });
    assert.equal(upper.status, "verified", "uppercase of the active hash canonicalizes to a match");
    assert.equal(db.prepare("SELECT originating_content_sha256 FROM material_bookmarks WHERE id='bmk_uppercase'").get().originating_content_sha256, SHA_A, "stored canonical");

    const noGeneration = p.saveReadingState("mat_sample_001", 5, { contentSha256: SHA_A });
    assert.equal(noGeneration.committed, false, "a save without an operation token is rejected, not committed");

    reserveExactly(p, "mat_sample_001", 2);
    const unknownHash = p.saveReadingState("mat_sample_001", 5, { generation: 2 });
    assert.equal(unknownHash.committed, true);
    assert.equal(unknownHash.status, "unverified", "missing content identity cannot be active");

    reserveExactly(p, "mat_sample_001", 3);
    const knownGood = p.saveReadingState("mat_sample_001", 5, { contentSha256: SHA_A, generation: 3 });
    assert.equal(knownGood.status, "active");
    assert.equal(knownGood.persistedPage, 5);
  } finally { db.close(); }
});

// ---------------------------------------------------------------------------
// M4-R11 retained + M4-R13/R14 fencing
// ---------------------------------------------------------------------------

test("[M4-R11] same material with different content cannot inherit prior requested page", async () => {
  const c = new OpenerController({ injectedOpener: async (f) => { if (f === "new.pdf") throw new Error("Missing file"); } });
  await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 42 })));
  const r = await c.requestOpen({ ...sampleMaterial, filePath: "new.pdf" }, rec(dest({ contentSha256: SHA_B, physicalPage: 3, totalPages: 10 })));
  assert.equal(r.success, false);
  assert.equal(r.lastRequestedPage, null, "failed B must not expose A's page");
  assert.equal(c.lastRequestedPage, null, "public accessor must not leak A after failed B");
});

test("[M4-R11] public progress accessor must not leak A after failed B", async () => {
  const c = new OpenerController({ injectedOpener: async () => {} });
  await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 42 })));
  await c.requestOpen({ id: "B", filePath: null }, rec(dest({ materialId: "B", physicalPage: 1 })));
  assert.equal(c.lastRequestedPage, null);
});

test("[M4-R11] explicit abort refuses obsolete opener and prevents state publication", async () => {
  const h = held();
  const c = new OpenerController({ injectedOpener: (f, p) => h.promise });
  const req = c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 10 })));
  c.abort();
  h.resolve();
  const res = await req;
  assert.equal(res.success, false);
  assert.equal(res.state, "aborted");
  assert.equal(c.state, "aborted", "controller state must reflect the abort");
  assert.equal(c.lastNotice, null);
});

test("[M4-R13] held obsolete save is rejected at commit and page 42 never reaches storage", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const h = held();
    const sequence = [];
    const c = new OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => {
        if (d.physicalPage === 42) await h.promise;
        const verdict = p.commitNavigation(d, g);
        const after = db.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id='mat_sample_001'").get();
        sequence.push({
          attemptedPage: d.physicalPage,
          generation: g,
          committed: verdict.committed,
          reason: verdict.reason ?? null,
          durablePageAfter: after ? after.last_requested_page : null,
        });
        return verdict;
      },
    });

    const old = c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 42, pageLabel: "forty-two" })));
    await Promise.resolve();
    const newer = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 3, pageLabel: "three" })));
    assert.equal(newer.success, true);
    h.resolve();
    const oldRes = await old;

    assert.equal(oldRes.success, false, "the obsolete operation must not report success");
    assert.equal(oldRes.state, "aborted");
    assert.equal(oldRes.superseded, true);
    assert.equal(oldRes.persistedPage, 3, "the caller learns the durable value from the verdict");

    const durablePages = sequence.map((s) => s.durablePageAfter);
    assert.ok(!durablePages.includes(42), `obsolete page 42 must never be durable, saw ${JSON.stringify(durablePages)}`);
    assert.equal(sequence.filter((s) => s.attemptedPage === 42 && s.committed).length, 0, "the obsolete save must be rejected, never committed");
    assert.equal(db.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id='mat_sample_001'").get().last_requested_page, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM material_reading_state").get().n, 1, "no compensating second write may exist");
  } finally { db.close(); }
});

test("[M4-R13] a fenced commit that throws is surfaced honestly and cannot leave the stale page", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    reserveExactly(p, "mat_sample_001", 1);
    p.saveReadingState("mat_sample_001", 3, { contentSha256: SHA_A, generation: 1 });
    db.exec("CREATE TRIGGER fault BEFORE UPDATE ON material_reading_state BEGIN SELECT RAISE(ABORT,'disk full during save'); END;");
    const c = new OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => p.commitNavigation(d, g),
    });
    const r = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 42 })));
    db.exec("DROP TRIGGER fault;");

    assert.equal(r.success, true, "the document really did open");
    assert.equal(r.state, "opened_unsaved");
    assert.equal(r.saved, false);
    assert.match(r.saveError, /disk full during save/, "the failure is surfaced, never swallowed");
    assert.match(r.notice, /could not be saved/);
    assert.equal(db.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id='mat_sample_001'").get().last_requested_page, 3, "the stale page must not be durable");
    assert.equal(c.lastRequestedPage, 42, "in-memory intent is still the requested page, but it is not claimed as saved");
  } finally { db.close(); }
});

test("[M4-R14] a mid-flight content replacement commits the winner's whole tuple and nothing else", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_B, 50);
    const h = held();
    const c = new OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => { if (d.physicalPage === 42) await h.promise; return p.commitNavigation(d, g); },
    });

    // Obsolete operation carries content A and A's printed label; the winner carries content B.
    p.replaceContentIdentity("mat_sample_001", SHA_A, 50);
    const old = c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 42, contentSha256: SHA_A, pageLabel: "printed-A-label" })));
    await Promise.resolve();
    p.replaceContentIdentity("mat_sample_001", SHA_B, 50);
    const newer = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 3, contentSha256: SHA_B, pageLabel: "printed-B-label" })));
    assert.equal(newer.success, true, newer.error ?? "");
    h.resolve();
    await old;

    const row = db.prepare("SELECT last_requested_page, originating_content_sha256, last_requested_page_label, status FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(row.last_requested_page, 3);
    assert.equal(row.originating_content_sha256, SHA_B, "the durable hash must be the winner's content");
    assert.equal(row.last_requested_page_label, "printed-B-label", "the durable label must be the winner's label");
    assert.equal(row.status, "active", "the winner matches persisted identity");
  } finally { db.close(); }
});

test("[M4-R11] opener refuses an out-of-bounds destination before native invocation", async () => {
  let calls = 0;
  const c = new OpenerController({ injectedOpener: async () => { calls += 1; } });
  const r = await c.requestOpen({ ...sampleMaterial, totalPages: 10 }, rec(dest({ physicalPage: 42, totalPages: 10 })));
  assert.equal(r.success, false);
  assert.equal(calls, 0);
});

test("[M4-R11] partial save failure offers deliberate save-only retry carrying same ownership", async () => {
  let openerCalls = 0;
  let persistCalls = 0;
  let failPersistence = true;
  const c = new OpenerController({
    injectedOpener: async () => { openerCalls += 1; },
    injectedPersistence: async () => {
      persistCalls += 1;
      if (failPersistence) throw new Error("Disk full");
      return { committed: true, status: "active", persistedPage: 5 };
    },
  });
  const record = rec(dest({ physicalPage: 5 }));
  const res = await c.requestOpen(sampleMaterial, record);
  assert.equal(res.success, true);
  assert.equal(res.state, "opened_unsaved");
  assert.equal(res.savePending, true);
  assert.equal(openerCalls, 1);
  assert.equal(persistCalls, 1);

  failPersistence = false;
  const retry = await res.retrySave();
  assert.equal(retry.success, true);
  assert.equal(openerCalls, 1, "the retry must not replay the native opener");
  assert.equal(persistCalls, 2);
});

// ---------------------------------------------------------------------------
// M4-R23, M4-R24, M4-R26: Cross-session ordering, late retry, and lifecycle proofs
// ---------------------------------------------------------------------------

test("[M4-R23] session 1 saves several pages, then a new controller on the same database commits a new page", async () => {
  const tmpDbPath = path.join(os.tmpdir(), `hfd-r23-session-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  try {
    // Session 1: opens file-backed database, applies schema, saves pages 5, 6, 7.
    const db1 = new DatabaseSync(tmpDbPath);
    const p1 = applySchema(db1);
    p1.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const c1 = new OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p1.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => p1.commitNavigation(d, g),
    });
    const r5 = await c1.requestOpen(sampleMaterial, rec(dest({ physicalPage: 5 })));
    assert.equal(r5.success, true);
    const r6 = await c1.requestOpen(sampleMaterial, rec(dest({ physicalPage: 6 })));
    assert.equal(r6.success, true);
    const r7 = await c1.requestOpen(sampleMaterial, rec(dest({ physicalPage: 7 })));
    assert.equal(r7.success, true);
    const row1 = db1.prepare("SELECT last_requested_page, owner_generation FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(row1.last_requested_page, 7);
    assert.equal(row1.owner_generation, 3);
    db1.close();

    // Session 2: new controller opens the same file-backed database, requests page 9
    const db2 = new DatabaseSync(tmpDbPath);
    const p2 = new DocumentPersistenceProtocol(db2);
    const c2 = new OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p2.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => p2.commitNavigation(d, g),
    });
    const r9 = await c2.requestOpen(sampleMaterial, rec(dest({ physicalPage: 9 })));
    assert.equal(r9.success, true, `new session must commit new page: ${r9.error ?? r9.reason ?? ""}`);
    assert.equal(r9.state, "opened");
    const row2 = db2.prepare("SELECT last_requested_page, owner_generation FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(row2.last_requested_page, 9, "durable row must advance to page 9");
    assert.ok(row2.owner_generation > 3, `owner_generation must advance beyond 3, got ${row2.owner_generation}`);
    db2.close();
  } finally {
    try { fs.unlinkSync(tmpDbPath); } catch {}
  }
});

test("[M4-R23] two controllers on one database: the later request wins and the earlier held request is rejected", async () => {
  const tmpDbPath = path.join(os.tmpdir(), `hfd-r23-twocontrollers-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  try {
    const db = new DatabaseSync(tmpDbPath);
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);

    const h = held();
    const c1 = new OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => {
        await h.promise; // hold controller 1's save in-flight
        return p.commitNavigation(d, g);
      },
    });

    const c2 = new OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => p.commitNavigation(d, g),
    });

    // Controller 1 starts request for page 10 (held in persistence)
    const op1 = c1.requestOpen(sampleMaterial, rec(dest({ physicalPage: 10 })));
    await Promise.resolve();

    // Controller 2 starts request for page 20 on the same database, finishes immediately
    const res2 = await c2.requestOpen(sampleMaterial, rec(dest({ physicalPage: 20 })));
    assert.equal(res2.success, true);
    assert.equal(res2.state, "opened");
    const midRow = db.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(midRow.last_requested_page, 20);

    // Controller 1's held save is now released
    h.resolve();
    const res1 = await op1;

    // Earlier request from controller 1 must be rejected
    assert.equal(res1.success, false, "earlier held request must not report success");
    assert.equal(res1.state, "aborted");
    assert.equal(res1.superseded, true);
    assert.equal(res1.persistedPage, 20);

    // Final database state must remain at page 20
    const finalRow = db.prepare("SELECT last_requested_page, owner_generation FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(finalRow.last_requested_page, 20, "database must keep later request page 20");
    db.close();
  } finally {
    try { fs.unlinkSync(tmpDbPath); } catch {}
  }
});

test("[M4-R24] retrySave sends the retried operation's own generation and is rejected once superseded by a newer request", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);

    let failOp1Save = true;
    const c = new OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => {
        if (d.physicalPage === 42 && failOp1Save) {
          throw new Error("simulated transient persistence failure");
        }
        return p.commitNavigation(d, g);
      },
    });

    // 1. Operation 1 (page 42) opens, but save throws, returning opened_unsaved
    const op1 = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 42 })));
    assert.equal(op1.success, true);
    assert.equal(op1.state, "opened_unsaved");
    assert.equal(op1.saved, false);
    assert.equal(typeof op1.retrySave, "function");

    // 2. Operation 2 (page 3) commits cleanly
    const op2 = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 3 })));
    assert.equal(op2.success, true);
    assert.equal(op2.state, "opened");
    assert.equal(op2.saved, true);
    assert.equal(db.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id='mat_sample_001'").get().last_requested_page, 3);

    // 3. Operation 1's retrySave runs late after operation 2 has committed
    failOp1Save = false; // persistence would now succeed if called
    const retryRes = await op1.retrySave();

    // The retry must not succeed, and the durable row must stay at page 3
    assert.equal(retryRes.success, false, "late retry must be rejected when superseded");
    assert.equal(retryRes.state, "aborted");
    assert.equal(retryRes.superseded, true);
    assert.equal(db.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id='mat_sample_001'").get().last_requested_page, 3, "durable row must stay at page 3");
  } finally { db.close(); }
});

test("[M4-R13] same-content repeat commits with advanced generation and preserves final database state", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const c = new OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => p.commitNavigation(d, g),
    });
    const r1 = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 10, pageLabel: "10" })));
    assert.equal(r1.success, true);
    const r2 = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 10, pageLabel: "10" })));
    assert.equal(r2.success, true);
    const row = db.prepare("SELECT last_requested_page, last_requested_page_label, originating_content_sha256, status, owner_generation FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(row.last_requested_page, 10);
    assert.equal(row.last_requested_page_label, "10");
    assert.equal(row.originating_content_sha256, SHA_A);
    assert.equal(row.status, "active");
    assert.equal(row.owner_generation, 2, "repeat navigation must advance durable generation");
  } finally { db.close(); }
});

test("[M4-R13] changed content with same material ID commits new tuple and preserves final database state", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const c = new OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => p.commitNavigation(d, g),
    });
    const r1 = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 5, contentSha256: SHA_A, pageLabel: "A-5" })));
    assert.equal(r1.success, true);
    p.replaceContentIdentity("mat_sample_001", SHA_B, 20);
    const r2 = await c.requestOpen({ ...sampleMaterial, contentSha256: SHA_B, totalPages: 20 }, rec(dest({ physicalPage: 12, contentSha256: SHA_B, totalPages: 20, pageLabel: "B-12" })));
    assert.equal(r2.success, true);
    const row = db.prepare("SELECT last_requested_page, last_requested_page_label, originating_content_sha256, status, owner_generation FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(row.last_requested_page, 12);
    assert.equal(row.last_requested_page_label, "B-12");
    assert.equal(row.originating_content_sha256, SHA_B);
    assert.equal(row.status, "active");
    assert.equal(row.owner_generation, 2);
  } finally { db.close(); }
});

test("[M4-R13] route navigation A -> B -> A commits each destination and preserves final database state for both materials", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    db.prepare("INSERT OR IGNORE INTO study_materials (id,title,material_type,topic,file_path,created_at,updated_at) VALUES ('mat_sample_002','AFH','handbook','x','/afh.pdf','x','x')").run();
    p.saveContentIdentity("mat_sample_002", SHA_B, 30);
    const matA = sampleMaterial;
    const matB = { id: "mat_sample_002", title: "AFH", filePath: "afh.pdf", contentSha256: SHA_B, totalPages: 30 };
    const c = new OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => p.commitNavigation(d, g),
    });
    // Navigate A -> page 5
    const rA1 = await c.requestOpen(matA, rec(dest({ materialId: "mat_sample_001", physicalPage: 5, contentSha256: SHA_A, totalPages: 50 })));
    assert.equal(rA1.success, true);
    // Navigate B -> page 20
    const rB = await c.requestOpen(matB, rec(dest({ materialId: "mat_sample_002", physicalPage: 20, contentSha256: SHA_B, totalPages: 30 })));
    assert.equal(rB.success, true);
    // Navigate A -> page 8
    const rA2 = await c.requestOpen(matA, rec(dest({ materialId: "mat_sample_001", physicalPage: 8, contentSha256: SHA_A, totalPages: 50 })));
    assert.equal(rA2.success, true);

    const rowA = db.prepare("SELECT last_requested_page, originating_content_sha256, status, owner_generation FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(rowA.last_requested_page, 8);
    assert.equal(rowA.originating_content_sha256, SHA_A);
    assert.equal(rowA.status, "active");

    const rowB = db.prepare("SELECT last_requested_page, originating_content_sha256, status, owner_generation FROM material_reading_state WHERE material_id='mat_sample_002'").get();
    assert.equal(rowB.last_requested_page, 20);
    assert.equal(rowB.originating_content_sha256, SHA_B);
    assert.equal(rowB.status, "active");
  } finally { db.close(); }
});

test("[M4-R13] explicit abort/unmount prevents in-flight operation from committing to storage", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    // Initial committed position: page 5
    reserveExactly(p, "mat_sample_001", 1);
    p.saveReadingState("mat_sample_001", 5, { contentSha256: SHA_A, generation: 1 });

    const h = held();
    const c = new OpenerController({
      injectedOpener: async () => { await h.promise; },
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => p.commitNavigation(d, g),
    });

    const inFlight = c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 15 })));
    // Component unmount / route navigation aborts the controller
    c.abort();
    // In-flight opener completes
    h.resolve();
    const res = await inFlight;

    assert.equal(res.success, false);
    assert.equal(res.state, "aborted");
    // Database must be untouched: still page 5
    const row = db.prepare("SELECT last_requested_page, owner_generation FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(row.last_requested_page, 5, "aborted operation must not reach database");
    assert.equal(row.owner_generation, 1);
  } finally { db.close(); }
});

test("[M4-R13] delayed failure of earlier operation cannot overwrite or corrupt newer committed progress", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const h = held();
    const c = new OpenerController({
      injectedOpener: async (path, page) => {
        if (page === 10) {
          await h.promise;
          throw new Error("Simulated device failure for page 10");
        }
      },
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => p.commitNavigation(d, g),
    });

    // Operation 1 starts for page 10 (held)
    const op1 = c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 10 })));
    await Promise.resolve();

    // Operation 2 requests page 25 and commits cleanly
    const op2 = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 25 })));
    assert.equal(op2.success, true);
    assert.equal(op2.state, "opened");

    // Release operation 1's delayed failure
    h.resolve();
    const res1 = await op1;
    assert.equal(res1.success, false);
    assert.equal(res1.state, "aborted");
    assert.equal(res1.superseded, true);

    // Final database state must be untouched at page 25
    const row = db.prepare("SELECT last_requested_page, owner_generation, status FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(row.last_requested_page, 25);
    assert.equal(row.status, "active");
  } finally { db.close(); }
});

test("[M4-R14] superseded or drifted generation row remains visibly unverified, never active", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    reserveExactly(p, "mat_sample_001", 1);
    const commit1 = p.commitNavigation({
      materialId: "mat_sample_001",
      physicalPage: 20,
      contentSha256: SHA_A,
      pageLabel: "twenty",
      totalPages: 50,
      coordinateSpace: "material_physical",
      provenance: "physical_index",
    }, 1);
    assert.equal(commit1.committed, true);
    assert.equal(commit1.status, "active");

    // Content replacement from SHA_A to SHA_B: row drifts and becomes unverified
    p.replaceContentIdentity("mat_sample_001", SHA_B, 30);
    const rowDrifted = db.prepare("SELECT last_requested_page, originating_content_sha256, status, owner_generation FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(rowDrifted.last_requested_page, 20);
    assert.equal(rowDrifted.originating_content_sha256, SHA_A);
    assert.equal(rowDrifted.status, "unverified", "drifted row must be visibly unverified");

    // A stale commit with generation 1 (or older) cannot overwrite or activate the drifted row
    const staleCommit = p.commitNavigation({
      materialId: "mat_sample_001",
      physicalPage: 20,
      contentSha256: SHA_A,
      pageLabel: "twenty",
      totalPages: 50,
      coordinateSpace: "material_physical",
      provenance: "physical_index",
    }, 1);
    assert.equal(staleCommit.committed, false);
    assert.equal(staleCommit.reason, "superseded");

    const rowAfterStale = db.prepare("SELECT last_requested_page, originating_content_sha256, status, owner_generation FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(rowAfterStale.status, "unverified", "superseded attempt must leave row unverified");
    assert.equal(rowAfterStale.owner_generation, 1);
  } finally { db.close(); }
});

// ---------------------------------------------------------------------------
// M4-R28: Durable Operation Ownership Reservation Regressions
// ---------------------------------------------------------------------------

test("[M4-R28] file-backed DB: overlapping controllers, earlier completion released first, later request wins", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hfd-r28-filedb-"));
  const dbPath = path.join(tmpDir, "store.db");
  const db1 = new DatabaseSync(dbPath);
  const p1 = applySchema(db1);
  p1.saveContentIdentity("mat_sample_001", SHA_A, 50);
  const db2 = new DatabaseSync(dbPath);
  const p2 = new DocumentPersistenceProtocol(db2);
  try {
    const a = held(), b = held();
    const c1 = new OpenerController({
      identityProvider: (id) => p1.getCurrentIdentity(id),
      injectedOpener: async () => a.promise,
      injectedPersistence: async (d, g) => p1.commitNavigation(d, g),
    });
    const c2 = new OpenerController({
      identityProvider: (id) => p2.getCurrentIdentity(id),
      injectedOpener: async () => b.promise,
      injectedPersistence: async (d, g) => p2.commitNavigation(d, g),
    });
    const older = c1.requestOpen(sampleMaterial, rec(dest({ physicalPage: 10 })));
    const newer = c2.requestOpen(sampleMaterial, rec(dest({ physicalPage: 20 })));
    assert.equal(c1.currentIntentId, 1);
    assert.equal(c2.currentIntentId, 2);
    a.resolve();
    const oldResult = await older;
    b.resolve();
    const newResult = await newer;
    const finalPage = db1.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id='mat_sample_001'").get().last_requested_page;
    assert.equal(finalPage, 20, "[M4-R28] later request must win even when earlier completion lands first");
    assert.equal(oldResult.success, false, "earlier request must report superseded/aborted");
    assert.equal(newResult.success, true);
  } finally {
    db2.close();
    db1.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("[M4-R28] file-backed DB: overlapping controllers, later completion released first, earlier completion rejected", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hfd-r28-filedb-rev-"));
  const dbPath = path.join(tmpDir, "store.db");
  const db1 = new DatabaseSync(dbPath);
  const p1 = applySchema(db1);
  p1.saveContentIdentity("mat_sample_001", SHA_A, 50);
  const db2 = new DatabaseSync(dbPath);
  const p2 = new DocumentPersistenceProtocol(db2);
  try {
    const a = held(), b = held();
    const c1 = new OpenerController({
      identityProvider: (id) => p1.getCurrentIdentity(id),
      injectedOpener: async () => a.promise,
      injectedPersistence: async (d, g) => p1.commitNavigation(d, g),
    });
    const c2 = new OpenerController({
      identityProvider: (id) => p2.getCurrentIdentity(id),
      injectedOpener: async () => b.promise,
      injectedPersistence: async (d, g) => p2.commitNavigation(d, g),
    });
    const older = c1.requestOpen(sampleMaterial, rec(dest({ physicalPage: 10 })));
    const newer = c2.requestOpen(sampleMaterial, rec(dest({ physicalPage: 20 })));
    b.resolve();
    const newResult = await newer;
    a.resolve();
    const oldResult = await older;
    const finalPage = db1.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id='mat_sample_001'").get().last_requested_page;
    assert.equal(finalPage, 20, "[M4-R28] later request must remain winner when released first");
    assert.equal(oldResult.success, false);
    assert.equal(newResult.success, true);
  } finally {
    db2.close();
    db1.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("[M4-R28] earlier pending operation is fenced from becoming a durable stale winner once later claim exists", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const token1 = p.reserveOperationOwnership("mat_sample_001");
    const token2 = p.reserveOperationOwnership("mat_sample_001");
    assert.equal(token1, 1);
    assert.equal(token2, 2);
    // Token 1 attempts to commit while token 2 has already been reserved
    const commit1 = p.commitNavigation(dest({ physicalPage: 10 }), token1);
    assert.equal(commit1.committed, false, "[M4-R28] pending operation must be rejected once later claim exists");
    assert.equal(commit1.reason, "superseded");
    // Database has not been written
    const row = db.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(row, undefined);
  } finally { db.close(); }
});

// ---------------------------------------------------------------------------
// M4-R29: Cancellation at Commit Boundary Regressions
// ---------------------------------------------------------------------------

test("[M4-R29] abort while persistence is pending fences the operation before commit and preserves previous saved tuple", async () => {
  const db = new DatabaseSync(":memory:");
  const gate = held(), entered = held();
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    reserveExactly(p, "mat_sample_001", 1);
    p.saveReadingState("mat_sample_001", 5, { contentSha256: SHA_A, generation: 1 });
    const c = new OpenerController({
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => {
        entered.resolve();
        await gate.promise;
        return p.commitNavigation(d, g);
      },
    });
    const pending = c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 42 })));
    await entered.promise;
    c.abort();
    gate.resolve();
    const result = await pending;
    assert.equal(result.success, false, "[M4-R29] aborted operation must report failure");
    assert.equal(c.state, "aborted");
    const row = db.prepare("SELECT last_requested_page, owner_generation FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(row.last_requested_page, 5, "[M4-R29] abort before commit must preserve previous saved page");
    assert.equal(row.owner_generation, 1);
  } finally { db.close(); }
});

test("[M4-R29] an old operation cancellation cannot cancel or release a newer operation claim", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const token1 = p.reserveOperationOwnership("mat_sample_001");
    const token2 = p.reserveOperationOwnership("mat_sample_001");
    assert.equal(token1, 1);
    assert.equal(token2, 2);
    // Cancel token 1
    const cancelRes = p.cancelOperation("mat_sample_001", token1);
    assert.equal(cancelRes, true);
    // Token 2 commits
    const commit2 = p.commitNavigation(dest({ physicalPage: 25 }), token2);
    assert.equal(commit2.committed, true, "[M4-R29] cancelling older operation must not affect newer operation");
    const row = db.prepare("SELECT last_requested_page, owner_generation FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(row.last_requested_page, 25);
    assert.equal(row.owner_generation, 2);
  } finally { db.close(); }
});

test("[M4-R29] post-commit delayed acknowledgement retains storage result but suppresses publication", async () => {
  const db = new DatabaseSync(":memory:");
  const gate = held(), entered = held();
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const c = new OpenerController({
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => {
        const res = p.commitNavigation(d, g);
        entered.resolve();
        await gate.promise;
        return res;
      },
    });
    const pending = c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 30 })));
    await entered.promise;
    // Commit has already landed in DB before abort:
    assert.equal(db.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id='mat_sample_001'").get().last_requested_page, 30);
    c.abort();
    gate.resolve();
    const result = await pending;
    assert.equal(result.success, false, "[M4-R29] publication suppressed on aborted controller");
    assert.equal(c.state, "aborted");
    assert.equal(c.lastNotice, null, "aborted controller must not publish winning notice");
    // Storage remains legitimate page 30
    const row = db.prepare("SELECT last_requested_page, owner_generation FROM material_reading_state WHERE material_id='mat_sample_001'").get();
    assert.equal(row.last_requested_page, 30, "[M4-R29] legitimate completed commit must stay in storage");
  } finally { db.close(); }
});

// ---------------------------------------------------------------------------
// M4-R30: Recheck Immutable Operation Ownership Regressions
// ---------------------------------------------------------------------------

test("[M4-R30] late fulfilled commit acknowledgement cannot overwrite newer controller progress", async () => {
  const db = new DatabaseSync(":memory:");
  const gate = held(), entered = held();
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const c = new OpenerController({
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => {
        const result = p.commitNavigation(d, g);
        if (d.physicalPage === 10) {
          entered.resolve();
          await gate.promise;
        }
        return result;
      },
    });
    const older = c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 10 })));
    await entered.promise;
    const newer = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 20 })));
    assert.equal(newer.saved, true);
    const winningNotice = c.lastNotice;
    gate.resolve();
    const oldResult = await older;
    assert.equal(oldResult.success, false, "late acknowledged operation must report superseded");
    assert.equal(c.lastRequestedPage, 20, "[M4-R30] stale acknowledged operation must not replace winning controller progress");
    assert.equal(c.lastNotice, winningNotice);
    assert.equal(c.state, "opened");
  } finally { db.close(); }
});

test("[M4-R30] late retry acknowledgement cannot overwrite newer controller progress", async () => {
  const db = new DatabaseSync(":memory:");
  const gate = held(), entered = held();
  let first = true;
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const c = new OpenerController({
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => {
        if (d.physicalPage === 42 && first) { first = false; throw new Error("transient save error"); }
        const result = p.commitNavigation(d, g);
        if (d.physicalPage === 42) { entered.resolve(); await gate.promise; }
        return result;
      },
    });
    const unsaved = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 42 })));
    assert.equal(unsaved.saved, false);
    const retry = unsaved.retrySave();
    await entered.promise;
    const newer = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 20 })));
    assert.equal(newer.saved, true);
    gate.resolve();
    const lateRetry = await retry;
    assert.equal(lateRetry.success, false, "late retry must report superseded");
    assert.equal(c.lastRequestedPage, 20, "[M4-R30] retry must recheck immutable operation ownership after await");
    assert.equal(c.state, "opened");
  } finally { db.close(); }
});

test("[M4-R30] obsolete opener failure must leave winner notice and state intact", async () => {
  const db = new DatabaseSync(":memory:");
  const gate = held();
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const c = new OpenerController({
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedOpener: async (_file, target) => {
        if (target === 10) { await gate.promise; throw new Error("old opener failed"); }
      },
      injectedPersistence: async (d, g) => p.commitNavigation(d, g),
    });
    const older = c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 10 })));
    const newer = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 20 })));
    assert.equal(newer.success, true);
    const winningNotice = c.lastNotice;
    gate.resolve();
    const oldResult = await older;
    assert.equal(oldResult.success, false);
    assert.equal(c.state, "opened", "[M4-R30] superseded failure must not abort winning route");
    assert.equal(c.lastNotice, winningNotice);
    assert.equal(c.lastRequestedPage, 20);
  } finally { db.close(); }
});

test("[M4-R30] route navigation A -> B -> A with delayed persistence leaves final winner intact", async () => {
  const db = new DatabaseSync(":memory:");
  const gateB = held();
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const matB = { id: "mat_b", title: "Doc B", filePath: "b.pdf", contentSha256: SHA_B, totalPages: 30 };
    db.prepare("INSERT INTO study_materials (id,title,material_type,topic,file_path,created_at,updated_at) VALUES ('mat_b','Doc B','handbook','x','/b.pdf','x','x')").run();
    p.saveContentIdentity("mat_b", SHA_B, 30);
    const c = new OpenerController({
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => {
        if (d.materialId === "mat_b") { await gateB.promise; }
        return p.commitNavigation(d, g);
      },
    });
    await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 5 })));
    const navB = c.requestOpen(matB, rec(dest({ materialId: "mat_b", contentSha256: SHA_B, physicalPage: 12, totalPages: 30 })));
    const navA2 = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 15 })));
    assert.equal(navA2.success, true);
    gateB.resolve();
    const resB = await navB;
    assert.equal(resB.success, false, "interleaved B navigation must be superseded");
    assert.equal(c.currentMaterialId, "mat_sample_001");
    assert.equal(c.lastRequestedPage, 15);
    assert.equal(c.state, "opened");
  } finally { db.close(); }
});

// ---------------------------------------------------------------------------
// M4-R31, M4-R32: truthful verification records and execution-derived claims.
// Round 4 (Claude): these call the runner's real checks (scripts/evidenceChecks.mjs) and the real
// runner binary. The earlier versions re-implemented the logic inside the test or asserted values
// they had just assigned, so they could not fail when the runner was wrong.
// ---------------------------------------------------------------------------

const runnerPath = path.join(packRoot, "scripts", "run_integration_proof.mjs");

/** A minimal sealed pack in a temporary directory: one receipt and its SHA256SUMS. */
function sealedTempPack(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hfd-r31-${label}-`));
  fs.mkdirSync(path.join(dir, "receipts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "receipts", "01-toolchain.txt"), "toolchain ok\n");
  const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, "receipts", "01-toolchain.txt"))).digest("hex");
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), `${sha}  receipts/01-toolchain.txt\n`);
  return dir;
}

test("[M4-R31] the real runner rejects a delivered receipt altered after sealing", () => {
  const dir = sealedTempPack("tamper");
  try {
    const clean = spawnSync(process.execPath, [runnerPath, "--verify-manifest-only", "--pack-root", dir], { encoding: "utf8" });
    assert.equal(clean.status, 0, "an untouched sealed pack must verify");
    assert.match(clean.stdout, /MANIFEST VERIFICATION PASSED/);

    fs.appendFileSync(path.join(dir, "receipts", "01-toolchain.txt"), "TAMPERED_BYTE\n");
    const tampered = spawnSync(process.execPath, [runnerPath, "--verify-manifest-only", "--pack-root", dir], { encoding: "utf8" });
    assert.equal(tampered.status, 1, "[M4-R31] the runner must exit 1 for a receipt changed after sealing");
    assert.match(tampered.stderr, /PROOF RUN FAILED/, "[M4-R31] the runner must describe the failure");
    assert.doesNotMatch(tampered.stdout, /PASSED/, "[M4-R31] no success may be printed for a tampered pack");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("[M4-R31] a failing final manifest check produces a FAILED outcome and never a PASS", () => {
  const dir = sealedTempPack("final-check");
  try {
    fs.writeFileSync(path.join(dir, "SHA256SUMS"), `${"0".repeat(64)}  receipts/01-toolchain.txt\n`);
    const outcome = verifyManifest(dir, "SHA256SUMS");
    assert.equal(outcome.ok, false, "[M4-R31] a mismatched seal must not verify");
    assert.notEqual(outcome.exit, 0);
    const result = verificationResult(outcome, "all files verified");
    assert.match(result, /^RESULT: FAILED/, "[M4-R31] the recorded result must say FAILED");
    assert.doesNotMatch(result, /PASS/, "[M4-R31] a failed check must never be recorded as PASS");

    const missing = verifyManifest(dir, "NO_SUCH_MANIFEST");
    assert.equal(missing.ok, false, "[M4-R31] a check that could not run cannot count as verified");
    assert.match(verificationResult(missing, "x"), /^RESULT: FAILED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("[M4-R31] an interrupted run leaves its outcome receipts marked incomplete, never an earlier success", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hfd-r31-interrupt-"));
  try {
    // An earlier, successful run left these behind.
    fs.writeFileSync(path.join(dir, "15-run-summary.json"), JSON.stringify({ failures: [], manifest: { payloadVerified: true } }));
    fs.writeFileSync(path.join(dir, "16-manifest-verification.txt"), "RESULT: PASS - all files verified\n");

    // A new run starts, then stops before reaching its summary step.
    markOutcomesIncomplete(dir, "2026-10-16T00:00:00.000Z");

    const summary = JSON.parse(fs.readFileSync(path.join(dir, "15-run-summary.json"), "utf8"));
    assert.equal(summary.status, "incomplete", "[M4-R31] an unfinished run must not leave a success summary");
    assert.equal(summary.failures, undefined, "[M4-R31] an unfinished run must not claim an empty failure list");
    const receipt = fs.readFileSync(path.join(dir, "16-manifest-verification.txt"), "utf8");
    assert.match(receipt, /RESULT: INCOMPLETE/);
    assert.doesNotMatch(receipt, /RESULT: PASS/);

    // The real runner does this before its first step, after the read-only verify mode.
    const source = fs.readFileSync(runnerPath, "utf8");
    const marked = source.indexOf("markOutcomesIncomplete(receiptsDir");
    assert.ok(marked > source.indexOf('if (process.argv.includes("--verify-manifest-only"))'), "verify-only mode must not touch receipts");
    assert.ok(marked < source.indexOf("// 01 toolchain"), "[M4-R31] outcomes must be marked incomplete before the first step");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("[M4-R31] an installer failure is recorded with its real non-zero exit and a FAILED result", () => {
  const base = {
    mode: "live-install",
    command: "npm ci --prefix scratch/pdfjs-engine --no-audit --no-fund --ignore-scripts",
    cwd: "/tmp/pack",
    nodeVersion: "v22.23.3",
    platform: "darwin/arm64",
    installedPackage: null,
    scratchArtifactsSha256: null,
  };
  const failed = liveInstallAudit({ ...base, exit: 42 });
  assert.equal(failed.ok, false, "[M4-R31] a failed install must not count as installed");
  assert.match(failed.text, /^exit: 42$/m, "[M4-R31] the real exit status must be recorded");
  assert.match(failed.text, /RESULT: FAILED - npm ci exited 42/);
  assert.doesNotMatch(failed.text, /RESULT: PASS/);

  const crashed = liveInstallAudit({ ...base, exit: null });
  assert.equal(crashed.ok, false, "[M4-R31] an install that never reported an exit is not a success");

  const passed = liveInstallAudit({ ...base, exit: 0, installedPackage: { name: "pdfjs-dist", version: "x" } });
  assert.equal(passed.ok, true);
  assert.match(passed.text, /RESULT: PASS/);
});

const mutantIdsInSensitivitySource = () =>
  [...fs.readFileSync(path.join(here, "sensitivityMutants.test.mjs"), "utf8").matchAll(/id: "(M\d+_[A-Z0-9_]+)"/g)].map((m) => m[1]);

const traceInput = (overrides = {}) => ({
  texts: ["Executed `M1_RELAX_SHARED_COUNT_VALIDATOR` in `[M4-R9] a real test`. 1 mapped tests and 1 executed mutants."],
  executedTests: new Set(["[M4-R9] a real test"]),
  executedMutants: new Set(["M1_RELAX_SHARED_COUNT_VALIDATOR"]),
  measured: { mappedTests: 1, mutants: 1 },
  ...overrides,
});

test("[M4-R32] the runner's validator accepts claims that match what executed", () => {
  const r = validateTraceability(traceInput());
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("[M4-R32] the runner's validator rejects a cited mutant that never executed", () => {
  const r = validateTraceability(traceInput({ texts: [traceInput().texts[0] + " Also `M99_NEVER_EXECUTED`."] }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.unexecutedCitedMutants, ["M99_NEVER_EXECUTED"], "[M4-R32] the unexecuted claim must be named");
});

test("[M4-R32] the runner's validator rejects an executed mutant missing from the report", () => {
  const r = validateTraceability(traceInput({ executedMutants: new Set(["M1_RELAX_SHARED_COUNT_VALIDATOR", "M14_DISABLE_DURABLE_OWNERSHIP_RESERVATION"]), measured: { mappedTests: 1, mutants: 2 }, texts: ["Executed `M1_RELAX_SHARED_COUNT_VALIDATOR` in `[M4-R9] a real test`."] }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingExecutedMutants, ["M14_DISABLE_DURABLE_OWNERSHIP_RESERVATION"], "[M4-R32] the omitted executed mutant must be named");
});

test("[M4-R32] the runner's validator rejects a cited test that did not run", () => {
  const r = validateTraceability(traceInput({ texts: [traceInput().texts[0] + " And `[M4-R99] phantom test`."] }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.unexecutedCitedTests, ["[M4-R99] phantom test"], "[M4-R32] the phantom test must be named");
});

test("[M4-R32] the runner's validator rejects stale counts", () => {
  const r = validateTraceability(traceInput({ texts: ["Executed `M1_RELAX_SHARED_COUNT_VALIDATOR` in `[M4-R9] a real test`. 18 mapped tests and 13 mutants."] }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.staleCounts.map((c) => c.text), ["18 mapped tests", "13 mutants"], "[M4-R32] each stale count must be named");
  // Round 5 (M4-R36): only an explicitly delimited historical block keeps an earlier count out of
  // the current claims. The word "historical" on a line exempts nothing.
  const delimited = validateTraceability(traceInput({ texts: [traceInput().texts[0] + "\n<!-- historical:begin -->\nRound 3 claimed 18 mapped tests.\n<!-- historical:end -->"] }));
  assert.equal(delimited.ok, true, JSON.stringify(delimited.staleCounts));
  const wordOnly = validateTraceability(traceInput({ texts: [traceInput().texts[0] + "\nHistorical: round 3 claimed 18 mapped tests."] }));
  assert.equal(wordOnly.ok, false, "[M4-R36] a bare 'Historical:' line must not hide a stale count");
});

test("[M4-R32] executed mutant IDs and failure outcomes are derived from execution records", () => {
  const defined = mutantIdsInSensitivitySource();
  assert.ok(defined.length > 0, "the sensitivity suite must define mutants");
  assert.equal(new Set(defined).size, defined.length, "mutant IDs must be unique");
  for (const id of ["M14_DISABLE_DURABLE_OWNERSHIP_RESERVATION", "M15_DISABLE_COMMIT_CANCELLATION_FENCE", "M16_OMIT_POST_AWAIT_OWNERSHIP_RECHECK"]) {
    assert.ok(defined.includes(id), `${id} must be defined`);
  }
  const receiptsPath = path.join(packRoot, "receipts", "07b-executed-mutants.json");
  assert.ok(fs.existsSync(receiptsPath), "receipts/07b-executed-mutants.json must exist");
  const data = JSON.parse(fs.readFileSync(receiptsPath, "utf8"));
  // Counts come from the record and the suite's own definitions, never from a literal.
  assert.equal(data.total, data.mutants.length, "[M4-R32] the recorded total must equal the recorded mutants");
  assert.deepEqual([...data.mutants.map((m) => m.id)].sort(), [...defined].sort(), "[M4-R32] every defined mutant, and only those, must be recorded as executed");
  for (const m of data.mutants) {
    assert.ok(m.failure && m.failure.length > 0, `mutant ${m.id} must have recorded the regression it failed`);
  }
});

// ---------------------------------------------------------------------------
// Round 5 (Claude): M4-R33 fail-closed reservation, M4-R34 exact claim authorization,
// M4-R35 install execution records, M4-R36 named mutant claims.
// ---------------------------------------------------------------------------

const blockClaimWrites = (db) =>
  db.exec("CREATE TRIGGER reject_claim BEFORE UPDATE ON material_operation_claims BEGIN SELECT RAISE(ABORT, 'claim write blocked'); END;");
const claimOf = (db) => db.prepare("SELECT reserved_generation AS g, cancelled_generation AS c FROM material_operation_claims WHERE material_id='mat_sample_001'").get();
const savedTuple = (db) => db.prepare("SELECT last_requested_page AS page, originating_content_sha256 AS hash, last_requested_page_label AS label, status, owner_generation AS owner FROM material_reading_state WHERE material_id='mat_sample_001'").get();

test("[M4-R33] a failed claim write throws, returns no token and leaves the saved tuple and claim unchanged", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const seed = p.reserveOperationOwnership("mat_sample_001");
    p.commitNavigation(dest({ physicalPage: 5, pageLabel: "v" }), seed);
    const before = savedTuple(db);
    blockClaimWrites(db);
    assert.throws(() => p.reserveOperationOwnership("mat_sample_001"), /claim write blocked/, "[M4-R33] the claim write failure must be surfaced, never a token");
    assert.deepEqual(savedTuple(db), before, "[M4-R33] the saved tuple must be unchanged");
    assert.equal(claimOf(db).g, seed, "[M4-R33] no unpersisted claim may exist");
  } finally { db.close(); }
});

test("[M4-R33] a blocked claim write cannot hand out equal tokens or let the earlier request win", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const seed = p.reserveOperationOwnership("mat_sample_001");
    p.commitNavigation(dest({ physicalPage: 5 }), seed);
    blockClaimWrites(db);
    const tokens = [];
    for (let i = 0; i < 2; i++) {
      try { tokens.push(p.reserveOperationOwnership("mat_sample_001")); } catch { /* fail closed */ }
    }
    assert.deepEqual(tokens, [], "[M4-R33] no caller may be told it owns an unrecorded generation");
    assert.equal(savedTuple(db).page, 5, "[M4-R33] page 5 must remain the saved page");
  } finally { db.close(); }
});

test("[M4-R33] a missing claims table fails reservation instead of being created on demand", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    db.exec("DROP TABLE material_operation_claims;");
    assert.throws(() => p.reserveOperationOwnership("mat_sample_001"), /no such table/, "[M4-R33] the declared claims table is required");
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name='material_operation_claims'").get().c, 0, "[M4-R33] the protocol must not create hidden schema");
  } finally { db.close(); }
});

test("[M4-R33] a controller whose reservation fails reports it and never opens or saves", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const seed = p.reserveOperationOwnership("mat_sample_001");
    p.commitNavigation(dest({ physicalPage: 5 }), seed);
    blockClaimWrites(db);
    let opened = 0;
    let persisted = 0;
    const c = new OpenerController({
      injectedOpener: async () => { opened++; },
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => { persisted++; return p.commitNavigation(d, g); },
    });
    const r = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 20 })));
    assert.equal(r.success, false, "[M4-R33] a reservation failure is an honest failure");
    assert.match(String(r.error), /Failed to reserve operation ownership: claim write blocked/);
    assert.equal(opened, 0, "[M4-R33] nothing is opened without ownership");
    assert.equal(persisted, 0, "[M4-R33] nothing is written without ownership");
    assert.equal(savedTuple(db).page, 5);
  } finally { db.close(); }
});

test("[M4-R33] two connections to one file-backed database reserve distinct, increasing, durable tokens", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hfd-r33-two-conn-"));
  const db1 = new DatabaseSync(path.join(tmp, "store.db"));
  try {
    const p1 = applySchema(db1);
    p1.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const db2 = new DatabaseSync(path.join(tmp, "store.db"));
    try {
      const p2 = new DocumentPersistenceProtocol(db2);
      const a = p1.reserveOperationOwnership("mat_sample_001");
      const b = p2.reserveOperationOwnership("mat_sample_001");
      const c = p1.reserveOperationOwnership("mat_sample_001");
      assert.deepEqual([a, b, c], [1, 2, 3], "[M4-R33] tokens must be distinct and increasing across connections");
      assert.equal(db2.prepare("SELECT reserved_generation AS g FROM material_operation_claims WHERE material_id='mat_sample_001'").get().g, 3, "[M4-R33] each reservation is durable before it is returned");
      assert.equal(p2.commitNavigation(dest({ physicalPage: 12 }), b).committed, false, "[M4-R34] an older token is not the current claim");
      assert.equal(p1.commitNavigation(dest({ physicalPage: 30 }), c).committed, true);
    } finally { db2.close(); }
  } finally { db1.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("[M4-R33] reservation survives restart and refuses overflow without changing the claim", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hfd-r33-restart-"));
  try {
    let db = new DatabaseSync(path.join(tmp, "store.db"));
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    for (const page of [5, 6]) p.commitNavigation(dest({ physicalPage: page }), p.reserveOperationOwnership("mat_sample_001"));
    db.close();
    db = new DatabaseSync(path.join(tmp, "store.db"));
    const p2 = new DocumentPersistenceProtocol(db);
    const next = p2.reserveOperationOwnership("mat_sample_001");
    assert.equal(next, 3, "[M4-R33] the next token after restart follows the durable claim");
    assert.equal(p2.commitNavigation(dest({ physicalPage: 7 }), next).committed, true);
    db.exec(`UPDATE material_operation_claims SET reserved_generation = ${Number.MAX_SAFE_INTEGER - 1} WHERE material_id='mat_sample_001'`);
    assert.throws(() => p2.reserveOperationOwnership("mat_sample_001"), RangeError, "[M4-R33] overflow is refused");
    assert.equal(claimOf(db).g, Number.MAX_SAFE_INTEGER - 1, "[M4-R33] a refused reservation leaves the claim unchanged");
    db.close();
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("[M4-R34] commit rejects a generation that was never the reserved owner", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const owner = p.reserveOperationOwnership("mat_sample_001");
    const result = p.commitNavigation(dest({ physicalPage: 9 }), owner + 100);
    assert.equal(result.committed, false, "[M4-R34] an unreserved future token is not the authorized owner");
    assert.equal(result.reason, "unreserved");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM material_reading_state").get().n, 0, "[M4-R34] nothing may be written");
  } finally { db.close(); }
});

test("[M4-R34] commit with no claim is rejected without writing", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const result = p.commitNavigation(dest({ physicalPage: 9 }), 1);
    assert.equal(result.committed, false, "[M4-R34] no claim, no write");
    assert.equal(result.reason, "unreserved");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM material_reading_state").get().n, 0);
  } finally { db.close(); }
});

test("[M4-R34] an unreadable claim rejects the commit and keeps the exact saved tuple", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const t = p.reserveOperationOwnership("mat_sample_001");
    p.commitNavigation(dest({ physicalPage: 5, pageLabel: "v" }), t);
    const before = savedTuple(db);
    db.exec("DROP TABLE material_operation_claims;");
    const result = p.commitNavigation(dest({ physicalPage: 20, pageLabel: "xx" }), t + 1);
    assert.equal(result.committed, false, "[M4-R34] unreadable ownership is a rejection");
    assert.match(result.reason, /^ownership-unreadable/);
    assert.deepEqual(savedTuple(db), before, "[M4-R34] the saved page, hash, label, status and owner must be unchanged");
  } finally { db.close(); }
});

test("[M4-R34] once a later token is reserved the earlier one is rejected and the winner's exact tuple stands", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const p = applySchema(db);
    p.saveContentIdentity("mat_sample_001", SHA_A, 50);
    const earlier = p.reserveOperationOwnership("mat_sample_001");
    const later = p.reserveOperationOwnership("mat_sample_001");
    assert.equal(p.commitNavigation(dest({ physicalPage: 20, pageLabel: "xx" }), later).committed, true);
    const late = p.commitNavigation(dest({ physicalPage: 10, pageLabel: "x" }), earlier);
    assert.equal(late.committed, false, "[M4-R34] the superseded token cannot write");
    assert.equal(late.reason, "superseded");
    assert.deepEqual({ ...savedTuple(db) }, { page: 20, hash: SHA_A, label: "xx", status: "active", owner: later }, "[M4-R34] the winner's page, hash, printed label and status are exact");
  } finally { db.close(); }
});

/**
 * A disposable mini repository for driving the REAL runner up to its engine step
 * (`--engine-check-only`). The engine files are small stand-ins whose digests are bound consistently,
 * so each test changes exactly one piece of the evidence.
 */
function miniRunnerRepo(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `hfd-r35-${label}-`));
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base"], { cwd: root });
  const packRel = path.join("docs", "evidence", path.basename(packRoot));
  const pack = path.join(root, packRel);
  fs.mkdirSync(path.join(pack, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(pack, "proof"), { recursive: true });
  for (const f of ["run_integration_proof.mjs", "evidenceChecks.mjs"]) fs.copyFileSync(path.join(packRoot, "scripts", f), path.join(pack, "scripts", f));
  fs.copyFileSync(path.join(packRoot, "proof", "realParserDemonstration.mjs"), path.join(pack, "proof", "realParserDemonstration.mjs"));
  const engine = path.join(pack, "scratch", "pdfjs-engine");
  fs.mkdirSync(path.join(engine, "node_modules", "pdfjs-dist", "legacy", "build"), { recursive: true });
  fs.writeFileSync(path.join(engine, "package.json"), '{"name":"engine","private":true}\n');
  fs.writeFileSync(path.join(engine, "package-lock.json"), '{"name":"engine","lockfileVersion":3}\n');
  fs.writeFileSync(path.join(engine, "node_modules", "pdfjs-dist", "package.json"), '{"name":"pdfjs-dist","version":"0.0.0-test"}\n');
  fs.writeFileSync(path.join(engine, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs"), "export const stand_in = true;\n");
  const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(engine, f))).digest("hex");
  fs.writeFileSync(path.join(engine, "scratch-artifacts.json"), JSON.stringify({
    lockfile: { sha256: sha("package-lock.json") },
    packageJson: { sha256: sha("package.json") },
    evaluated_assets: { "legacy/build/pdf.mjs": { sha256: sha("node_modules/pdfjs-dist/legacy/build/pdf.mjs") } },
  }));
  const realRoot = fs.realpathSync(root);
  const record = {
    schema: INSTALL_EXECUTION_SCHEMA,
    command: installCommandFor(packRel.split(path.sep).join("/") + "/scratch/pdfjs-engine"),
    cwd: realRoot,
    nodeVersion: "v22.23.3", npmVersion: "10.9.9", exit: 0, signal: null,
    startedAt: "2026-10-16T00:00:00.000Z", finishedAt: "2026-10-16T00:00:01.000Z",
    stdout: "added 3 packages", stderr: "",
    bindings: engineBindings(engine),
  };
  const writeRecord = (r) => fs.writeFileSync(path.join(engine, "install-execution.json"), JSON.stringify(r, null, 2));
  const run = (...args) => spawnSync(process.execPath, [path.join(pack, "scripts", "run_integration_proof.mjs"), "--engine-check-only", ...args], { cwd: realRoot, encoding: "utf8" });
  const receipt = () => fs.readFileSync(path.join(pack, "receipts", "01b-engine-install.txt"), "utf8");
  return { root, engine, record, writeRecord, run, receipt };
}

test("[M4-R35] the real runner's reuse route accepts a valid recorded successful install", () => {
  const m = miniRunnerRepo("valid");
  try {
    m.writeRecord(m.record);
    const r = m.run();
    assert.equal(r.status, 0, `valid recorded reuse must pass: ${r.stderr}`);
    assert.match(r.stdout, /ENGINE CHECK PASSED \(verified-reuse\)/);
    assert.match(m.receipt(), /attestation: PASS/);
    assert.match(m.receipt(), /RESULT: PASS - engine bytes verified and bound to a recorded successful install/);
  } finally { fs.rmSync(m.root, { recursive: true, force: true }); }
});

for (const [label, change, problem] of [
  ["missing", (m) => {}, /install execution record missing/],
  ["exit42", (m) => m.writeRecord({ ...m.record, exit: 42 }), /recorded install exit is 42, not 0/],
  ["wrong-cwd", (m) => m.writeRecord({ ...m.record, cwd: "/nonexistent/install/cwd" }), /recorded cwd .* is not this checkout/],
  ["wrong-binding", (m) => m.writeRecord({ ...m.record, bindings: { ...m.record.bindings, "node_modules/pdfjs-dist/legacy/build/pdf.mjs": "0".repeat(64) } }), /has changed since the recorded install/],
  ["malformed", (m) => fs.writeFileSync(path.join(m.engine, "install-execution.json"), "{not json"), /install execution record malformed/],
]) {
  test(`[M4-R35] the real runner's reuse route rejects ${label} install evidence`, () => {
    const m = miniRunnerRepo(label);
    try {
      change(m);
      const r = m.run();
      assert.equal(r.status, 1, `[M4-R35] ${label} evidence must fail the run`);
      assert.doesNotMatch(r.stdout, /ENGINE CHECK PASSED/);
      const text = m.receipt();
      assert.match(text, problem, `[M4-R35] the receipt must name the problem`);
      assert.match(text, /attestation: FAILED/);
      assert.match(text, /RESULT: FAILED/);
      assert.doesNotMatch(text, /RESULT: PASS/);
      const summary = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(m.engine)), "receipts", "15-run-summary.json"), "utf8"));
      assert.notEqual(summary.status, "engine-check-only", "[M4-R35] a failed reuse must not record a passing engine check");
    } finally { fs.rmSync(m.root, { recursive: true, force: true }); }
  });
}

test("[M4-R35] a live install that fails writes its real non-zero execution record and a FAILED receipt", () => {
  const m = miniRunnerRepo("live-fail");
  try {
    fs.writeFileSync(path.join(m.engine, "package-lock.json"), "{ this is not a lockfile");
    const r = m.run("--install");
    assert.equal(r.status, 1, "[M4-R35] a failed live install fails the run");
    const record = JSON.parse(fs.readFileSync(path.join(m.engine, "install-execution.json"), "utf8"));
    assert.notEqual(record.exit, 0, "[M4-R35] the execution record keeps the real exit");
    assert.equal(record.schema, INSTALL_EXECUTION_SCHEMA);
    const text = m.receipt();
    assert.match(text, new RegExp(`^exit: ${record.exit}$`, "m"), "[M4-R35] the receipt agrees with the real exit");
    assert.match(text, /RESULT: FAILED - npm ci exited/);
    // And that failed record can never be reused afterwards.
    const reuse = m.run();
    assert.equal(reuse.status, 1, "[M4-R35] a recorded failed install cannot later attest reuse");
  } finally { fs.rmSync(m.root, { recursive: true, force: true }); }
});

test("[M4-R35] digest integrity and successful-install attestation are checked separately", () => {
  const bindings = Object.fromEntries(ENGINE_BOUND_FILES.map((f) => [f, "a".repeat(64)]));
  const expected = { expectedCommand: installCommandFor("p/scratch/pdfjs-engine"), expectedCwd: "/repo", currentBindings: bindings };
  const good = { schema: INSTALL_EXECUTION_SCHEMA, command: expected.expectedCommand, cwd: "/repo", nodeVersion: "v22", npmVersion: "10", exit: 0, startedAt: "a", finishedAt: "b", stdout: "", stderr: "", bindings };
  assert.equal(validateInstallExecution({ record: good, error: null }, expected).ok, true);
  // Matching digests alone do not attest a successful command.
  assert.equal(validateInstallExecution({ record: { ...good, exit: null }, error: null }, expected).ok, false, "[M4-R35] no exit, no attestation");
  assert.equal(validateInstallExecution({ record: { ...good, command: "verified-reuse: npm ci (described)" }, error: null }, expected).ok, false, "[M4-R35] a described command is not the executed one");
  assert.equal(validateInstallExecution({ record: { ...good, schema: "hand-written" }, error: null }, expected).ok, false, "[M4-R35] an unrecognised record is not evidence");
});

test("[M4-R36] active unexecuted mutant claims cannot escape via NAVIGATION in their ID", () => {
  const result = validateTraceability({ texts: ["M1_REAL\nM99_NAVIGATION_NEVER_EXECUTED"], executedTests: new Set(), executedMutants: new Set(["M1_REAL"]), measured: { mappedTests: 72, mutants: 1 } });
  assert.equal(result.ok, false, "[M4-R36] the active fabricated mutant must be rejected");
  assert.deepEqual(result.unexecutedCitedMutants, ["M99_NAVIGATION_NEVER_EXECUTED"]);
  for (const word of ["DOCUMENT", "ROUND", "CONDITIONAL", "VIEWER"]) {
    const r = validateTraceability({ texts: [`Current executed mutant: M98_${word}_CLAIM.`], executedTests: new Set(), executedMutants: new Set(["M1_REAL"]), measured: { mappedTests: 0, mutants: 1 } });
    assert.deepEqual(r.unexecutedCitedMutants, [`M98_${word}_CLAIM`], `[M4-R36] ${word} in a mutant ID is no exemption`);
  }
});

test("[M4-R36] document references and environment syntax are distinguished from claims by syntax, and history only by markers", () => {
  const r = validateTraceability({
    texts: [
      "See docs/M4_DOCUMENT_NAVIGATION_ROUND5_CORRECTIONS_REPORT_2026-10-16.md and M4_DOCUMENT_NAVIGATION_ROUND4_CORRECTIONS_PROMPT_2026-10-11.md.\n" +
      "Run with M4_REVIEW_TARGET_PACK=/abs/pack or $M4_PINNED_REF.\n" +
      "Executed `M1_REAL`.\n" +
      "<!-- historical:begin -->\nRound 3 cited M77_OLD_CLAIM.\n<!-- historical:end -->",
    ],
    executedTests: new Set(), executedMutants: new Set(["M1_REAL"]), measured: { mappedTests: 0, mutants: 1 },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const bare = validateTraceability({ texts: ["Executed `M1_REAL`.\nHistorical: M77_OLD_CLAIM"], executedTests: new Set(), executedMutants: new Set(["M1_REAL"]), measured: { mappedTests: 0, mutants: 1 } });
  assert.deepEqual(bare.unexecutedCitedMutants, ["M77_OLD_CLAIM"], "[M4-R36] the word 'historical' alone exempts nothing");
  const open = validateTraceability({ texts: ["Executed `M1_REAL`.\n<!-- historical:begin -->\nM76_HIDDEN"], executedTests: new Set(), executedMutants: new Set(["M1_REAL"]), measured: { mappedTests: 0, mutants: 1 } });
  assert.deepEqual(open.unexecutedCitedMutants, ["M76_HIDDEN"], "[M4-R36] an unterminated historical block hides nothing");
});

test("[M4-R36] the real runner rejects a current report claiming M99_NAVIGATION_NEVER_EXECUTED", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hfd-r36-claims-"));
  try {
    const pack = path.join(root, "docs", "evidence", path.basename(packRoot));
    fs.mkdirSync(path.join(pack, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(pack, "proof"), { recursive: true });
    fs.mkdirSync(path.join(pack, "receipts"), { recursive: true });
    for (const f of ["run_integration_proof.mjs", "evidenceChecks.mjs"]) fs.copyFileSync(path.join(packRoot, "scripts", f), path.join(pack, "scripts", f));
    fs.copyFileSync(path.join(packRoot, "proof", "realParserDemonstration.mjs"), path.join(pack, "proof", "realParserDemonstration.mjs"));
    fs.writeFileSync(path.join(pack, "README.md"), "Executed `M1_REAL`.\n");
    fs.writeFileSync(path.join(pack, "issue-to-test-map.json"), JSON.stringify({ groups: [{ cases: [{ test_name: "[M4-R9] a real test" }] }] }));
    fs.writeFileSync(path.join(pack, "receipts", "05-suite-proof.txt"), "passed names:\n  - [M4-R9] a real test\n");
    fs.writeFileSync(path.join(pack, "receipts", "07b-executed-mutants.json"), JSON.stringify({ total: 1, mutants: [{ id: "M1_REAL", failure: "x" }] }));
    const report = path.join(root, "docs", "M4_DOCUMENT_NAVIGATION_ROUND6_CORRECTIONS_REPORT_2026-10-16.md");
    const run = () => spawnSync(process.execPath, [path.join(pack, "scripts", "run_integration_proof.mjs"), "--validate-claims-only"], { cwd: root, encoding: "utf8" });

    fs.writeFileSync(report, "Executed `M1_REAL` in `[M4-R9] a real test`. 1 mapped tests and 1 executed mutants.\n");
    const clean = run();
    assert.equal(clean.status, 0, `a matching report must pass: ${clean.stderr}${clean.stdout}`);

    fs.appendFileSync(report, "Current executed mutant: M99_NAVIGATION_NEVER_EXECUTED\n");
    const fabricated = run();
    assert.equal(fabricated.status, 1, "[M4-R36] the real runner must reject the fabricated active claim");
    assert.match(fabricated.stdout, /UNEXECUTED CITED MUTANT: M99_NAVIGATION_NEVER_EXECUTED/);
    assert.match(fabricated.stderr, /PROOF RUN FAILED/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Round 6: M4-R37 (a newer failed request retires older work), M4-R38 (a claim must persist before
// its token is issued), M4-R39 (a signalled install keeps its real signal).
// ---------------------------------------------------------------------------

const blockClaimUpdates = (db, message = "reservation blocked") =>
  db.exec(`CREATE TRIGGER reject_claim_update BEFORE UPDATE ON material_operation_claims BEGIN SELECT RAISE(ABORT, '${message}'); END;`);

/** Seeds page 5 ("five") through the real protocol and returns the exact saved tuple. */
function seededStore() {
  const db = new DatabaseSync(":memory:");
  const p = applySchema(db);
  p.saveContentIdentity("mat_sample_001", SHA_A, 50);
  const seed = p.reserveOperationOwnership("mat_sample_001");
  assert.equal(p.commitNavigation(dest({ physicalPage: 5, pageLabel: "five" }), seed).committed, true);
  return { db, p, before: { ...savedTuple(db) } };
}

for (const boundary of ["opener", "persistence"]) {
  test(`[M4-R37] a newer failed reservation supersedes an older held ${boundary} and keeps the exact saved tuple`, async () => {
    const { db, p, before } = seededStore();
    const gate = held();
    let entered;
    const reached = new Promise((r) => (entered = r));
    let opened = 0;
    let writes = 0;
    try {
      const c = new OpenerController({
        identityProvider: (id) => p.getCurrentIdentity(id),
        injectedOpener: async () => { opened++; if (boundary === "opener") { entered(); await gate.promise; } },
        injectedPersistence: async (d, g) => { writes++; if (boundary === "persistence") { entered(); await gate.promise; } return p.commitNavigation(d, g); },
      });
      const older = c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 10, pageLabel: "ten" })));
      await reached;
      blockClaimUpdates(db);
      const newer = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 20, pageLabel: "twenty" })));
      assert.equal(newer.success, false);
      assert.match(String(newer.error), /Failed to reserve operation ownership: reservation blocked/);
      gate.resolve();
      const old = await older;
      assert.equal(old.success, false, "[M4-R37] the older operation is superseded by the newer failed request");
      assert.equal(old.superseded, true);
      assert.equal(c.state, "failed", "[M4-R37] the newest failure stays published");
      assert.equal(c.lastNotice, null, "[M4-R37] no late success notice replaces the newest failure");
      assert.deepEqual({ ...savedTuple(db) }, before, "[M4-R37] the exact saved tuple is unchanged");
      assert.equal(opened, 1, "[M4-R37] the opener is never invoked for the failed newer request");
      assert.equal(writes, boundary === "opener" ? 0 : 1, "[M4-R37] no persistence attempt beyond the held one, and no compensating write");
    } finally { gate.resolve(); db.close(); }
  });
}

test("[M4-R37] a save-only retry of a partially saved operation is refused after a newer failed reservation", async () => {
  const { db, p, before } = seededStore();
  try {
    let failSave = true;
    let opened = 0;
    let writes = 0;
    const c = new OpenerController({
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedOpener: async () => { opened++; },
      injectedPersistence: async (d, g) => {
        writes++;
        if (failSave) throw new Error("disk briefly unavailable");
        return p.commitNavigation(d, g);
      },
    });
    const partial = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 10, pageLabel: "ten" })));
    assert.equal(partial.state, "opened_unsaved");
    blockClaimUpdates(db);
    const newer = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 20, pageLabel: "twenty" })));
    assert.equal(newer.success, false);
    failSave = false;
    const writesBefore = writes;
    const retry = await partial.retrySave();
    assert.equal(retry.success, false, "[M4-R37] the retired operation's retry is refused");
    assert.equal(retry.superseded, true);
    assert.equal(writes, writesBefore, "[M4-R37] the refused retry never reaches persistence");
    assert.equal(opened, 1, "[M4-R37] a retry never replays the opener");
    assert.equal(c.state, "failed");
    assert.deepEqual({ ...savedTuple(db) }, before, "[M4-R37] the exact saved tuple is unchanged");
  } finally { db.close(); }
});

test("[M4-R37] a thrown preliminary ownership read is a reported failure that still retires older work", async () => {
  const { db, p, before } = seededStore();
  const gate = held();
  let entered;
  const reached = new Promise((r) => (entered = r));
  try {
    let readFails = false;
    let opened = 0;
    let writes = 0;
    const c = new OpenerController({
      generationSource: () => { if (readFails) throw new Error("ownership read failed"); return null; },
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedOpener: async () => { opened++; entered(); await gate.promise; },
      injectedPersistence: async (d, g) => { writes++; return p.commitNavigation(d, g); },
    });
    const older = c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 10, pageLabel: "ten" })));
    await reached;
    readFails = true;
    const newer = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 20, pageLabel: "twenty" })));
    assert.equal(newer.success, false, "[M4-R37] a thrown ownership read is reported, not an unhandled rejection");
    assert.match(String(newer.error), /Failed to read operation ownership: ownership read failed/);
    gate.resolve();
    const old = await older;
    assert.equal(old.success, false, "[M4-R37] the older operation is retired");
    assert.equal(writes, 0);
    assert.equal(opened, 1);
    assert.equal(c.state, "failed");
    assert.deepEqual({ ...savedTuple(db) }, before);
  } finally { gate.resolve(); db.close(); }
});

test("[M4-R37] after a failed request, a later successful request still opens and saves normally", async () => {
  const { db, p } = seededStore();
  try {
    const c = new OpenerController({
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedOpener: async () => {},
      injectedPersistence: async (d, g) => p.commitNavigation(d, g),
    });
    blockClaimUpdates(db);
    assert.equal((await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 20 })))).success, false);
    db.exec("DROP TRIGGER reject_claim_update;");
    const ok = await c.requestOpen(sampleMaterial, rec(dest({ physicalPage: 30, pageLabel: "thirty" })));
    assert.equal(ok.success, true, "[M4-R37] a legitimate newer request is unaffected");
    assert.equal(c.state, "opened");
    assert.deepEqual({ page: savedTuple(db).page, label: savedTuple(db).label }, { page: 30, label: "thirty" });
  } finally { db.close(); }
});

for (const phase of ["INSERT", "UPDATE"]) {
  test(`[M4-R38] an ignored claim ${phase} throws, issues no token and changes nothing`, () => {
    const { db, p, before } = seededStore();
    try {
      if (phase === "INSERT") db.exec("DELETE FROM material_operation_claims");
      const claimBefore = claimOf(db) ? { ...claimOf(db) } : null;
      db.exec(`CREATE TRIGGER ignore_claim BEFORE ${phase} ON material_operation_claims BEGIN SELECT RAISE(IGNORE); END;`);
      for (let i = 0; i < 2; i++) {
        assert.throws(() => p.reserveOperationOwnership("mat_sample_001"), /Claim write did not take effect/, `[M4-R38] an ignored ${phase} must not issue a token`);
      }
      assert.deepEqual(claimOf(db) ? { ...claimOf(db) } : null, claimBefore, "[M4-R38] the prior claim is unchanged");
      assert.deepEqual({ ...savedTuple(db) }, before, "[M4-R38] the saved tuple is unchanged");
    } finally { db.close(); }
  });
}

test("[M4-R38] a claim that persists the wrong generation, or cannot be read back, fails closed", () => {
  const { db, p, before } = seededStore();
  try {
    const claimBefore = { ...claimOf(db) };
    db.exec("CREATE TRIGGER skew_claim AFTER UPDATE OF reserved_generation ON material_operation_claims BEGIN UPDATE material_operation_claims SET reserved_generation = 999 WHERE material_id = NEW.material_id AND NEW.reserved_generation <> 999; END;");
    assert.throws(() => p.reserveOperationOwnership("mat_sample_001"), /Claim did not persist token 2 \(found 999\)/, "[M4-R38] a wrong persisted generation is refused");
    assert.deepEqual({ ...claimOf(db) }, claimBefore, "[M4-R38] the refused reservation rolled back");
    db.exec("DROP TRIGGER skew_claim;");

    // A read-back that fails after the write also refuses, and rolls the write back.
    const realPrepare = db.prepare.bind(db);
    let wrote = false;
    db.prepare = (sql) => {
      if (/INSERT INTO material_operation_claims/.test(sql)) wrote = true;
      else if (wrote && /SELECT reserved_generation FROM material_operation_claims/.test(sql)) throw new Error("read-back failed");
      return realPrepare(sql);
    };
    try {
      assert.throws(() => p.reserveOperationOwnership("mat_sample_001"), /read-back failed/, "[M4-R38] a failed read-back is refused");
    } finally { db.prepare = realPrepare; }
    assert.deepEqual({ ...claimOf(db) }, claimBefore, "[M4-R38] the claim is unchanged after a failed read-back");
    assert.deepEqual({ ...savedTuple(db) }, before);
  } finally { db.close(); }
});

test("[M4-R38] a normal reservation persists exactly the token it returns", () => {
  const { db, p } = seededStore();
  try {
    const token = p.reserveOperationOwnership("mat_sample_001");
    assert.equal(claimOf(db).g, token, "[M4-R38] the returned token is the persisted claim");
    assert.equal(p.commitNavigation(dest({ physicalPage: 7, pageLabel: "seven" }), token).committed, true);
    assert.equal(savedTuple(db).page, 7);
  } finally { db.close(); }
});

test("[M4-R39] a signal-terminated live install keeps exit null and its real signal, and fails the run", () => {
  const m = miniRunnerRepo("signal");
  try {
    // A disposable npm stand-in for this test only: --version succeeds, the install child kills itself.
    const bin = path.join(m.root, "test-adapter-bin");
    fs.mkdirSync(bin);
    const npm = path.join(bin, "npm");
    fs.writeFileSync(npm, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "10.9.9"; exit 0; fi\nkill -TERM $$\n');
    fs.chmodSync(npm, 0o700);
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const control = spawnSync(npm, ["ci"], { env, encoding: "utf8" });
    assert.equal(control.signal, "SIGTERM", "control: the stand-in really terminates by signal");
    const realRoot = fs.realpathSync(m.root);
    const packDir = path.dirname(path.dirname(m.engine));
    const r = spawnSync(process.execPath, [path.join(packDir, "scripts", "run_integration_proof.mjs"), "--engine-check-only", "--install"], { cwd: realRoot, env, encoding: "utf8" });
    assert.equal(r.status, 1, "[M4-R39] a signal-terminated install fails the run");
    assert.doesNotMatch(r.stdout, /ENGINE CHECK PASSED/);
    const record = JSON.parse(fs.readFileSync(path.join(m.engine, "install-execution.json"), "utf8"));
    assert.equal(record.exit, null, "[M4-R39] a signal termination has no exit status");
    assert.equal(record.signal, control.signal, "[M4-R39] the record keeps the real signal");
    const text = m.receipt();
    assert.match(text, /^signal: SIGTERM$/m, "[M4-R39] the audit agrees with the record");
    assert.match(text, /RESULT: FAILED - npm ci was terminated by SIGTERM/);
    assert.doesNotMatch(text, /RESULT: PASS/);
    const summary = JSON.parse(fs.readFileSync(path.join(packDir, "receipts", "15-run-summary.json"), "utf8"));
    assert.notEqual(summary.status, "engine-check-only", "[M4-R39] no passing engine check is recorded");
    assert.match(fs.readFileSync(path.join(packDir, "receipts", "16-manifest-verification.txt"), "utf8"), /RESULT: (NOT RUN|INCOMPLETE)/, "[M4-R39] no verification success is claimed");
  } finally { fs.rmSync(m.root, { recursive: true, force: true }); }
});

test("[M4-R39] a recorded signal-terminated install cannot attest reuse", () => {
  const bindings = Object.fromEntries(ENGINE_BOUND_FILES.map((f) => [f, "a".repeat(64)]));
  const expected = { expectedCommand: installCommandFor("p/scratch/pdfjs-engine"), expectedCwd: "/repo", currentBindings: bindings };
  const good = { schema: INSTALL_EXECUTION_SCHEMA, command: expected.expectedCommand, cwd: "/repo", nodeVersion: "v22", npmVersion: "10", exit: 0, signal: null, startedAt: "a", finishedAt: "b", stdout: "", stderr: "", bindings };
  assert.equal(validateInstallExecution({ record: good, error: null }, expected).ok, true);
  const signalled = validateInstallExecution({ record: { ...good, exit: null, signal: "SIGTERM" }, error: null }, expected);
  assert.equal(signalled.ok, false, "[M4-R39] a signalled install is not a successful install");
  assert.ok(signalled.problems.some((x) => /terminated by "SIGTERM"/.test(x)));
});
