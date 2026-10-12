/**
 * The shared M3 contracts on node:sqlite and sql.js. The rusqlite crate
 * (native/tests/contract.rs) reads the same fixtures and must give the same
 * outcome for every case.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PracticeStateValidationError } from "@/data/practiceStateValidation";

import { CANDIDATE_SQL, candidateReference, migrate, openEngine, type EngineName } from "../prototype/candidateEngine";
import { validateSkillEvidenceState } from "../prototype/skillEvidenceValidation";

const DIR = `${process.cwd()}/docs/evidence/m3-skills-evidence-scope-2026-10-10/fixtures`;
type ValidationCase = { name: string; category: string; candidateEdits?: [string, string][]; sql: string[]; expect: "accept" | "refuse" };
const VALIDATION: { baseline: string[]; cases: ValidationCase[] } = JSON.parse(readFileSync(`${DIR}/validation-cases.json`, "utf8"));
const CONSTRAINTS: { baseline: string[]; cases: { name: string; sql: string; expect: "ok" | "error" }[] } = JSON.parse(
  readFileSync(`${DIR}/constraint-cases.json`, "utf8"),
);

function editedCandidate(edits: [string, string][] = []): string {
  let sql = CANDIDATE_SQL;
  for (const [from, to] of edits) {
    const at = sql.indexOf(from);
    if (at < 0 || sql.indexOf(from, at + 1) >= 0) throw new Error(`candidate edit must match exactly once: ${from}`);
    sql = sql.replace(from, to);
  }
  return sql;
}

const engines: EngineName[] = ["node:sqlite", "sql.js"];

describe("shared schema-14 validation contract", () => {
  it("covers every invariant category, with controls", () => {
    expect(new Set(VALIDATION.cases.map((c) => c.category))).toEqual(
      new Set([
        "control", "schema", "schema-check", "schema-fk", "schema-key", "schema-index", "schema-trigger", "catalog", "history", "relationships", "receipts",
        // M3-R5 / M3-R6 corrections.
        "receipt-shape", "receipt-ownership", "catalog-pinned", "catalog-names",
        // M3-R9 remaining correction.
        "history-ownership",
      ]),
    );
  });

  for (const engineName of engines) {
    it(`${engineName} gives the listed outcome for every case`, async () => {
      const reference = await candidateReference();
      const outcomes: string[] = [];
      for (const testCase of VALIDATION.cases) {
        const engine = await openEngine(engineName);
        try {
          await migrate(engine, { candidate: true, candidateSql: editedCandidate(testCase.candidateEdits) });
          for (const statement of [...VALIDATION.baseline, ...testCase.sql]) engine.exec(statement);
          const outcome = await validateSkillEvidenceState((sql, params) => engine.query(sql, params), reference).then(
            () => "accept",
            (error: unknown) => {
              if (!(error instanceof PracticeStateValidationError)) throw error;
              return "refuse";
            },
          );
          outcomes.push(`${testCase.name}: ${outcome}`);
        } finally {
          engine.close();
        }
      }
      expect(outcomes).toEqual(VALIDATION.cases.map((c) => `${c.name}: ${c.expect}`));
    });
  }
});

describe("shared constraint contract", () => {
  for (const engineName of engines) {
    it(`${engineName} accepts and refuses exactly the listed statements`, async () => {
      const outcomes: string[] = [];
      for (const testCase of CONSTRAINTS.cases) {
        const engine = await openEngine(engineName);
        try {
          await migrate(engine, { candidate: true });
          for (const statement of CONSTRAINTS.baseline) engine.exec(statement);
          let outcome = "ok";
          try {
            engine.exec(testCase.sql);
          } catch {
            outcome = "error";
          }
          outcomes.push(`${testCase.name}: ${outcome}`);
        } finally {
          engine.close();
        }
      }
      expect(outcomes).toEqual(CONSTRAINTS.cases.map((c) => `${c.name}: ${c.expect}`));
    });
  }
});
