/**
 * The shared M3 write contract (`src-tauri/fixtures/skill-evidence/
 * operation-cases.json`) on node:sqlite and sql.js. The native suite replays
 * the same cases through `save_on_connection`; outcomes, row counts and
 * checks must be identical on all three engines.
 */
import { describe, expect, it } from "vitest";

import { SkillEvidenceError } from "./skillEvidenceTransaction";
import { ENGINES, openEngine, openStore, readFixture } from "./testing/skillEvidenceEngines";

type Step =
  | { sql: string }
  | { request: Record<string, unknown>; expect: { status: "applied" | "replayed"; result: unknown } | { code: string } };
interface OperationCase {
  name: string;
  valid?: boolean;
  steps: Step[];
  rows: Record<string, number>;
  checks: { sql: string; rows: unknown[][] }[];
}
const CONTRACT = readFixture<{ baseline: string[]; cases: OperationCase[] }>("operation-cases.json");

describe("shared skill-evidence write contract", () => {
  it("covers create, retry, conflict, stale, link, addressed, erase, resurrection, damaged replay and decoding", () => {
    const actions = new Set(
      CONTRACT.cases.flatMap((c) => c.steps.flatMap((s) => ("request" in s ? [String(s.request["action"])] : []))),
    );
    for (const action of [
      "create_custom_skill", "edit_custom_skill", "retire_skill", "restore_skill", "create_observation", "edit_observation",
      "link_action", "unlink_action", "set_addressed", "set_status", "set_confidence", "erase_observation",
    ]) {
      expect(actions).toContain(action);
    }
    const codes = new Set(CONTRACT.cases.flatMap((c) => c.steps.flatMap((s) => ("expect" in s && "code" in s.expect ? [s.expect.code] : []))));
    expect([...codes].sort()).toEqual(
      [
        "BUILTIN_READ_ONLY", "DUPLICATE_LABEL", "ERASED", "INVALID_ARGUMENT", "LIMIT_EXCEEDED", "NOT_FOUND", "OPERATION_CONFLICT",
        "SKILL_RETIRED", "SOURCE_MISSING", "STALE_REVISION", "STORAGE_FAILURE",
      ].sort(),
    );
  });

  for (const engineName of ENGINES) {
    it(`${engineName} gives every listed outcome, row count and check`, async () => {
      for (const testCase of CONTRACT.cases) {
        const engine = await openEngine(engineName);
        try {
          const store = await openStore(engine);
          for (const statement of CONTRACT.baseline) engine.exec(statement);
          for (const [index, step] of testCase.steps.entries()) {
            if ("sql" in step) {
              engine.exec(step.sql);
              continue;
            }
            const label = `${testCase.name} / step ${index + 1}`;
            const outcome = await store.act(step.request).then(
              (value) => ({ status: value.status, result: value.result }),
              (error: unknown) => {
                if (!(error instanceof SkillEvidenceError)) throw error;
                return { code: error.code };
              },
            );
            expect(outcome, label).toEqual(step.expect);
          }
          for (const [table, n] of Object.entries(testCase.rows)) {
            expect(engine.query(`SELECT COUNT(*) AS n FROM ${table}`)[0]!["n"], `${testCase.name} / ${table}`).toBe(n);
          }
          for (const check of testCase.checks) {
            const rows = engine.query(check.sql).map((r) => Object.values(r));
            expect(rows, `${testCase.name} / ${check.sql}`).toEqual(check.rows);
          }
          if (testCase.valid === false) {
            await expect(store.validate(), testCase.name).rejects.toThrow();
          } else {
            await store.validate();
          }
        } finally {
          engine.close();
        }
      }
    });
  }
});
