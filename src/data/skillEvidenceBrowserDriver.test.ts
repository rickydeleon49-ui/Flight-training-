/**
 * Browser mode (the real sql.js driver over browser storage): skill-evidence
 * writes are durable only once stored, a storage refusal leaves the stored
 * bytes and every table as they were (receipt included), the same request
 * then saves afresh, reads are owned like every other call, and a reopened
 * library validates with the evidence intact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import { StorageDurabilityError } from "./persistenceErrors";
import { createRepositories } from "./repositories";
import { createSqlJsDatabase } from "./sqlJsDb";
import { SkillEvidenceError } from "./skillEvidenceTransaction";

const STORAGE_KEY = "her-flight-deck.dev-database";
let stored: Map<string, string>;
let storageFails: boolean;

beforeEach(() => {
  stored = new Map();
  storageFails = false;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storageFails) throw new Error("synthetic quota failure");
      stored.set(key, value);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const request = (journalId: string) => ({
  action: "create_observation" as const,
  operationId: "10000000-0000-4000-8000-000000000001",
  observationId: "20000000-0000-4000-8000-000000000001",
  skillId: "builtin.normal_landing",
  journalId,
  sourceField: "none" as const,
  wording: "Flare a little later.",
  observedOn: "2026-10-01",
  attribution: "self_report" as const,
  instructorName: "",
});

const count = async (db: Awaited<ReturnType<typeof createSqlJsDatabase>>, table: string) =>
  Number((await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]!.n);

describe("skill evidence in browser mode (sql.js)", () => {
  it("a storage refusal restores the stored bytes and every table; the same request then saves once", async () => {
    const db = await createSqlJsDatabase();
    const repos = createRepositories(db);
    expect(repos.skillEvidence.supported()).toBe(true);
    await db.execute("INSERT INTO journal_entries (id, date, title, created_at, updated_at) VALUES ('j1', '2026-10-01', 'Pattern work', 'x', 'x')");
    const before = stored.get(STORAGE_KEY);
    storageFails = true;
    await expect(repos.skillEvidence.act(request("j1"))).rejects.toBeInstanceOf(StorageDurabilityError);
    expect(stored.get(STORAGE_KEY)).toBe(before);
    for (const table of ["skill_observations", "skill_observation_revisions", "skill_evidence_operations"]) {
      expect(await count(db, table)).toBe(0);
    }
    storageFails = false;
    expect(await repos.skillEvidence.act(request("j1"))).toMatchObject({ status: "applied" });
    expect(await repos.skillEvidence.act(request("j1"))).toMatchObject({ status: "replayed" });
    expect(await count(db, "skill_observations")).toBe(1);

    // A refusal inside the transaction restores the stored state too.
    const storedNow = stored.get(STORAGE_KEY);
    await expect(repos.skillEvidence.act({ ...request("missing"), operationId: "10000000-0000-4000-8000-000000000002", observationId: "20000000-0000-4000-8000-000000000002" })).rejects.toMatchObject({ code: "SOURCE_MISSING" });
    expect(stored.get(STORAGE_KEY)).toBe(storedNow);

    const page = await repos.skillEvidence.page({ skillId: "builtin.normal_landing" });
    expect(page.items.map((i) => i.wording)).toEqual(["Flare a little later."]);
    expect((await repos.skillEvidence.summary("builtin.normal_landing"))?.observationCount).toBe(1);
    expect(await repos.skillEvidence.skills()).toHaveLength(15);
    expect((await repos.skillEvidence.history({ observationId: request("j1").observationId })).currentRevision).toBe(1);

    // Reopened from storage: validated on open, evidence intact.
    const reopened = createRepositories(await createSqlJsDatabase());
    expect((await reopened.skillEvidence.page({})).items).toHaveLength(1);
  });

  it("a driver without the methods refuses writes and reads with a clear message", async () => {
    const repo = createRepositories({ select: async () => [], execute: async () => undefined }).skillEvidence;
    expect(repo.supported()).toBe(false);
    expect(() => repo.act(request("j1"))).toThrow(SkillEvidenceError);
    expect(() => repo.page({})).toThrow(/isn't available with this storage/);
  });
});
