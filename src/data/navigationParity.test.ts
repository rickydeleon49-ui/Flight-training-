/**
 * The shared navigation operation cases (src-tauri/fixtures/navigation/
 * operation-cases.json) through the browser/test twin on both real engines,
 * node:sqlite and sql.js. The native half runs the same file in
 * `navigation_tests.rs::the_shared_operation_cases_hold_natively`, so the two
 * implementations are held to identical outcomes. The native-only file reread
 * (M4S1-R3) has no browser counterpart and is covered natively.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MIGRATIONS, applyMigrations } from "./migrations";
import { NavigationError, executeNavigationOperation } from "./navigationTransaction";
import { ENGINES, openEngine, type Engine } from "./testing/skillEvidenceEngines";

interface Step {
  op: unknown;
  expect: { ok?: unknown; error?: string } | null;
}
interface Case {
  name: string;
  setup: string[];
  steps: Step[];
  final?: { claim?: [number, number] | null; tuple?: unknown[] | null; bookmarks?: number };
}

const RAW = readFileSync(`${process.cwd()}/src-tauri/fixtures/navigation/operation-cases.json`, "utf8");
const HASHES = (JSON.parse(RAW) as { hashes: Record<string, string> }).hashes;
const CASES = (JSON.parse(Object.entries(HASHES).reduce((text, [token, hash]) => text.split(token).join(hash), RAW)) as { cases: Case[] }).cases;

/** Every key in `expected` is in `actual` with an equal value; arrays match in length. */
function subset(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length && expected.every((e, i) => subset(e, actual[i]));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([k, v]) => Object.hasOwn(actual, k) && subset(v, (actual as Record<string, unknown>)[k]));
  }
  return Object.is(expected, actual);
}

async function library(name: (typeof ENGINES)[number]): Promise<Engine> {
  const engine = await openEngine(name);
  await applyMigrations((sql) => engine.exec(sql), new Set());
  expect(engine.query("SELECT MAX(version) AS v FROM schema_migrations")).toEqual([{ v: MIGRATIONS.at(-1)!.version }]);
  engine.exec("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat', 'Synthetic', 'x', 'x'), ('other', 'Synthetic', 'x', 'x')");
  return engine;
}

describe.each(ENGINES)("shared navigation cases on %s", (engineName) => {
  it("there are enough cases to matter", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
  });

  it.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, testCase) => {
    const engine = await library(engineName);
    try {
      for (const sql of testCase.setup) engine.exec(sql);
      for (const [i, step] of testCase.steps.entries()) {
        const sql = (step.op as { sql?: string } | null)?.sql;
        if (typeof sql === "string") {
          engine.exec(sql);
          continue;
        }
        let outcome: { ok: unknown } | { error: string };
        try {
          outcome = {
            ok: await executeNavigationOperation(
              (s) => engine.exec(s),
              (s, p) => engine.run(s, p),
              (s, p) => engine.query(s, p),
              step.op,
            ),
          };
        } catch (error) {
          if (!(error instanceof NavigationError)) throw error;
          outcome = { error: error.code };
        }
        if (step.expect?.error !== undefined) {
          expect(outcome, `step ${i}`).toEqual({ error: step.expect.error });
        } else {
          expect("ok" in outcome, `step ${i}: ${JSON.stringify(outcome)}`).toBe(true);
          const value = (outcome as { ok: unknown }).ok;
          expect(subset(step.expect?.ok, value), `step ${i}: ${JSON.stringify(value)} lacks ${JSON.stringify(step.expect?.ok)}`).toBe(true);
        }
      }
      const fin = testCase.final;
      if (!fin) return;
      if (fin.claim !== undefined) {
        const [row] = engine.query("SELECT reserved_generation AS r, cancelled_generation AS c FROM material_operation_claims WHERE material_id = 'mat'");
        expect(row ? [Number(row["r"]), Number(row["c"])] : null, "claim").toEqual(fin.claim);
      }
      if (fin.tuple !== undefined) {
        const [row] = engine.query(
          `SELECT json_array(last_requested_page, last_requested_page_label, confirmed_read, originating_content_sha256, status, owner_generation) AS t
             FROM material_reading_state WHERE material_id = 'mat'`,
        );
        expect(row ? JSON.parse(String(row["t"])) : null, "tuple").toEqual(fin.tuple);
      }
      if (fin.bookmarks !== undefined) {
        expect(engine.query("SELECT COUNT(*) AS n FROM material_bookmarks").map((r) => Number(r["n"])), "bookmarks").toEqual([fin.bookmarks]);
      }
    } finally {
      engine.close();
    }
  });
});
