/**
 * OFFLINE-03b r6 — shared parity fixture, TypeScript side.
 *
 * `src/testing/practiceAuthoringVectors.json` is generated once from this
 * reference contract and asserted identically by the TypeScript runner here
 * and the native `practice_authoring_tests.rs` runner. This file only
 * asserts; it never regenerates the fixture.
 *
 * Conventions both engines share:
 * - every scenario runs on a FRESH database (all migrations applied,
 *   foreign keys on) with `mat-a` and `mat-b` pre-inserted as study
 *   materials; scenarios never depend on each other's state;
 * - an `expected` of `"$current"` is replaced by the live
 *   `readCurrentSnapshot` result of the operation's own material before the
 *   save, `"$current:mat-b"` by `mat-b`'s; a snapshot `null` substitutes as
 *   `null` (that is what restore-after-removal sends);
 * - `current` summarizes the material's snapshot after the step:
 *   `versionNumber`, `contentHash` = `practiceContentHash(questions)`,
 *   `questionCount`, `origins` aligned to `ordinal` with `null` where a
 *   question carries no origin, and `retiredCount` = ledger length;
 * - `expect` is either `{status, current}` or `{error: "<CODE>"}`; codes
 *   come from `PracticeAuthoringError.code`;
 * - hash-vector `questions` are hashed directly by `practiceContentHash`
 *   (identity/replaces never join; `origin` joins only when present), so a
 *   vector may omit `identity` entirely;
 * - server-owned ids and timestamps are deliberately NOT asserted — they
 *   differ per engine by design.
 */
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import type { PracticeAuthoringQuestion, PracticeSaveOperation } from "@/domain/types";

import { practiceContentHash, readCurrentSnapshot } from "./practiceAuthoring";
import { computeCanonicalHash, type Query } from "./practiceSessionTransaction";
import { PracticeAuthoringError } from "./persistenceErrors";
import type { TestDatabase } from "./testing/nodeSqliteDb";
import { createNodeSqliteDatabase } from "./testing/nodeSqliteDb";

const STAMP = "2026-10-20T02:00:00.000Z";

interface CurrentSummary {
  versionNumber: number;
  contentHash: string;
  questionCount: number;
  origins: (string | null)[];
  retiredCount: number;
}

interface ParityFixture {
  hashVectors: { name: string; questions: Record<string, unknown>[]; contentHash: string }[];
  scenarios: {
    name: string;
    steps: {
      operation: Record<string, unknown>;
      expect: { status?: string; current?: CurrentSummary | null; error?: string };
    }[];
  }[];
}

const fixturePath = new URL("../testing/practiceAuthoringVectors.json", import.meta.url);
const fixture: ParityFixture = JSON.parse(readFileSync(fixturePath, "utf8"));

let openDb: TestDatabase | undefined;

afterEach(() => {
  openDb?.close();
  openDb = undefined;
});

async function seededDatabase(): Promise<TestDatabase> {
  const db = await createNodeSqliteDatabase();
  openDb = db;
  for (const [id, title] of [
    ["mat-a", "Parity material A"],
    ["mat-b", "Parity material B"],
  ] as const) {
    await db.execute("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", [id, title, STAMP, STAMP]);
  }
  return db;
}

const queryOf = (db: TestDatabase): Query => (sql, params) => db.select(sql, params);

async function currentSummary(query: Query, materialId: string): Promise<CurrentSummary | null> {
  const current = await readCurrentSnapshot(query, materialId);
  if (!current) return null;
  return {
    versionNumber: current.versionNumber,
    contentHash: await practiceContentHash(current.questions),
    questionCount: current.questions.length,
    origins: current.questions.map((item) => item.origin ?? null),
    retiredCount: current.retired.length,
  };
}

describe("shared parity fixture — surface", () => {
  it("carries at least six hash vectors and fourteen scenarios", () => {
    expect(fixture.hashVectors.length).toBeGreaterThanOrEqual(6);
    expect(fixture.scenarios.length).toBeGreaterThanOrEqual(14);
    expect(new Set(fixture.scenarios.map((scenario) => scenario.name)).size).toBe(fixture.scenarios.length);
    for (const vector of fixture.hashVectors) {
      expect(vector.name).toBeTruthy();
      expect(vector.questions.length).toBeGreaterThan(0);
      expect(vector.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const scenario of fixture.scenarios) {
      expect(scenario.steps.length).toBeGreaterThan(0);
      for (const step of scenario.steps) {
        const shape = Object.keys(step.expect).sort().join(",");
        expect(shape === "current,status" || shape === "error").toBe(true);
      }
    }
  });
});

describe("shared parity fixture — hash vectors", () => {
  it("every vector hashes exactly as stored, legacy sets byte-identically", async () => {
    const mismatches: string[] = [];
    for (const vector of fixture.hashVectors) {
      const computed = await practiceContentHash(vector.questions as unknown as readonly PracticeAuthoringQuestion[]);
      if (computed !== vector.contentHash) mismatches.push(`${vector.name}: computed ${computed} != stored ${vector.contentHash}`);
      const originless = vector.questions.every((item) => !("origin" in item));
      if (originless) {
        const fiveFields = vector.questions.map(({ question, options, correctIndex, explanation, sourcePage }) => ({
          question,
          options,
          correctIndex,
          explanation,
          sourcePage,
        }));
        const legacy = await computeCanonicalHash(fiveFields);
        if (legacy !== vector.contentHash) mismatches.push(`${vector.name}: legacy five-field hash ${legacy} != stored ${vector.contentHash}`);
      }
    }
    const present = fixture.hashVectors.find((vector) => vector.name === "identity-and-replaces-present");
    const removed = fixture.hashVectors.find((vector) => vector.name === "identity-and-replaces-removed");
    if (!present || !removed) {
      mismatches.push("identity-and-replaces pair missing from the fixture");
    } else if (present.contentHash !== removed.contentHash) {
      mismatches.push("identity/replaces pair hashes differ — they must never join the canonical hash");
    }
    expect(mismatches).toEqual([]);
  });
});

describe("shared parity fixture — scenarios", () => {
  for (const scenario of fixture.scenarios) {
    it(`scenario ${scenario.name}`, async () => {
      const db = await seededDatabase();
      const query = queryOf(db);
      const mismatches: string[] = [];
      for (const [index, step] of scenario.steps.entries()) {
        const label = `${scenario.name} step ${index + 1} (${String(step.operation.reason)} ${String(step.operation.operationId).slice(-4)})`;
        const raw = step.operation.expected;
        const materialId = String(step.operation.sourceMaterialId);
        const expected =
          raw === "$current"
            ? await readCurrentSnapshot(query, materialId)
            : typeof raw === "string" && raw.startsWith("$current:")
              ? await readCurrentSnapshot(query, raw.slice("$current:".length))
              : raw;
        // The fixture is data, not a typed literal; executePracticeAuthoring
        // decodes this exact-key shape at runtime and that decode is the
        // contract under parity — the reference engine stays authoritative.
        const operation = { ...step.operation, expected } as unknown as PracticeSaveOperation;
        let actual: Record<string, unknown>;
        try {
          const result = await db.savePracticeAuthoringAtomically!(operation);
          actual = { status: result.status, current: await currentSummary(query, materialId) };
        } catch (error) {
          actual =
            error instanceof PracticeAuthoringError
              ? { error: error.code }
              : { error: `non-authoring throw: ${String(error)}` };
        }
        try {
          expect(actual).toEqual(step.expect);
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : String(failure);
          mismatches.push(`${label}: expected ${JSON.stringify(step.expect)}, TS gave ${JSON.stringify(actual)} — ${message}`);
        }
      }
      expect(mismatches).toEqual([]);
    });
  }
});
