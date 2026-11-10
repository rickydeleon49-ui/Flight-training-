import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMigrations, MIGRATIONS } from "./migrations";
import { validateStudyPackState } from "./practiceStateValidation";
import { openNodeEngine } from "./testing/skillEvidenceEngines";

const OP = "11111111-1111-4111-8111-111111111111";
const NS = "22222222-2222-4222-8222-222222222222";
const HEX = "a".repeat(64);
const AT = "2026-11-07T10:00:00.000Z";

async function validated(engine: Awaited<ReturnType<typeof openNodeEngine>>) {
  const reference = await openNodeEngine();
  try {
    await applyMigrations((sql) => reference.exec(sql), new Set());
    const query = async (sql: string, params: Parameters<typeof engine.query>[1]) => engine.query(sql, params);
    const ref = async (sql: string, params: Parameters<typeof reference.query>[1]) => reference.query(sql, params);
    await validateStudyPackState(query, ref);
  } finally {
    reference.close();
  }
}

async function freshWithRows() {
  const engine = await openNodeEngine();
  await applyMigrations((sql) => engine.exec(sql), new Set());
  engine.exec(`INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m1','One','${AT}','${AT}')`);
  engine.exec(`INSERT INTO study_pack_imports VALUES ('${OP}','${OP}','${HEX}',1, 2,1,1,0,0, 0,0,0,0,0,'${AT}')`);
  engine.exec(`INSERT INTO study_pack_items VALUES ('${NS}','item-1','${HEX}','document','${HEX}','m1','added','${OP}','${AT}')`);
  engine.exec(`INSERT INTO study_pack_acks VALUES ('${OP}','${AT}')`);
  return engine;
}

describe("study pack provenance schema 37", () => {
  it("is registered on desktop and in the browser with a recorded checksum", () => {
    expect(MIGRATIONS.find((m) => m.version === 37)).toMatchObject({ version: 37, description: "study_pack_provenance" });
    const native = readFileSync("src-tauri/src/lib.rs", "utf8");
    expect(native).toMatch(/version: 37,\s+description: "study_pack_provenance",\s+sql: include_str!\("\.\.\/migrations\/0037_study_pack_provenance.sql"\)/);
    expect(native).toMatch(new RegExp(`CURRENT_SCHEMA_VERSION: i64 = ${MIGRATIONS.length}`));
    expect(JSON.parse(readFileSync("src/data/migration-checksums.json", "utf8"))["0037_study_pack_provenance.sql"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("upgrades 36 to 37 without touching existing rows and accepts a good database", async () => {
    const engine = await openNodeEngine();
    try {
      await applyMigrations((sql) => engine.exec(sql), new Set([37, 38]));
      engine.exec(`INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m','Hers','${AT}','${AT}')`);
      const before = engine.query("SELECT * FROM study_materials");
      await applyMigrations((sql) => engine.exec(sql), new Set(MIGRATIONS.filter((m) => m.version <= 36).map((m) => m.version)));
      expect(engine.query("SELECT * FROM study_materials")).toEqual(before);
      for (const table of ["study_pack_imports", "study_pack_items", "study_pack_acks"]) {
        expect(engine.query(`SELECT * FROM ${table}`)).toEqual([]);
      }
      await validated(engine);
    } finally {
      engine.close();
    }
  });

  it("accepts imported rows, and a deleted material turns its rows into tombstones", async () => {
    const engine = await freshWithRows();
    try {
      await validated(engine);
      engine.exec("PRAGMA foreign_keys = ON");
      engine.exec("DELETE FROM study_materials WHERE id = 'm1'");
      expect(engine.query("SELECT material_id FROM study_pack_items")).toEqual([{ material_id: null }]);
      await validated(engine);
    } finally {
      engine.close();
    }
  });

  it("refuses missing, malformed and inconsistent provenance", async () => {
    const damages: Array<[string, string]> = [
      ["a missing table", "DROP TABLE study_pack_acks"],
      ["a bad link value", `PRAGMA ignore_check_constraints = ON; UPDATE study_pack_items SET link = 'bogus'; PRAGMA ignore_check_constraints = OFF`],
      ["an item with no receipt", `PRAGMA foreign_keys = OFF; INSERT INTO study_pack_items VALUES ('${NS}','item-2','${HEX}','guide',NULL,NULL,'alias','99999999-9999-4999-8999-999999999999','${AT}')`],
      ["two added rows for one material", `DROP INDEX idx_study_pack_items_added; INSERT INTO study_pack_items VALUES ('${NS}','item-3','${HEX}','document','${HEX}','m1','added','${OP}','${AT}')`],
      ["practice sets above the added total", "UPDATE study_pack_imports SET added_practice = 9"],
      ["a guide with a file hash", "UPDATE study_pack_items SET kind = 'guide'"],
      ["a document without a file hash", "UPDATE study_pack_items SET file_sha256 = NULL"],
      ["an ack with no receipt", `PRAGMA foreign_keys = OFF; INSERT INTO study_pack_acks VALUES ('99999999-9999-4999-8999-999999999999','${AT}')`],
      ["a dropped check constraint", `DROP TABLE study_pack_acks; DROP TABLE study_pack_items; CREATE TABLE study_pack_items (namespace TEXT NOT NULL, item_id TEXT NOT NULL, revision TEXT NOT NULL, kind TEXT NOT NULL, file_sha256 TEXT, material_id TEXT REFERENCES study_materials(id) ON DELETE SET NULL, link TEXT NOT NULL, operation_id TEXT NOT NULL REFERENCES study_pack_imports(operation_id), imported_at TEXT NOT NULL, PRIMARY KEY (namespace, item_id, operation_id)); CREATE TABLE study_pack_acks (operation_id TEXT PRIMARY KEY NOT NULL REFERENCES study_pack_imports(operation_id), acked_at TEXT NOT NULL)`],
    ];
    for (const [label, sql] of damages) {
      const engine = await freshWithRows();
      try {
        await validated(engine);
        engine.exec(sql);
        await expect(validated(engine), label).rejects.toThrow();
      } finally {
        engine.close();
      }
    }
  });
});
