/**
 * Guards on migrations, because her training record has to survive updates.
 *
 * Two things would put it at risk:
 *
 *   1. A destructive migration — dropping or renaming what already holds her
 *      data.
 *   2. Editing a migration that has already shipped. Installed copies record
 *      a checksum of every migration they have applied; changing one makes
 *      those databases refuse to open.
 *
 * Both are easy to do by accident and expensive to discover on her machine.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import checksums from "./migration-checksums.json";
import { MIGRATIONS } from "./migrations";

const DIR = join(process.cwd(), "src-tauri/migrations");
const files = readdirSync(DIR).filter((name) => name.endsWith(".sql")).sort();

describe("shipped migrations are never edited", () => {
  it("every migration file matches its recorded checksum", () => {
    const recorded = checksums as Record<string, string>;

    for (const file of files) {
      // Git may materialize text files with CRLF on Windows. The SQL itself is
      // platform-independent, so hash a canonical LF representation rather
      // than treating checkout line endings as a migration edit.
      const sql = readFileSync(join(DIR, file), "utf8").replace(/\r\n?/g, "\n");
      const actual = createHash("sha256").update(sql).digest("hex");
      expect(
        recorded[file],
        `${file} has changed, or is new.\n` +
          "If it is new, add its checksum to src/data/migration-checksums.json.\n" +
          "If it already shipped, do not edit it — every installed copy has " +
          "recorded a checksum of it and will refuse to open. Add a new " +
          "migration instead.",
      ).toBe(actual);
    }
  });

  it("records a checksum for every migration and nothing else", () => {
    expect(Object.keys(checksums).sort()).toEqual(files);
  });

  it("registers every migration file with the runner", () => {
    expect(MIGRATIONS).toHaveLength(files.length);
    expect(MIGRATIONS.map((m) => m.version)).toEqual(
      files.map((_, index) => index + 1),
    );
  });
});

describe("migrations are additive", () => {
  const destructive: Array<[string, RegExp]> = [
    ["dropping a table", /\bDROP\s+TABLE\b/i],
    ["dropping a column", /\bDROP\s+COLUMN\b/i],
    ["renaming a table", /\bRENAME\s+TO\b/i],
    ["renaming a column", /\bRENAME\s+COLUMN\b/i],
    ["deleting rows", /\bDELETE\s+FROM\b/i],
    ["emptying a table", /\bTRUNCATE\b/i],
  ];

  for (const file of files) {
    const sql = stripComments(readFileSync(join(DIR, file), "utf8"));

    for (const [what, pattern] of destructive) {
      it(`${file} does not risk her data by ${what}`, () => {
        expect(
          pattern.test(sql),
          `${file} looks like it is ${what}. Migrations run against databases ` +
            "that already hold her training record. If a change genuinely " +
            "needs this, it has to copy the data forward first — and this " +
            "guard should only be relaxed deliberately.",
        ).toBe(false);
      });
    }
  }
});

/** Comments explain intent and often mention the very words we search for. */
function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
