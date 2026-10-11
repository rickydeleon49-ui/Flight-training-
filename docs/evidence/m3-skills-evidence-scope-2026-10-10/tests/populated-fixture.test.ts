/**
 * The shared populated schema-13 fixture (fixtures/populated-schema13.sql)
 * used by the native crate's upgrade proof.
 *
 * It is a row dump of a library written by the shipped production driver
 * and repositories (tests/helpers.ts buildPopulatedSchema13). Regenerate with
 *   M3_WRITE_FIXTURE=1 npx vitest run --config <this pack>/vitest.config.ts tests/populated-fixture
 * Normally this test only proves the committed fixture is a genuine shipped
 * library: it loads into the shipped 0001-0013 schema and the SHIPPED
 * production driver opens it (which runs the accepted schema 11-13 validators).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createNodeSqliteDatabase } from "@/data/testing/nodeSqliteDb";

import { openNodeEngine, type Engine } from "../prototype/candidateEngine";
import { buildPopulatedSchema13, tempDir } from "./helpers";

const FIXTURE = `${process.cwd()}/docs/evidence/m3-skills-evidence-scope-2026-10-10/fixtures/populated-schema13.sql`;

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Data rows only, parents first (tables in creation order). */
export function dumpRows(engine: Engine): string[] {
  const out: string[] = [];
  const tables = engine
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY rowid")
    .map((r) => String(r["name"]));
  for (const table of tables) {
    for (const row of engine.query(`SELECT * FROM "${table}" ORDER BY rowid`)) {
      const cols = Object.keys(row);
      out.push(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((c) => literal(row[c])).join(", ")});`);
    }
  }
  return out;
}

describe("populated schema-13 fixture", () => {
  it.runIf(process.env["M3_WRITE_FIXTURE"] === "1")("regenerates the fixture from the shipped driver", async () => {
    const t = tempDir("m3-fixture-");
    try {
      const path = join(t.dir, "library.db");
      await buildPopulatedSchema13(path);
      const engine = await openNodeEngine(path);
      const lines = dumpRows(engine);
      engine.close();
      writeFileSync(FIXTURE, `-- Synthetic populated schema-13 library: rows written by the shipped driver (see tests/populated-fixture.test.ts).\n${lines.join("\n")}\n`);
    } finally {
      t.cleanup();
    }
  });

  it("loads into the shipped schema and opens through the shipped production driver", async () => {
    const t = tempDir("m3-fixture-check-");
    try {
      const path = join(t.dir, "library.db");
      // A fresh shipped library, then the fixture rows.
      (await createNodeSqliteDatabase(path)).close();
      const engine = await openNodeEngine(path);
      engine.exec(readFileSync(FIXTURE, "utf8"));
      expect(engine.query("PRAGMA foreign_key_check")).toEqual([]);
      const count = (table: string) => Number(engine.query(`SELECT COUNT(*) AS n FROM ${table}`)[0]!["n"]);
      expect({
        journal: count("journal_entries"), actions: count("next_actions"), questions: count("questions"),
        responses: count("practice_responses"), cardEvents: count("card_review_events"), lineage: count("material_split_lineage"),
      }).toEqual({ journal: 2, actions: 2, questions: 2, responses: 1, cardEvents: 1, lineage: 1 });
      engine.close();
      const shipped = await createNodeSqliteDatabase(path);
      shipped.close();
    } finally {
      t.cleanup();
    }
  });
});
