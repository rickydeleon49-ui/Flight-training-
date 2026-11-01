import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMigrations, MIGRATIONS } from "./migrations";
import { validateStudentPilotSteps } from "./practiceStateValidation";
import { openNodeEngine } from "./testing/skillEvidenceEngines";

describe("student pilot steps schema 30", () => {
  it("registers the same additive migration on desktop and browser", () => {
    expect(MIGRATIONS.at(-1)).toMatchObject({ version: 31, description: "faa_downloads" });
    const native = readFileSync("src-tauri/src/lib.rs", "utf8");
    expect(native).toMatch(/version: 30,\s+description: "student_pilot_steps",\s+sql: include_str!\("\.\.\/migrations\/0030_student_pilot_steps.sql"\)/);
  });
  it("refuses a missing or changed table", async () => {
    for (const damage of ["DROP TABLE student_pilot_steps", "ALTER TABLE student_pilot_steps DROP COLUMN done_at"]) {
      const reference = await openNodeEngine();
      const damaged = await openNodeEngine();
      try {
        await applyMigrations((sql) => reference.exec(sql), new Set());
        await applyMigrations((sql) => damaged.exec(sql), new Set());
        const query = async (sql: string, params: Parameters<typeof damaged.query>[1]) => damaged.query(sql, params);
        const ref = async (sql: string, params: Parameters<typeof reference.query>[1]) => reference.query(sql, params);
        await validateStudentPilotSteps(query, ref);
        damaged.exec(damage);
        await expect(validateStudentPilotSteps(query, ref)).rejects.toThrow();
      } finally { reference.close(); damaged.close(); }
    }
  });
  it("upgrades schema 29 without changing existing materials", async () => {
    const engine = await openNodeEngine();
    try {
      await applyMigrations((sql) => engine.exec(sql), new Set([30, 31]));
      engine.exec("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('section','Synthetic section','now','now')");
      const before = engine.query("SELECT * FROM study_materials");
      await applyMigrations((sql) => engine.exec(sql), new Set(MIGRATIONS.filter((m) => m.version <= 29).map((m) => m.version)));
      expect(engine.query("SELECT * FROM study_materials")).toEqual(before);
      expect(engine.query("SELECT * FROM student_pilot_steps")).toEqual([]);
    } finally { engine.close(); }
  });
});
