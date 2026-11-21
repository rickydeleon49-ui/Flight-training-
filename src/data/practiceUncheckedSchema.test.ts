import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMigrations, MIGRATIONS } from "./migrations";
import { openNodeEngine } from "./testing/skillEvidenceEngines";

describe("practice unchecked schema 39", () => {
  it("registers the same additive migration on desktop and browser", () => {
    expect(MIGRATIONS.find((m) => m.version === 39)).toMatchObject({ version: 39, description: "practice_unchecked" });
    const native = readFileSync("src-tauri/src/lib.rs", "utf8");
    expect(native).toMatch(new RegExp(`CURRENT_SCHEMA_VERSION: i64 = ${MIGRATIONS.length}`));
    expect(native).toMatch(/version: 39,\s+description: "practice_unchecked",\s+sql: include_str!\("\.\.\/migrations\/0039_practice_unchecked\.sql"\)/);
  });

  it("opens a schema-38 library with every old question marked checked", async () => {
    const engine = await openNodeEngine();
    try {
      await applyMigrations((sql) => engine.exec(sql), new Set([39, 40, 41, 42]));
      engine.exec("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('m', 'Synthetic', 'now', 'now')");
      engine.exec("INSERT INTO practice_test_versions (id, source_material_id, history_key, source_material_title, content_hash, created_at) VALUES ('v', 'm', 'k', 'Synthetic', 'h', 'now')");
      engine.exec("INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index) VALUES ('i', 'v', 0, 'Old question', '[\"A\",\"B\"]', 0)");
      await applyMigrations((sql) => engine.exec(sql), new Set(MIGRATIONS.filter((m) => m.version <= 38).map((m) => m.version)));
      expect(engine.query("SELECT question_text, unchecked FROM practice_test_items")).toEqual([{ question_text: "Old question", unchecked: 0 }]);
    } finally {
      engine.close?.();
    }
  });
});
