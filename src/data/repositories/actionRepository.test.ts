import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories, type Repositories } from "./index";

let db: TestDatabase;
let repos: Repositories;

beforeEach(async () => {
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
});

afterEach(() => db.close());

describe("action repository bound actions", () => {
  it("bound_action_refusal_message_is_plain", async () => {
    const assignmentId = crypto.randomUUID();
    const now = new Date().toISOString();

    const action = await repos.actions.create({
      title: "Weather homework",
      category: "prepare",
      dueDate: "2026-10-22",
      estimatedMinutes: 30,
    });
    const actionId = action.id;

    await db.execute(
      `INSERT INTO homework_assignments (id, title, instructions, action_id, state, revision, created_at, updated_at)
       VALUES (?, 'Weather assignment', '', ?, 'upcoming', 1, ?, ?)`,
      [assignmentId, actionId, now, now],
    );

    const PLAIN_MSG = "This comes from your homework. Open the homework to change it.";

    await expect(repos.actions.complete(actionId)).rejects.toThrow(PLAIN_MSG);
    await expect(repos.actions.update(actionId, { dueDate: "2026-10-25" })).rejects.toThrow(PLAIN_MSG);
    await expect(repos.actions.update(actionId, { status: "completed" })).rejects.toThrow(PLAIN_MSG);
    await expect(repos.actions.remove(actionId)).rejects.toThrow(PLAIN_MSG);
  });
});
