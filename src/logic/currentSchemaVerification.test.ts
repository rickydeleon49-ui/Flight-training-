/**
 * Current-schema (14) verification helper against the production writers and the production
 * validator, on genuine temporary SQLite libraries.
 *
 * `scripts/mac-schema14-profile-snapshot.mjs` exports nothing and has no test route, so each run
 * imports a disposable copy written by `scripts/mac-schema14-verification-proof.mjs`: its operator
 * lane is replaced by a scratch lane and its entry point by an adapter export. Libraries are built from
 * the shipped migrations and the accepted M3 fixtures, with a synthetic SQLx ledger (the helper's
 * scratch builder writes SQLx's exact table, the shipped descriptions and SHA-384 checksums; it is
 * not SQLx itself). A "restore" here puts a closed database copy back in place: archive-state
 * fidelity, not a native backup/restore run.
 */
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MIGRATIONS } from "@/data/migrations";
import {
  PracticeStateValidationError,
  SKILL_EVIDENCE_INDEXES,
  SKILL_EVIDENCE_TABLES,
  SKILL_EVIDENCE_TRIGGERS,
  validateApplicationDatabase,
} from "@/data/practiceStateValidation";
import { SkillEvidenceError } from "@/data/skillEvidenceTransaction";
import { createRequest, openNodeEngine, openStore, schemaReference, uuid } from "@/data/testing/skillEvidenceEngines";

const RUNNER = join(process.cwd(), "scripts", "mac-schema14-verification-proof.mjs");
const RECEIPT_KEYS = ["last_complete_backup_at", "last_complete_backup_path", "last_complete_backup_version"];
const SPECIAL_KEYS: [string, string][] = [
  ["__proto__", "proto-value"],
  ["constructor", "constructor-value"],
  ["toString", "tostring-value"],
  ["préférence_✈️_キー", "unicode-value"],
];

interface TableEntry {
  absent?: boolean;
  rowCount: number;
  sha256: string | null;
  keyDigests?: Record<string, string>;
}
interface Snapshot {
  ledger: { maxVersion: number; versions: number[] };
  tables: Record<string, TableEntry>;
  m3Evidence: Record<string, number> | null;
}
interface Comparison {
  verdict: "PASS" | "FAIL" | "PARTIAL";
  diffs: string[];
  notes: string[];
  receiptExclusion: { applied: boolean; keys: string[] };
  sections: {
    tables: { changed: string[]; seededAdditions: string[]; emptyAdditions: string[]; receiptOnlyDifference: string[] };
    backupReceipt?: {
      applied: boolean;
      excludedKeys: string[];
      receiptKeysBefore: string[];
      receiptKeysAfter: string[];
      otherKeysChanged: string[];
      receiptOnlyDifference: boolean;
    };
  };
}
interface Library {
  root: string;
  dbPath: string;
}
interface DatabaseHandle {
  exec(sql: string): void;
}
interface Helper {
  PINNED_SOURCE: { commit: string; schemaCeiling: number };
  PINNED_MIGRATIONS: { version: number; description: string; sha256: string; sqlx: string }[];
  PINNED_OBJECT_MAP: Map<string, [string, number, string]>;
  M3_TABLES: string[];
  BACKUP_RECEIPT_KEYS: string[];
  buildScratchProfile(parent: string, repo: string, options: { version: number; populate?: boolean; writerEvidence?: boolean }): Library;
  cloneScratchProfile(source: string, parent: string): Library;
  setMetadata(dbPath: string, rows: [string, string][], remove?: string[]): void;
  withDb(dbPath: string, fn: (db: DatabaseHandle) => void): void;
  applyShippedMigrations(db: DatabaseHandle, repo: string, from: number, to: number): void;
  takeSnapshot(root: string, uid: number, outPath: string): Snapshot;
  compare(options: { before: string; after: string; purpose: string }): Comparison;
}

const repo = process.cwd();
let scratch = "";
let helper: Helper;
let uid = 0;
let counter = 0;

/** A disposable helper copy (scratch lane, adapter export) written by the proof runner. */
async function loadAdapter(dir: string): Promise<Helper> {
  const runner = (await import(/* @vite-ignore */ pathToFileURL(RUNNER).href)) as {
    writeDisposableHelper(dir: string, options: { entry: string }): string;
  };
  const file = runner.writeDisposableHelper(dir, {
    entry: "export const adapter = { PINNED_SOURCE, PINNED_MIGRATIONS, PINNED_OBJECT_MAP, M3_TABLES, BACKUP_RECEIPT_KEYS, buildScratchProfile, cloneScratchProfile, setMetadata, withDb, applyShippedMigrations, takeSnapshot, compare };",
  });
  return ((await import(/* @vite-ignore */ pathToFileURL(file).href)) as { adapter: Helper }).adapter;
}

/** Fixture precondition: every managed document is its own single-linked file (the helper refuses aliases). */
function expectIndependentDocuments(library: Library): void {
  const documents = join(library.root, "documents");
  for (const name of readdirSync(documents)) expect(lstatSync(join(documents, name)).nlink, `${library.root} documents/${name}`).toBe(1);
}

function snap(library: Library, name: string): string {
  const out = join(scratch, `${name}-${++counter}.json`);
  helper.takeSnapshot(library.root, uid, out);
  return out;
}

const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Snapshot;

/** The production whole-database validation the drivers run on open and restore. */
async function validate(dbPath: string): Promise<void> {
  const engine = await openNodeEngine(dbPath);
  try {
    await validateApplicationDatabase((sql, params) => engine.query(sql, params), await schemaReference());
  } finally {
    engine.close();
  }
}

/** The production M3 writer on the library's own connection, without adding a second migration ledger. */
async function withStore<T>(library: Library, fn: (store: Awaited<ReturnType<typeof openStore>>) => Promise<T>): Promise<T> {
  const engine = await openNodeEngine(library.dbPath);
  try {
    return await fn(await openStore(engine, { migrate: false }));
  } finally {
    engine.close();
  }
}

/** Real writer history: observation with edit, link and addressed revisions, status, confidence, a custom skill and an erased observation. */
async function writeEvidence(library: Library) {
  return withStore(library, async (store) => {
    const [journal] = store.engine.query("SELECT id, date FROM journal_entries ORDER BY rowid LIMIT 1");
    const [action] = store.engine.query("SELECT id FROM next_actions ORDER BY rowid LIMIT 1");
    const journalId = String(journal!["id"]);
    const observedOn = String(journal!["date"]);
    const kept = createRequest({ journalId, observedOn, wording: "Flare a little later." });
    await store.act(kept);
    await store.act({
      action: "edit_observation", operationId: uuid(), observationId: kept.observationId, expectedRevision: 1,
      wording: "Flare later, eyes down the runway.", observedOn, attribution: "self_report", instructorName: "",
    });
    await store.act({ action: "link_action", operationId: uuid(), observationId: kept.observationId, expectedRevision: 2, actionId: String(action!["id"]) });
    await store.act({ action: "set_addressed", operationId: uuid(), observationId: kept.observationId, expectedRevision: 3, addressed: true });
    await store.act({ action: "set_status", operationId: uuid(), skillId: "builtin.normal_landing", expectedSequence: 0, status: "practicing" });
    await store.act({ action: "set_confidence", operationId: uuid(), skillId: "builtin.normal_landing", expectedSequence: 0, confidence: 3 });
    await store.act({
      action: "create_custom_skill", operationId: uuid(), skillId: `custom.${uuid()}`,
      label: "Short-field approach", description: "Over an obstacle.", topic: "landings",
    });
    const erased = createRequest({ journalId, observedOn, wording: "Erase me." });
    await store.act(erased);
    await store.act({ action: "erase_observation", operationId: uuid(), observationId: erased.observationId, confirm: "erase" });
    await store.validate();
    return { observationId: kept.observationId, journalId, observedOn };
  });
}

/** Archive state -> post-export receipt -> the archive's closed bytes put back in place (archive-state fidelity). */
function exportAndRestore(library: Library, name: string) {
  const archive = helper.cloneScratchProfile(library.root, join(scratch, `${name}-archive`));
  helper.setMetadata(library.dbPath, [
    ["last_complete_backup_at", "2026-10-11T12:00:00.000Z"],
    ["last_complete_backup_path", "/synthetic/backups/hfd.zip"],
    ["last_complete_backup_version", "0.6.0"],
  ]);
  const postExport = snap(library, `${name}-post-export`);
  copyFileSync(archive.dbPath, library.dbPath);
  expectIndependentDocuments(archive);
  expectIndependentDocuments(library);
  return { archive, postExport };
}

beforeAll(async () => {
  scratch = mkdtempSync(join(realpathSync(tmpdir()), "hfd-schema14-selfcheck-ts-"));
  helper = await loadAdapter(scratch);
  uid = process.getuid?.() ?? 0;
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("the schema-14 helper contract is the registered source", () => {
  it("pins migrations 1–14 with the registered descriptions and SQLx SHA-384 checksums of their exact bytes", () => {
    expect(helper.PINNED_SOURCE).toMatchObject({ commit: "8a260c0b32bc213850ed85bf9488d6ef571354a9", schemaCeiling: 14 });
    expect(helper.PINNED_MIGRATIONS.map((m) => [m.version, m.description])).toEqual(MIGRATIONS.map((m) => [m.version, m.description]));
    for (const m of MIGRATIONS) {
      const pinned = helper.PINNED_MIGRATIONS.find((p) => p.version === m.version)!;
      expect(createHash("sha384").update(m.sql, "utf8").digest("hex"), `migration ${m.version}`).toBe(pinned.sqlx);
      expect(createHash("sha256").update(m.sql, "utf8").digest("hex"), `migration ${m.version}`).toBe(pinned.sha256);
    }
    const ceiling = readFileSync(join(repo, "src-tauri", "src", "lib.rs"), "utf8").match(/CURRENT_SCHEMA_VERSION[^=]*=\s*(\d+)/);
    expect(Number(ceiling?.[1])).toBe(14);
  });

  it("pins the same six M3 tables, indexes and triggers the production validator requires", () => {
    const since14 = [...helper.PINNED_OBJECT_MAP].filter(([, [, since]]) => since === 14);
    expect([...helper.M3_TABLES].sort()).toEqual([...SKILL_EVIDENCE_TABLES].sort());
    expect(since14.filter(([, [type]]) => type === "index").map(([name]) => name).sort()).toEqual(SKILL_EVIDENCE_INDEXES.map(([, name]) => name).sort());
    expect(since14.filter(([, [type]]) => type === "trigger").map(([name]) => name).sort()).toEqual([...SKILL_EVIDENCE_TRIGGERS].sort());
    expect(helper.BACKUP_RECEIPT_KEYS).toEqual(RECEIPT_KEYS);
  });
});

describe("a populated schema-13 library upgraded to schema 14", () => {
  it("passes production validation on both sides and only the upgrade contract, keeping special metadata keys", async () => {
    const library = helper.buildScratchProfile(join(scratch, "upgrade"), repo, { version: 13 });
    helper.setMetadata(library.dbPath, SPECIAL_KEYS);
    await validate(library.dbPath);
    const before = snap(library, "s13");
    helper.withDb(library.dbPath, (db) => helper.applyShippedMigrations(db, repo, 14, 14));
    await validate(library.dbPath);
    const after = snap(library, "s14");

    const upgrade = helper.compare({ before, after, purpose: "upgrade" });
    expect(upgrade.diffs).toEqual([]);
    expect(upgrade.verdict).toBe("PASS");
    expect(upgrade.sections.tables.seededAdditions).toEqual(["skill_catalog_entries", "skill_catalog_revisions"]);
    expect(upgrade.sections.tables.emptyAdditions).toEqual([
      "skill_observations", "skill_observation_revisions", "skill_self_assessments", "skill_evidence_operations",
    ]);
    expect(upgrade.receiptExclusion.applied).toBe(false);
    const keys = read(after).tables["app_metadata"]!.keyDigests!;
    expect(SPECIAL_KEYS.every(([k]) => Object.hasOwn(keys, k))).toBe(true);
    expect(Object.keys(keys)).toHaveLength(read(after).tables["app_metadata"]!.rowCount);

    expect(helper.compare({ before, after, purpose: "unchanged" }).verdict).toBe("FAIL");
    expect(helper.compare({ before: after, after, purpose: "upgrade" }).diffs).toContain(
      "ledger: no migration was actually applied between these snapshots (no-op upgrade)",
    );
  });
});

describe("writer-created schema-14 evidence", () => {
  it("is captured, and a refused write or a failed write leaves every protected fact unchanged", async () => {
    const library = helper.buildScratchProfile(join(scratch, "writer"), repo, { version: 14 });
    helper.setMetadata(library.dbPath, SPECIAL_KEYS);
    const written = await writeEvidence(library);
    await validate(library.dbPath);
    const base = snap(library, "written");
    expect(read(base).m3Evidence).toMatchObject({
      observations: 1, observationRevisions: 4, statusAssessments: 1, confidenceAssessments: 1, customCatalogEntries: 1, erasedOperations: 1,
    });
    expect(helper.compare({ before: base, after: snap(library, "written-again"), purpose: "unchanged" }).verdict).toBe("PASS");

    // A refused write (stale revision): the writer rejects before changing anything.
    await withStore(library, async (store) => {
      await expect(
        store.act({
          action: "edit_observation", operationId: uuid(), observationId: written.observationId, expectedRevision: 1,
          wording: "Stale.", observedOn: written.observedOn, attribution: "self_report", instructorName: "",
        }),
      ).rejects.toMatchObject({ code: "STALE_REVISION" });
    });
    const afterRefusal = helper.compare({ before: base, after: snap(library, "after-refusal"), purpose: "unchanged" });
    expect(afterRefusal.diffs).toEqual([]);
    expect(afterRefusal.verdict).toBe("PASS");

    // A failed write: the history append fails mid-transaction and the writer rolls back.
    await withStore(library, async (store) => {
      store.engine.beforeStatement = (sql) => {
        if (sql.includes("INSERT INTO skill_observation_revisions")) throw new Error("injected fault");
      };
      const failure = await store
        .act({
          action: "edit_observation", operationId: uuid(), observationId: written.observationId, expectedRevision: 4,
          wording: "Never saved.", observedOn: written.observedOn, attribution: "self_report", instructorName: "",
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(failure).toBeInstanceOf(SkillEvidenceError);
      expect((failure as SkillEvidenceError).code).toBe("STORAGE_FAILURE");
    });
    await validate(library.dbPath);
    const afterFailure = helper.compare({ before: base, after: snap(library, "after-failure"), purpose: "unchanged" });
    expect(afterFailure.diffs).toEqual([]);
    expect(afterFailure.verdict).toBe("PASS");

    // One more genuine write is a change, named per table.
    await withStore(library, async (store) => {
      await store.act({ action: "unlink_action", operationId: uuid(), observationId: written.observationId, expectedRevision: 4 });
    });
    const changed = helper.compare({ before: base, after: snap(library, "after-write"), purpose: "unchanged" });
    expect(changed.verdict).toBe("FAIL");
    expect(changed.sections.tables.changed).toEqual(["skill_observations", "skill_observation_revisions", "skill_evidence_operations"]);
  });

  it("restores into schema 14 with only the three receipt keys set aside, and tampered evidence fails both authorities", async () => {
    const library = helper.buildScratchProfile(join(scratch, "restore14"), repo, { version: 14 });
    helper.setMetadata(library.dbPath, SPECIAL_KEYS);
    await writeEvidence(library);
    const { archive, postExport } = exportAndRestore(library, "r14");
    await validate(library.dbPath);
    const restored = snap(library, "r14-restored");

    const restore = helper.compare({ before: postExport, after: restored, purpose: "restore" });
    expect(restore.diffs).toEqual([]);
    expect(restore.verdict).toBe("PASS");
    expect(restore.receiptExclusion).toEqual({ applied: true, keys: RECEIPT_KEYS, scope: "restore only" });
    expect(restore.sections.backupReceipt).toMatchObject({
      receiptOnlyDifference: true, receiptKeysBefore: RECEIPT_KEYS, receiptKeysAfter: [], otherKeysChanged: [],
    });
    expect(restore.notes.some((n) => n.includes("set aside by exact name"))).toBe(true);
    const strict = helper.compare({ before: postExport, after: restored, purpose: "unchanged" });
    expect(strict.diffs).toContain(`app_metadata: keys differ (${RECEIPT_KEYS.join(", ")})`);

    // The validator owns M3 history consistency; metadata values are the helper's alone.
    for (const [name, sql, table, validatorRefuses] of [
      ["deleted status receipt", "DELETE FROM skill_evidence_operations WHERE action = 'set_status'", "skill_evidence_operations", true],
      ["edited observation head", "UPDATE skill_observations SET wording = 'Altered.'", "skill_observations", true],
      ["changed __proto__ key", "UPDATE app_metadata SET value = 'changed' WHERE key = '__proto__'", "app_metadata", false],
    ] as const) {
      copyFileSync(archive.dbPath, library.dbPath);
      helper.withDb(library.dbPath, (db) => db.exec(sql));
      expectIndependentDocuments(library);
      if (validatorRefuses) await expect(validate(library.dbPath), name).rejects.toBeInstanceOf(PracticeStateValidationError);
      else await validate(library.dbPath);
      const tampered = helper.compare({ before: postExport, after: snap(library, `r14-${name.replace(/\W+/g, "-")}`), purpose: "restore" });
      expect(tampered.verdict, name).toBe("FAIL");
      expect(tampered.sections.tables.changed, name).toEqual([table]);
      if (table === "app_metadata") expect(tampered.diffs).toContain("app_metadata: keys other than the backup receipt differ (__proto__)");
    }
  });

  for (const version of [12, 13]) {
    it(`a populated schema-${version} archive state restores into schema 14 with validation on both sides`, async () => {
      const library = helper.buildScratchProfile(join(scratch, `restore${version}`), repo, { version });
      helper.setMetadata(library.dbPath, SPECIAL_KEYS);
      await validate(library.dbPath);
      const { postExport } = exportAndRestore(library, `r${version}`);
      helper.withDb(library.dbPath, (db) => helper.applyShippedMigrations(db, repo, version + 1, 14));
      await validate(library.dbPath);
      const restore = helper.compare({ before: postExport, after: snap(library, `r${version}-restored`), purpose: "restore" });
      expect(restore.diffs).toEqual([]);
      expect(restore.verdict).toBe("PASS");
      expect(restore.sections.tables.seededAdditions).toEqual(["skill_catalog_entries", "skill_catalog_revisions"]);
      expect(restore.sections.backupReceipt?.receiptOnlyDifference).toBe(true);
    });
  }
});

describe("the accepted writer-populated schema-14 fixture (M3-R9)", () => {
  it("removing any history-owning receipt is refused by the production validator and fails the helper's unchanged contract", async () => {
    const library = helper.buildScratchProfile(join(scratch, "fixture14"), repo, { version: 14, writerEvidence: true });
    await validate(library.dbPath);
    const base = snap(library, "fixture14");
    const pristine = readFileSync(library.dbPath);
    const engine = await openNodeEngine(library.dbPath);
    const owning = engine.query(
      "SELECT operation_id, action FROM skill_evidence_operations WHERE is_erased = 0 AND action <> 'erase_observation' ORDER BY rowid",
    );
    engine.close();
    expect(new Set(owning.map((r) => r["action"])).size).toBe(11);
    for (const row of owning) {
      const action = String(row["action"]);
      writeFileSync(library.dbPath, pristine);
      helper.withDb(library.dbPath, (db) => db.exec(`DELETE FROM skill_evidence_operations WHERE operation_id = '${String(row["operation_id"])}'`));
      await expect(validate(library.dbPath), action).rejects.toBeInstanceOf(PracticeStateValidationError);
      const result = helper.compare({ before: base, after: snap(library, `fixture14-${action}`), purpose: "unchanged" });
      expect(result.verdict, action).toBe("FAIL");
      expect(result.sections.tables.changed, action).toEqual(["skill_evidence_operations"]);
    }
    writeFileSync(library.dbPath, pristine);
    expect(helper.compare({ before: base, after: snap(library, "fixture14-pristine"), purpose: "unchanged" }).verdict).toBe("PASS");
  });
});
