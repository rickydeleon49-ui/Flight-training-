/**
 * OFFLINE-03b r7: the shared schema-17 practice-authoring validation contract
 * (`src-tauri/fixtures/practice-authoring-validation/cases.json`) on the
 * browser and test engines. The native runner is
 * `practice_authoring_tests::shared_practice_authoring_validation_contract_native_outcomes`;
 * all three must give the listed outcome for every case. The validator is
 * `validatePracticeAuthoringState`, the TypeScript contract the native
 * `verify_schema_17_practice_authoring_semantics` is the twin of. Real engines
 * on disposable in-memory databases only, each one closed and reopened before
 * it is validated, so a writable_schema edit takes effect exactly as it would
 * on the next launch.
 */
import { readFileSync } from "node:fs";
import initSqlJs, { type BindParams, type Database as SqlJsHandle } from "sql.js";
import { describe, expect, it } from "vitest";

import type { SqlValue } from "./db";
import { applyMigrations } from "./migrations";
import { PracticeStateValidationError, validatePracticeAuthoringState } from "./practiceStateValidation";

const WASM = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
const CONTRACT: {
  baseline: string[];
  cases: { name: string; category: string; sql: string[]; expect: "accept" | "refuse" }[];
} = JSON.parse(readFileSync(`${process.cwd()}/src-tauri/fixtures/practice-authoring-validation/cases.json`, "utf8"));

function rows(handle: SqlJsHandle, sql: string, params: SqlValue[] = []): Record<string, unknown>[] {
  const statement = handle.prepare(sql);
  try {
    statement.bind(params as BindParams);
    const out: Record<string, unknown>[] = [];
    while (statement.step()) out.push(statement.getAsObject());
    return out;
  } finally {
    statement.free();
  }
}

async function outcome(run: () => Promise<void>): Promise<"accept" | "refuse"> {
  return run().then(
    () => "accept" as const,
    (error: unknown) => {
      expect(error).toBeInstanceOf(PracticeStateValidationError);
      return "refuse" as const;
    },
  );
}

describe("shared schema-17 practice-authoring validation contract", () => {
  it("covers every required invariant category with at least twenty-six cases", () => {
    expect(CONTRACT.cases.length).toBeGreaterThanOrEqual(26);
    expect(new Set(CONTRACT.cases.map((c) => c.category))).toEqual(
      new Set(["control", "schema", "schema-fk", "schema-check", "schema-index", "schema-column", "receipts", "identity", "ledger", "history", "mirror"]),
    );
    expect(CONTRACT.cases.filter((c) => c.expect === "accept").length).toBeGreaterThanOrEqual(4);
  });

  it("sql.js gives the listed outcome for every case", async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM });
    const reference = new SQL.Database();
    await applyMigrations((sql) => reference.run(sql), new Set());
    const mismatches: string[] = [];
    for (const testCase of CONTRACT.cases) {
      const build = new SQL.Database();
      build.run("PRAGMA foreign_keys = ON");
      await applyMigrations((sql) => build.run(sql), new Set());
      for (const statement of [...CONTRACT.baseline, ...testCase.sql]) build.run(statement);
      const reopened = new SQL.Database(build.export());
      build.close();
      const result = await outcome(() =>
        validatePracticeAuthoringState(
          (sql, params) => rows(reopened, sql, params),
          (sql, params) => rows(reference, sql, params),
        ),
      );
      reopened.close();
      if (result !== testCase.expect) mismatches.push(`${testCase.name}: expected ${testCase.expect}, got ${result}`);
    }
    reference.close();
    expect(mismatches).toEqual([]);
  });

  it.each(CONTRACT.cases)("node:sqlite: $name gives $expect", async (testCase) => {
    const { DatabaseSync } = await import(/* @vite-ignore */ "node:sqlite");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const reference = new DatabaseSync(":memory:");
    const dir = mkdtempSync(join(tmpdir(), "authoring-contract-"));
    try {
      await applyMigrations((sql) => reference.exec(sql), new Set());
      const path = join(dir, "case.db");
      const build = new DatabaseSync(path);
      try {
        build.exec("PRAGMA foreign_keys = ON");
        await applyMigrations((sql) => build.exec(sql), new Set());
        for (const statement of [...CONTRACT.baseline, ...testCase.sql]) build.exec(statement);
      } finally {
        build.close();
      }
      const reopened = new DatabaseSync(path);
      try {
        const result = await outcome(() =>
          validatePracticeAuthoringState(
            (sql, params) => reopened.prepare(sql).all(...params) as Record<string, unknown>[],
            (sql, params) => reference.prepare(sql).all(...params) as Record<string, unknown>[],
          ),
        );
        expect(result).toBe(testCase.expect);
      } finally {
        reopened.close();
      }
    } finally {
      reference.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
