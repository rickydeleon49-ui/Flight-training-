import { describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import {
  appliedVersions,
  migrate,
  openEngine,
  storeWithDebrief,
  type EngineName,
} from "./skillEvidenceEngines";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

describe("skillEvidence test harness schema regression", () => {
  const engineNames: EngineName[] = ["node:sqlite", "sql.js"];

  for (const engineName of engineNames) {
    it(`storeWithDebrief on ${engineName} has current schema, school_name column, and usable store`, async () => {
      const { engine, store, journalId } = await storeWithDebrief(engineName);
      try {
        const versions = appliedVersions(engine);
        const latestMigration = MIGRATIONS.at(-1)!.version;
        const maxVersion = Math.max(...versions);
        expect(maxVersion).toBe(latestMigration);

        // Verify school_name column exists in table info
        const columns = engine.query("PRAGMA table_info(journal_entries)");
        const schoolCol = columns.find((c) => c.name === "school_name");
        expect(schoolCol).toBeDefined();

        // Verify real saved debrief row has null school_name
        const rows = engine.query("SELECT id, school_name FROM journal_entries WHERE id = ?", [journalId]);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.id).toBe(journalId);
        expect(rows[0]?.school_name).toBeNull();

        // Verify store remains usable
        const page = await store.page();
        expect(page).toBeDefined();
        expect(page.items).toEqual([]);
        expect(page.nextCursor).toBeNull();
      } finally {
        engine.close();
      }
    });

    it(`plain historical migrate(engine) on ${engineName} still stops at 14 without school_name`, async () => {
      const engine = await openEngine(engineName);
      try {
        await migrate(engine);
        const versions = appliedVersions(engine);
        const maxVersion = Math.max(...versions);
        expect(maxVersion).toBe(14);
        expect(versions.has(14)).toBe(true);
        expect(versions.has(22)).toBe(false);

        const columns = engine.query("PRAGMA table_info(journal_entries)");
        const schoolCol = columns.find((c) => c.name === "school_name");
        expect(schoolCol).toBeUndefined();
      } finally {
        engine.close();
      }
    });
  }
});
