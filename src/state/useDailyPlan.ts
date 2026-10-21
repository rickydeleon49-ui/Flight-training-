import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { IsoDate } from "@/domain/types";
import { nowIso } from "@/lib/dates";
import {
  applyBudgetChange,
  applyDefer,
  applyRefresh,
  applyResetToday,
  applySkip,
  computeDailyPlan,
  createInitialDailyPlanState,
  dailyPlanSignature,
  DEFAULT_DAILY_BUDGET,
  rolloverDailyPlanState,
  type DailyPlanState,
} from "@/logic/dailyPlan";
import type { RecommendationResult, RecommendationSources } from "@/logic/recommendations";
import { useAppData } from "@/state/AppDataContext";

export interface UseDailyPlanResult {
  /** The calculated recommendation result (suggested, remaining, budget totals, fit disclosure). */
  plan: RecommendationResult;
  /** Active daily plan state (budget, decisions, locked suggestions). */
  state: DailyPlanState;
  /** Currently selected budget (10, 20, 30, or null for untimed). */
  timeBudget: number | null;
  /** Whether any plan write is still in flight. */
  isSaving: boolean;
  /** User-facing error if a plan write failed, or null. */
  saveError: string | null;
  /** True when today's session is shown but could not be saved. */
  sessionUnsaved: boolean;
  /** The sources the plan was computed from (shared with Start targets). */
  sources: RecommendationSources;
  setTimeBudget: (budget: number | null) => Promise<boolean>;
  /** Skip a recommended candidate for today only. */
  skipItem: (candidateId: string) => Promise<boolean>;
  /** Defer a candidate until tomorrow (planner-only: leaves source due date untouched). */
  deferItem: (candidateId: string) => Promise<boolean>;
  /** Restore every skip and deferral recorded today, atomically. */
  resetToday: () => Promise<boolean>;
  /** Explicitly choose a fresh session from current work. */
  refreshPlan: () => Promise<boolean>;
  /** Try again to save today's session after a failed save. */
  retrySave: () => Promise<boolean>;
  clearSaveError: () => void;
}

type Transform = (latest: DailyPlanState) => DailyPlanState;

const identity: Transform = (state) => state;

/** The newer of two saved states, by the time they were written. */
function newest(a: DailyPlanState | null, b: DailyPlanState | null): DailyPlanState | null {
  if (!a) return b;
  if (!b) return a;
  return a.updatedAt > b.updatedAt ? a : b;
}

/**
 * Daily Flight Plan state for one local date.
 *
 * Every change runs inside AppDataContext's serialized mutation queue and is
 * computed there from the *stored* plan, not from the render-time snapshot, so
 * two quick clicks can never overwrite each other. A write is skipped when the
 * result is equivalent to what is stored.
 *
 * The session shown on first open (or after local midnight) is persisted once
 * per distinct session. A failed save is reported and not retried in a loop;
 * `retrySave` tries again on request.
 */
export function useDailyPlan(today: IsoDate): UseDailyPlanResult {
  const { data, mutate } = useAppData();

  const [inFlight, setInFlight] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sessionUnsaved, setSessionUnsaved] = useState(false);
  /** The last state this hook wrote, kept in case the reload after it failed. */
  const [lastWritten, setLastWritten] = useState<DailyPlanState | null>(null);

  const sources = useMemo<RecommendationSources>(
    () => ({
      today,
      actions: data.actions,
      homework: data.homework,
      events: data.events,
      prepItems: data.prepItems,
      materials: data.materials,
      questions: data.questions,
      notes: data.notes,
      journalEntries: data.journalEntries,
    }),
    [data.actions, data.homework, data.events, data.prepItems, data.materials, data.questions, data.notes, data.journalEntries, today],
  );

  const saved = newest(data.dailyPlan, lastWritten);

  const { result: plan, nextState: state } = useMemo(
    () => computeDailyPlan(sources, saved, { today }),
    [sources, saved, today],
  );

  // Latest inputs for work that runs later inside the mutation queue.
  const sourcesRef = useRef(sources);
  const todayRef = useRef(today);
  sourcesRef.current = sources;
  todayRef.current = today;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const seqRef = useRef(0);
  const lastFailureSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  const runUpdate = useCallback(
    async (transform: Transform, kind: "change" | "session"): Promise<boolean> => {
      const seq = ++seqRef.current;
      setInFlight((count) => count + 1);

      let written: DailyPlanState | null = null;
      const result = await mutate(async (repos) => {
        const day = todayRef.current;
        const stored = await repos.app.getDailyPlanState();
        const base = stored
          ? rolloverDailyPlanState(stored, day)
          : createInitialDailyPlanState(day, DEFAULT_DAILY_BUDGET);
        const changed = transform(base);
        const { nextState } = computeDailyPlan(sourcesRef.current, changed, { today: day });
        if (stored && dailyPlanSignature(nextState) === dailyPlanSignature(stored)) {
          return stored; // Already stored; nothing to write.
        }
        const toWrite = { ...nextState, updatedAt: nowIso() };
        await repos.app.setDailyPlanState(toWrite);
        written = toWrite;
        return toWrite;
      });

      if (!mountedRef.current) return result !== null;
      setInFlight((count) => Math.max(0, count - 1));

      if (result === null) {
        lastFailureSeqRef.current = seq;
        if (kind === "session") setSessionUnsaved(true);
        setSaveError(
          kind === "session"
            ? "Today's plan couldn't be saved. It's shown here, but it may change if you leave or restart the app."
            : "That change couldn't be saved. Your previous plan is unchanged — try again.",
        );
        return false;
      }

      // Results arrive in queue order; ignore anything older than what is applied.
      if (seq > appliedSeqRef.current) {
        appliedSeqRef.current = seq;
        if (written) setLastWritten(written);
      }
      if (seq > lastFailureSeqRef.current) {
        setSaveError(null);
        setSessionUnsaved(false);
      }
      return true;
    },
    [mutate],
  );

  // Persist the session the screen is showing when it differs from storage:
  // first open, a new local day, or a slot refilled after a source went away.
  // Attempted once per distinct session so a failure cannot loop.
  const shownSignature = dailyPlanSignature(state);
  const storedSignature = dailyPlanSignature(saved);
  const attemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (shownSignature === storedSignature) return;
    if (attemptedRef.current === shownSignature) return;
    attemptedRef.current = shownSignature;
    void runUpdate(identity, "session");
  }, [shownSignature, storedSignature, runUpdate]);

  const setTimeBudget = useCallback(
    (budget: number | null) =>
      runUpdate((latest) => applyBudgetChange(latest, budget, todayRef.current), "change"),
    [runUpdate],
  );
  const skipItem = useCallback(
    (candidateId: string) =>
      runUpdate((latest) => applySkip(latest, candidateId, todayRef.current), "change"),
    [runUpdate],
  );
  const deferItem = useCallback(
    (candidateId: string) =>
      runUpdate((latest) => applyDefer(latest, candidateId, todayRef.current), "change"),
    [runUpdate],
  );
  const resetToday = useCallback(
    () => runUpdate((latest) => applyResetToday(latest, todayRef.current), "change"),
    [runUpdate],
  );
  const refreshPlan = useCallback(
    () => runUpdate((latest) => applyRefresh(latest, todayRef.current), "change"),
    [runUpdate],
  );
  const retrySave = useCallback(() => runUpdate(identity, "session"), [runUpdate]);
  const clearSaveError = useCallback(() => setSaveError(null), []);

  return {
    plan,
    state,
    timeBudget: state.timeBudget,
    isSaving: inFlight > 0,
    saveError,
    sessionUnsaved,
    sources,
    setTimeBudget,
    skipItem,
    deferItem,
    resetToday,
    refreshPlan,
    retrySave,
    clearSaveError,
  };
}
