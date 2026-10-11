/**
 * Populated schema-13 -> candidate 14 upgrade, rollback of a failed upgrade,
 * backup/restore round trips across engines, corrupt-backup refusal, and the
 * SHIPPED schema-13 driver refusing a genuinely newer (14) database without
 * changing it.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PracticeStateValidationError } from "@/data/practiceStateValidation";
import { createNodeSqliteDatabase } from "@/data/testing/nodeSqliteDb";

import {
  CANDIDATE_SQL,
  SHIPPED_VERSION,
  appliedVersions,
  candidateReference,
  dumpTables,
  migrate,
  openCandidateStore,
  openNodeEngine,
  openSqlJsEngine,
  type Engine,
} from "../prototype/candidateEngine";
import { M3_TABLES, validateCandidateDatabase } from "../prototype/skillEvidenceValidation";
import { buildPopulatedSchema13, observation, tempDir, uuid } from "./helpers";

const open: Engine[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const e of open.splice(0)) e.close();
  for (const c of cleanups.splice(0)) c();
});

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

async function populated() {
  const t = tempDir("m3-upgrade-");
  cleanups.push(t.cleanup);
  const path = join(t.dir, "library.db");
  const ids = await buildPopulatedSchema13(path);
  return { path, dir: t.dir, ...ids };
}

const RETAINED = (engine: Engine) => dumpTables(engine, { exclude: ["schema_migrations", ...M3_TABLES] });

describe("upgrading a populated schema-13 library", () => {
  it("the starting library is genuine: shipped schema 13 with practice, card, debrief and lineage history", async () => {
    const { path } = await populated();
    expect(SHIPPED_VERSION).toBe(13);
    const engine = await openNodeEngine(path);
    open.push(engine);
    expect([...appliedVersions(engine)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    const counts = Object.fromEntries(
      ["journal_entries", "next_actions", "questions", "debrief_operations", "practice_responses", "card_review_events", "material_split_lineage"].map(
        (t) => [t, Number(engine.query(`SELECT COUNT(*) AS n FROM ${t}`)[0]!["n"])],
      ),
    );
    expect(counts).toEqual({ journal_entries: 2, next_actions: 2, questions: 2, debrief_operations: 2, practice_responses: 1, card_review_events: 1, material_split_lineage: 1 });
    expect(engine.query("SELECT name FROM sqlite_master WHERE name LIKE 'skill_%'")).toEqual([]);
  });

  for (const engineName of ["node:sqlite", "sql.js"] as const) {
    it(`${engineName}: adds only the M3 tables and seeded catalog; every retained row is identical`, async () => {
      const { path } = await populated();
      const engine = engineName === "node:sqlite" ? await openNodeEngine(path) : await openSqlJsEngine(readFileSync(path));
      open.push(engine);
      const before = RETAINED(engine);
      const tablesBefore = engine.query("SELECT name FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY name").map((r) => r["name"]);
      const store = await openCandidateStore(engine);
      expect(RETAINED(engine)).toEqual(before);
      expect([...appliedVersions(engine)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
      const added = engine
        .query("SELECT name FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY name")
        .map((r) => r["name"])
        .filter((n) => !tablesBefore.includes(n));
      expect(added.filter((n) => !String(n).startsWith("sqlite_autoindex"))).toEqual([
        "idx_skill_evidence_operations_subject", "idx_skill_observations_action", "idx_skill_observations_journal",
        "idx_skill_observations_page", "idx_skill_observations_skill_page", "idx_skill_observations_source_journal",
        "skill_catalog_entries", "skill_catalog_revisions", "skill_evidence_operations", "skill_observation_revisions",
        "skill_observations", "skill_self_assessments",
        "trg_skill_catalog_revisions_no_delete", "trg_skill_catalog_revisions_no_update",
        "trg_skill_observation_revisions_no_partial_delete", "trg_skill_observation_revisions_no_update",
        "trg_skill_self_assessments_no_delete", "trg_skill_self_assessments_no_update",
      ]);
      expect((await store.skills()).length).toBe(15);
      for (const table of ["skill_observations", "skill_observation_revisions", "skill_self_assessments", "skill_evidence_operations"]) {
        expect(engine.query(`SELECT COUNT(*) AS n FROM ${table}`)[0]!["n"]).toBe(0);
      }
      // Existing debriefs stay usable: one can now carry an observation.
      const [journal] = engine.query("SELECT id FROM journal_entries ORDER BY date LIMIT 1");
      expect((await store.act(observation("builtin.normal_landing", String(journal!["id"])))).status).toBe("applied");
    });
  }

  it("a failed upgrade rolls back completely and the library stays schema 13", async () => {
    const { path } = await populated();
    const engine = await openNodeEngine(path);
    open.push(engine);
    const before = dumpTables(engine);
    const schemaBefore = engine.query("SELECT type, name, sql FROM sqlite_master ORDER BY name");
    await expect(migrate(engine, { candidate: true, candidateSql: `${CANDIDATE_SQL}\nINSERT INTO no_such_table VALUES (1);` })).rejects.toThrow();
    expect(dumpTables(engine)).toEqual(before);
    expect(engine.query("SELECT type, name, sql FROM sqlite_master ORDER BY name")).toEqual(schemaBefore);
    expect(Math.max(...appliedVersions(engine))).toBe(13);
  });
});

describe("an older app and a newer library", () => {
  it("the shipped schema-13 driver refuses a candidate-14 library and leaves its bytes unchanged", async () => {
    const { path } = await populated();
    const engine = await openNodeEngine(path);
    const store = await openCandidateStore(engine);
    const [journal] = engine.query("SELECT id FROM journal_entries LIMIT 1");
    await store.act(observation("builtin.go_around", String(journal!["id"])));
    engine.close();
    const before = sha(path);
    await expect(createNodeSqliteDatabase(path)).rejects.toThrow(/newer format/);
    expect(sha(path)).toBe(before);
  });

  it("the candidate refuses a library from a version newer than itself", async () => {
    const engine = await openNodeEngine();
    open.push(engine);
    await migrate(engine, { candidate: true });
    engine.exec("INSERT INTO schema_migrations (version, description, applied_at) VALUES (15, 'future', 'x')");
    await expect(validateCandidateDatabase((s, p) => engine.query(s, p), await candidateReference())).rejects.toThrow(/newer format/);
  });
});

describe("backup and restore", () => {
  async function populatedCandidate() {
    const { path, debrief, second } = await populated();
    const engine = await openNodeEngine(path);
    open.push(engine);
    const store = await openCandidateStore(engine);
    const a = observation("builtin.normal_landing", debrief.journalId);
    const b = observation("builtin.crosswind_landing", second.journalId, { attribution: "self_report", instructorName: "", sourceField: "was_difficult", wording: "Gusts." });
    const c = observation("builtin.go_around", second.journalId, { sourceField: "none", wording: "To be erased." });
    for (const o of [a, b, c]) await store.act(o);
    await store.act({ action: "edit_observation", operationId: uuid(), observationId: a.observationId, expectedRevision: 1, wording: "Edited.", observedOn: "2026-10-02", attribution: "instructor_transcribed", instructorName: "Synthetic CFI" });
    await store.act({ action: "link_action", operationId: uuid(), observationId: a.observationId, expectedRevision: 2, actionId: debrief.actionId });
    await store.act({ action: "set_addressed", operationId: uuid(), observationId: a.observationId, expectedRevision: 3, addressed: true });
    await store.act({ action: "set_status", operationId: uuid(), skillId: "builtin.normal_landing", expectedSequence: 0, status: "practicing" });
    await store.act({ action: "set_confidence", operationId: uuid(), skillId: "builtin.normal_landing", expectedSequence: 0, confidence: 3 });
    const skillId = `custom.${uuid()}`;
    await store.act({ action: "create_custom_skill", operationId: uuid(), skillId, label: "Short-field landing", description: "", topic: "landings" });
    await store.act({ action: "retire_skill", operationId: uuid(), skillId, expectedRevision: 1 });
    await store.act({ action: "erase_observation", operationId: uuid(), observationId: c.observationId, confirm: "erase" });
    engine.run("DELETE FROM journal_entries WHERE id = ?", [second.journalId]);
    engine.run("DELETE FROM next_actions WHERE id = ?", [debrief.actionId]);
    await store.validate();
    return { engine, store };
  }

  for (const [from, to] of [["node:sqlite", "node:sqlite"], ["node:sqlite", "sql.js"], ["sql.js", "node:sqlite"]] as const) {
    it(`${from} backup restores on ${to}: validated, and every table identical`, async () => {
      let { engine } = await populatedCandidate();
      if (from === "sql.js") {
        const moved = await openSqlJsEngine(engine.snapshot());
        open.push(moved);
        engine = moved;
      }
      const original = dumpTables(engine);
      const bytes = engine.snapshot();
      let restored: Engine;
      if (to === "sql.js") restored = await openSqlJsEngine(bytes);
      else {
        const t = tempDir("m3-restore-");
        cleanups.push(t.cleanup);
        writeFileSync(join(t.dir, "restored.db"), bytes);
        restored = await openNodeEngine(join(t.dir, "restored.db"));
      }
      open.push(restored);
      const store = await openCandidateStore(restored, { migrate: false });
      expect(dumpTables(restored)).toEqual(original);
      const page = await store.page();
      expect(page.items.map((i) => [i.wording, i.source.kind, i.action.kind, i.addressedAt !== null])).toEqual([
        ["Edited.", "present", "deleted", true],
        ["Gusts.", "deleted", "none", false],
      ]);
      expect(await store.summary("builtin.normal_landing")).toMatchObject({ status: "practicing", confidence: 3 });
    });
  }

  it("a backup whose evidence was altered is refused before anything would be replaced", async () => {
    const { engine } = await populatedCandidate();
    const tampered = await openSqlJsEngine(engine.snapshot());
    open.push(tampered);
    tampered.exec("UPDATE skill_observations SET wording = 'Tampered.'");
    await expect(validateCandidateDatabase((s, p) => tampered.query(s, p), await candidateReference())).rejects.toBeInstanceOf(PracticeStateValidationError);
  });

  it("an older schema-13 backup restores into the candidate app, gains 14 and keeps every row", async () => {
    const { path } = await populated();
    const backup = readFileSync(path);
    const restored = await openSqlJsEngine(backup);
    open.push(restored);
    const before = RETAINED(restored);
    await openCandidateStore(restored);
    expect(RETAINED(restored)).toEqual(before);
    expect(Math.max(...appliedVersions(restored))).toBe(14);
  });
});
