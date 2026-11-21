import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { OralRating } from "@/domain/types";
import { formatLongDate } from "@/lib/dates";
import { areaName } from "@/logic/mockTest";
import { ACS_TASK_CATALOG } from "@/logic/acsTaskCatalog";
import { referencesForTask, type AcsReferenceDocument } from "@/logic/acsTaskReferences";
import { useAppData } from "@/state/AppDataContext";

export const NEEDS_WORK_FOOTER = "Your own view. Your instructor decides.";
export const REFS_PER_AREA = 4;

/** Needs-work ratings, latest per scenario (newest date, then later list entry), grouped by area. */
export function needsWorkByArea(ratings: readonly OralRating[]): Map<string, OralRating[]> {
  const latest = new Map<string, OralRating>();
  for (const r of ratings) {
    const prev = latest.get(r.scenarioId);
    if (!prev || r.date >= prev.date) latest.set(r.scenarioId, r);
  }
  const byArea = new Map<string, OralRating[]>();
  for (const r of latest.values()) {
    if (r.rating !== "Needs work") continue;
    byArea.set(r.area, [...(byArea.get(r.area) ?? []), r]);
  }
  return new Map([...byArea].sort(([a], [b]) => a.localeCompare(b)));
}

/** Up to four reference documents for an area, from its tasks in catalog order. */
export function areaReferences(area: string): AcsReferenceDocument[] {
  const seen = new Map<string, AcsReferenceDocument>();
  for (const task of ACS_TASK_CATALOG) {
    if (!task.code.startsWith(`${area}.`)) continue;
    for (const doc of referencesForTask(task.code)) {
      if (!seen.has(doc.id)) seen.set(doc.id, doc);
      if (seen.size >= REFS_PER_AREA) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

/** Scenario id -> material id for the saved scenarios that still exist. A read error gives an empty map. */
function useScenarioMaterials(wanted: ReadonlySet<string>): Map<string, string> {
  const { data, dataRevision, repositories } = useAppData();
  const [found, setFound] = useState<Map<string, string>>(new Map());
  const key = [...wanted].join("|");
  useEffect(() => {
    const oral = repositories?.oralScenarios;
    if (!oral || wanted.size === 0) {
      setFound(new Map());
      return;
    }
    let current = true;
    (async () => {
      const next = new Map<string, string>();
      for (const material of data.materials ?? []) {
        try {
          for (const s of await oral.list(material.id)) if (wanted.has(s.id)) next.set(s.id, material.id);
        } catch {
          /* a material that cannot be read just has no Open button */
        }
      }
      if (current) setFound(next);
    })().catch(() => {});
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositories, data.materials, dataRevision, key]);
  return found;
}

/** Oral scenarios the student rated "Needs work", per ACS area, with where to read more. */
export function NeedsWorkList({ ratings }: { ratings: readonly OralRating[] }) {
  const byArea = useMemo(() => needsWorkByArea(ratings), [ratings]);
  const wanted = useMemo(() => new Set([...byArea.values()].flat().map((r) => r.scenarioId)), [byArea]);
  const materials = useScenarioMaterials(wanted);
  if (byArea.size === 0) return null;
  return (
    <div className="stack stack--2" data-testid="needs-work-list">
      <p className="small strong">Needs work</p>
      {[...byArea].map(([area, rows]) => {
        const refs = areaReferences(area);
        return (
          <section key={area} data-testid={`needs-work-${area}`}>
            <p className="tiny dim">{area.startsWith("PA.") ? areaName(area.slice(3)) : area}</p>
            <ul className="acs-list">
              {rows.map((r) => {
                const materialId = materials.get(r.scenarioId);
                return (
                  <li className="acs-list__row" key={r.scenarioId}>
                    <span className="small wrap-anywhere">{r.title}</span>
                    <span className="tiny dim"> {formatLongDate(r.date)}</span>
                    {materialId ? (
                      <Link className="button button--secondary" to={`/study/${encodeURIComponent(materialId)}?scenario=${encodeURIComponent(r.scenarioId)}#material-oral`}>
                        Open<span className="visually-hidden">: {r.title}</span>
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {refs.length > 0 ? (
              <details>
                <summary className="tiny">Reference documents</summary>
                <ul className="tiny">
                  {refs.map((d) => (
                    <li key={d.id}>{d.label}: {d.name}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        );
      })}
      <p className="tiny dim">{NEEDS_WORK_FOOTER}</p>
    </div>
  );
}
