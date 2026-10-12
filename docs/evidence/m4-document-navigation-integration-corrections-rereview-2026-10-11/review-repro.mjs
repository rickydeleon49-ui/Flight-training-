#!/usr/bin/env node
/**
 * Her Flight Deck — independent reviewer reproducers for the M4 integration-corrections round.
 *
 * Runs against the byte-faithful `submitted/` copies of the evaluated modules so the findings are
 * reproducible from a clean clone, with no dependency on the implementation worktree.
 *
 * Usage: node docs/evidence/m4-document-navigation-integration-corrections-rereview-2026-10-11/review-repro.mjs
 * Exits 0 always; each probe prints one JSON line keyed by finding id.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sub = (f) => path.join(here, "submitted", f);
const { OpenerController } = await import(sub("openerController.mjs"));
const { translateSplitCoordinates, parsePageReference } = await import(sub("contractModel.mjs"));
const { DocumentPersistenceProtocol } = await import(sub("persistenceProtocol.mjs"));

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const print = (id, obj) => console.log(JSON.stringify({ id, ...obj }));
const held = () => { let r; const p = new Promise((res) => (r = res)); return { promise: p, resolve: r }; };
const mat = { id: "m1", title: "IFH", filePath: "ifh.pdf", contentSha256: SHA_A, totalPages: 50 };

function progressDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE progress (id TEXT PRIMARY KEY, page INTEGER, sha TEXT, label TEXT)");
  return db;
}
function writeProgress(db, id, page, opts) {
  db.prepare(
    "INSERT INTO progress VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET page=excluded.page, sha=excluded.sha, label=excluded.label"
  ).run(id, page, opts?.contentSha256 ?? null, opts?.label ?? null);
}

/** Build the real schema the way the submitted suite does: shipped migrations + candidate DDL. */
function realSchemaDb() {
  const db = new DatabaseSync(":memory:");
  const migDir = path.resolve(here, "../../../src-tauri/migrations");
  const names = fs
    .readdirSync(migDir)
    .filter((p) => p.endsWith(".sql") && Number(p.slice(0, 4)) <= 13)
    .sort();
  for (const n of names) db.exec(fs.readFileSync(path.join(migDir, n), "utf8"));
  const proto = new DocumentPersistenceProtocol(db);
  proto.applyCandidateDdl(fs.readFileSync(sub("candidate_migration_0015.sql"), "utf8"));
  db.prepare(
    "INSERT INTO study_materials (id,title,material_type,topic,file_path,created_at,updated_at) VALUES ('m1','T','handbook','x','/t.pdf','x','x')"
  ).run();
  proto.saveContentIdentity("m1", SHA_A, 200);
  return { db, proto };
}

// ---- R13: the obsolete save still reaches durable storage; enforcement is a compensating rewrite.
{
  const db = progressDb();
  const h = held();
  const seq = [];
  let calls = 0;
  const c = new OpenerController({
    injectedOpener: async () => {},
    injectedPersistence: async (id, page, opts = {}) => {
      if (page === 42) await h.promise;
      seq.push({ call: ++calls, page, sha: (opts.contentSha256 || "").slice(0, 4), label: opts.label ?? null });
      writeProgress(db, id, page, opts);
    },
  });
  const old = c.requestOpen(mat, 42, "forty-two");
  await Promise.resolve();
  await c.requestOpen(mat, 3, "three");
  h.resolve();
  const oldRes = await old;
  print("R13-obsolete-write-commits", {
    durableWriteSequence: seq,
    obsoleteValueCommittedToSqlite: seq.some((w) => w.page === 42),
    finalRow: db.prepare("SELECT * FROM progress").get(),
    returned: { success: oldRes.success, state: oldRes.state, lastRequestedPage: oldRes.lastRequestedPage },
    controllerStateField: c.state,
    note: "page 42 is committed (call 2) and only re-covered afterwards by a second write (call 3)",
  });
  db.close();
}

// ---- R13b: when the compensating rewrite fails, the stale destination wins and nothing is reported.
{
  const db = progressDb();
  const h = held();
  let n = 0;
  const seq = [];
  const c = new OpenerController({
    injectedOpener: async () => {},
    injectedPersistence: async (id, page, opts = {}) => {
      if (page === 42) await h.promise;
      seq.push({ call: ++n, page });
      if (n === 3) throw new Error("disk full during compensating rewrite");
      writeProgress(db, id, page, opts);
    },
  });
  const old = c.requestOpen(mat, 42, "forty-two");
  await Promise.resolve();
  await c.requestOpen(mat, 3, "three");
  h.resolve();
  const oldRes = await old;
  const row = db.prepare("SELECT * FROM progress").get();
  print("R13b-repair-failure-silent", {
    writeSequence: seq,
    finalDurablePage: row.page,
    returned: { success: oldRes.success, state: oldRes.state, lastRequestedPage: oldRes.lastRequestedPage },
    surfacedError: oldRes.error ?? null,
    notice: c.lastNotice,
    staleDestinationWonSilently: row.page === 42,
  });
  db.close();
}

// ---- R14: the compensating rewrite republishes the obsolete content hash and printed label.
{
  const db = progressDb();
  const h = held();
  const c = new OpenerController({
    injectedOpener: async () => {},
    injectedPersistence: async (id, page, opts = {}) => {
      if (page === 42) await h.promise;
      writeProgress(db, id, page, opts);
    },
  });
  const old = c.requestOpen({ ...mat, contentSha256: SHA_A }, 42, "printed-A-label");
  await Promise.resolve();
  await c.requestOpen({ ...mat, contentSha256: SHA_B }, 3, "printed-B-label");
  h.resolve();
  await old;
  const row = db.prepare("SELECT * FROM progress").get();
  print("R14-repair-publishes-obsolete-identity", {
    finalRow: { page: row.page, sha: row.sha?.slice(0, 4), label: row.label },
    newerContentWas: "SHA_B",
    newerLabelWas: "printed-B-label",
    repairStampedOldContentHash: row.sha === SHA_A,
    repairStampedOldLabel: row.label === "printed-A-label",
  });
  db.close();
}

// ---- R15: translation returns a successful destination when the destination count is unknown.
{
  const base = { childPageCount: 16, rootMaterialId: "mat_root", sourcePageStart: 1, sourcePageEnd: 16 };
  const res = {};
  for (const [k, lin] of Object.entries({
    count_200: { ...base, sourceTotalPages: 200 },
    count_null: { ...base, sourceTotalPages: null },
    count_absent: { ...base },
    count_undefined: { ...base, sourceTotalPages: undefined },
    count_5_inconsistent: { ...base, sourceTotalPages: 5 },
  })) {
    const r = translateSplitCoordinates({ direction: "child_to_root", page: 12 }, lin);
    res[k] = { success: r.success, rootPage: r.rootPage ?? null, error: r.error ?? null };
  }
  const nested = { childPageCount: 8, parentMaterialId: "mat_parent", parentPageStart: 20, parentPageEnd: 27 };
  const pUnknown = translateSplitCoordinates({ direction: "child_to_parent", page: 5 }, nested);
  const pMissingParent = translateSplitCoordinates({ direction: "child_to_parent", page: 5 }, { ...nested, parentMaterialId: null });
  print("R15-unknown-destination-count-resolves", {
    childToRoot: res,
    childToParentUnknownCount: { success: pUnknown.success, parentPage: pUnknown.parentPage ?? null },
    deletedParentGuidanceReachable: pMissingParent.code ?? null,
  });
}

// ---- R16: printed label maps are bounded but still not content-bound.
{
  const r = parsePageReference("iv", { provenance: "printed_label", labelToPhysicalMap: { iv: 4 }, totalPages: 50, contentSha256: SHA_A });
  const rB = parsePageReference("iv", { provenance: "printed_label", labelToPhysicalMap: { iv: 4 }, totalPages: 50, contentSha256: SHA_B });
  print("R16-label-map-not-content-bound", {
    resolved: r.isResolved,
    physicalIndex: r.physicalIndex,
    resultKeys: Object.keys(r).join(","),
    carriesContentIdentity: "contentSha256" in r,
    staleMapForDifferentContentResolvesIdentically: rB.isResolved === r.isResolved && rB.physicalIndex === r.physicalIndex,
  });
}

// ---- R18: the named "safe integer arithmetic" case never exercises the arithmetic guard.
{
  const fixture = { childPageCount: 3, sourcePageStart: Number.MAX_SAFE_INTEGER, rootMaterialId: "root" };
  const viaNamedCase = translateSplitCoordinates({ direction: "child_to_root", page: 3 }, fixture);
  print("R18-overflow-guard-unreachable", {
    namedCaseError: viaNamedCase.error,
    blockedBy: /sourcePageStart\/sourcePageEnd/.test(viaNamedCase.error || "") ? "range-completeness guard (not the arithmetic guard)" : "unknown",
    maximalBoundedRange: (() => {
      const lin = { childPageCount: 16, rootMaterialId: "r", sourcePageStart: Number.MAX_SAFE_INTEGER - 15, sourcePageEnd: Number.MAX_SAFE_INTEGER };
      const r = translateSplitCoordinates({ direction: "child_to_root", page: 16 }, lin);
      return { success: r.success, rootPage: r.rootPage ?? null };
    })(),
  });
}

// ---- R19: durable writers throw on unknown/missing content identity instead of persisting unverified.
{
  const { db, proto } = realSchemaDb();
  const out = {};
  const attempt = (label, fn) => {
    try { fn(); out[label] = { wrote: true }; }
    catch (e) { out[label] = { wrote: false, threw: e.constructor.name, message: String(e.message).slice(0, 80) }; }
  };
  attempt("addBookmark_missing_hash", () => proto.addBookmark({ id: "b1", materialId: "m1", pageIndex: 5, title: "x", originatingContentSha256: undefined }));
  attempt("addBookmark_malformed_hash", () => proto.addBookmark({ id: "b2", materialId: "m1", pageIndex: 5, title: "x", originatingContentSha256: "not-a-hash" }));
  attempt("saveReadingState_missing_hash", () => proto.saveReadingState("m1", 5, {}));
  db.close();
  print("R19-writer-unknown-identity-throws", out);
}

// ---- R17: the opener's bounds check consumes caller-supplied metadata, never the persisted identity.
{
  const db = progressDb();
  const seenByWriter = [];
  const c = new OpenerController({
    injectedOpener: async (filePath, page) => seenByWriter.push({ openedAt: page }),
    injectedPersistence: async (id, page, opts = {}) => {
      seenByWriter.push({ persisted: page, sha: (opts.contentSha256 || "").slice(0, 4) });
      writeProgress(db, id, page, opts);
    },
  });
  // Persisted truth would be 10 pages for SHA_A; the caller asserts 50 in the same object shape the
  // submitted suite uses (proof.test.mjs:190 passes a caller-chosen totalPages).
  const res = await c.requestOpen({ ...mat, totalPages: 50 }, 42, "printed-42");
  print("R17-opener-trusts-caller-count", {
    callerSuppliedTotalPages: 50,
    destinationAccepted: res.success,
    state: res.state,
    openerAndWriterCalls: seenByWriter,
    durableRow: db.prepare("SELECT page, label FROM progress").get(),
    note: "no validated destination record ties the opened page to the persisted count/content identity",
  });
  db.close();
}

// ---- R20 (manifest / baseline integrity) is measured by verify-submitted-hashes.mjs.

// ---- R22: the PDF.js step resolves another pack's untracked node_modules, and the runner fixes its own engine label.
{
  const demo = fs.readFileSync(sub("realParserDemonstration.mjs"), "utf8");
  const runner = fs.readFileSync(sub("run_integration_proof.mjs"), "utf8");
  print("R22-parser-path-and-engine", {
    demoResolvesOtherPacksUntrackedNodeModules:
      /scope-remaining-corrections[^"']*node_modules/.test(demo),
    demoUsesThisPacksPinnedScratchDir: demo.includes("m4-document-navigation-integration-corrections-2026-10-11/scratch"),
    runnerPerformsInstallStep: /npm\s+(ci|install)/.test(runner),
    runnerHardcodesEngineLabel: /Node\.js v26\.10\.0/.test(runner),
    runnerChecksProcessVersion: /process\.version/.test(runner.split("Receipts")[0] || ""),
    thisProcess: process.version,
  });
}
