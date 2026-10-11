/**
 * The shared schema-14 contracts on node:sqlite and sql.js, against the
 * registered migration 14. The native suite (`skill_evidence_tests.rs`)
 * replays the same fixtures and must give the same outcome for every case.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PracticeStateValidationError, validateApplicationDatabase, validateSkillEvidenceState } from "./practiceStateValidation";
import {
  ENGINES,
  FIXTURES,
  SKILL_EVIDENCE_MIGRATION,
  editedMigration,
  migrate,
  openEngine,
  readFixture,
  schemaReference,
} from "./testing/skillEvidenceEngines";

type ValidationCase = { name: string; category: string; candidateEdits?: [string, string][]; sql: string[]; expect: "accept" | "refuse" };
const VALIDATION = readFixture<{ baseline: string[]; cases: ValidationCase[] }>("validation-cases.json");
const CONSTRAINTS = readFixture<{ baseline: string[]; cases: { name: string; sql: string; expect: "ok" | "error" }[] }>("constraint-cases.json");
const WRITER_LIBRARY = readFileSync(`${FIXTURES}/writer-populated-schema14.sql`, "utf8");

describe("migration 14 is the accepted candidate", () => {
  it("is byte-identical to the reviewed candidate in the evidence pack", () => {
    const candidate = readFileSync(`${process.cwd()}/docs/evidence/m3-skills-evidence-scope-2026-10-10/candidate/0014_skills_evidence.sql`, "utf8");
    expect(SKILL_EVIDENCE_MIGRATION.sql).toBe(candidate);
    expect(SKILL_EVIDENCE_MIGRATION.description).toBe("skills_evidence");
  });
});

describe("shared schema-14 validation contract", () => {
  it("covers every invariant category, with controls", () => {
    expect(VALIDATION.cases).toHaveLength(85);
    expect(new Set(VALIDATION.cases.map((c) => c.category))).toEqual(
      new Set([
        "control", "schema", "schema-check", "schema-fk", "schema-key", "schema-index", "schema-trigger", "catalog", "history",
        "relationships", "receipts", "receipt-shape", "receipt-ownership", "catalog-pinned", "catalog-names", "history-ownership",
      ]),
    );
  });

  for (const engineName of ENGINES) {
    it(`${engineName} gives the listed outcome for every case`, async () => {
      const reference = await schemaReference();
      const outcomes: string[] = [];
      for (const testCase of VALIDATION.cases) {
        const engine = await openEngine(engineName);
        try {
          await migrate(engine, { migration14: editedMigration(testCase.candidateEdits) });
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

    it(`${engineName}: whole-database validation runs the schema-14 check (a refused case refuses the database)`, async () => {
      const reference = await schemaReference();
      const refused = VALIDATION.cases.find((c) => c.name === "tombstone whose observation is still present") ??
        VALIDATION.cases.find((c) => c.expect === "refuse" && !c.candidateEdits)!;
      const engine = await openEngine(engineName);
      try {
        await migrate(engine);
        for (const statement of VALIDATION.baseline) engine.exec(statement);
        await validateApplicationDatabase((sql, params) => engine.query(sql, params), reference);
        for (const statement of refused.sql) engine.exec(statement);
        await expect(validateApplicationDatabase((sql, params) => engine.query(sql, params), reference)).rejects.toBeInstanceOf(
          PracticeStateValidationError,
        );
      } finally {
        engine.close();
      }
    });
  }
});

describe("shared constraint contract", () => {
  it("has the accepted 29 cases", () => {
    expect(CONSTRAINTS.cases).toHaveLength(29);
  });

  for (const engineName of ENGINES) {
    it(`${engineName} accepts and refuses exactly the listed statements`, async () => {
      const outcomes: string[] = [];
      for (const testCase of CONSTRAINTS.cases) {
        const engine = await openEngine(engineName);
        try {
          await migrate(engine);
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

describe("the library written by the real writer (M3-R9)", () => {
  for (const engineName of ENGINES) {
    it(`${engineName}: validates, and removing any one history-owning receipt is refused`, async () => {
      const reference = await schemaReference();
      const open = async (extra?: string) => {
        const engine = await openEngine(engineName);
        await migrate(engine);
        engine.exec(WRITER_LIBRARY);
        if (extra) engine.exec(extra);
        return engine;
      };
      const whole = await open();
      const owning = whole.query(
        "SELECT operation_id, action FROM skill_evidence_operations WHERE is_erased = 0 AND action <> 'erase_observation' ORDER BY rowid",
      );
      await validateApplicationDatabase((sql, params) => whole.query(sql, params), reference);
      whole.close();
      expect(new Set(owning.map((r) => r["action"])).size).toBe(11);
      for (const row of owning) {
        const broken = await open(`DELETE FROM skill_evidence_operations WHERE operation_id = '${String(row["operation_id"])}'`);
        try {
          await expect(validateApplicationDatabase((sql, params) => broken.query(sql, params), reference)).rejects.toBeInstanceOf(
            PracticeStateValidationError,
          );
        } finally {
          broken.close();
        }
      }
    });
  }
});
