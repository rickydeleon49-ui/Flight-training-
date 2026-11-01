import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMigrations, MIGRATIONS } from "./migrations";
import { validateVideoLinks } from "./practiceStateValidation";
import { openNodeEngine } from "./testing/skillEvidenceEngines";

describe("video links schema 29", () => {
  it("registers the same additive migration on desktop and browser", () => {
    expect(MIGRATIONS.at(-1)).toMatchObject({ version: 31, description: "faa_downloads" });
    const native = readFileSync("src-tauri/src/lib.rs", "utf8");
    expect(native).toMatch(/CURRENT_SCHEMA_VERSION: i64 = 31/);
    expect(native).toMatch(/version: 29,\s+description: "material_video_links",\s+sql: include_str!\("\.\.\/migrations\/0029_material_video_links.sql"\)/);
  });
  it.each(["DROP TABLE material_video_links", "DROP INDEX idx_material_video_links_material"])("refuses schema damage: %s", async (damage) => {
    const reference = await openNodeEngine();
    const damaged = await openNodeEngine();
    try {
      await applyMigrations((sql) => reference.exec(sql), new Set());
      await applyMigrations((sql) => damaged.exec(sql), new Set());
      const query = async (sql: string, params: Parameters<typeof damaged.query>[1]) => damaged.query(sql, params);
      const ref = async (sql: string, params: Parameters<typeof reference.query>[1]) => reference.query(sql, params);
      await validateVideoLinks(query, ref);
      damaged.exec(damage);
      await expect(validateVideoLinks(query, ref)).rejects.toThrow();
    } finally { reference.close(); damaged.close(); }
  });
  it("upgrades schema 28 without changing existing materials", async () => {
    const engine = await openNodeEngine();
    try {
      await applyMigrations((sql) => engine.exec(sql), new Set([29, 30, 31]));
      engine.exec("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('section','Synthetic section','now','now')");
      const before = engine.query("SELECT * FROM study_materials");
      await applyMigrations((sql) => engine.exec(sql), new Set(MIGRATIONS.filter((m) => m.version <= 28).map((m) => m.version)));
      expect(engine.query("SELECT * FROM study_materials")).toEqual(before);
      expect(engine.query("SELECT * FROM material_video_links")).toEqual([]);
    } finally { engine.close(); }
  });
});
