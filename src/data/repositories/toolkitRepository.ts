import type { ToolkitState } from "@/domain/types";
import { nowIso } from "@/lib/dates";
import { defaultToolkitState, normalizeToolkitState } from "@/logic/toolkit";
import type { SqlDatabase } from "../db";

/** Shown when the saved toolkit cannot be read; her saved row is left alone. */
export const TOOLKIT_UNREADABLE_MESSAGE =
  "Your Pilot Toolkit could not be read, so nothing was changed. Your saved toolkit is kept as it was.";

type Stored = { kind: "none" } | { kind: "ok"; state: ToolkitState } | { kind: "unreadable" };

export function toolkitRepository(db: SqlDatabase) {
  async function readStored(): Promise<Stored> {
    const rows = await db.select<{ state_json: string }>(
      "SELECT state_json FROM pilot_toolkit WHERE id = 'toolkit'",
    );
    const raw = rows[0]?.state_json;
    if (!raw) return { kind: "none" };
    try {
      const parsed: unknown = JSON.parse(raw);
      // Not an object, or written by a newer build: normalising would
      // quietly drop what it does not understand.
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "unreadable" };
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "number" && version > 1) return { kind: "unreadable" };
      return { kind: "ok", state: normalizeToolkitState(parsed) };
    } catch {
      return { kind: "unreadable" };
    }
  }

  return {
    async get(): Promise<ToolkitState> {
      const stored = await readStored();
      return stored.kind === "ok" ? stored.state : defaultToolkitState();
    },

    /** True when a saved toolkit exists but this build cannot read it. */
    async isUnreadable(): Promise<boolean> {
      return (await readStored()).kind === "unreadable";
    },

    /**
     * Save the whole toolkit. Refuses — and changes nothing — when the saved
     * row cannot be read, so defaults shown in its place never overwrite her
     * goals and credentials.
     */
    async save(state: ToolkitState): Promise<void> {
      if ((await readStored()).kind === "unreadable") {
        throw new Error(TOOLKIT_UNREADABLE_MESSAGE);
      }
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
