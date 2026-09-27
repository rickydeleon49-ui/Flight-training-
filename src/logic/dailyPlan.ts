/**
 * Daily Flight Plan recommendation session management and decision persistence.
 *
 * M1 D3–D4:
 * - Manages user's daily training session (10, 20, 30 min or untimed).
 * - Implements stable session selection across navigation and app restarts.
 * - Manages "Skip today" (expires on next local calendar day).
 * - Manages "Move to tomorrow" (deferral that leaves source due date untouched).
 * - Maps each recommendation kind to its concrete Start navigation target.
 * - Local-date rollover automatically expires daily skips and activates deferred work.
 */

import type { IsoDate, IsoDateTime } from "@/domain/types";
import { nowIso, todayIso } from "@/lib/dates";
import {
  buildRecommendationCandidates,
  compareCandidates,
  isSourceIdValid,
  selectRecommendations,
  type Recommendation,
  type RecommendationCandidate,
  type RecommendationResult,
  type RecommendationSources,
} from "./recommendations";

export interface DailyPlanDecision {
  type: "skip" | "defer";
  /** Local calendar date when the decision was recorded (YYYY-MM-DD). */
  date: IsoDate;
}

export interface DailyPlanState {
  version: 1;
  /** Local calendar date when this session was selected/locked (YYYY-MM-DD). */
  date: IsoDate;
  /** Selected time budget in minutes (10, 20, 30), or null for untimed / all. */
  timeBudget: number | null;
  /** Candidate IDs that were chosen for the suggested session in stable order. */
  suggestedIds: string[];
  /** Map of candidateId -> decision (skip or defer with local date). */
  decisions: Record<string, DailyPlanDecision>;
  /** Timestamp when session was last updated. */
  updatedAt: IsoDateTime;
  /**
   * Intended session capacity (slot count). Preserved when items vacate or when
   * vacated slots cannot be immediately refilled. Undefined for fresh/unlocked sessions.
   */
  targetCapacity?: number;
}

export interface StartTarget {
  /** Navigation route (e.g. `/study/m-1`, `/schedule/e-1`, `/questions`, `/notes`). */
  path: string;
  /** Accessible label describing the action for screen readers and tooltips. */
  label: string;
  /** Target element ID on Flight Deck to focus if the action is local. */
  elementId?: string;
  /** Whether the target should be treated as an in-page focus/scroll action. */
  isLocalAction?: boolean;
}

/** Default time budget for initial session if none chosen. */
export const DEFAULT_DAILY_BUDGET = 20;

/** Supported time budget options in minutes, with null representing untimed. */
export const BUDGET_OPTIONS: ReadonlyArray<{ label: string; value: number | null }> = [
  { label: "10 min", value: 10 },
  { label: "20 min", value: 20 },
  { label: "30 min", value: 30 },
  { label: "All / Untimed", value: null },
];

/**
 * Creates a clean initial daily plan state for a given local date.
 */
export function createInitialDailyPlanState(
  today: IsoDate = todayIso(),
  budget: number | null = DEFAULT_DAILY_BUDGET,
): DailyPlanState {
  return {
    version: 1,
    date: today,
    timeBudget: budget,
    suggestedIds: [],
    decisions: {},
    updatedAt: nowIso(),
  };
}

/**
 * Parses and validates raw serialized daily plan state from app_metadata.
 * Returns null safely if raw is absent, unparseable, or invalid.
 */
export function parseDailyPlanState(raw: string | null): DailyPlanState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.version === 1 &&
      typeof parsed.date === "string" &&
      Array.isArray(parsed.suggestedIds) &&
      parsed.decisions &&
      typeof parsed.decisions === "object"
    ) {
      const state: DailyPlanState = {
        version: 1,
        date: parsed.date,
        timeBudget: typeof parsed.timeBudget === "number" ? parsed.timeBudget : null,
        suggestedIds: parsed.suggestedIds.filter((id: unknown): id is string => typeof id === "string"),
        decisions: Object.fromEntries(
          Object.entries(parsed.decisions).filter(
            ([_, v]) =>
              v &&
              typeof v === "object" &&
              ((v as DailyPlanDecision).type === "skip" || (v as DailyPlanDecision).type === "defer") &&
              typeof (v as DailyPlanDecision).date === "string",
          ) as [string, DailyPlanDecision][],
        ),
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
      };
      if (typeof parsed.targetCapacity === "number" && parsed.targetCapacity > 0) {
        state.targetCapacity = parsed.targetCapacity;
      } else if (typeof parsed.sessionCapacity === "number" && parsed.sessionCapacity > 0) {
        state.targetCapacity = parsed.sessionCapacity;
      }
      return state;
    }
  } catch {
    // Malformed JSON falls back gracefully to null
  }
  return null;
}

/**
 * Serializes daily plan state for persistent storage.
 */
export function serializeDailyPlanState(state: DailyPlanState): string {
  return JSON.stringify(state);
}

/**
 * Normalizes state for the current local date, expiring past skips and activating past deferrals.
 */
export function rolloverDailyPlanState(
  state: DailyPlanState,
  today: IsoDate,
): DailyPlanState {
  if (state.date === today) {
    return state;
  }

  // A new local day has started:
  // 1. Skips for previous days expire.
  // 2. Deferrals recorded yesterday (or earlier) expire, making the item eligible today.
  const activeDecisions: Record<string, DailyPlanDecision> = {};
  for (const [candidateId, decision] of Object.entries(state.decisions)) {
    // Only keep decisions recorded for today (if any)
    if (decision.date === today) {
      activeDecisions[candidateId] = decision;
    }
  }

  const next: DailyPlanState = {
    ...state,
    date: today,
    // Suggested session is refreshed for the new day's priorities
    suggestedIds: [],
    decisions: activeDecisions,
    updatedAt: nowIso(),
  };
  delete next.targetCapacity;
  return next;
}

/**
 * Applies a "Skip today" decision for a candidate.
 * The candidate is removed from today's suggestions and excluded until tomorrow.
 * Idempotent.
 */
export function applySkip(
  state: DailyPlanState,
  candidateId: string,
  today: IsoDate = todayIso(),
): DailyPlanState {
  const current = rolloverDailyPlanState(state, today);
  return {
    ...current,
    // The id stays in suggestedIds: the decision removes it from view, and its
    // slot counts as vacated so exactly one replacement can take it.
    decisions: {
      ...current.decisions,
      [candidateId]: {
        type: "skip",
        date: today,
      },
    },
    updatedAt: nowIso(),
  };
}

/**
 * Applies a "Move to tomorrow" (defer) decision for a candidate.
 * The candidate is removed from today's suggestions and excluded until tomorrow.
 * Planner-only: preserves the source entity's original due date.
 * Idempotent.
 */
export function applyDefer(
  state: DailyPlanState,
  candidateId: string,
  today: IsoDate = todayIso(),
): DailyPlanState {
  const current = rolloverDailyPlanState(state, today);
  return {
    ...current,
    decisions: {
      ...current.decisions,
      [candidateId]: {
        type: "defer",
        date: today,
      },
    },
    updatedAt: nowIso(),
  };
}

/**
 * Reverts a skip or defer decision for a candidate, making it eligible for recommendations again.
 * Idempotent.
 */
export function applyResetDecision(
  state: DailyPlanState,
  candidateId: string,
  today: IsoDate = todayIso(),
): DailyPlanState {
  const current = rolloverDailyPlanState(state, today);
  if (!current.decisions[candidateId]) return current;

  const nextDecisions = { ...current.decisions };
  delete nextDecisions[candidateId];

  return {
    ...current,
    decisions: nextDecisions,
    updatedAt: nowIso(),
  };
}

/**
 * Reverts every skip and defer recorded for today in one step, so a reset
 * either happens completely or not at all.
 */
export function applyResetToday(
  state: DailyPlanState,
  today: IsoDate = todayIso(),
): DailyPlanState {
  const current = rolloverDailyPlanState(state, today);
  if (Object.keys(current.decisions).length === 0) return current;
  return {
    ...current,
    decisions: {},
    updatedAt: nowIso(),
  };
}

/**
 * Clears the saved selection so the next computation chooses a fresh session.
 * Used only for the explicit Refresh control.
 */
export function applyRefresh(
  state: DailyPlanState,
  today: IsoDate = todayIso(),
): DailyPlanState {
  const current = rolloverDailyPlanState(state, today);
  const next: DailyPlanState = {
    ...current,
    suggestedIds: [],
    updatedAt: nowIso(),
  };
  delete next.targetCapacity;
  return next;
}

/**
 * Everything that makes two plan states equivalent, ignoring `updatedAt`.
 * Used to decide whether a write is needed at all, so unchanged renders and
 * repeated identical clicks never write again.
 */
export function dailyPlanSignature(state: DailyPlanState | null): string {
  if (!state) return "none";
  const decisions = Object.keys(state.decisions)
    .sort()
    .map((id) => `${id}=${state.decisions[id]?.type}@${state.decisions[id]?.date}`)
    .join(",");
  const cap = state.targetCapacity !== undefined ? state.targetCapacity : "auto";
  return `${state.date}|${state.timeBudget ?? "untimed"}|cap:${cap}|${state.suggestedIds.join(",")}|${decisions}`;
}

/**
 * Updates the user's preferred time budget (10, 20, 30, or null for untimed).
 * Clears locked suggestedIds to trigger re-selection under the new budget.
 */
export function applyBudgetChange(
  state: DailyPlanState,
  budget: number | null,
  today: IsoDate = todayIso(),
): DailyPlanState {
  const current = rolloverDailyPlanState(state, today);
  const next: DailyPlanState = {
    ...current,
    timeBudget: budget,
    suggestedIds: [],
    updatedAt: nowIso(),
  };
  delete next.targetCapacity;
  return next;
}

/**
 * Builds a result that keeps `kept` exactly as saved and fills only the free
 * slots (up to `maxItems` in total) from the other candidates. Explanations follow the same wording as
 * `selectRecommendations` so a kept session reads like a fresh one.
 */
function assembleLockedSession(
  kept: readonly RecommendationCandidate[],
  active: readonly RecommendationCandidate[],
  budget: number | null,
  maxItems: number,
  today: IsoDate,
): RecommendationResult {
  const timed = budget !== null && budget > 0;
  const keptIds = new Set(kept.map((c) => c.id));
  const others = active
    .filter((c) => !keptIds.has(c.id))
    .sort((a, b) => compareCandidates(a, b, today));

  const suggested: RecommendationCandidate[] = [...kept];
  let allocated = kept.reduce((sum, c) => sum + (c.estimatedMinutes ?? 0), 0);
  const remaining: { candidate: RecommendationCandidate; exceeds?: number }[] = [];

  for (const candidate of others) {
    if (suggested.length >= maxItems) {
      remaining.push({ candidate });
      continue;
    }
    if (timed && candidate.estimatedMinutes !== null) {
      if (allocated + candidate.estimatedMinutes <= (budget as number)) {
        allocated += candidate.estimatedMinutes;
        suggested.push(candidate);
      } else {
        remaining.push({ candidate, exceeds: Math.max(0, (budget as number) - allocated) });
      }
      continue;
    }
    if (!timed && candidate.estimatedMinutes !== null) allocated += candidate.estimatedMinutes;
    suggested.push(candidate);
  }

  const suggestedUnestimatedCount = suggested.filter((c) => c.estimatedMinutes === null).length;
  const hasUnknown = suggestedUnestimatedCount > 0;
  const overBudget = timed && allocated > (budget as number);
  const fitsBudgetCompletely = timed
    ? suggested.length > 0 && !hasUnknown && !overBudget
    : true;

  const explainSuggested = (c: RecommendationCandidate): string => {
    if (!timed) return c.reason.summary;
    if (c.estimatedMinutes === null) {
      return `${c.reason.summary} · Duration unknown (included by priority; not counted in ${budget}-min timed allocation)`;
    }
    if (overBudget) {
      return `${c.reason.summary} · ${c.estimatedMinutes} min estimated (${allocated} of ${budget} min allocated; over the ${budget}-min budget)`;
    }
    if (hasUnknown) {
      return `${c.reason.summary} · ${c.estimatedMinutes} min estimated for timed item (${allocated} of ${budget} min allocated; total duration indeterminate)`;
    }
    return `${c.reason.summary} · Fits ${budget}-min session (${c.estimatedMinutes} min, ${(budget as number) - allocated} min remaining)`;
  };

  return {
    suggested: suggested.map((c) => ({ ...c, explanation: explainSuggested(c) })),
    remaining: remaining.map(({ candidate, exceeds }) => ({
      ...candidate,
      explanation:
        exceeds !== undefined && candidate.estimatedMinutes !== null
          ? `${candidate.reason.summary} · Exceeds remaining timed allocation (${candidate.estimatedMinutes} min vs ${exceeds} min left)`
          : `${candidate.reason.summary} · Available in unfinished work`,
    })),
    totalEstimatedMinutes: allocated,
    allocatedMinutes: allocated,
    suggestedUnestimatedCount,
    timeBudget: budget,
    unestimatedCount: active.filter((c) => c.estimatedMinutes === null).length,
    fitsBudgetCompletely,
  };
}

/**
 * Computes the daily recommendations respecting time budget, stable locked suggestions,
 * and skip/defer decisions.
 *
 * Returns the recommendation result and the updated stable plan state.
 */
export function computeDailyPlan(
  sources: RecommendationSources,
  savedState: DailyPlanState | null,
  options?: {
    timeBudget?: number | null;
    maxItems?: number;
    today?: IsoDate;
    forceRefresh?: boolean;
  },
): { result: RecommendationResult; nextState: DailyPlanState } {
  const today = options?.today ?? sources.today ?? todayIso();
  const maxItems = options?.maxItems ?? 3;

  // Initialize or roll over state for today
  let state = savedState
    ? rolloverDailyPlanState(savedState, today)
    : createInitialDailyPlanState(today, options?.timeBudget ?? DEFAULT_DAILY_BUDGET);

  // If timeBudget was explicitly passed in options and differs from state, apply it
  if (options?.timeBudget !== undefined && options.timeBudget !== state.timeBudget) {
    state = applyBudgetChange(state, options.timeBudget, today);
  }

  // If forceRefresh is requested, clear locked suggestions
  if (options?.forceRefresh) {
    state = {
      ...state,
      suggestedIds: [],
      updatedAt: nowIso(),
    };
    delete state.targetCapacity;
  }

  const budget = state.timeBudget;

  // Build all raw candidates from sources for today
  const allCandidates = buildRecommendationCandidates(sources, today);

  // Filter candidates: exclude any item with active skip or defer for today
  const activeCandidates = allCandidates.filter((c) => {
    const decision = state.decisions[c.id];
    if (!decision) return true;
    // Suppress if skipped today or deferred today
    if (decision.date === today && (decision.type === "skip" || decision.type === "defer")) {
      return false;
    }
    return true;
  });

  // Session stability policy (see docs/M1_D3_D4_DAILY_PLAN_2026-09-26.md):
  // - A saved selection keeps its items in their saved order. A newly arrived
  //   higher-priority candidate never displaces a healthy selected item; it
  //   waits in "remaining" until an explicit refresh, a budget change, or the
  //   next local day.
  // - A selected item leaves the session only when its source is no longer an
  //   open candidate (completed, deleted, answered) or when she skips or
  //   defers it. Only that vacated slot is refilled, from the remaining
  //   candidates in selector order, within the unallocated budget. A session
  //   never grows to absorb newly arrived work.
  // - A selected item whose estimate changes stays in place; the budget
  //   summary reports the new total honestly, even when it runs over.
  const candidateMap = new Map(activeCandidates.map((c) => [c.id, c]));
  const kept: RecommendationCandidate[] = [];
  if (!options?.forceRefresh) {
    const seen = new Set<string>();
    for (const id of state.suggestedIds) {
      const candidate = candidateMap.get(id);
      if (candidate && !seen.has(id)) {
        seen.add(id);
        kept.push(candidate);
      }
    }
  }

  const rawCapacity =
    typeof state.targetCapacity === "number" && state.targetCapacity > 0
      ? state.targetCapacity
      : state.suggestedIds.length > 0
      ? state.suggestedIds.length
      : null;

  const isFreshSession = Boolean(options?.forceRefresh) || rawCapacity === null;

  let finalResult: RecommendationResult;
  let nextCapacity: number | null = null;

  if (isFreshSession) {
    finalResult = selectRecommendations(activeCandidates, { timeBudget: budget, maxItems, today });
    nextCapacity = finalResult.suggested.length > 0 ? finalResult.suggested.length : null;
  } else {
    // Locked session: capacity is established. Refill only vacated slots.
    const capacity = Math.min(maxItems, Math.max(kept.length, rawCapacity));
    finalResult = assembleLockedSession(kept, activeCandidates, budget, capacity, today);
    // Preserve the intended capacity even if no replacement currently fits
    nextCapacity = rawCapacity;
  }

  const nextState: DailyPlanState = {
    ...state,
    suggestedIds: finalResult.suggested.map((s) => s.id),
    updatedAt: nowIso(),
  };

  if (nextCapacity !== null) {
    nextState.targetCapacity = nextCapacity;
  } else {
    delete nextState.targetCapacity;
  }

  return {
    result: finalResult,
    nextState,
  };
}

/**
 * Determines the concrete navigation target and accessible label for "Start".
 *
 * Supported recommendation kinds:
 * - `action`: Focuses/scrolls to the action on Flight Deck, or navigates to its related entity.
 * - `study_material`: Navigates to `/study/:materialId` for study/review.
 * - `lesson_prep`: Navigates to `/schedule/:eventId` for upcoming lesson prep.
 * - `question`: Navigates to `/questions` (or lesson if attached to upcoming event).
 * - `note`: Navigates to `/notes` to view or edit pinned note.
 */
export function getStartTarget(
  item: Recommendation,
  sources: RecommendationSources,
): StartTarget {
  switch (item.kind) {
    case "action": {
      const actionId = item.reason.sourceType === "action" ? item.reason.sourceId : item.id.replace(/^action:/, "");
      const action = (sources.actions ?? []).find((a) => a.id === actionId);

      // A linked record is only a destination while it still exists. When the
      // debrief, material or lesson has been deleted, Start falls back to the
      // action itself on Flight Deck rather than a route that shows "not found".
      if (action) {
        const linkedId = action.relatedId;
        if (action.relatedType === "journal" && linkedId && isSourceIdValid(linkedId, "journal", sources)) {
          return {
            path: `/journal/${linkedId}`,
            label: `Open debrief for ${item.title}`,
          };
        }
        if (action.relatedType === "material" && linkedId && isSourceIdValid(linkedId, "material", sources)) {
          return {
            path: `/study/${linkedId}`,
            label: `Open study material for ${item.title}`,
          };
        }
        if (action.relatedType === "event" && linkedId && isSourceIdValid(linkedId, "event", sources)) {
          return {
            path: `/schedule/${linkedId}`,
            label: `Open flight lesson for ${item.title}`,
          };
        }
        if (action.relatedType === "goal") {
          return {
            path: "/flight-path",
            label: `Open goal on Flight Path for ${item.title}`,
          };
        }
      }

      // Standalone action (or one whose linked record is gone): handled on
      // Flight Deck by focusing the action's own control.
      return {
        path: "/",
        elementId: `action-${actionId}`,
        isLocalAction: true,
        label: `Start action: ${item.title}`,
      };
    }

    case "study_material": {
      const materialId = item.reason.sourceId;
      return {
        path: `/study/${materialId}`,
        label: `Study ${item.title}`,
      };
    }

    case "lesson_prep": {
      if (item.reason.sourceType === "event") {
        return {
          path: `/schedule/${item.reason.sourceId}`,
          label: `Open lesson checklist for ${item.title}`,
        };
      }
      return {
        path: "/schedule",
        label: `Open schedule for ${item.title}`,
      };
    }

    case "question": {
      if (item.reason.sourceType === "event") {
        return {
          path: `/schedule/${item.reason.sourceId}`,
          label: `Review lesson question: ${item.title}`,
        };
      }
      return {
        path: "/questions",
        label: `Review question: ${item.title}`,
      };
    }

    case "note": {
      return {
        path: "/notes",
        label: `View pinned note: ${item.title}`,
      };
    }

    default: {
      return {
        path: "/",
        label: `View ${item.title}`,
      };
    }
  }
}
