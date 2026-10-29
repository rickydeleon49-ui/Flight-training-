import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS, applyMigrations } from "./migrations";
import { openEngine, openSqlJsEngine, ENGINES, type Engine } from "./testing/skillEvidenceEngines";
import { FAA_FILE_LOCKED, PICTURE_FILE_LOCKED, executeMaterialSave } from "./materialTransaction";
import { validateApplicationDatabase } from "./practiceStateValidation";
import { FAA_REFERENCES, faaReferenceDraft } from "@/logic/faaReferences";
import { documentRepository } from "./repositories/documentRepository";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";

const handles: Array<Engine | TestDatabase> = [];
afterEach(() => { handles.splice(0).forEach((db) => db.close()); });
const imported = { relativePath: "synthetic.pdf", originalFileName: "synthetic.pdf", fileSize: 123,
  pdfIdentity: { contentSha256: "a".repeat(64), totalPages: 2 } };
const draft = () => faaReferenceDraft(FAA_REFERENCES[0], "faa", "6B", imported);
const query = (db: Engine) => async (sql: string, params: import("./db").SqlValue[]) => db.query(sql, params);
async function engine(name: typeof ENGINES[number], through = 27) {
  const db = await openEngine(name); handles.push(db);
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, description TEXT, applied_at TEXT)");
  for (const migration of MIGRATIONS.filter((m) => m.version <= through)) {
    db.exec(migration.sql);
    db.run("INSERT INTO schema_migrations VALUES (?, ?, 'synthetic')", [migration.version, migration.description]);
  }
  return db;
}
async function save(db: Engine, overrides = {}) {
  const d = draft();
  return executeMaterialSave((sql) => db.exec(sql), (sql, params) => db.run(sql, params), query(db), {
    mode: "create", id: d.id, fields: d, faaReference: { ...d.faaReference, ...overrides },
  });
}

for (const name of ENGINES) describe(`FAA shelf storage: ${name}`, () => {
  it("adds only the empty table to schema 26, preserving personal notes", async () => {
    const db = await engine(name, 26);
    db.exec("INSERT INTO study_materials (id,title,notes,created_at,updated_at) VALUES ('old','My notes','Keep my words','x','x')");
    const before = db.query("SELECT * FROM study_materials");
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    await applyMigrations((sql) => db.exec(sql), new Set(MIGRATIONS.filter((m) => m.version <= 26).map((m) => m.version)));
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name).filter((t) => !tables.includes(t))).toEqual(["faa_reference_copies"]);
    expect(db.query("SELECT * FROM faa_reference_copies")).toEqual([]);
    expect(db.query("SELECT * FROM study_materials")).toEqual(before);
    const reference = await engine(name);
    await validateApplicationDatabase(query(db), query(reference));
  });

  it("refuses to replace or remove the file behind an FAA copy or picture cards, but keeps metadata edits", async () => {
    const db = await engine(name);
    await save(db);
    db.exec("INSERT INTO study_materials (id,title,file_path,created_at,updated_at) VALUES ('owner','Owner',NULL,'x','x'),('image','Panel','panel.png','x','x')");
    db.exec("INSERT INTO visual_card_regions (id,owner_material_id,image_material_id,image_sha256,image_width,image_height,x,y,w,h,rotation) VALUES ('" + "b".repeat(64) + "','owner','image','" + "c".repeat(64) + "',10,10,0,0,5,5,0)");
    const update = (id: string, fields: import("./db").MaterialSaveFields) =>
      executeMaterialSave((sql) => db.exec(sql), (sql, params) => db.run(sql, params), query(db), { mode: "update", id, fields });
    for (const [id, message] of [["faa", FAA_FILE_LOCKED], ["image", PICTURE_FILE_LOCKED]] as const) {
      await expect(update(id, { filePath: null, originalFileName: null, fileSize: null })).rejects.toThrow(message);
      await expect(update(id, { filePath: "other.pdf" })).rejects.toThrow(message);
    }
    expect(db.query("SELECT id,file_path FROM study_materials WHERE id IN ('faa','image') ORDER BY id")).toEqual([
      { id: "faa", file_path: "synthetic.pdf" }, { id: "image", file_path: "panel.png" },
    ]);
    await update("faa", { title: "My ACS", filePath: "synthetic.pdf" });
    await update("image", { notes: "Panel notes" });
    expect(db.query("SELECT title FROM study_materials WHERE id='faa'")).toEqual([{ title: "My ACS" }]);
  });

  it("commits copy details and empty notes together, and cascades deletion", async () => {
    const db = await engine(name);
    await save(db);
    expect(db.query("SELECT title,notes FROM study_materials")).toEqual([{ title: "Private Pilot Airplane ACS — 6B", notes: "" }]);
    expect(db.query("SELECT * FROM faa_reference_copies")[0]).toMatchObject({ material_id: "faa", reference_id: "private-acs", edition: "6B", content_sha256: "a".repeat(64), total_pages: 2 });
    const reference = await engine(name);
    await validateApplicationDatabase(query(db), query(reference));
    db.exec("DELETE FROM study_materials WHERE id='faa'");
    expect(db.query("SELECT * FROM faa_reference_copies")).toEqual([]);
  });

  it("rolls back the material if any copy CHECK fails", async () => {
    const db = await engine(name);
    for (const bad of [
      { contentSha256: "g".repeat(64) }, { contentSha256: "A".repeat(64) }, { contentSha256: "a".repeat(63) },
      { referenceId: "other" }, { edition: "x".repeat(201) }, { totalPages: 0 }, { totalPages: 1.5 },
    ]) {
      await expect(save(db, bad)).rejects.toThrow();
      expect(db.query("SELECT * FROM study_materials")).toEqual([]);
      expect(db.query("SELECT * FROM faa_reference_copies")).toEqual([]);
    }
    expect(() => db.run("INSERT INTO faa_reference_copies VALUES ('absent','phak','','" + "a".repeat(64) + "',1,'x')", [])).toThrow();
  });

  it("refuses a missing table, drifted CHECK/default/FK and corrupt hashes even if checks were bypassed", async () => {
    const reference = await engine(name);
    for (const change of [
      "DROP TABLE faa_reference_copies",
      "PRAGMA ignore_check_constraints=ON; INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('faa','Synthetic','x','x'); INSERT INTO faa_reference_copies VALUES ('faa','phak','','" + "g".repeat(64) + "',1,'x'); PRAGMA ignore_check_constraints=OFF",
      ...[
        ["content_sha256 NOT GLOB '*[^0-9a-f]*'", "1"],
        ["DEFAULT ''", "DEFAULT 'changed'"],
        ["ON DELETE CASCADE", "ON DELETE NO ACTION"],
      ].map(([from, to]) => "DROP TABLE faa_reference_copies; " + MIGRATIONS.at(-1)!.sql.replace(from!, to!)),
    ]) {
      const db = await engine(name);
      db.exec(change);
      await expect(validateApplicationDatabase(query(db), query(reference))).rejects.toThrow();
    }
  });

  it("refuses a newer schema", async () => {
    const db = await engine(name), reference = await engine(name);
    db.exec("INSERT INTO schema_migrations VALUES (28, 'future', 'x')");
    await expect(validateApplicationDatabase(query(db), query(reference))).rejects.toThrow(/newer/);
  });
});

it("repository reads shelf membership from the table, preserving it through personal-note edits", async () => {
  const db = await createNodeSqliteDatabase(); handles.push(db);
  const docs = documentRepository(db);
  await docs.create(draft());
  await docs.create({ id: "ordinary", title: FAA_REFERENCES[0].title, notes: "FAA reference: Private Pilot Airplane ACS" });
  await docs.update("faa", { notes: "My own notes" });
  const materials = await docs.list();
  expect(materials.find((m) => m.id === "faa")).toMatchObject({ notes: "My own notes", faaReference: draft().faaReference });
  expect(materials.find((m) => m.id === "ordinary")?.faaReference).toBeUndefined();
});

it("database byte snapshots round-trip new shelf rows; an old snapshot upgrades to an empty shelf", async () => {
  for (const through of [26, 27]) {
    const db = await engine("sql.js", through);
    if (through === 27) await save(db);
    else db.exec("INSERT INTO study_materials (id,title,notes,created_at,updated_at) VALUES ('old','Synthetic','Personal words','x','x')");
    const restored = await openSqlJsEngine(db.snapshot()); handles.push(restored);
    await applyMigrations((sql) => restored.exec(sql), new Set(MIGRATIONS.filter((m) => m.version <= through).map((m) => m.version)));
    const reference = await engine("sql.js");
    await validateApplicationDatabase(query(restored), query(reference));
    expect(restored.query("SELECT * FROM faa_reference_copies")).toEqual(through === 27 ? db.query("SELECT * FROM faa_reference_copies") : []);
    expect(restored.query("SELECT * FROM study_materials")).toEqual(db.query("SELECT * FROM study_materials"));
  }
});
