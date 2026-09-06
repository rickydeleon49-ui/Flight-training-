import type { ToolkitState } from "@/domain/types";
import { nowIso } from "@/lib/dates";
import { DEFAULT_TOOLKIT_STATE, normalizeToolkitState } from "@/logic/toolkit";
import type { SqlDatabase } from "../db";

export function toolkitRepository(db: SqlDatabase) {
  return {
    async get(): Promise<ToolkitState> {
      const rows = await db.select<{ state_json: string }>(
        "SELECT state_json FROM pilot_toolkit WHERE id = 'toolkit'",
      );
      const raw = rows[0]?.state_json;
      if (!raw) return structuredClone(DEFAULT_TOOLKIT_STATE);
      try {
        return normalizeToolkitState(JSON.parse(raw));
      } catch {
        return structuredClone(DEFAULT_TOOLKIT_STATE);
      }
    },

    async save(state: ToolkitState): Promise<void> {
      const normalized = normalizeToolkitState(state);
      await db.execute(
        `INSERT INTO pilot_toolkit (id, state_json, updated_at) VALUES ('toolkit', ?, ?)
         ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json,
           updated_at = excluded.updated_at`,
        [JSON.stringify(normalized), nowIso()],
      );
    },

    async clear(): Promise<void> {
      await db.execute("DELETE FROM pilot_toolkit WHERE id = 'toolkit'");
    },
  };
}
