import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMigrations, MIGRATIONS } from "./migrations";
import { validateLibraryFolders } from "./practiceStateValidation";
import { openNodeEngine } from "./testing/skillEvidenceEngines";

describe("library folders schema 38", () => {
  it("registers the same additive migration on desktop and browser", () => {
    expect(MIGRATIONS.find((m) => m.version === 38)).toMatchObject({
      version: 38,
      description: "library_folders",
    });
    const native = readFileSync("src-tauri/src/lib.rs", "utf8");
    expect(native).toMatch(new RegExp(`CURRENT_SCHEMA_VERSION: i64 = ${MIGRATIONS.length}`));
    expect(native).toMatch(
      /version: 38,\s+description: "library_folders",\s+sql: include_str!\("\.\.\/migrations\/0038_library_folders\.sql"\)/,
    );
    expect(MIGRATIONS).toHaveLength(38);
  });

  it("deleting a material cascades and removes its placement row", async () => {
    const engine = await openNodeEngine();
    try {
      await applyMigrations((sql) => engine.exec(sql), new Set());
      engine.exec("PRAGMA foreign_keys = ON");
      engine.exec(
        "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat-1', 'Weather Flying', '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z')",
      );
      engine.exec(
        "INSERT INTO library_folders (id, name, position, created_at, updated_at) VALUES ('folder-1', 'Weather', 1, '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z')",
      );
      engine.exec(
        "INSERT INTO library_placements (material_id, folder_id, position, updated_at) VALUES ('mat-1', 'folder-1', 1, '2026-11-09T00:00:00Z')",
      );

      expect(engine.query("SELECT * FROM library_placements")).toEqual([
        {
          material_id: "mat-1",
          folder_id: "folder-1",
          position: 1,
          updated_at: "2026-11-09T00:00:00Z",
        },
      ]);

      engine.exec("DELETE FROM study_materials WHERE id = 'mat-1'");
      expect(engine.query("SELECT * FROM library_placements")).toEqual([]);
      expect(engine.query("SELECT * FROM library_folders")).toHaveLength(1);
    } finally {
      engine.close();
    }
  });

  it("deleting a folder leaves the placement row (no FK) and the material intact", async () => {
    const engine = await openNodeEngine();
    try {
      await applyMigrations((sql) => engine.exec(sql), new Set());
      engine.exec("PRAGMA foreign_keys = ON");
      engine.exec(
        "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat-1', 'Weather Flying', '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z')",
      );
      engine.exec(
        "INSERT INTO library_folders (id, name, position, created_at, updated_at) VALUES ('folder-1', 'Weather', 1, '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z')",
      );
      engine.exec(
        "INSERT INTO library_placements (material_id, folder_id, position, updated_at) VALUES ('mat-1', 'folder-1', 1, '2026-11-09T00:00:00Z')",
      );

      engine.exec("DELETE FROM library_folders WHERE id = 'folder-1'");
      expect(engine.query("SELECT * FROM library_folders")).toEqual([]);
      expect(engine.query("SELECT * FROM library_placements")).toEqual([
        {
          material_id: "mat-1",
          folder_id: "folder-1",
          position: 1,
          updated_at: "2026-11-09T00:00:00Z",
        },
      ]);
      expect(engine.query("SELECT id FROM study_materials")).toEqual([{ id: "mat-1" }]);
    } finally {
      engine.close();
    }
  });

  it("refuses empty name or name longer than 40 characters after trim", async () => {
    const engine = await openNodeEngine();
    try {
      await applyMigrations((sql) => engine.exec(sql), new Set());
      // Valid name 1 char
      engine.exec(
        "INSERT INTO library_folders (id, name, position, created_at, updated_at) VALUES ('f1', 'A', 1, 'now', 'now')",
      );
      // Valid name 40 chars
      engine.exec(
        `INSERT INTO library_folders (id, name, position, created_at, updated_at) VALUES ('f2', '${"x".repeat(40)}', 2, 'now', 'now')`,
      );

      // Empty string
      expect(() =>
        engine.exec(
          "INSERT INTO library_folders (id, name, position, created_at, updated_at) VALUES ('f3', '', 3, 'now', 'now')",
        ),
      ).toThrow();

      // Only spaces (trimmed length 0)
      expect(() =>
        engine.exec(
          "INSERT INTO library_folders (id, name, position, created_at, updated_at) VALUES ('f4', '   ', 4, 'now', 'now')",
        ),
      ).toThrow();

      // 41 characters
      expect(() =>
        engine.exec(
          `INSERT INTO library_folders (id, name, position, created_at, updated_at) VALUES ('f5', '${"x".repeat(41)}', 5, 'now', 'now')`,
        ),
      ).toThrow();

      // 41 characters after trim
      expect(() =>
        engine.exec(
          `INSERT INTO library_folders (id, name, position, created_at, updated_at) VALUES ('f6', '  ${"x".repeat(41)}  ', 6, 'now', 'now')`,
        ),
      ).toThrow();
    } finally {
      engine.close();
    }
  });

  it("upgrading a DB that has a material at version 37 keeps the material and gives empty folder tables", async () => {
    const engine = await openNodeEngine();
    try {
      await applyMigrations(
        (sql) => engine.exec(sql),
        new Set([38]),
      );
      engine.exec(
        "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat-prev', 'Previous Book', 'now', 'now')",
      );
      const before = engine.query("SELECT * FROM study_materials");

      await applyMigrations(
        (sql) => engine.exec(sql),
        new Set(MIGRATIONS.filter((m) => m.version <= 37).map((m) => m.version)),
      );

      expect(engine.query("SELECT * FROM study_materials")).toEqual(before);
      expect(engine.query("SELECT * FROM library_folders")).toEqual([]);
      expect(engine.query("SELECT * FROM library_placements")).toEqual([]);
    } finally {
      engine.close();
    }
  });

  it.each([
    "DROP TABLE library_folders",
    "DROP TABLE library_placements",
    "DROP INDEX idx_library_placements_folder",
    "ALTER TABLE library_folders DROP COLUMN position",
    "ALTER TABLE library_placements DROP COLUMN position",
    `DROP TABLE library_placements;
     CREATE TABLE library_placements (
       material_id TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id),
       folder_id TEXT,
       position INTEGER,
       updated_at TEXT NOT NULL
     );
     CREATE INDEX idx_library_placements_folder ON library_placements(folder_id);`,
    `DROP TABLE library_placements;
     DROP TABLE library_folders;
     CREATE TABLE library_folders (
       id TEXT PRIMARY KEY NOT NULL,
       name TEXT NOT NULL,
       position INTEGER NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     );
     CREATE TABLE library_placements (
       material_id TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
       folder_id TEXT,
       position INTEGER,
       updated_at TEXT NOT NULL
     );
     CREATE INDEX idx_library_placements_folder ON library_placements(folder_id);`,
  ])("refuses schema damage: %s", async (damage) => {
    const reference = await openNodeEngine();
    const damaged = await openNodeEngine();
    try {
      await applyMigrations((sql) => reference.exec(sql), new Set());
      await applyMigrations((sql) => damaged.exec(sql), new Set());
      const query = async (sql: string, params: Parameters<typeof damaged.query>[1]) => damaged.query(sql, params);
      const ref = async (sql: string, params: Parameters<typeof reference.query>[1]) => reference.query(sql, params);
      await validateLibraryFolders(query, ref);
      damaged.exec(damage);
      await expect(validateLibraryFolders(query, ref)).rejects.toThrow();
    } finally {
      reference.close();
      damaged.close();
    }
  });
});
