/**
 * Reader parity: the reads in `src-tauri/fixtures/skill-evidence/
 * read-cases.json`, over the library written by the real writer, must return
 * exactly the listed JSON on node:sqlite and sql.js here, and on rusqlite in
 * `skill_evidence_tests.rs` (cursor strings included).
 *
 * The expected outputs were produced once by the TypeScript reader
 * (`M3_PRINT_READS=<path>` writes them there) and are checked by every
 * engine since.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ENGINES, FIXTURES, migrate, openEngine, openStore, readFixture, type SkillEvidenceStore } from "./testing/skillEvidenceEngines";

type ReadCase = { kind: "page" | "summary" | "skills" | "history"; input: Record<string, unknown>; output: unknown };
const WRITER_LIBRARY = readFileSync(`${FIXTURES}/writer-populated-schema14.sql`, "utf8");

async function run(store: SkillEvidenceStore, read: Omit<ReadCase, "output">): Promise<unknown> {
  try {
    switch (read.kind) {
      case "page":
        return await store.page(read.input);
      case "summary":
        return await store.summary(String(read.input["skillId"]));
      case "skills":
        return await store.skills(read.input);
      case "history":
        return await store.history(read.input as { observationId: string });
    }
  } catch (error) {
    return { code: (error as { code?: string }).code ?? "unexpected" };
  }
}

async function writerStore(engineName: (typeof ENGINES)[number]) {
  const engine = await openEngine(engineName);
  await migrate(engine);
  engine.exec(WRITER_LIBRARY);
  return { engine, store: await openStore(engine, { migrate: false }) };
}

/** The reads, with cursors followed to the end, as the fixture lists them. */
async function plannedReads(store: SkillEvidenceStore, engine: { query(sql: string): Record<string, unknown>[] }): Promise<ReadCase[]> {
  const out: ReadCase[] = [];
  const add = async (kind: ReadCase["kind"], input: Record<string, unknown>) => {
    const output = await run(store, { kind, input });
    out.push({ kind, input, output });
    return output as { nextCursor?: string | null };
  };
  const follow = async (kind: "page" | "history", input: Record<string, unknown>) => {
    let cursor: string | null = null;
    do {
      const result = await add(kind, cursor ? { ...input, cursor } : input);
      cursor = result?.nextCursor ?? null;
    } while (cursor);
  };
  await follow("page", { limit: 1 });
  await add("page", {});
  await add("page", { attribution: "self_report" });
  await add("page", { attribution: "instructor_transcribed", limit: 50 });
  for (const row of engine.query("SELECT DISTINCT skill_id FROM skill_observations ORDER BY skill_id")) {
    await follow("page", { skillId: String(row["skill_id"]), limit: 1 });
  }
  for (const row of engine.query("SELECT DISTINCT source_journal_id FROM skill_observations ORDER BY 1")) {
    await add("page", { journalId: String(row["source_journal_id"]) });
  }
  for (const row of engine.query("SELECT id FROM skill_catalog_entries ORDER BY id")) {
    await add("summary", { skillId: String(row["id"]) });
  }
  await add("summary", { skillId: "builtin.no_such_skill" });
  await add("skills", {});
  await add("skills", { includeRetired: true });
  for (const row of engine.query("SELECT id FROM skill_observations ORDER BY id")) {
    await follow("history", { observationId: String(row["id"]), limit: 1 });
  }
  for (const row of engine.query("SELECT DISTINCT subject_id FROM skill_evidence_operations WHERE is_erased = 1 ORDER BY 1")) {
    await add("history", { observationId: String(row["subject_id"]) });
  }
  await add("page", { limit: 0 });
  await add("page", { limit: 51 });
  await add("page", { cursor: "[2,null,null,null,\"2026-10-01\",\"x\",\"y\",999]" });
  await add("page", { skillId: "builtin.normal_landing", cursor: "[2,null,null,null,\"2026-10-01\",\"x\",\"y\",0]" });
  await add("page", { cursor: "not json" });
  await add("history", { observationId: "not-a-uuid" });
  await add("history", { observationId: "20000000-0000-4000-8000-0000000000ff" });
  return out;
}

describe("skill-evidence reader parity", () => {
  const printTo = process.env["M3_PRINT_READS"];
  if (printTo) {
    it("writes the expected reads to the given path", async () => {
      const { engine, store } = await writerStore("node:sqlite");
      writeFileSync(printTo, `${JSON.stringify({ reads: await plannedReads(store, engine) }, null, 1)}\n`);
      engine.close();
    });
    return;
  }

  const fixture = readFixture<{ reads: ReadCase[] }>("read-cases.json");

  it("covers pages with followed cursors, filters, summaries, lists, history and refusals", () => {
    const kinds = new Set(fixture.reads.map((r) => r.kind));
    expect([...kinds].sort()).toEqual(["history", "page", "skills", "summary"]);
    expect(fixture.reads.some((r) => r.kind === "page" && typeof r.input["cursor"] === "string")).toBe(true);
    expect(fixture.reads.some((r) => r.kind === "history" && typeof r.input["cursor"] === "string")).toBe(true);
    expect(fixture.reads.some((r) => (r.output as { code?: string } | null)?.code === "ERASED")).toBe(true);
  });

  for (const engineName of ENGINES) {
    it(`${engineName} returns exactly the listed output for every read`, async () => {
      const { engine, store } = await writerStore(engineName);
      try {
        const actual: unknown[] = [];
        for (const read of fixture.reads) actual.push(await run(store, read));
        expect(actual).toEqual(fixture.reads.map((r) => r.output));
        // The fixture's plan is still what the library produces.
        expect((await plannedReads(store, engine)).map((r) => r.input)).toEqual(fixture.reads.map((r) => r.input));
      } finally {
        engine.close();
      }
    });
  }
});
