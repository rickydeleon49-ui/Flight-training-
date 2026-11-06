/** ORAL-01d: her kept oral answers (schema 32): codec, repository, verifier and exports. Fictional fixtures only. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { SqlValue } from "./db";
import { applyMigrations, MIGRATIONS } from "./migrations";
import { coveredIndexes, decodeOralCovered, encodeOralCovered, oralAnswerFirstLine } from "./oralAnswers";
import { executeOralOperation } from "./oralScenarios";
import { PracticeStateValidationError, validateApplicationDatabase, validateOralAnswers } from "./practiceStateValidation";
import { createRepositories } from "./repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";

const nativeSqlite = "node:sqlite";
const M = "oral-material";
const uid = (n: number) => `0a1c0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const content = (prompt: string, points = 3) => ({
  prompt,
  assumptions: "",
  points: Array.from({ length: points }, (_, i) => `Point ${i} — Bravo`),
  sourcePage: null,
  origin: "user" as const,
});
const create = (op: number, scenario: number, version: number, prompt: string) => ({
  action: "create" as const,
  operationId: uid(op),
  materialId: M,
  at: "2026-11-02T10:00:00.000Z",
  scenarioId: uid(scenario),
  versionId: uid(version),
  content: content(prompt),
});

describe("oral answers codec", () => {
  it("keeps only sorted, unique ticks that exist in the version", () => {
    expect(coveredIndexes([true, false, true])).toEqual([0, 2]);
    expect(encodeOralCovered([0, 2], 3)).toBe("[0,2]");
    expect(decodeOralCovered("[]", 3)).toEqual([]);
    for (const bad of ["[2,0]", "[0,0]", "[3]", "[-1]", "[0, 2]", "[1.5]", "{}", "null"]) {
      expect(() => decodeOralCovered(bad, 3), bad).toThrow();
    }
    expect(() => encodeOralCovered([3], 3)).toThrow();
  });
  it("shows the first written line, short", () => {
    expect(oralAnswerFirstLine("\n  Carb heat first \nthen checklist")).toBe("Carb heat first");
    expect(oralAnswerFirstLine("x".repeat(200))).toHaveLength(120);
    expect(oralAnswerFirstLine("   ")).toBe("");
  });
});

describe("oral answers repository", () => {
  let db: TestDatabase;
  afterEach(() => db?.close());

  async function setup() {
    db = await createNodeSqliteDatabase();
    const repos = createRepositories(db);
    await repos.documents.create({ id: M, title: "Oral material" });
    const scenario = await repos.oralScenarios.create(M, content("Scenario Alpha"));
    const [s] = await repos.oralScenarios.list(M);
    return { repos, scenario: s!, result: scenario };
  }

  it("keeps a finished answer frozen to its version, lists newest first, and deletes one or all", async () => {
    const { repos, scenario } = await setup();
    const base = { scenarioId: scenario.id, versionId: scenario.versionId, pointCount: 3, revealedAt: "2026-11-02T10:00:00.000Z" };
    const first = await repos.oralAnswers.finish({ ...base, answer: "First answer\nmore", covered: [1] });
    await new Promise((r) => setTimeout(r, 5));
    await repos.oralAnswers.finish({ ...base, answer: "Second answer", covered: [] });
    const list = await repos.oralAnswers.list(scenario.id);
    expect(list.map((a) => a.answer)).toEqual(["Second answer", "First answer\nmore"]);
    expect(list[1]).toMatchObject({ id: first, covered: [1], versionNumber: 1, versionId: scenario.versionId });
    // Editing the scenario adds a version; the kept answer still points at the one she answered.
    await repos.oralScenarios.edit(M, scenario.id, 1, content("Scenario Alpha, reworded", 2));
    expect((await repos.oralAnswers.list(scenario.id)).every((a) => a.versionNumber === 1)).toBe(true);
    expect((await repos.oralAnswers.list(scenario.id))[0]!.points).toEqual(content("Scenario Alpha").points);
    await repos.oralAnswers.remove(first);
    expect(await repos.oralAnswers.list(scenario.id)).toHaveLength(1);
    await repos.oralAnswers.removeAll(scenario.id);
    expect(await repos.oralAnswers.list(scenario.id)).toEqual([]);
  });

  it("refuses ticks outside the version, an answer over 20,000 characters, and a version of another scenario", async () => {
    const { repos, scenario } = await setup();
    const base = { scenarioId: scenario.id, versionId: scenario.versionId, pointCount: 3, revealedAt: "t", covered: [] as number[] };
    await expect(repos.oralAnswers.finish({ ...base, answer: "a", covered: [3] })).rejects.toThrow();
    await expect(repos.oralAnswers.finish({ ...base, answer: "x".repeat(20001) })).rejects.toThrow();
    await repos.oralAnswers.finish({ ...base, answer: "x".repeat(20000) });
    await expect(repos.oralAnswers.finish({ ...base, scenarioId: uid(99), answer: "orphan" })).rejects.toThrow();
    await expect(repos.oralAnswers.finish({ ...base, versionId: uid(99), answer: "missing version" })).rejects.toThrow();
    expect(await db.select("SELECT COUNT(*) AS n FROM oral_answers")).toEqual([{ n: 1 }]);
  });

  it("deleting the material removes her answers too", async () => {
    const { repos, scenario } = await setup();
    await repos.oralAnswers.finish({ scenarioId: scenario.id, versionId: scenario.versionId, pointCount: 3, answer: "a", covered: [0], revealedAt: "t" });
    await db.execute("DELETE FROM study_materials WHERE id = ?", [M]);
    expect(await db.select("SELECT COUNT(*) AS n FROM oral_answers")).toEqual([{ n: 0 }]);
  });
});

describe("oral answers verifier (schema 32)", () => {
  async function raw() {
    const { DatabaseSync } = await import(/* @vite-ignore */ nativeSqlite);
    const make = async () => {
      const handle = new DatabaseSync(":memory:");
      handle.exec("PRAGMA foreign_keys = ON");
      await applyMigrations((sql) => handle.exec(sql), new Set());
      const query = (sql: string, params: SqlValue[] = []) => handle.prepare(sql).all(...params) as Record<string, unknown>[];
      return { handle, query };
    };
    const reference = await make();
    const db = await make();
    db.handle.exec(`INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('${M}', 'Fictional', 'x', 'x')`);
    const save = (op: unknown) =>
      executeOralOperation((sql) => db.handle.exec(sql), (sql, params) => void db.handle.prepare(sql).run(...params), db.query, op);
    await save(create(1, 10, 11, "Scenario Alpha"));
    await save(create(2, 20, 21, "Scenario Bravo"));
    db.handle.exec(`INSERT INTO oral_answers (id, scenario_id, version_id, answer, covered_json, revealed_at, finished_at, created_at, updated_at)
      VALUES ('${uid(30)}', '${uid(10)}', '${uid(11)}', 'Fictional answer ✈', '[0,2]', 't', 't', 't', 't')`);
    return { db, reference };
  }

  it("accepts kept answers and refuses each damaged row", async () => {
    const corruptions = [
      null,
      "UPDATE oral_answers SET covered_json = '[2,0]'",
      "UPDATE oral_answers SET covered_json = '[3]'",
      "UPDATE oral_answers SET covered_json = '[0, 2]'",
      `UPDATE oral_answers SET scenario_id = '${uid(20)}'`,
      "UPDATE oral_answers SET id = 'short-id-but-thirty-six-characters!!'",
      "UPDATE oral_answers SET finished_at = ''",
      "UPDATE oral_answers SET created_at = ''",
      "ALTER TABLE oral_answers ADD COLUMN extra TEXT",
    ];
    for (const sql of corruptions) {
      const { db, reference } = await raw();
      await validateOralAnswers(db.query, reference.query);
      await validateApplicationDatabase(db.query, reference.query);
      if (sql === null) continue;
      db.handle.exec("PRAGMA foreign_keys = OFF");
      db.handle.exec(sql);
      await expect(validateOralAnswers(db.query, reference.query), sql).rejects.toBeInstanceOf(PracticeStateValidationError);
    }
  });

  it("a finished answer must have been revealed", async () => {
    const { db } = await raw();
    expect(() => db.handle.exec("UPDATE oral_answers SET revealed_at = NULL")).toThrow();
  });

  it("is registered as add-only migration 32 on desktop and browser; a schema-31 library upgrades empty", async () => {
    expect(MIGRATIONS.find((m) => m.version === 32)).toMatchObject({ version: 32, description: "oral_answers" });
    const native = readFileSync("src-tauri/src/lib.rs", "utf8");
    expect(native).toMatch(new RegExp(`CURRENT_SCHEMA_VERSION: i64 = ${MIGRATIONS.length}`));
    expect(native).toMatch(/version: 32,\s+description: "oral_answers",\s+sql: include_str!\("\.\.\/migrations\/0032_oral_answers.sql"\)/);
    const { DatabaseSync } = await import(/* @vite-ignore */ nativeSqlite);
    const handle = new DatabaseSync(":memory:");
    await applyMigrations((sql) => handle.exec(sql), new Set([32, 33, 34, 35]));
    expect(handle.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'oral_answers'").get()).toEqual({ n: 0 });
    await applyMigrations((sql) => handle.exec(sql), new Set(MIGRATIONS.filter((m) => m.version <= 31).map((m) => m.version)));
    expect(handle.prepare("SELECT COUNT(*) AS n FROM oral_answers").get()).toEqual({ n: 0 });
  });
});

it("no export, packet, handout or Markdown code reads her answers", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|rs)$/.test(name) && !/\.test\.|_tests\.rs$/.test(name)) files.push(path);
    }
  };
  walk("src");
  walk("src-tauri/src");
  const readers = files.filter((f) => readFileSync(f, "utf8").includes("oral_answers")).sort();
  // Only the migration list, the verifiers and her own repository: no export, packet or handout.
  expect(readers).toEqual([
    "src-tauri/src/backup.rs",
    "src-tauri/src/lib.rs",
    "src-tauri/src/oral_scenarios.rs",
    "src/data/migrations.ts",
    "src/data/practiceStateValidation.ts",
    "src/data/repositories/oralAnswerRepository.ts",
  ]);
  const repositoryUsers = files.filter((f) => /oralAnswers\.(list|finish)|oralAnswerRepository/.test(readFileSync(f, "utf8"))).sort();
  expect(repositoryUsers).toEqual(["src/data/repositories/index.ts", "src/data/repositories/oralAnswerRepository.ts", "src/pages/StudyLibrary/OralPracticeDialog.tsx"]);
});
