import type { SqlDatabase } from "../db";
import { decodeOralPoints } from "../oralScenarios";
import { decodeOralCovered, encodeOralCovered, validOralAnswerText, type OralAnswer } from "../oralAnswers";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";

/** ORAL-01d: her finished oral answers. Saved only when she finishes; she can delete one or all. */
export function oralAnswerRepository(db: SqlDatabase) {
  return {
    /** Her finished answers for one scenario, newest first. */
    async list(scenarioId: string): Promise<OralAnswer[]> {
      const rows = await db.select<Record<string, unknown>>(
        `SELECT a.id, a.scenario_id, a.version_id, v.version_number, v.points_json, a.answer, a.covered_json, a.finished_at
           FROM oral_answers a JOIN oral_scenario_versions v ON v.id = a.version_id
          WHERE a.scenario_id = ? AND a.finished_at IS NOT NULL
          ORDER BY a.finished_at DESC, a.id`,
        [scenarioId],
      );
      return rows.map((r) => ({
        id: String(r.id),
        scenarioId: String(r.scenario_id),
        versionId: String(r.version_id),
        versionNumber: Number(r.version_number),
        answer: String(r.answer),
        covered: decodeOralCovered(r.covered_json, decodeOralPoints(r.points_json).length),
        finishedAt: String(r.finished_at),
      }));
    },
    /**
     * Keep one finished practice, frozen to the version she answered. The row
     * is written only if that version still belongs to the scenario.
     */
    async finish(input: { scenarioId: string; versionId: string; pointCount: number; answer: string; covered: number[]; revealedAt: string }): Promise<string> {
      if (!validOralAnswerText(input.answer)) throw new Error("Your answer is too long to keep.");
      const covered = encodeOralCovered(input.covered, input.pointCount);
      const id = newId();
      const at = nowIso();
      await db.execute(
        `INSERT INTO oral_answers (id, scenario_id, version_id, answer, covered_json, revealed_at, finished_at, created_at, updated_at)
         SELECT ?, v.scenario_id, v.id, ?, ?, ?, ?, ?, ? FROM oral_scenario_versions v WHERE v.id = ? AND v.scenario_id = ?`,
        [id, input.answer, covered, input.revealedAt, at, at, at, input.versionId, input.scenarioId],
      );
      return id;
    },
    remove: (answerId: string) => db.execute("DELETE FROM oral_answers WHERE id = ?", [answerId]),
    removeAll: (scenarioId: string) => db.execute("DELETE FROM oral_answers WHERE scenario_id = ?", [scenarioId]),
  };
}
