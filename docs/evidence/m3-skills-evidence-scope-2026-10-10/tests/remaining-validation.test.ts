/**
 * Permanent regressions for re-review finding M3-R9: restore validation
 * requires history -> receipt ownership as well as receipt -> history.
 *
 * fixtures/writer-populated-schema14.sql is a row dump of a library written by
 * the REAL candidate writer (every action family, an erase with its
 * tombstones, a cleared status), so the valid control is not hand-written.
 * The native crate (native/tests/contract.rs) loads the same file.
 * Regenerate with
 *   M3_WRITE_WRITER_FIXTURE=1 npx vitest run --config <this pack>/vitest.config.ts tests/remaining-validation
 */
import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { executeDebriefSave } from "@/data/debriefTransaction";

import { candidateReference, migrate, openCandidateStore, openEngine, type Engine, type EngineName } from "../prototype/candidateEngine";
import { validateSkillEvidenceState } from "../prototype/skillEvidenceValidation";
import { candidateWithDebrief, observation } from "./helpers";

const FIXTURE = `${process.cwd()}/docs/evidence/m3-skills-evidence-scope-2026-10-10/fixtures/writer-populated-schema14.sql`;
const engines: EngineName[] = ["node:sqlite", "sql.js"];
const open: Engine[] = [];
afterEach(() => {
  for (const e of open.splice(0)) e.close();
});

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function inserts(engine: Engine, table: string, where = "1"): string[] {
  return engine.query(`SELECT * FROM "${table}" WHERE ${where} ORDER BY rowid`).map((row) => {
    const cols = Object.keys(row);
    return `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((c) => literal(row[c])).join(", ")});`;
  });
}

/** A deterministic library written through the real candidate writer. Returns the fixture text. */
async function writeWithRealWriter(): Promise<string> {
  let n = 0;
  const id = () => `20000000-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}`;
  let ms = Date.parse("2026-10-11T09:00:00.000Z");
  const now = () => new Date((ms += 1000)).toISOString();
  const engine = await openEngine("node:sqlite");
  try {
    const store = await openCandidateStore(engine);
    const journalId = id();
    const actionId = id();
    await executeDebriefSave((sql) => engine.exec(sql), (sql, p) => engine.run(sql, p), (sql, p) => engine.query(sql, p).length > 0, {
      operationId: id(), targetId: journalId,
      journal: { date: "2026-10-01", title: "Pattern work", instructorFeedback: "Flare later.", wasDifficult: "Gusts.", instructorName: "Synthetic CFI" },
      action: { id: actionId, title: "Review flare timing" },
    }, now());
    const act = (a: unknown) => store.act(a, { now });
    const skillId = `custom.${id()}`;
    await act({ action: "create_custom_skill", operationId: id(), skillId, label: "Short-field landing", description: "", topic: "landings" });
    await act({ action: "edit_custom_skill", operationId: id(), skillId, expectedRevision: 1, label: "Short-field approach", description: "Over an obstacle.", topic: "landings" });
    await act({ action: "retire_skill", operationId: id(), skillId, expectedRevision: 2 });
    await act({ action: "restore_skill", operationId: id(), skillId, expectedRevision: 3 });
    await act({ action: "retire_skill", operationId: id(), skillId: "builtin.go_around", expectedRevision: 1 });
    await act({ action: "restore_skill", operationId: id(), skillId: "builtin.go_around", expectedRevision: 2 });
    const kept = observation("builtin.normal_landing", journalId, { operationId: id(), observationId: id(), wording: "Flare later." });
    await act(kept);
    const base = { observationId: kept.observationId, observedOn: kept.observedOn, attribution: kept.attribution, instructorName: kept.instructorName };
    await act({ action: "edit_observation", operationId: id(), expectedRevision: 1, wording: "Flare a little later.", ...base });
    await act({ action: "link_action", operationId: id(), observationId: kept.observationId, expectedRevision: 2, actionId });
    await act({ action: "set_addressed", operationId: id(), observationId: kept.observationId, expectedRevision: 3, addressed: true });
    await act({ action: "set_addressed", operationId: id(), observationId: kept.observationId, expectedRevision: 4, addressed: false });
    await act({ action: "unlink_action", operationId: id(), observationId: kept.observationId, expectedRevision: 5 });
    const gone = observation(skillId, journalId, { operationId: id(), observationId: id(), sourceField: "none", wording: "To be erased." });
    await act(gone);
    await act({ action: "edit_observation", operationId: id(), observationId: gone.observationId, expectedRevision: 1, wording: "To be erased, edited.", observedOn: gone.observedOn, attribution: gone.attribution, instructorName: gone.instructorName });
    await act({ action: "erase_observation", operationId: id(), observationId: gone.observationId, confirm: "erase" });
    await act({ action: "set_status", operationId: id(), skillId: "builtin.normal_landing", expectedSequence: 0, status: "practicing" });
    await act({ action: "set_status", operationId: id(), skillId: "builtin.normal_landing", expectedSequence: 1, status: null });
    await act({ action: "set_confidence", operationId: id(), skillId, expectedSequence: 0, confidence: 3 });
    await store.validate();
    const lines = [
      ...inserts(engine, "journal_entries"),
      ...inserts(engine, "next_actions"),
      ...inserts(engine, "skill_catalog_entries", "origin = 'custom'"),
      // Built-in heads exist from the migration; replay their changed state.
      ...engine.query("SELECT id, status, retired_at, revision, updated_at FROM skill_catalog_entries WHERE origin = 'builtin' AND revision > 1 ORDER BY id").map(
        (r) => `UPDATE "skill_catalog_entries" SET "status" = ${literal(r["status"])}, "retired_at" = ${literal(r["retired_at"])}, "revision" = ${literal(r["revision"])}, "updated_at" = ${literal(r["updated_at"])} WHERE "id" = ${literal(r["id"])};`,
      ),
      ...inserts(engine, "skill_catalog_revisions", "changed_by = 'user'"),
      ...inserts(engine, "skill_observations"),
      ...inserts(engine, "skill_observation_revisions"),
      ...inserts(engine, "skill_self_assessments"),
      ...inserts(engine, "skill_evidence_operations"),
    ];
    return `-- Synthetic schema-14 library written by the real candidate writer (tests/remaining-validation.test.ts).\n${lines.join("\n")}\n`;
  } finally {
    engine.close();
  }
}

async function loadFixture(name: EngineName, extra: string[] = []): Promise<Engine> {
  const engine = await openEngine(name);
  open.push(engine);
  await migrate(engine, { candidate: true });
  engine.exec(readFileSync(FIXTURE, "utf8"));
  for (const sql of extra) engine.exec(sql);
  return engine;
}

const verdict = async (engine: Engine) =>
  validateSkillEvidenceState((sql, params) => engine.query(sql, params), await candidateReference()).then(() => "accept", () => "refuse");

describe("M3-R9 writer fixture", () => {
  it.runIf(process.env["M3_WRITE_WRITER_FIXTURE"] === "1")("regenerates the writer fixture", async () => {
    writeFileSync(FIXTURE, await writeWithRealWriter());
  });

  it("[M3-R9] the committed writer fixture regenerates byte-identically from the real candidate writer", async () => {
    expect(await writeWithRealWriter()).toBe(readFileSync(FIXTURE, "utf8"));
  });
});

describe.each(engines)("M3-R9 history needs its receipt (%s)", (name) => {
  it("[M3-R9] a library written by the real writer validates, and losing any receipt that owns history is refused", async () => {
    expect(await verdict(await loadFixture(name))).toBe("accept");
    const probe = await loadFixture(name);
    const owning = probe
      .query("SELECT operation_id, action FROM skill_evidence_operations WHERE is_erased = 0 AND action <> 'erase_observation' ORDER BY rowid")
      .map((r) => [String(r["operation_id"]), String(r["action"])] as const);
    expect(new Set(owning.map(([, action]) => action))).toEqual(
      new Set(["create_custom_skill", "edit_custom_skill", "retire_skill", "restore_skill", "create_observation", "edit_observation", "link_action", "unlink_action", "set_addressed", "set_status", "set_confidence"]),
    );
    const outcomes: string[] = [];
    for (const [operationId, action] of owning) {
      const engine = await loadFixture(name, [`DELETE FROM skill_evidence_operations WHERE operation_id = '${operationId}'`]);
      outcomes.push(`${action} ${operationId}: ${await verdict(engine)}`);
    }
    expect(outcomes).toEqual(owning.map(([operationId, action]) => `${action} ${operationId}: refuse`));
  });

  it("[M3-R9] receipt removal cannot leave an accepted operation-owned history orphan (review case)", async () => {
    const x = await candidateWithDebrief(name);
    open.push(x.engine);
    const o = observation("builtin.normal_landing", x.journalId);
    await x.store.act(o);
    await x.store.validate();
    x.engine.run("DELETE FROM skill_evidence_operations WHERE operation_id = ?", [o.operationId]);
    await expect(x.store.validate()).rejects.toThrow(/no matching operation record/);
  });

  it("[M3-R9] erasure tombstones, catalog seeds and earlier receipts after later edits stay valid", async () => {
    const engine = await loadFixture(name);
    expect(Number(engine.query("SELECT COUNT(*) AS n FROM skill_evidence_operations WHERE is_erased = 1")[0]!["n"])).toBe(2);
    expect(Number(engine.query("SELECT COUNT(*) AS n FROM skill_catalog_revisions WHERE changed_by = 'catalog'")[0]!["n"])).toBe(15);
    expect(await verdict(engine)).toBe("accept");
  });
});
