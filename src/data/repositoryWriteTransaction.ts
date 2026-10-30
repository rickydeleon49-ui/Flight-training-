import type { FundGoal } from "@/domain/types";
import type { SqlValue } from "./db";

type Run = (sql: string, params: SqlValue[]) => void | Promise<void>;
type Query = (sql: string, params: SqlValue[]) => Record<string, unknown>[] | Promise<Record<string, unknown>[]>;
export type MaterialLinkKind = "journal" | "schedule";

/** Called only while the driver owns its single connection. Native twin: repository_writes.rs. */
export async function replaceMaterialLinks(
  exec: (sql: string) => void,
  run: Run,
  kind: MaterialLinkKind,
  id: string,
  materialIds: string[],
): Promise<void> {
  const [table, column] = kind === "journal" ? ["journal_materials", "journal_id"] : ["event_materials", "event_id"];
  exec("BEGIN IMMEDIATE");
  try {
    await run(`DELETE FROM ${table} WHERE ${column} = ?`, [id]);
    for (const materialId of materialIds) {
      await run(`INSERT INTO ${table} (${column}, material_id) VALUES (?, ?)`, [id, materialId]);
    }
    exec("COMMIT");
  } catch (error) {
    exec("ROLLBACK");
    throw error;
  }
}

export async function createFundGoal(
  exec: (sql: string) => void,
  run: Run,
  query: Query,
  goal: FundGoal,
): Promise<void> {
  if (!goal.active) throw new Error("The new savings target must be active.");
  exec("BEGIN IMMEDIATE");
  try {
    const [existing] = await query("SELECT * FROM fund_goals WHERE id = ?", [goal.id]);
    if (existing) {
      // A replay must never retire a goal created after this operation.
      if (existing.title !== goal.title || Number(existing.target) !== goal.target || existing.created_at !== goal.createdAt) {
        throw new Error("This savings target save was already used with different values.");
      }
    } else {
      await run("UPDATE fund_goals SET active = 0, updated_at = ?", [goal.updatedAt]);
      await run(
        "INSERT INTO fund_goals (id, title, target, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
        [goal.id, goal.title, goal.target, goal.createdAt, goal.updatedAt],
      );
    }
    exec("COMMIT");
  } catch (error) {
    exec("ROLLBACK");
    throw error;
  }
}
