import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMigrations, MIGRATIONS } from "./migrations";
import { validateKitQueue } from "./practiceStateValidation";
import { createNodeSqliteDatabase } from "./testing/nodeSqliteDb";
import { openNodeEngine } from "./testing/skillEvidenceEngines";
import { createRepositories } from "./repositories";
import type { Queue } from "@/state/kitQueueLogic";

describe("kit queue schema 36", () => {
  it("registers the same migration on desktop and browser, with a recorded checksum", () => {
    expect(MIGRATIONS.find((m) => m.version === 36)).toMatchObject({ version: 36, description: "kit_queue" });
    const native = readFileSync("src-tauri/src/lib.rs", "utf8");
    expect(native).toMatch(/version: 36,\s+description: "kit_queue",\s+sql: include_str!\("\.\.\/migrations\/0036_kit_queue.sql"\)/);
    expect(native).toMatch(new RegExp(`CURRENT_SCHEMA_VERSION: i64 = ${MIGRATIONS.length}`));
    expect(JSON.parse(readFileSync("src/data/migration-checksums.json", "utf8"))["0036_kit_queue.sql"]).toMatch(/^[0-9a-f]{64}$/);
  });
  it("holds ids, checksums and status only: no key, answer or page text column", async () => {
    const engine = await openNodeEngine();
    try {
      await applyMigrations((sql) => engine.exec(sql), new Set());
      const columns = (table: string) => engine.query(`SELECT name FROM pragma_table_info('${table}')`).map((r) => (r as { name: string }).name);
      expect(columns("kit_queue")).toEqual(["id", "provider", "created_at", "state", "consent_at"]);
      expect(columns("kit_queue_item")).toEqual(["queue_id", "position", "material_id", "source_sha256", "status", "request_id", "job_id", "updated_at"]);
    } finally { engine.close(); }
  });
  it("is not part of the sync ledger", () => {
    for (const file of ["src-tauri/src/sync/tables.rs", "src-tauri/src/sync/apply.rs"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/kit_queue/);
    }
  });
  it("refuses a missing or changed table", async () => {
    const uncheckedQueue = `DROP TABLE kit_queue_item; DROP TABLE kit_queue;
      CREATE TABLE kit_queue (id TEXT PRIMARY KEY, provider TEXT NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL, consent_at TEXT);
      CREATE UNIQUE INDEX kit_queue_one_open ON kit_queue ((1)) WHERE state IN ('active', 'paused');
      CREATE TABLE kit_queue_item (queue_id TEXT NOT NULL REFERENCES kit_queue(id) ON DELETE CASCADE, position INTEGER NOT NULL,
        material_id TEXT NOT NULL, source_sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('waiting', 'running', 'checkpointed', 'saved', 'partial', 'unclear', 'skipped', 'failed')),
        request_id TEXT, job_id TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (queue_id, position));`;
    const uncheckedItem = `DROP TABLE kit_queue_item;
      CREATE TABLE kit_queue_item (queue_id TEXT NOT NULL REFERENCES kit_queue(id) ON DELETE CASCADE, position INTEGER NOT NULL,
        material_id TEXT NOT NULL, source_sha256 TEXT NOT NULL, status TEXT NOT NULL,
        request_id TEXT, job_id TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (queue_id, position));`;
    for (const damage of ["DROP TABLE kit_queue_item", "ALTER TABLE kit_queue DROP COLUMN consent_at", uncheckedQueue, uncheckedItem, "DROP INDEX kit_queue_one_open"]) {
      const reference = await openNodeEngine();
      const damaged = await openNodeEngine();
      try {
        await applyMigrations((sql) => reference.exec(sql), new Set());
        await applyMigrations((sql) => damaged.exec(sql), new Set());
        const query = async (sql: string, params: Parameters<typeof damaged.query>[1]) => damaged.query(sql, params);
        const ref = async (sql: string, params: Parameters<typeof reference.query>[1]) => reference.query(sql, params);
        await validateKitQueue(query, ref);
        damaged.exec(damage);
        await expect(validateKitQueue(query, ref)).rejects.toThrow();
      } finally { reference.close(); damaged.close(); }
    }
  });
  it("upgrades schema 35 without touching existing materials", async () => {
    const engine = await openNodeEngine();
    try {
      await applyMigrations((sql) => engine.exec(sql), new Set([36]));
      engine.exec("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m','Synthetic','now','now')");
      const before = engine.query("SELECT * FROM study_materials");
      await applyMigrations((sql) => engine.exec(sql), new Set(MIGRATIONS.filter((m) => m.version <= 35).map((m) => m.version)));
      expect(engine.query("SELECT * FROM study_materials")).toEqual(before);
      expect(engine.query("SELECT * FROM kit_queue")).toEqual([]);
      expect(engine.query("SELECT * FROM kit_queue_item")).toEqual([]);
    } finally { engine.close(); }
  });
});

describe("kit queue repository", () => {
  const queue = (state: Queue["state"], id = "q1"): Queue => ({
    id, provider: "Google", createdAt: "2026-11-07T10:00:00.000Z", state, consentAt: "2026-11-07T10:00:00.000Z",
    items: [0, 1].map((position) => ({ position, materialId: `m${position}`, sourceSha256: "a".repeat(64), status: "waiting" as const, requestId: null, jobId: null, updatedAt: "t" })),
  });
  it("saves, updates, finds the open queue and removes it", async () => {
    const db = await createNodeSqliteDatabase();
    try {
      const repo = createRepositories(db).kitQueue;
      expect(await repo.findOpen()).toBeNull();
      await repo.save(queue("active"));
      const loaded = await repo.findOpen();
      expect(loaded?.items).toHaveLength(2);
      expect(loaded?.state).toBe("active");
      const changed = { ...queue("paused"), items: queue("paused").items.map((i) => i.position === 0 ? { ...i, status: "running" as const, requestId: "req-1" } : i) };
      await repo.save(changed);
      const again = await repo.findOpen();
      expect(again?.state).toBe("paused");
      expect(again?.items[0]).toMatchObject({ status: "running", requestId: "req-1" });
      await repo.save(queue("done"));
      expect(await repo.findOpen()).toBeNull();
      expect((await repo.latest())?.state).toBe("done");
      await repo.remove("q1");
      expect(await repo.latest()).toBeNull();
      expect(await db.select("SELECT * FROM kit_queue_item", [])).toEqual([]);
    } finally { db.close(); }
  });
  it("claims the one open queue atomically: a racing second claim and a second open row are refused", async () => {
    const db = await createNodeSqliteDatabase();
    try {
      const repo = createRepositories(db).kitQueue;
      const results = await Promise.all([repo.claim(queue("active", "qa")), repo.claim(queue("active", "qb"))]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await db.select("SELECT id FROM kit_queue WHERE state IN ('active', 'paused')", [])).toHaveLength(1);
      // Even a write that skips the claim cannot open a second queue.
      await expect(db.execute("INSERT INTO kit_queue (id, provider, created_at, state) VALUES ('qc', 'Google', 'now', 'paused')", [])).rejects.toThrow();
      expect((await repo.findOpen())?.items).toHaveLength(2);
      // Once it ends, a new queue may be claimed.
      const winner = (await repo.findOpen())!;
      await repo.save({ ...winner, state: "done" });
      expect(await repo.claim(queue("active", "qd"))).toBe(true);
    } finally { db.close(); }
  });
  it("refuses a status outside the list", async () => {
    const db = await createNodeSqliteDatabase();
    try {
      const repo = createRepositories(db).kitQueue;
      await expect(repo.save({ ...queue("active"), items: [{ ...queue("active").items[0]!, status: "bogus" as never }] })).rejects.toThrow();
    } finally { db.close(); }
  });
});
