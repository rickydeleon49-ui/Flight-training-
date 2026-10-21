import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "./migrations";
import { validateHomeworkState } from "./practiceStateValidation";
import { openNodeEngine, openSqlJsEngine, type Engine } from "./testing/skillEvidenceEngines";

const contract = JSON.parse(readFileSync("src-tauri/fixtures/homework-validation/cases.json", "utf8")) as {
  baseline: string[]; cases: { name: string; expect: string; sql: string[] }[];
};
describe.each(["sql.js", "node:sqlite"])("shared homework contract: %s", (name) => {
  it.each(contract.cases)("$name -> $expect after close/reopen", async (c) => {
    const dir = mkdtempSync(join(tmpdir(), "homework-contract-"));
    let build: Engine | undefined, reopened: Engine | undefined;
    const reference = await openNodeEngine();
    try {
      await applyMigrations((sql) => reference.exec(sql), new Set());
      build = name === "sql.js" ? await openSqlJsEngine() : await openNodeEngine(join(dir, "case.db"));
      await applyMigrations((sql) => build!.exec(sql), new Set());
      for (const sql of [...contract.baseline, ...c.sql]) build.exec(sql);
      const bytes = build.snapshot();
      build.close(); build = undefined;
      if (name !== "sql.js") writeFileSync(join(dir, "case.db"), bytes);
      reopened = name === "sql.js" ? await openSqlJsEngine(bytes) : await openNodeEngine(join(dir, "case.db"));
      let result = "accept";
      try { await validateHomeworkState((s, p) => reopened!.query(s, p), (s, p) => reference.query(s, p)); }
      catch { result = "refuse"; }
      expect(result).toBe(c.expect);
    } finally { build?.close(); reopened?.close(); reference.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
