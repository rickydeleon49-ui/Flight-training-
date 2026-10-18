/**
 * The shared schema-15 navigation validation cases
 * (src-tauri/fixtures/navigation/validation-cases.json) through whole-library
 * validation on node:sqlite and sql.js. The native suite replays the same
 * file through `verify_application_connection` and must give the same
 * outcome for every case.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyMigrations } from "./migrations";
import { PracticeStateValidationError, validateApplicationDatabase } from "./practiceStateValidation";
import { ENGINES, openEngine, schemaReference } from "./testing/skillEvidenceEngines";

const CASES = JSON.parse(readFileSync(`${process.cwd()}/src-tauri/fixtures/navigation/validation-cases.json`, "utf8")) as {
  baseline: string[];
  cases: { name: string; category: string; sql: string[]; expect: "accept" | "refuse" }[];
};

describe("shared schema-15 navigation validation", () => {
  it("has controls and refusals in every category", () => {
    expect(CASES.cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CASES.cases.map((c) => c.category))).toEqual(new Set(["control", "limits", "ownership", "schema-fk", "schema-index", "schema-check", "schema"]));
  });

  for (const engineName of ENGINES) {
    it(`${engineName} gives the listed outcome for every case`, async () => {
      const reference = await schemaReference();
      const mismatches: string[] = [];
      for (const testCase of CASES.cases) {
        const engine = await openEngine(engineName);
        try {
          engine.exec("PRAGMA foreign_keys = ON");
          await applyMigrations((sql) => engine.exec(sql), new Set());
          for (const statement of [...CASES.baseline, ...testCase.sql]) engine.exec(statement);
          const outcome = await validateApplicationDatabase((sql, params) => engine.query(sql, params), reference).then(
            () => "accept",
            (error: unknown) => {
              if (!(error instanceof PracticeStateValidationError)) throw error;
              return "refuse";
            },
          );
          if (outcome !== testCase.expect) mismatches.push(`${testCase.name}: expected ${testCase.expect}, got ${outcome}`);
        } finally {
          engine.close();
        }
      }
      expect(mismatches).toEqual([]);
    });
  }
});
