/**
 * M2 split lineage on the browser/test drivers (node:sqlite): materials carry
 * their recorded lineage, the drivers that cannot split refuse to save a
 * split, and a populated schema-12 library upgrades to 13 with every practice
 * and card record untouched. Disposable databases; every value is synthetic.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CardItemAction } from "@/domain/types";

import type { SqlDatabase } from "./db";
import { MIGRATIONS } from "./migrations";
import { createRepositories } from "./repositories";
import { SplitNeedsDesktopError } from "./repositories/documentRepository";
import { seedPracticeTest } from "./testing/practiceTestFixtures";
import { practiceSessionRepository } from "./repositories/practiceSessionRepository";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";

const T0 = "2026-10-08T12:00:00.000Z";
const H = "c".repeat(64);
const opened: TestDatabase[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fresh(path?: string): Promise<TestDatabase> {
  const db = await createNodeSqliteDatabase(path);
  opened.push(db);
  return db;
}

async function insertMaterial(db: SqlDatabase, id: string) {
  await db.execute(
    "INSERT INTO study_materials (id, title, file_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [id, `Synthetic ${id}`, `${id}.pdf`, T0, T0],
  );
}

describe("materials carry their recorded lineage", () => {
  it("attaches a split part's lineage and leaves other materials with none", async () => {
    const db = await fresh();
    for (const id of ["R", "A", "plain"]) await insertMaterial(db, id);
    await db.execute(
      `INSERT INTO material_split_lineage (material_id, parent_material_id, root_material_id,
         source_page_start, source_page_end, child_page_count, source_file_name, source_title,
         source_content_sha256, source_total_pages, nested_level, created_at)
       VALUES ('A', NULL, 'R', 101, 300, 200, 'root.pdf', 'Synthetic R', ?, 400, 1, ?)`,
      [H, T0],
    );
    const materials = await createRepositories(db).documents.list();
    const a = materials.find((m) => m.id === "A")!;
    expect(a.lineage).toMatchObject({
      rootMaterialId: "R",
      parentMaterialId: null,
      sourcePageStart: 101,
      sourcePageEnd: 300,
      childPageCount: 200,
      sourceContentSha256: H,
      sourceTotalPages: 400,
      parentPageStart: null,
      nestedLevel: 1,
    });
    expect(materials.find((m) => m.id === "plain")!.lineage).toBeNull();
  });
});

describe("drivers that cannot split PDFs", () => {
  it("refuse to save, cancel or read back a split, and cannot fingerprint", async () => {
    const documents = createRepositories(await fresh()).documents;
    const receipt = { core: {}, receiptHash: H, operationId: H } as never;
    await expect(documents.saveSplitBatch(receipt, [])).rejects.toBeInstanceOf(SplitNeedsDesktopError);
    await expect(documents.cancelSplitBatch(H)).rejects.toBeInstanceOf(SplitNeedsDesktopError);
    await expect(documents.reconcileSplitBatch(H)).rejects.toBeInstanceOf(SplitNeedsDesktopError);
    await expect(documents.fingerprintDocuments(["a.pdf"])).resolves.toBeNull();
  });
});

describe("upgrading a populated schema-12 library", () => {
  it("adds the lineage tables and changes no practice or card record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lineage-upgrade-"));
    dirs.push(dir);
    const path = join(dir, "library.db");
    const db = await fresh(path);

    // Practice history: a saved test and an attempt with an answer.
    await insertMaterial(db, "mat");
    await seedPracticeTest(db, {
      sourceMaterialId: "mat",
      title: "Synthetic",
      questions: [{ question: "Synthetic", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null }],
      model: "synthetic",
    });
    const practice = practiceSessionRepository(db);
    const active = (await practice.getActiveVersion("mat"))!;
    const started = await practice.saveSessionAction({
      action: "start_or_resume", operationId: crypto.randomUUID(), materialId: "mat", versionId: active.version.id,
    });
    await practice.saveSessionAction({
      action: "record_response", operationId: crypto.randomUUID(), attemptId: started.attemptId,
      itemId: active.items[0]!.id, expectedRevision: 0, selectedIndex: 1, isDontKnow: false,
    });

    // Card history: a rated card.
    await db.execute(
      `INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes,
         provider, model, generated_at, updated_at)
       VALUES ('mat', 'Synthetic', '', '[]', ?, '', 'import', '', ?, ?)`,
      [JSON.stringify([{ front: "Synthetic front", back: "Synthetic back", sourcePage: null }]), T0, T0],
    );
    const reviews = createRepositories(db).cardReviews;
    const snap = await reviews.getCardReviewSnapshot("mat");
    if (snap.current.status !== "ok") throw new Error("no cards");
    await reviews.saveAction({
      action: "rate", rating: "good", operationId: crypto.randomUUID(), materialId: "mat",
      versionContentHash: snap.current.contentHash, itemId: snap.current.items[0]!.itemId,
      expectedGeneration: snap.generation, expectedRevision: 0,
    } as CardItemAction);

    const historyTables = [
      "practice_test_versions", "practice_test_items", "practice_attempts", "practice_responses",
      "card_versions", "card_items", "card_review_state", "card_review_events", "study_materials",
    ];
    const snapshot = async (handle: SqlDatabase) => {
      const out: Record<string, unknown[]> = {};
      for (const table of historyTables) out[table] = await handle.select(`SELECT * FROM ${table} ORDER BY rowid`);
      return out;
    };
    const before = await snapshot(db);
    expect(before.practice_responses).toHaveLength(1);
    expect(before.card_review_events).toHaveLength(1);

    // Turn it back into the schema-12 library it would have been.
    await db.execute("DROP TABLE split_operation_log");
    await db.execute("DROP TABLE material_split_lineage");
    await db.execute("DELETE FROM schema_migrations WHERE version = 13");
    opened.splice(opened.indexOf(db), 1);
    db.close();

    const upgraded = await fresh(path);
    expect(await upgraded.select("SELECT MAX(version) AS v FROM schema_migrations")).toEqual([
      { v: MIGRATIONS.at(-1)!.version },
    ]);
    expect(MIGRATIONS.at(-1)!.version).toBe(21);
    expect(await snapshot(upgraded)).toEqual(before);
    expect(await upgraded.select("SELECT COUNT(*) AS n FROM material_split_lineage")).toEqual([{ n: 0 }]);
    expect(await upgraded.select("SELECT COUNT(*) AS n FROM split_operation_log")).toEqual([{ n: 0 }]);
    const materials = await createRepositories(upgraded).documents.list();
    expect(materials.every((m) => m.lineage === null)).toBe(true);
  });
});
