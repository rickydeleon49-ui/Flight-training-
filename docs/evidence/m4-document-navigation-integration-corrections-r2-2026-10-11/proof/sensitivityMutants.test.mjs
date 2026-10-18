/**
 * Her Flight Deck - Disposable Module Mutation Sensitivity (round 2)
 *
 * Every guard added or strengthened this round is pinned by reverting it in a disposable COPY of
 * the submitted module and running an unchanged regression against the copy. The regression must
 * fail with an AssertionError naming that guard. The live worktree is never mutated, and its
 * digests are re-verified afterwards.
 *
 * M10 covers M4-R21's ledger binding; M11 is the M4-R22 loud-failure control, which needs no
 * mutant because the missing install is the mutation itself.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as cleanContract from "./contractModel.mjs";
import * as cleanPersistence from "./persistenceProtocol.mjs";
import * as cleanController from "./openerController.mjs";
import * as cleanLedger from "./shippedLedger.mjs";
import { resolveEngine } from "./realParserDemonstration.mjs";
import * as cleanEvidence from "../scripts/evidenceChecks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packRoot = path.resolve(here, "..");
const SOURCE_FILES = ["contractModel.mjs", "persistenceProtocol.mjs", "openerController.mjs", "shippedLedger.mjs"];
// Round 5: the runner's shared evidence checks are mutated too (M4-R35/R36). It lives in scripts/.
const EVIDENCE_FILE = path.join(packRoot, "scripts", "evidenceChecks.mjs");

// Reference inputs live in the real pack; disposable copies are pointed at them explicitly.
process.env.M4_ACCEPTED_MAIN_ROOT ??= path.join(packRoot, "scratch", "accepted-main");
const refs = {
  candidateDdl: cleanLedger.candidateDdlText(),
};

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const MAT = { id: "mat_sample_001", title: "IFH", filePath: "ifh.pdf" };
const held = () => { let r; const p = new Promise((res) => (r = res)); return { promise: p, resolve: r }; };
const destination = (over = {}) => ({
  materialId: MAT.id, coordinateSpace: "material_physical", contentSha256: SHA_A,
  physicalPage: 42, totalPages: 50, pageLabel: null, provenance: "physical_index", ...over,
});
const record = (d) => ({ status: "resolved", destination: d });

const firstLevelLineage = {
  materialId: "mat_child", childPageCount: 16, rootMaterialId: "mat_root", rootContentSha256: SHA_A,
  sourcePageStart: 101, sourcePageEnd: 116, sourceTotalPages: 200,
  parentMaterialId: null, parentPageStart: null, parentPageEnd: null, parentTotalPages: null,
};
const fullLineage = {
  materialId: "mat_child", childPageCount: 16, rootMaterialId: "mat_root", rootContentSha256: SHA_A,
  sourcePageStart: 101, sourcePageEnd: 116, sourceTotalPages: 200,
  parentMaterialId: "mat_parent", parentContentSha256: SHA_B,
  parentPageStart: 21, parentPageEnd: 36, parentTotalPages: 100,
};

function schemaBackedDb(mods, fileDb = null) {
  const db = fileDb || new DatabaseSync(":memory:");
  // Reference paths resolve through M4_ACCEPTED_MAIN_ROOT, so a disposable copy still sees the real tree.
  mods.shippedLedger.applyShippedMigrations(db);
  const p = new mods.persistenceProtocol.DocumentPersistenceProtocol(db);
  p.applyCandidateDdl(refs.candidateDdl);
  db.prepare("INSERT INTO study_materials (id,title,material_type,topic,file_path,created_at,updated_at) VALUES (?, 'IFH','handbook','x','/ifh.pdf','x','x')").run(MAT.id);
  return { db, p };
}

/** Round 5 fixture setup (M4-R34): seed writes reserve their exact token through the module under test. */
function reserveExactly(p, generation) {
  const token = p.reserveOperationOwnership(MAT.id, generation - 1);
  assert.equal(token, generation, `fixture expected to reserve token ${generation}`);
}

// ---------------------------------------------------------------------------
// Unchanged regressions (shared by the baseline run and every mutant run)
// ---------------------------------------------------------------------------

async function regressionTotals(m) {
  for (const totalPages of [undefined, null, NaN, Infinity, 2.5, "50"]) {
    const r = m.contractModel.resolveDestination({ materialId: MAT.id, reference: 42, identity: { contentSha256: SHA_A, totalPages }, provenance: "physical_index" });
    assert.equal(r.isResolved, false, `[M4-R9] totalPages ${String(totalPages)} must not resolve`);
  }
}

async function regressionFirstLevelLineage(m) {
  const r = m.contractModel.translateSplitCoordinates({ direction: "child_to_root", page: 3 }, firstLevelLineage);
  assert.equal(r.success, true, `[M4-R9] first-level lineage must allow root navigation: ${r.error ?? ""}`);
  assert.equal(r.rootPage, 103, `[M4-R9] first-level lineage must land on page 103`);
}

async function regressionDestinationCount(m) {
  for (const sourceTotalPages of [null, undefined, "200", 2.5, NaN]) {
    const r = m.contractModel.translateSplitCoordinates({ direction: "child_to_root", page: 12 }, { ...fullLineage, sourceTotalPages });
    assert.equal(r.success, false, `[M4-R15] unknown destination count ${String(sourceTotalPages)} must not produce a verified destination`);
    assert.equal(r.code, "DESTINATION_COUNT_UNKNOWN", `[M4-R15] unknown destination count must report DESTINATION_COUNT_UNKNOWN`);
  }
}

async function regressionLabelBinding(m) {
  const map = { map: { iv: 4 }, contentSha256: SHA_A };
  const stale = m.contractModel.parsePageReference("iv", { provenance: "printed_label", labelToPhysicalMap: map, materialId: MAT.id, contentSha256: SHA_B, totalPages: 50 });
  assert.equal(stale.isResolved, false, "[M4-R16] stale label map must not resolve");
  const fresh = m.contractModel.parsePageReference("iv", { provenance: "printed_label", labelToPhysicalMap: map, materialId: MAT.id, contentSha256: SHA_A, totalPages: 50 });
  assert.equal(fresh.isResolved, true, "[M4-R16] a correctly content-bound map must resolve");
}

async function regressionAtomicInvalidation(m) {
  const { db, p } = schemaBackedDb(m);
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    p.addBookmark({ id: "bmk_s", materialId: MAT.id, pageIndex: 42, originatingContentSha256: SHA_A, title: "t" });
    assert.equal(db.prepare("SELECT status FROM material_bookmarks WHERE id='bmk_s'").get().status, "verified", "[M4-R10] baseline bookmark must be verified");
    p.replaceContentIdentity(MAT.id, SHA_B, 10);
    assert.equal(db.prepare("SELECT status FROM material_bookmarks WHERE id='bmk_s'").get().status, "unverified", "[M4-R10] bookmark must not remain verified after content replacement");
  } finally { db.close(); }
}

async function regressionHeldSaveFence(m) {
  const { db, p } = schemaBackedDb(m);
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    const h = held();
    const durable = [];
    const c = new m.openerController.OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => {
        if (d.physicalPage === 42) await h.promise;
        const v = p.commitNavigation(d, g);
        durable.push(db.prepare("SELECT last_requested_page AS p FROM material_reading_state WHERE material_id=?").get(MAT.id).p);
        return v;
      },
    });
    const old = c.requestOpen(MAT, record(destination({ physicalPage: 42, pageLabel: "forty-two" })));
    await Promise.resolve();
    await c.requestOpen(MAT, record(destination({ physicalPage: 3, pageLabel: "three" })));
    h.resolve();
    const oldRes = await old;
    // Durable evidence is asserted first so a fence failure names the fence, not the return shape.
    assert.ok(!durable.includes(42), `[M4-R13] obsolete page 42 must never become durable, observed ${JSON.stringify(durable)}`);
    assert.equal(db.prepare("SELECT last_requested_page AS p FROM material_reading_state WHERE material_id=?").get(MAT.id).p, 3, "[M4-R13] database must remain at page 3 after the obsolete page 42 completes");
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM material_reading_state").get().c, 1, "[M4-R13] no compensating second write may exist");
    assert.equal(oldRes.success, false, "[M4-R13] the obsolete operation must not report success");
  } finally { db.close(); }
}

async function regressionContentScoping(m) {
  const c = new m.openerController.OpenerController({ injectedOpener: async (f) => { if (f === "new.pdf") throw new Error("missing"); } });
  await c.requestOpen(MAT, record(destination({ physicalPage: 42 })));
  const r = await c.requestOpen({ ...MAT, filePath: "new.pdf" }, record(destination({ contentSha256: SHA_B, physicalPage: 3, totalPages: 10 })));
  assert.equal(r.success, false, "[M4-R11] replacement open must fail");
  assert.equal(c.lastRequestedPage, null, "[M4-R11] new content B cannot inherit page 42 from content A");
}

async function regressionTrustedCount(m) {
  let openerCalls = 0;
  const c = new m.openerController.OpenerController({
    injectedOpener: async () => { openerCalls += 1; },
    identityProvider: () => ({ contentSha256: SHA_A, totalPages: 10 }),
  });
  const r = await c.requestOpen(MAT, record(destination({ physicalPage: 42, totalPages: 50 })));
  // Opener evidence is asserted first so a bounds failure names the bounds guard.
  assert.equal(openerCalls, 0, "[M4-R17] caller-inflated count must not reach the opener");
  assert.equal(r.success, false, "[M4-R17] caller-inflated count must be refused");
}

async function regressionUnknownIdentity(m) {
  const { db, p } = schemaBackedDb(m);
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    reserveExactly(p, 1);
    const v = p.commitNavigation({ materialId: MAT.id, contentSha256: null, physicalPage: 5, pageLabel: null, totalPages: null, coordinateSpace: "material_physical", provenance: "physical_index" }, 1);
    assert.equal(v.committed, true, "[M4-R19] unknown identity must still be persisted");
    assert.equal(v.status, "unverified", "[M4-R19] unknown identity must never be active");
    const b = p.addBookmark({ id: "b_x", materialId: MAT.id, pageIndex: 5, title: "t", originatingContentSha256: "not-a-hash" });
    assert.equal(b.status, "unverified", "[M4-R19] malformed hash must persist unverified, not throw");
  } finally { db.close(); }
}

async function regressionLedgerCeiling(m) {
  const ceiling = m.shippedLedger.readCeiling();
  let error = null;
  let loaded = null;
  try { loaded = m.shippedLedger.loadVerifiedLedger(); } catch (e) { error = e; }
  assert.equal(error, null, `[M4-R21] ledger must verify against the derived ceiling ${ceiling}: ${error?.message ?? ""}`);
  assert.equal(loaded.files.length, ceiling, "[M4-R21] migration count must equal the derived accepted-base ceiling");
  assert.notEqual(ceiling, 13, "[M4-R21] the ceiling must not be the stale worktree base");
}

async function regressionTuplePropagation(m) {
  const { db, p } = schemaBackedDb(m);
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    reserveExactly(p, 1);
    p.saveReadingState(MAT.id, 42, { contentSha256: SHA_A, generation: 1, label: "printed-A-label" });
    p.replaceContentIdentity(MAT.id, SHA_B, 50);
    const c = new m.openerController.OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => p.commitNavigation(d, g),
    });

    const newer = await c.requestOpen(MAT, record(destination({ physicalPage: 3, contentSha256: SHA_B, pageLabel: "printed-B-label" })));
    assert.equal(newer.success, true);

    const row = db.prepare("SELECT last_requested_page, originating_content_sha256, last_requested_page_label, status FROM material_reading_state WHERE material_id=?").get(MAT.id);
    assert.equal(row.last_requested_page, 3, "[M4-R14] durable page must belong to winning operation");
    assert.equal(row.originating_content_sha256, SHA_B, "[M4-R14] durable hash must belong to winning operation");
    assert.equal(row.last_requested_page_label, "printed-B-label", "[M4-R14] durable label must belong to winning operation");
    assert.equal(row.status, "active", "[M4-R14] winner must be active");
  } finally { db.close(); }
}

async function regressionCrossSessionOrdering(m) {
  const { db, p } = schemaBackedDb(m);
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    // Session 1: saves pages 5, 6, 7
    const c1 = new m.openerController.OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => p.commitNavigation(d, g),
    });
    await c1.requestOpen(MAT, record(destination({ physicalPage: 5 })));
    await c1.requestOpen(MAT, record(destination({ physicalPage: 6 })));
    await c1.requestOpen(MAT, record(destination({ physicalPage: 7 })));
    assert.equal(db.prepare("SELECT last_requested_page AS p, owner_generation AS g FROM material_reading_state WHERE material_id=?").get(MAT.id).g, 3);

    // Session 2: new controller instance on the same database
    const c2 = new m.openerController.OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => p.commitNavigation(d, g),
    });
    const r9 = await c2.requestOpen(MAT, record(destination({ physicalPage: 9 })));
    assert.equal(r9.success, true, "[M4-R23] new session on same database must commit new page");
    assert.equal(db.prepare("SELECT last_requested_page AS p FROM material_reading_state WHERE material_id=?").get(MAT.id).p, 9, "[M4-R23] database must advance to page 9");
  } finally { db.close(); }
}

async function regressionLateRetrySuperseded(m) {
  const { db, p } = schemaBackedDb(m);
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    let failOp1 = true;
    const c = new m.openerController.OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => {
        if (d.physicalPage === 42 && failOp1) throw new Error("simulated failure");
        return p.commitNavigation(d, g);
      },
    });

    const op1 = await c.requestOpen(MAT, record(destination({ physicalPage: 42 })));
    assert.equal(op1.success, true);
    assert.equal(op1.state, "opened_unsaved");

    const op2 = await c.requestOpen(MAT, record(destination({ physicalPage: 3 })));
    assert.equal(op2.success, true);
    assert.equal(db.prepare("SELECT last_requested_page AS p FROM material_reading_state WHERE material_id=?").get(MAT.id).p, 3);

    failOp1 = false;
    const retryRes = await op1.retrySave();
    assert.equal(retryRes.success, false, "[M4-R24] late retry must be rejected when superseded");
    assert.equal(db.prepare("SELECT last_requested_page AS p FROM material_reading_state WHERE material_id=?").get(MAT.id).p, 3, "[M4-R24] database must remain at page 3 after late retry");
  } finally { db.close(); }
}

async function regressionDurableReservationOrder(m) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hfd-mut-r28-"));
  const dbPath = path.join(tmpDir, "store.db");
  const db1 = new DatabaseSync(dbPath);
  const p1 = schemaBackedDb(m, db1).p;
  p1.saveContentIdentity(MAT.id, SHA_A, 50);
  const db2 = new DatabaseSync(dbPath);
  const p2 = new m.persistenceProtocol.DocumentPersistenceProtocol(db2);
  try {
    const a = held(), b = held();
    const c1 = new m.openerController.OpenerController({
      identityProvider: (id) => p1.getCurrentIdentity(id),
      injectedOpener: async () => a.promise,
      injectedPersistence: async (d, g) => p1.commitNavigation(d, g),
    });
    const c2 = new m.openerController.OpenerController({
      identityProvider: (id) => p2.getCurrentIdentity(id),
      injectedOpener: async () => b.promise,
      injectedPersistence: async (d, g) => p2.commitNavigation(d, g),
    });
    const older = c1.requestOpen(MAT, record(destination({ physicalPage: 10 })));
    const newer = c2.requestOpen(MAT, record(destination({ physicalPage: 20 })));
    a.resolve();
    await older;
    b.resolve();
    await newer;
    const finalPage = db1.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id=?").get(MAT.id)?.last_requested_page;
    assert.equal(finalPage, 20, "[M4-R28] later request must win even when earlier completion lands first");
  } finally {
    db2.close();
    db1.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function regressionCancellationFence(m) {
  const { db, p } = schemaBackedDb(m);
  const gate = held(), entered = held();
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    reserveExactly(p, 1);
    p.saveReadingState(MAT.id, 5, { contentSha256: SHA_A, generation: 1 });
    const c = new m.openerController.OpenerController({
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => {
        entered.resolve();
        await gate.promise;
        return p.commitNavigation(d, g);
      },
    });
    const pending = c.requestOpen(MAT, record(destination({ physicalPage: 42 })));
    await entered.promise;
    c.abort();
    gate.resolve();
    await pending;
    const row = db.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id=?").get(MAT.id);
    assert.equal(row.last_requested_page, 5, "[M4-R29] abort before commit must preserve previous saved page");
  } finally { db.close(); }
}

async function regressionPostAwaitOwnership(m) {
  const { db, p } = schemaBackedDb(m);
  const gate = held(), entered = held();
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    const c = new m.openerController.OpenerController({
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
    const older = c.requestOpen(MAT, record(destination({ physicalPage: 10 })));
    await entered.promise;
    const newer = await c.requestOpen(MAT, record(destination({ physicalPage: 20 })));
    assert.equal(newer.saved, true);
    gate.resolve();
    await older;
    assert.equal(c.lastRequestedPage, 20, "[M4-R30] stale acknowledged operation must not replace winning controller progress");
  } finally { db.close(); }
}

// ---------------------------------------------------------------------------
// Round 5 regressions (M4-R33–R36)
// ---------------------------------------------------------------------------

async function regressionFailClosedReservation(m) {
  const { db, p } = schemaBackedDb(m);
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    const seed = p.reserveOperationOwnership(MAT.id);
    p.commitNavigation(destination({ physicalPage: 5 }), seed);
    db.exec("CREATE TRIGGER reject_claim BEFORE UPDATE ON material_operation_claims BEGIN SELECT RAISE(ABORT, 'claim write blocked'); END;");
    let token = null;
    let error = null;
    try { token = p.reserveOperationOwnership(MAT.id); } catch (e) { error = e; }
    assert.equal(token, null, `[M4-R33] a failed claim write must not return a token, got ${token}`);
    assert.ok(error, "[M4-R33] the claim write failure must be surfaced");
    assert.equal(db.prepare("SELECT reserved_generation AS g FROM material_operation_claims WHERE material_id=?").get(MAT.id).g, seed, "[M4-R33] the stored claim must be unchanged");
    assert.equal(db.prepare("SELECT last_requested_page AS p FROM material_reading_state WHERE material_id=?").get(MAT.id).p, 5, "[M4-R33] the saved page must be unchanged");
  } finally { db.close(); }
}

async function regressionExactClaimAuthorization(m) {
  const { db, p } = schemaBackedDb(m);
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    const owner = p.reserveOperationOwnership(MAT.id);
    const future = p.commitNavigation(destination({ physicalPage: 9 }), owner + 100);
    assert.equal(future.committed, false, "[M4-R34] a never-reserved future token must not commit");
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM material_reading_state").get().c, 0, "[M4-R34] a rejected token must write nothing");
  } finally { db.close(); }
}

async function regressionCommittedTokenReplay(m) {
  // The saved-owner fence: a token that already committed cannot commit again, even though it is
  // still the latest claim. This is the case the owner_generation check exists for now that R34's
  // exact claim match rejects every older token on its own.
  const { db, p } = schemaBackedDb(m);
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    const token = p.reserveOperationOwnership(MAT.id);
    assert.equal(p.commitNavigation(destination({ physicalPage: 3, pageLabel: "three" }), token).committed, true);
    const replay = p.commitNavigation(destination({ physicalPage: 42, pageLabel: "forty-two" }), token);
    assert.equal(replay.committed, false, "[M4-R13] a replayed committed token must not overwrite the saved page");
    assert.equal(db.prepare("SELECT last_requested_page AS p FROM material_reading_state WHERE material_id=?").get(MAT.id).p, 3, "[M4-R13] obsolete page 42 must never become durable");
  } finally { db.close(); }
}

const validInstallRecord = (e) => ({
  schema: e.INSTALL_EXECUTION_SCHEMA, command: e.installCommandFor("x/scratch/pdfjs-engine"), cwd: "/repo",
  nodeVersion: "v22.23.3", npmVersion: "10.9.9", exit: 0, signal: null, startedAt: "t0", finishedAt: "t1",
  stdout: "added 3 packages", stderr: "", bindings: Object.fromEntries(e.ENGINE_BOUND_FILES.map((f) => [f, "a".repeat(64)])),
});

async function regressionCrossSessionReservation(m) {
  // A second protocol instance on the same database (a new session) reserves with no client hint.
  const { db, p } = schemaBackedDb(m);
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    for (const page of [5, 6, 7]) {
      const t = p.reserveOperationOwnership(MAT.id);
      p.commitNavigation(destination({ physicalPage: page }), t);
    }
    const session2 = new m.persistenceProtocol.DocumentPersistenceProtocol(db);
    const token = session2.reserveOperationOwnership(MAT.id);
    assert.ok(token > 3, `[M4-R23] a new session's reservation must exceed every durable token, got ${token}`);
    assert.equal(session2.commitNavigation(destination({ physicalPage: 9 }), token).committed, true, "[M4-R23] new session on same database must commit new page");
  } finally { db.close(); }
}

async function regressionSupersededRetryNeverWrites(m) {
  // The controller refuses a superseded retry itself, before any write attempt reaches storage.
  const { db, p } = schemaBackedDb(m);
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    let failOp1 = true;
    const attempts = [];
    const c = new m.openerController.OpenerController({
      injectedOpener: async () => {},
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedPersistence: async (d, g) => {
        attempts.push({ page: d.physicalPage, generation: g });
        if (d.physicalPage === 42 && failOp1) throw new Error("simulated failure");
        return p.commitNavigation(d, g);
      },
    });
    const op1 = await c.requestOpen(MAT, record(destination({ physicalPage: 42 })));
    await c.requestOpen(MAT, record(destination({ physicalPage: 3 })));
    const before = attempts.length;
    failOp1 = false;
    const retry = await op1.retrySave();
    assert.equal(retry.success, false);
    assert.equal(attempts.length, before, `[M4-R24] a superseded retry must be refused before any persistence attempt, saw ${JSON.stringify(attempts.slice(before))}`);
  } finally { db.close(); }
}

async function regressionInstallAttestation(m) {
  const e = m.evidenceChecks;
  const expected = { expectedCommand: e.installCommandFor("x/scratch/pdfjs-engine"), expectedCwd: "/repo", currentBindings: Object.fromEntries(e.ENGINE_BOUND_FILES.map((f) => [f, "a".repeat(64)])) };
  assert.equal(e.validateInstallExecution({ record: validInstallRecord(e), error: null }, expected).ok, true, "[M4-R35] a valid successful record attests reuse");
  const failed = e.validateInstallExecution({ record: { ...validInstallRecord(e), exit: 42 }, error: null }, expected);
  assert.equal(failed.ok, false, "[M4-R35] a recorded failed install must not attest reuse");
}

async function regressionNamedMutantClaims(m) {
  const result = m.evidenceChecks.validateTraceability({
    texts: ["Current executed mutant: M99_NAVIGATION_NEVER_EXECUTED"],
    executedTests: new Set(),
    executedMutants: new Set(["M1_REAL"]),
    measured: { mappedTests: 0, mutants: 1 },
  });
  assert.ok(result.unexecutedCitedMutants.includes("M99_NAVIGATION_NEVER_EXECUTED"), "[M4-R36] an unexecuted mutant claim must be rejected whatever its name contains");
}

async function failedReservationAfterHeld(m, boundary) {
  // Round 6 (M4-R37): an older operation is held in its opener or before its save reaches storage;
  // a newer request then fails to reserve ownership. The older one must be retired anyway.
  const { db, p } = schemaBackedDb(m);
  const gate = held();
  let entered;
  const reached = new Promise((r) => (entered = r));
  let writes = 0;
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    const seed = p.reserveOperationOwnership(MAT.id);
    p.commitNavigation(destination({ physicalPage: 5, pageLabel: "five" }), seed);
    const c = new m.openerController.OpenerController({
      identityProvider: (id) => p.getCurrentIdentity(id),
      injectedOpener: async () => { if (boundary === "opener") { entered(); await gate.promise; } },
      injectedPersistence: async (d, g) => { writes++; if (boundary === "persistence") { entered(); await gate.promise; } return p.commitNavigation(d, g); },
    });
    const older = c.requestOpen(MAT, record(destination({ physicalPage: 10, pageLabel: "ten" })));
    await reached;
    db.exec("CREATE TRIGGER reject_claim BEFORE UPDATE ON material_operation_claims BEGIN SELECT RAISE(ABORT, 'reservation blocked'); END;");
    const newer = await c.requestOpen(MAT, record(destination({ physicalPage: 20, pageLabel: "twenty" })));
    assert.equal(newer.success, false);
    gate.resolve();
    const old = await older;
    const saved = { ...db.prepare("SELECT last_requested_page AS page, last_requested_page_label AS label FROM material_reading_state WHERE material_id=?").get(MAT.id) };
    return { old, state: c.state, saved, writes };
  } finally { gate.resolve(); db.close(); }
}

async function regressionFailedReservationRetiresHeldOpener(m) {
  const r = await failedReservationAfterHeld(m, "opener");
  assert.equal(r.old.success, false, "[M4-R37] a newer failed reservation must retire an older held opener");
  assert.equal(r.writes, 0, "[M4-R37] the retired opener must not reach persistence");
  assert.equal(r.state, "failed");
  assert.deepEqual(r.saved, { page: 5, label: "five" });
}

async function regressionFailedReservationStopsHeldSave(m) {
  const r = await failedReservationAfterHeld(m, "persistence");
  assert.deepEqual(r.saved, { page: 5, label: "five" }, "[M4-R37] a newer failed reservation must stop an older held save from landing");
  assert.equal(r.old.success, false);
  assert.equal(r.state, "failed");
}

async function regressionIgnoredClaimWrite(m) {
  // Round 6 (M4-R38): RAISE(IGNORE) skips the write without an error.
  const { db, p } = schemaBackedDb(m);
  try {
    p.saveContentIdentity(MAT.id, SHA_A, 50);
    const seed = p.reserveOperationOwnership(MAT.id);
    db.exec("CREATE TRIGGER ignore_claim BEFORE UPDATE ON material_operation_claims BEGIN SELECT RAISE(IGNORE); END;");
    let token = null;
    try { token = p.reserveOperationOwnership(MAT.id); } catch {}
    assert.equal(token, null, `[M4-R38] an ignored claim write must not issue a token, got ${token}`);
    assert.equal(db.prepare("SELECT reserved_generation AS g FROM material_operation_claims WHERE material_id=?").get(MAT.id).g, seed);
  } finally { db.close(); }
}

async function regressionInstallSignal(m) {
  // Round 6 (M4-R39): a signalled install keeps exit null and its real signal.
  const e = m.evidenceChecks;
  const rec = e.buildInstallExecutionRecord({ ...validInstallRecord(e), exit: null, signal: "SIGTERM" });
  assert.equal(rec.signal, "SIGTERM", "[M4-R39] a signalled install must keep its real signal");
  assert.equal(rec.exit, null);
  const audit = e.liveInstallAudit({ ...rec, platform: "x", installedPackage: null });
  assert.equal(audit.ok, false);
  assert.match(audit.text, /SIGTERM/);
}

const REGRESSIONS = [
  ["[M4-R9] trusted count requirement", regressionTotals, ["contractModel"]],
  ["[M4-R9] first-level nullable lineage", regressionFirstLevelLineage, ["contractModel"]],
  ["[M4-R15] destination count mandatory", regressionDestinationCount, ["contractModel"]],
  ["[M4-R16] label map content binding", regressionLabelBinding, ["contractModel"]],
  ["[M4-R10] atomic replacement invalidation", regressionAtomicInvalidation, ["persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R13] commit-time generation fence", regressionHeldSaveFence, ["openerController", "persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R14] tuple propagation", regressionTuplePropagation, ["persistenceProtocol", "openerController", "contractModel", "shippedLedger"]],
  ["[M4-R11] content-scoped progress", regressionContentScoping, ["openerController", "contractModel", "shippedLedger"]],
  ["[M4-R17] trusted destination bounds", regressionTrustedCount, ["openerController", "contractModel", "shippedLedger"]],
  ["[M4-R19] unknown identity unverified", regressionUnknownIdentity, ["persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R21] derived ledger ceiling", regressionLedgerCeiling, ["shippedLedger", "contractModel", "persistenceProtocol"]],
  ["[M4-R23] cross-session generation ordering", regressionCrossSessionOrdering, ["openerController", "persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R24] late retry rejected when superseded", regressionLateRetrySuperseded, ["openerController", "persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R28] durable reservation order", regressionDurableReservationOrder, ["openerController", "persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R29] cancellation commit fence", regressionCancellationFence, ["openerController", "persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R30] post-await ownership recheck", regressionPostAwaitOwnership, ["openerController", "persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R24] superseded retry never writes", regressionSupersededRetryNeverWrites, ["openerController", "persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R23] cross-session reservation", regressionCrossSessionReservation, ["persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R33] fail-closed reservation", regressionFailClosedReservation, ["persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R34] exact claim authorization", regressionExactClaimAuthorization, ["persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R13] committed token replay fence", regressionCommittedTokenReplay, ["persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R35] install execution attestation", regressionInstallAttestation, ["evidenceChecks"]],
  ["[M4-R36] named mutant claims", regressionNamedMutantClaims, ["evidenceChecks"]],
  ["[M4-R37] failed reservation retires held opener", regressionFailedReservationRetiresHeldOpener, ["openerController", "persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R37] failed reservation stops held save", regressionFailedReservationStopsHeldSave, ["openerController", "persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R38] ignored claim write", regressionIgnoredClaimWrite, ["persistenceProtocol", "contractModel", "shippedLedger"]],
  ["[M4-R39] install signal", regressionInstallSignal, ["evidenceChecks"]],
];

const cleanModules = {
  contractModel: cleanContract,
  persistenceProtocol: cleanPersistence,
  openerController: cleanController,
  shippedLedger: cleanLedger,
  evidenceChecks: cleanEvidence,
};

const digestOf = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(here, f))).digest("hex");
const liveDigests = () => ({
  ...Object.fromEntries(SOURCE_FILES.map((f) => [f, digestOf(f)])),
  "evidenceChecks.mjs": crypto.createHash("sha256").update(fs.readFileSync(EVIDENCE_FILE)).digest("hex"),
});

test("[sensitivity] clean modules pass all thirteen unchanged regressions", async () => {
  for (const [name, fn] of REGRESSIONS) {
    let error = null;
    try { await fn(cleanModules); } catch (e) { error = e; }
    assert.equal(error, null, `baseline regression ${name} must pass: ${error?.message ?? ""}`);
  }
});

test("[sensitivity] each guard reversion fails its unchanged regression by name", async () => {
  const before = liveDigests();
  const mutants = [
    {
      id: "M1_RELAX_SHARED_COUNT_VALIDATOR",
      file: "contractModel.mjs",
      pattern: "  return typeof value === \"number\" && Number.isSafeInteger(value) && value >= 1;",
      replacement: "  return typeof value === \"number\" && value >= 1; // REVERTED GUARD: safe-integer check dropped",
      runner: regressionTotals,
      expectedError: "[M4-R9] totalPages Infinity must not resolve",
    },
    {
      id: "M2_REJECT_NULLABLE_PARENT",
      file: "contractModel.mjs",
      pattern: '    const idField = isRoot ? "rootMaterialId" : "parentMaterialId";',
      replacement: '    const idField = isRoot ? "rootMaterialId" : "parentMaterialId";\n    if (!lineage.parentMaterialId || !lineage.parentPageStart) return { success: false, status: "unresolved", error: "REVERTED: nullable parent columns rejected" };',
      runner: regressionFirstLevelLineage,
      expectedError: "[M4-R9] first-level lineage must allow root navigation",
    },
    {
      id: "M3_OMIT_ATOMIC_BOOKMARK_INVALIDATION",
      file: "persistenceProtocol.mjs",
      pattern: "          AND (originating_content_sha256 IS NULL\n               OR originating_content_sha256 != ?\n               OR page_index > ? OR page_index < 1)",
      // Keeps both placeholders (so the statement still binds) but can never match a row:
      // the replacement transaction then commits the new identity without invalidating bookmarks.
      replacement: "          AND (originating_content_sha256 = ?\n               AND page_index <= ? AND 0)",
      runner: regressionAtomicInvalidation,
      expectedError: "[M4-R10] bookmark must not remain verified after content replacement",
    },
    {
      id: "M4_DISABLE_COMMIT_GENERATION_FENCE",
      file: "persistenceProtocol.mjs",
      pattern: "      if (current && Number(current.owner_generation) >= generation) {",
      replacement: "      if (false && current) {",
      runner: regressionCommittedTokenReplay, // Round 5: the held-save case is now fenced by the exact claim (M18); this fence still blocks a replayed committed token
      expectedError: "[M4-R13] a replayed committed token must not overwrite the saved page",
    },
    {
      id: "M5_IGNORE_CONTENT_PROGRESS_SCOPE",
      file: "openerController.mjs",
      pattern: '    return this.readingStateByContent.get(`${materialId}:${contentSha256 || "unknown"}`)?.lastRequestedPage ?? null;',
      replacement: "    for (const [k, v] of this.readingStateByContent) if (k.startsWith(`${materialId}:`)) return v.lastRequestedPage ?? null;\n    return null;",
      runner: regressionContentScoping,
      expectedError: "[M4-R11] new content B cannot inherit page 42 from content A",
    },
    {
      id: "M6_DROP_DESTINATION_COUNT_REQUIREMENT",
      file: "contractModel.mjs",
      pattern: "    if (!isSafeCount(count)) {",
      replacement: "    if (false) {",
      runner: regressionDestinationCount,
      expectedError: "[M4-R15] unknown destination count must report DESTINATION_COUNT_UNKNOWN",
    },
    {
      id: "M7_DROP_LABEL_CONTENT_BINDING",
      file: "contractModel.mjs",
      pattern: "      if (mapHash !== contentSha256) {",
      replacement: "      if (false) {",
      runner: regressionLabelBinding,
      expectedError: "[M4-R16] stale label map must not resolve",
    },
    {
      id: "M8_TRUST_CALLER_DESTINATION_BOUNDS",
      file: "openerController.mjs",
      pattern: "      if (identity && (identity.totalPages !== destination.totalPages || identity.contentSha256 !== destination.contentSha256)) {",
      replacement: "      if (false && identity) {",
      runner: regressionTrustedCount,
      expectedError: "[M4-R17] caller-inflated count must not reach the opener",
    },
    {
      id: "M9_ALLOW_UNKNOWN_IDENTITY_ACTIVE",
      file: "persistenceProtocol.mjs",
      pattern: "      if (!identity || !hash || hash !== identity.contentSha256 || physicalPage > identity.totalPages) {",
      replacement: "      if (false) {",
      runner: regressionUnknownIdentity,
      expectedError: "[M4-R19] unknown identity must never be active",
    },
    {
      id: "M10_HARDCODE_STALE_LEDGER_CEILING",
      file: "shippedLedger.mjs",
      pattern: "export function readCeiling(file = ceilingFile()) {",
      replacement: `export function readCeiling(file = ceilingFile()) {\n  return 13; // REVERTED: literal stale base instead of the derived ceiling`,
      runner: regressionLedgerCeiling,
      expectedError: "[M4-R21] ledger must verify against the derived ceiling",
    },
    {
      id: "M11_OMIT_TUPLE_PROPAGATION",
      file: "persistenceProtocol.mjs",
      pattern: "          originating_content_sha256 = excluded.originating_content_sha256,",
      replacement: "          originating_content_sha256 = material_reading_state.originating_content_sha256, -- REVERTED: retains prior hash",
      runner: regressionTuplePropagation,
      expectedError: "[M4-R14] durable hash must belong to winning operation",
    },
    {
      id: "M12_DISABLE_CROSS_SESSION_GENERATION_ORDERING",
      // Round 5: cross-session ordering now lives in the durable reservation (M4-R33), so this
      // mutant reverts it there: a new session's token ignores what is already durable.
      file: "persistenceProtocol.mjs",
      pattern: "      const base = Math.max(savedGen, reservedGen, client);",
      replacement: "      const base = client; // REVERTED: ignores the durable saved owner and latest claim",
      runner: regressionCrossSessionReservation,
      expectedError: "[M4-R23] a new session's reservation must exceed every durable token",
    },
    {
      id: "M13_RETRY_SENDS_NEWEST_GENERATION",
      file: "openerController.mjs",
      pattern: "    const liveOp = parentActiveOp ?? this.activeOperation;\n    const startEpoch = this.requestEpoch;\n    if (liveOp && liveOp.epoch !== undefined && liveOp.epoch !== startEpoch) {\n      return {\n        success: false,\n        state: \"aborted\",\n        superseded: true,\n        reason: \"superseded\",\n        persistedPage: this.getLastRequestedPage(material.id, record.destination?.contentSha256),\n      };\n    }\n    const generation = originalIntentId ?? this.currentIntentId;\n    if (originalIntentId !== null && this.currentIntentId !== originalIntentId) {\n      return {\n        success: false,\n        state: \"aborted\",\n        superseded: true,\n        reason: \"superseded\",\n        persistedPage: this.getLastRequestedPage(material.id, record.destination?.contentSha256),\n      };\n    }\n    if (liveOp?.cancelled) {\n      return {\n        success: false,\n        state: \"aborted\",\n        superseded: true,\n        reason: \"cancelled\",\n        persistedPage: this.getLastRequestedPage(material.id, record.destination?.contentSha256),\n      };\n    }",
      replacement: "    const liveOp = parentActiveOp ?? this.activeOperation;\n    const startEpoch = this.requestEpoch;\n    const generation = ++this.intentCounter; // REVERTED: allocates a new generation on retry and drops the superseded-retry refusal",
      // Round 6: R37's epoch and cancellation checks now also refuse a superseded retry, so the revert
      // removes the retry's whole pre-write supersession guard, which is what M13 pins.
      runner: regressionSupersededRetryNeverWrites,
      expectedError: "[M4-R24] a superseded retry must be refused before any persistence attempt",
    },
    {
      id: "M14_DISABLE_DURABLE_OWNERSHIP_RESERVATION",
      file: "openerController.mjs",
      pattern: "              reservedToken = idObj.reserveOwnership(baseGen);",
      replacement: "              reservedToken = null; // REVERTED: skips durable ownership reservation",
      runner: regressionDurableReservationOrder,
      expectedError: "[M4-R28] later request must win even when earlier completion lands first",
    },
    {
      id: "M15_DISABLE_COMMIT_CANCELLATION_FENCE",
      file: "persistenceProtocol.mjs",
      pattern: "      if (isCancelled) {",
      replacement: "      if (false && isCancelled) { // REVERTED: ignores cancellation at commit boundary",
      runner: regressionCancellationFence,
      expectedError: "[M4-R29] abort before commit must preserve previous saved page",
    },
    {
      id: "M16_OMIT_POST_AWAIT_OWNERSHIP_RECHECK",
      file: "openerController.mjs",
      // Round 6: the same check now reads through #owns(), which adds R37's request epoch.
      pattern: "    // M4-R30: check ownership after persistence await\n    if (!this.#owns(activeOp, intentId, material.id)) {\n      return this.#superseded(material.id, verdict?.persistedPage ?? null);\n    }",
      replacement: "    // REVERTED: omitted post-await check after persistence",
      runner: regressionPostAwaitOwnership,
      expectedError: "[M4-R30] stale acknowledged operation must not replace winning controller progress",
    },
    {
      id: "M17_SUPPRESS_CLAIM_WRITE_FAILURE",
      file: "persistenceProtocol.mjs",
      // Round 6: R38's read-back now also refuses a swallowed write error, so the revert suppresses
      // every failure of the claim write and its check, which is the whole R33 guarantee.
      pattern: "      const write = this.db.prepare(`\n        INSERT INTO material_operation_claims (material_id, reserved_generation, cancelled_generation, updated_at)\n        VALUES (?, ?, 0, ?)\n        ON CONFLICT(material_id) DO UPDATE SET\n          reserved_generation = excluded.reserved_generation,\n          updated_at = excluded.updated_at\n      `).run(materialId, nextGen, now);\n\n      // M4-R38: a statement that runs without error is not proof that the claim exists. A\n      // RAISE(IGNORE) trigger, for example, skips the write silently. Require exactly one row to\n      // change, then read the claim back inside this same transaction and require it to hold\n      // exactly the token about to be issued. Anything else rolls back and is thrown.\n      if (Number(write?.changes) !== 1) {\n        throw new Error(`Claim write did not take effect (${Number(write?.changes) || 0} rows changed); no token issued`);\n      }\n      const persisted = this.db\n        .prepare(\"SELECT reserved_generation FROM material_operation_claims WHERE material_id = ?\")\n        .get(materialId);\n      if (!persisted || Number(persisted.reserved_generation) !== nextGen) {\n        throw new Error(\n          `Claim did not persist token ${nextGen} (found ${persisted ? Number(persisted.reserved_generation) : \"no claim\"}); no token issued`\n        );\n      }\n\n",
      replacement: "      try {\n      const write = this.db.prepare(`\n        INSERT INTO material_operation_claims (material_id, reserved_generation, cancelled_generation, updated_at)\n        VALUES (?, ?, 0, ?)\n        ON CONFLICT(material_id) DO UPDATE SET\n          reserved_generation = excluded.reserved_generation,\n          updated_at = excluded.updated_at\n      `).run(materialId, nextGen, now);\n\n      // M4-R38: a statement that runs without error is not proof that the claim exists. A\n      // RAISE(IGNORE) trigger, for example, skips the write silently. Require exactly one row to\n      // change, then read the claim back inside this same transaction and require it to hold\n      // exactly the token about to be issued. Anything else rolls back and is thrown.\n      if (Number(write?.changes) !== 1) {\n        throw new Error(`Claim write did not take effect (${Number(write?.changes) || 0} rows changed); no token issued`);\n      }\n      const persisted = this.db\n        .prepare(\"SELECT reserved_generation FROM material_operation_claims WHERE material_id = ?\")\n        .get(materialId);\n      if (!persisted || Number(persisted.reserved_generation) !== nextGen) {\n        throw new Error(\n          `Claim did not persist token ${nextGen} (found ${persisted ? Number(persisted.reserved_generation) : \"no claim\"}); no token issued`\n        );\n      }\n\n      } catch { /* REVERTED: any claim write failure is suppressed and the token issued anyway */ }\n",
      runner: regressionFailClosedReservation,
      expectedError: "[M4-R33] a failed claim write must not return a token",
    },
    {
      id: "M18_ACCEPT_UNRESERVED_FUTURE_TOKEN",
      file: "persistenceProtocol.mjs",
      pattern: "      if (!claimRow || reservedGen !== generation) {",
      replacement: "      if (!claimRow || reservedGen > generation) { // REVERTED: greater-than instead of the exact claim",
      runner: regressionExactClaimAuthorization,
      expectedError: "[M4-R34] a never-reserved future token must not commit",
    },
    {
      id: "M19_ACCEPT_FAILED_INSTALL_RECORD",
      file: "evidenceChecks.mjs",
      pattern: "  if (r.exit !== 0) problems.push(",
      replacement: "  if (false) problems.push( // REVERTED: a failed install exit is accepted\n",
      runner: regressionInstallAttestation,
      expectedError: "[M4-R35] a recorded failed install must not attest reuse",
    },
    {
      id: "M20_EXEMPT_NAMED_MUTANT_IDS",
      file: "evidenceChecks.mjs",
      pattern: "  return [...new Set(currentText(txt).match(MUTANT_TOKEN) ?? [])];",
      replacement: "  return [...new Set((currentText(txt).match(MUTANT_TOKEN) ?? []).filter((s) => !/DOCUMENT|ROUND|CONDITIONAL|VIEWER|NAVIGATION/.test(s)))]; // REVERTED: name-based exemption",
      runner: regressionNamedMutantClaims,
      expectedError: "[M4-R36] an unexecuted mutant claim must be rejected whatever its name contains",
    },
    {
      id: "M21_SKIP_ENTRY_SUPERSESSION",
      file: "openerController.mjs",
      pattern: "    const epoch = ++this.requestEpoch;\n    this.#retireActiveOperation();",
      replacement: "    const epoch = this.requestEpoch; // REVERTED: older work is retired only after a durable token is acquired",
      runner: regressionFailedReservationRetiresHeldOpener,
      expectedError: "[M4-R37] a newer failed reservation must retire an older held opener",
    },
    {
      id: "M22_RETIRE_WITHOUT_LIVE_CANCELLATION",
      file: "openerController.mjs",
      pattern: "    if (this.activeOperation && !this.activeOperation.cancelled) {\n      this.activeOperation.cancelled = true;\n    }\n  }\n\n  /** Whether",
      replacement: "    // REVERTED: the retired operation keeps its live cancellation flag clear\n  }\n\n  /** Whether",
      runner: regressionFailedReservationStopsHeldSave,
      expectedError: "[M4-R37] a newer failed reservation must stop an older held save from landing",
    },
    {
      id: "M23_TRUST_CLAIM_WRITE_WITHOUT_POSTCONDITION",
      file: "persistenceProtocol.mjs",
      pattern: "      if (Number(write?.changes) !== 1) {\n        throw new Error(`Claim write did not take effect (${Number(write?.changes) || 0} rows changed); no token issued`);\n      }\n      const persisted = this.db\n        .prepare(\"SELECT reserved_generation FROM material_operation_claims WHERE material_id = ?\")\n        .get(materialId);\n      if (!persisted || Number(persisted.reserved_generation) !== nextGen) {\n        throw new Error(\n          `Claim did not persist token ${nextGen} (found ${persisted ? Number(persisted.reserved_generation) : \"no claim\"}); no token issued`\n        );\n      }\n\n",
      replacement: "      // REVERTED: a statement that ran without error is taken as a durable claim\n",
      runner: regressionIgnoredClaimWrite,
      expectedError: "[M4-R38] an ignored claim write must not issue a token",
    },
    {
      id: "M24_DROP_INSTALL_SIGNAL",
      file: "evidenceChecks.mjs",
      pattern: "    signal: signal ?? null,\n    spawnError: spawnError ?? null,",
      replacement: "    signal: null, // REVERTED: the child's real signal is discarded\n    spawnError: spawnError ?? null,",
      runner: regressionInstallSignal,
      expectedError: "[M4-R39] a signalled install must keep its real signal",
    },
  ];

  const executed = [];
  for (const mu of mutants) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hfd-r2-mutant-${mu.id}-`));
    try {
      for (const f of SOURCE_FILES) fs.copyFileSync(path.join(here, f), path.join(tmpDir, f));
      fs.copyFileSync(EVIDENCE_FILE, path.join(tmpDir, "evidenceChecks.mjs"));
      const target = path.join(tmpDir, mu.file);
      const original = fs.readFileSync(target, "utf8");
      assert.ok(original.includes(mu.pattern), `revert pattern for ${mu.id} must exist in the disposable copy`);
      const mutated = original.replace(mu.pattern, mu.replacement);
      assert.notEqual(mutated, original, `${mu.id} must actually change the copy`);
      fs.writeFileSync(target, mutated, "utf8");

      const stamp = `${mu.id}-${Date.now()}`;
      const modules = {};
      for (const f of [...SOURCE_FILES, "evidenceChecks.mjs"]) {
        modules[f.replace(".mjs", "")] = await import(`${pathToFileURL(path.join(tmpDir, f)).href}?mutant=${stamp}`);
      }

      let caught = null;
      try { await mu.runner(modules); } catch (e) { caught = e; }
      assert.ok(caught, `mutant ${mu.id} was expected to fail its unchanged regression but passed`);
      assert.ok(caught instanceof assert.AssertionError, `mutant ${mu.id}: expected AssertionError, got ${caught.name}: ${caught.message}`);
      assert.ok(caught.message.includes(mu.expectedError), `mutant ${mu.id}: assertion must name '${mu.expectedError}', got '${caught.message}'`);
      executed.push({ id: mu.id, failure: caught.message.split("\n")[0] });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
  const receiptsDir = process.env.RECEIPTS_DIR || path.join(packRoot, "receipts");
  fs.mkdirSync(receiptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(receiptsDir, "07b-executed-mutants.json"),
    JSON.stringify({
      total: executed.length,
      mutants: executed.map((e) => ({
        id: e.id,
        failure: e.failure,
      })),
    }, null, 2) + "\n"
  );
  assert.equal(executed.length, mutants.length, "every defined mutant must be executed");

  const after = liveDigests();
  for (const f of Object.keys(before)) {
    assert.equal(after[f], before[f], `live module ${f} must remain untouched after sensitivity runs`);
  }
});

test("[sensitivity] a missing scratch engine fails loudly and never borrows another directory", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hfd-r2-noengine-"));
  try {
    fs.copyFileSync(path.join(packRoot, "proof", "realParserDemonstration.mjs"), path.join(tmpDir, "realParserDemonstration.mjs"));
    const mod = await import(`${pathToFileURL(path.join(tmpDir, "realParserDemonstration.mjs")).href}?t=${Date.now()}`);
    let error = null;
    try { mod.resolveEngine("legacy"); } catch (e) { error = e; }
    assert.ok(error, "[M4-R22] a copy without its own installed engine must fail instead of resolving elsewhere");
    assert.match(error.message, /scratch engine not installed/, "[M4-R22] failure must name the missing pack-local install");
    assert.doesNotMatch(error.message, /scope-remaining-corrections|integration-corrections-2026-10-11/, "[M4-R22] the message must not point at another round's directory");
    // The real pack resolves its own engine, in its own scratch tree.
    const resolved = resolveEngine("legacy");
    assert.ok(resolved.includes(path.join("m4-document-navigation-integration-corrections-r2-2026-10-11", "scratch", "pdfjs-engine")), "[M4-R22] the proof must consume this pack's pinned engine");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
