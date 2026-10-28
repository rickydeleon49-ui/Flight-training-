import type { SqlDatabase } from "../db";
import { OralScenarioError, readOralScenarios, type OralOperation, type OralScenarioContent } from "../oralScenarios";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";

/** ORAL-01c: her saved scenarios. Answers and ticks are never stored. */
export function oralScenarioRepository(db: SqlDatabase) {
  const save = (operation: OralOperation) => {
    if (!db.saveOralScenarioAtomically) throw new OralScenarioError("STORAGE");
    return db.saveOralScenarioAtomically(operation);
  };
  return {
    list: (materialId: string) => readOralScenarios((sql, params) => db.select(sql, params), materialId),
    create: (materialId: string, content: OralScenarioContent) =>
      save({ action: "create", operationId: newId(), materialId, at: nowIso(), scenarioId: newId(), versionId: newId(), content }),
    edit: (materialId: string, scenarioId: string, baseVersion: number, content: OralScenarioContent) =>
      save({ action: "edit", operationId: newId(), materialId, at: nowIso(), scenarioId, versionId: newId(), baseVersion, content }),
    reorder: (materialId: string, order: string[]) =>
      save({ action: "reorder", operationId: newId(), materialId, at: nowIso(), order }),
    remove: (materialId: string, scenarioId: string) =>
      save({ action: "remove", operationId: newId(), materialId, at: nowIso(), scenarioId }),
  };
}
