/**
 * The study-material save contract, shared with the native command.
 *
 * `src-tauri/fixtures/material-save-contract/steps.json` is replayed here
 * through the browser/test transaction and, in `documents_save_tests.rs`,
 * through the native `save_material_operation`. Both compare every returned
 * material and the rows read back afterwards with the same `expected.json`,
 * so the two implementations must agree on valid input and output. Tag ids
 * are random and are deliberately left out of the snapshot.
 *
 * Regenerate after an intentional contract change:
 *   UPDATE_MATERIAL_FIXTURES=1 npx vitest run src/data/materialSaveContract.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import type { MaterialSaveOperation } from "./db";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";

const FIXTURES = join(process.cwd(), "src-tauri", "fixtures", "material-save-contract");
const UPDATE = process.env.UPDATE_MATERIAL_FIXTURES === "1";

interface Steps {
  steps: Array<{ name: string; operation: MaterialSaveOperation }>;
}

let db: TestDatabase;
beforeEach(async () => {
  db = await createNodeSqliteDatabase();
});
afterEach(() => db.close());

async function snapshot() {
  return {
    materials: await db.select(
      `SELECT id, title, material_type, topic, review_status, priority, goal_id, event_id,
              notes, file_path, original_file_name, file_size, created_at, updated_at,
              last_reviewed_at
         FROM study_materials ORDER BY id`,
    ),
    links: await db.select(
      `SELECT mt.material_id, t.name FROM material_tags mt JOIN tags t ON t.id = mt.tag_id
        ORDER BY mt.material_id, t.name`,
    ),
    tagNames: (await db.select<{ name: string }>("SELECT name FROM tags ORDER BY name")).map(
      (row) => row.name,
    ),
  };
}

it("replays the shared material-save fixtures to the same results and rows as the native command", async () => {
  const { steps } = JSON.parse(readFileSync(join(FIXTURES, "steps.json"), "utf8")) as Steps;
  const results: Array<{ name: string; returned: unknown; after: unknown }> = [];
  for (const step of steps) {
    const returned = await db.saveMaterialAtomically!(step.operation);
    results.push({ name: step.name, returned, after: await snapshot() });
  }
  // Plain objects, so node:sqlite's null-prototype rows compare and serialize alike.
  const actual = JSON.parse(JSON.stringify({ results }));
  const path = join(FIXTURES, "expected.json");
  if (UPDATE) {
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  expect(actual).toEqual(JSON.parse(readFileSync(path, "utf8")));
});
