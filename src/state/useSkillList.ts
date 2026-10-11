/**
 * The skill catalog for pickers and the Skills list (M3): skills plus, when
 * asked, each skill's summary. Read on demand (not through AppDataContext)
 * and re-read when `dataRevision` advances. Catalog writes (add, rename,
 * retire, restore) keep their exact request while an outcome is unknown, so
 * trying again replays it instead of creating a second skill.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { SkillEvidenceAction, SkillEvidenceOutcome, SkillListEntry, SkillSummary } from "@/domain/types";
import { canonicalJson } from "@/logic/cardIdentity";
import { refusalText } from "@/logic/skillEvidence";

import { useAppData } from "./AppDataContext";

export interface SkillListState {
  status: "loading" | "ready" | "error";
  skills: SkillListEntry[];
  summaries: Record<string, SkillSummary>;
}

export type CatalogOutcome = { kind: "earlier_done"; message: string; outcome: SkillEvidenceOutcome } | { kind: "done"; outcome: SkillEvidenceOutcome } | { kind: "unknown"; message: string } | { kind: "refused"; code: string; message: string };

const DEFINITIVE = new Set([
  "INVALID_ARGUMENT", "LIMIT_EXCEEDED", "NOT_FOUND", "SOURCE_MISSING", "SKILL_RETIRED", "BUILTIN_READ_ONLY",
  "DUPLICATE_LABEL", "STALE_REVISION", "OPERATION_CONFLICT", "ERASED",
]);

export function useSkillList(options: { includeRetired?: boolean; withSummaries?: boolean } = {}) {
  const { repositories, dataRevision } = useAppData();
  const repo = repositories?.skillEvidence ?? null;
  const [state, setState] = useState<SkillListState>({ status: "loading", skills: [], summaries: {} });
  const generation = useRef(0);
  const pending = useRef(new Map<string, { fingerprint: string; request: SkillEvidenceAction; flight: Promise<CatalogOutcome> | null }>());
  const lifetime = useRef(0);
  const includeRetired = options.includeRetired === true;
  const withSummaries = options.withSummaries === true;

  const load = useCallback(async () => {
    if (!repo) return;
    const mine = ++generation.current;
    try {
      const skills = await repo.skills({ includeRetired });
      const summaries: Record<string, SkillSummary> = {};
      if (withSummaries) {
        for (const summary of await Promise.all(skills.map((s) => repo.summary(s.id)))) {
          if (summary) summaries[summary.skillId] = summary;
        }
      }
      if (mine === generation.current) setState({ status: "ready", skills, summaries });
    } catch {
      if (mine === generation.current) setState((s) => ({ ...s, status: "error" }));
    }
  }, [repo, includeRetired, withSummaries]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
      lifetime.current += 1;
    };
  }, [load, dataRevision]);

  /** One catalog write; the same intent after an unknown outcome replays the exact request. */
  const act = useCallback(
    async (key: string, intent: unknown, build: (operationId: string) => SkillEvidenceAction): Promise<CatalogOutcome> => {
      if (!repo) return { kind: "refused", code: "INVALID_ARGUMENT", message: "Skill evidence isn't available." };
      const fingerprint = canonicalJson(intent);
      let record = pending.current.get(key);
      const changed = record !== undefined && record.fingerprint !== fingerprint;
      const forCurrentIntent = (outcome: CatalogOutcome): CatalogOutcome =>
        changed && outcome.kind === "done"
          ? { kind: "earlier_done", outcome: outcome.outcome, message: "Your earlier skill change was saved. These new changes have not been sent. Review them before saving again; another save in the add-skill form creates another skill." }
          : outcome;
      if (record?.flight) return record.flight.then(forCurrentIntent);
      if (!record) {
        record = { fingerprint, request: build(crypto.randomUUID()), flight: null };
        pending.current.set(key, record);
      }
      const mine = record;
      const owner = lifetime.current;
      const forget = () => { if (pending.current.get(key) === mine) pending.current.delete(key); };
      const flight = (async (): Promise<CatalogOutcome> => {
        let outcome: SkillEvidenceOutcome;
        try {
          outcome = await repo.act(mine.request);
        } catch (error) {
          const code = (error as { code?: string } | null)?.code ?? "STORAGE_FAILURE";
          if (!DEFINITIVE.has(code)) return { kind: "unknown", message: refusalText(code) };
          forget();
          return { kind: "refused", code, message: refusalText(code, error instanceof Error ? error.message : undefined) };
        }
        forget();
        if (owner === lifetime.current) await load();
        return { kind: "done", outcome };
      })().finally(() => { mine.flight = null; });
      mine.flight = flight;
      return flight.then(forCurrentIntent);
    },
    [repo, load],
  );

  return { state, reload: load, act, available: repo !== null };
}
