/**
 * Pure recommendation selector for flight training tasks and study.
 *
 * D2: Pure function using deterministic, offline inputs and an explicit local date.
 *
 * Precedence hierarchy:
 * 1. User-pinned work (pinned notes, pinned actions)
 * 2. Due actions (overdue actions first, oldest first; then actions due today)
 * 3. Next-lesson preparation (prep checklist items, prep questions for upcoming flight lesson)
 * 4. Due study (study materials needing review, active study materials, debrief questions to ask)
 * 5. Other open work (next actions by priority and category)
 *
 * Guarantees:
 * - Deterministic, stable tie-breaking down to item ID.
 * - Time-budget awareness (10, 20, 30 min, etc.) without inventing durations for unestimated tasks.
 * - Unfinished work kept fully accessible in `remaining` outside the suggested short list.
 * - Clear, source-backed explanations with validated source IDs (no dangling phantom links).
 * - Debrief-created actions and questions are neither lost nor duplicated.
 * - Pure: zero database writes, zero silent action acceptance, zero skill proficiency mutations.
 */

import { formatShortDate } from "@/lib/dates";
import type {
  ActionCategory,
  Id,
  IsoDate,
  IsoDateTime,
  JournalEntry,
  NextAction,
  Note,
  PrepItem,
  Priority,
  Question,
  ScheduleEvent,
  StudyMaterial,
} from "@/domain/types";

export type RecommendationPrecedence =
  | "pinned"       // Tier 1: User-pinned work
  | "due_action"   // Tier 2: Due actions (overdue, due today)
  | "lesson_prep"  // Tier 3: Next-lesson preparation
  | "study"        // Tier 4: Study (materials to review/study, debrief questions)
  | "open_action"; // Tier 5: Other open actions

export type RecommendationKind =
  | "action"
  | "note"
  | "lesson_prep"
  | "study_material"
  | "question";

export type SourceType =
  | "action"
  | "note"
  | "prep_item"
  | "material"
  | "question"
  | "event"
  | "journal"
  | "goal";

export interface RecommendationReason {
  /** Human-readable explanation of why this item was recommended */
  summary: string;
  /** The entity type backing this recommendation */
  sourceType: SourceType;
  /** The ID of the backing entity (must exist in sources or match candidate) */
  sourceId: Id;
}

export interface RecommendationCandidate {
  id: Id;
  title: string;
  kind: RecommendationKind;
  precedence: RecommendationPrecedence;
  /** Duration in minutes, or null if unestimated / unknown */
  estimatedMinutes: number | null;
  /** Source and reason backing this recommendation */
  reason: RecommendationReason;
  priority?: Priority;
  category?: ActionCategory;
  dueDate?: IsoDate | null;
  createdAt?: IsoDateTime;
  /** Secondary sort index within precedence tier (e.g. prep item position or review urgency) */
  subRank?: number;
}

export interface Recommendation {
  id: Id;
  title: string;
  kind: RecommendationKind;
  precedence: RecommendationPrecedence;
  estimatedMinutes: number | null;
  reason: RecommendationReason;
  priority?: Priority;
  category?: ActionCategory;
  dueDate?: IsoDate | null;
  /** Detailed source-backed explanation including budget placement */
  explanation: string;
}

export interface RecommendationOptions {
  /**
   * Time budget in minutes (e.g. 10, 20, 30).
   * If provided, tasks with known duration fit within the budget, while tasks with
   * unknown duration are kept visibly unknown without fabricating a duration.
   */
  timeBudget?: number | null;
  /** Maximum number of items in the suggested short list. Defaults to 3. */
  maxItems?: number;
  /** Explicit reference date for due/overdue calculation. Defaults to today. */
  today?: IsoDate;
}

export interface RecommendationResult {
  /** The suggested short list fitting constraints and budget */
  suggested: Recommendation[];
  /** Unfinished work available outside the suggested short list */
  remaining: Recommendation[];
  /** Total known estimated minutes allocated to suggested items */
  totalEstimatedMinutes: number;
  /** Known estimated minutes allocated to suggested items (alias of totalEstimatedMinutes) */
  allocatedMinutes: number;
  /** Count of suggested items that have unknown duration */
  suggestedUnestimatedCount: number;
  /** The requested time budget, if any */
  timeBudget: number | null;
  /** Total count of candidate tasks across all inputs that have no estimated duration */
  unestimatedCount: number;
  /** True if a budget was specified, at least one item was suggested, none are unestimated, and total minutes fit */
  fitsBudgetCompletely: boolean;
}

export interface RecommendationSources {
  today: IsoDate;
  actions?: readonly NextAction[];
  events?: readonly ScheduleEvent[];
  prepItems?: readonly PrepItem[];
  materials?: readonly StudyMaterial[];
  questions?: readonly Question[];
  notes?: readonly Note[];
  journalEntries?: readonly JournalEntry[];
  pinnedActionIds?: ReadonlySet<Id> | readonly Id[];
  homework?: readonly import("@/domain/homework").HomeworkSnapshot[];
}

const PRECEDENCE_RANK: Record<RecommendationPrecedence, number> = {
  pinned: 1,
  due_action: 2,
  lesson_prep: 3,
  study: 4,
  open_action: 5,
};

const PRIORITY_WEIGHT: Record<Priority, number> = {
  next_up: 1,
  important: 2,
  later: 3,
};

/**
 * Stable, deterministic comparator for candidates.
 *
 * Precedence hierarchy:
 * 1. Pinned work
 * 2. Due actions (overdue oldest first, then due today)
 * 3. Next-lesson prep (by subRank position)
 * 4. Due study (needs_review -> studying -> questions)
 * 5. Open actions (by priority)
 *
 * Strict tie-breaking:
 * When precedence, due dates, subRank, and priorities match, candidates
 * break ties by title (alphabetical) and finally by ID (lexicographical).
 */
export function compareCandidates(
  a: RecommendationCandidate,
  b: RecommendationCandidate,
  today?: IsoDate,
): number {
  const precDiff = PRECEDENCE_RANK[a.precedence] - PRECEDENCE_RANK[b.precedence];
  if (precDiff !== 0) return precDiff;

  // Tier-specific ordering
  if (a.precedence === "due_action" && b.precedence === "due_action" && today) {
    const aOverdue = a.dueDate !== null && a.dueDate !== undefined && a.dueDate < today;
    const bOverdue = b.dueDate !== null && b.dueDate !== undefined && b.dueDate < today;

    // Overdue takes precedence over due today
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;

    // Between two overdue items: older due date first
    if (aOverdue && bOverdue && a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
  }

  // Priority weight (if applicable)
  const aPrio = a.priority ? PRIORITY_WEIGHT[a.priority] : 2;
  const bPrio = b.priority ? PRIORITY_WEIGHT[b.priority] : 2;
  if (aPrio !== bPrio) return aPrio - bPrio;

  // Sub-rank (e.g. prep item position or review urgency)
  const aSub = a.subRank ?? 0;
  const bSub = b.subRank ?? 0;
  if (aSub !== bSub) return aSub - bSub;

  // Due date if one has a due date and the other does not
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
    return a.dueDate.localeCompare(b.dueDate);
  }

  // Stable tie-breakers: title then unique ID
  const titleDiff = a.title.localeCompare(b.title);
  if (titleDiff !== 0) return titleDiff;

  return a.id.localeCompare(b.id);
}

/**
 * Validates whether a source ID actually exists in the provided sources.
 */
export function isSourceIdValid(
  sourceId: Id,
  sourceType: SourceType,
  sources: RecommendationSources,
): boolean {
  switch (sourceType) {
    case "action":
      return (sources.actions ?? []).some((a) => a.id === sourceId);
    case "note":
      return (sources.notes ?? []).some((n) => n.id === sourceId);
    case "prep_item":
      return (sources.prepItems ?? []).some((p) => p.id === sourceId);
    case "material":
      return (sources.materials ?? []).some((m) => m.id === sourceId);
    case "question":
      return (sources.questions ?? []).some((q) => q.id === sourceId);
    case "event":
      return (sources.events ?? []).some((e) => e.id === sourceId);
    case "journal":
      return (sources.journalEntries ?? []).some((j) => j.id === sourceId);
    case "goal":
      return false; // goals not in recommendation sources directly
    default:
      return false;
  }
}

/**
 * Transforms application domain entities into recommendation candidates.
 *
 * Ensures:
 * - Debrief actions and debrief questions are neither lost nor duplicated.
 * - Every displayed reason source ID is guaranteed valid (falls back gracefully if source unavailable).
 * - Unestimated tasks preserve estimatedMinutes = null (no invented durations).
 */
export function buildRecommendationCandidates(
  sources: RecommendationSources,
  referenceDate?: IsoDate,
): RecommendationCandidate[] {
  const candidates: RecommendationCandidate[] = [];
  const today = referenceDate ?? sources.today;

  const pinnedSet = new Set<Id>(
    sources.pinnedActionIds instanceof Set
      ? sources.pinnedActionIds
      : sources.pinnedActionIds ?? [],
  );

  // 1. User-pinned notes
  for (const note of sources.notes ?? []) {
    if (note.pinned) {
      const displayTitle = note.title.trim() || note.body.slice(0, 50).trim() || "Pinned note";
      candidates.push({
        id: `note:${note.id}`,
        title: displayTitle,
        kind: "note",
        precedence: "pinned",
        estimatedMinutes: null, // Notes have unknown/no estimate
        reason: {
          summary: "User-pinned note",
          sourceType: "note",
          sourceId: note.id,
        },
        createdAt: note.createdAt,
      });
    }
  }

  // Find next upcoming flight lesson for preparation context
  const upcomingLesson = (sources.events ?? [])
    .filter((e) => e.eventType === "flight_lesson" && e.date >= today && e.status === "scheduled")
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  // 2. Next-lesson preparation: Checklist items
  if (upcomingLesson) {
    const lessonPrepItems = (sources.prepItems ?? []).filter(
      (p) => p.eventId === upcomingLesson.id && !p.done,
    );
    for (let i = 0; i < lessonPrepItems.length; i++) {
      const item = lessonPrepItems[i];
      if (!item) continue;
      candidates.push({
        id: `prep:${item.id}`,
        title: item.title,
        kind: "lesson_prep",
        precedence: "lesson_prep",
        estimatedMinutes: null, // Prep checklist items are unestimated
        subRank: i,
        reason: {
          summary: `Preparation for upcoming lesson: ${upcomingLesson.title}`,
          sourceType: "event",
          sourceId: upcomingLesson.id,
        },
      });
    }

    // Next-lesson preparation: Questions saved specifically for this lesson
    const lessonQuestions = (sources.questions ?? []).filter(
      (q) => q.eventId === upcomingLesson.id && q.status === "to_ask",
    );
    for (let i = 0; i < lessonQuestions.length; i++) {
      const q = lessonQuestions[i];
      if (!q) continue;
      candidates.push({
        id: `question:${q.id}`,
        title: q.text,
        kind: "question",
        precedence: "lesson_prep",
        estimatedMinutes: null,
        subRank: 100 + i,
        reason: {
          summary: `Question to ask during upcoming lesson: ${upcomingLesson.title}`,
          sourceType: "event",
          sourceId: upcomingLesson.id,
        },
      });
    }
  }

  // 3. Next Actions (Pinned, Due, Debrief, and Open)
  for (const action of sources.actions ?? []) {
    if (action.status !== "open") continue;

    const isPinned = pinnedSet.has(action.id);
    const isOverdue = action.dueDate !== null && action.dueDate < today;
    const isDueToday = action.dueDate !== null && action.dueDate === today;

    let precedence: RecommendationPrecedence = "open_action";
    let summary = "Open action";
    let sourceType: SourceType = "action";
    let sourceId: Id = action.id;

    const homework = (sources.homework ?? []).find((h) => h.assignment.action_id === action.id);
    if (homework) {
      if (isPinned) {
        precedence = "pinned";
        summary = "User-pinned action";
      } else if (isDueToday) {
        precedence = "due_action";
        summary = "Homework due today";
      } else if (isOverdue) {
        precedence = "due_action";
        summary = `Homework overdue since ${formatShortDate(action.dueDate!, today)}`;
      } else if (homework.assignment.lesson_id || homework.assignment.source_lesson_id) {
        const lessonId = (homework.assignment.lesson_id ?? homework.assignment.source_lesson_id)!;
        const lesson = (sources.events ?? []).find((e) => e.id === lessonId);
        precedence = "lesson_prep";
        summary = lesson ? `Preparation for ${lesson.title}` : "Preparation for lesson";
        sourceType = "event";
        sourceId = lessonId;
      } else {
        precedence = "open_action";
        summary = "Self-directed homework";
      }
    } else if (isPinned) {
      precedence = "pinned";
      summary = "User-pinned action";
    } else if (isOverdue) {
      precedence = "due_action";
      summary = `Overdue since ${action.dueDate}`;
    } else if (isDueToday) {
      precedence = "due_action";
      summary = "Due today";
    } else if (action.relatedType === "journal" && action.relatedId) {
      // Debrief-created action
      const journalExists = (sources.journalEntries ?? []).some((j) => j.id === action.relatedId);
      if (journalExists) {
        sourceType = "journal";
        sourceId = action.relatedId;
        summary = "Action from flight debrief";
      } else {
        // Journal entry deleted / unavailable: fallback safely to the action itself (avoid dangling explanation link)
        sourceType = "action";
        sourceId = action.id;
        summary = "Action from flight debrief (source entry unavailable)";
      }
    }

    candidates.push({
      id: `action:${action.id}`,
      title: action.title,
      kind: "action",
      precedence,
      estimatedMinutes: action.estimatedMinutes,
      priority: action.priority,
      category: action.category,
      dueDate: action.dueDate,
      createdAt: action.createdAt,
      reason: {
        summary,
        sourceType,
        sourceId,
      },
    });
  }

  // 4. Study: Materials needing review or actively being studied (not described as "due" without due date)
  for (const material of sources.materials ?? []) {
    if (material.reviewStatus === "needs_review") {
      candidates.push({
        id: `material:${material.id}`,
        title: `Review: ${material.title}`,
        kind: "study_material",
        precedence: "study",
        estimatedMinutes: null, // Study materials are unestimated
        subRank: 1, // higher urgency than studying
        reason: {
          summary: `Look at this again: ${material.title}`,
          sourceType: "material",
          sourceId: material.id,
        },
      });
    } else if (material.reviewStatus === "studying") {
      candidates.push({
        id: `material:${material.id}`,
        title: `Study: ${material.title}`,
        kind: "study_material",
        precedence: "study",
        estimatedMinutes: null, // Study materials are unestimated
        subRank: 2,
        reason: {
          summary: `Active study material: ${material.title}`,
          sourceType: "material",
          sourceId: material.id,
        },
      });
    }
  }

  // 5. Debrief & General Instructor Questions (not already attached to upcoming lesson)
  for (const q of sources.questions ?? []) {
    if (q.status !== "to_ask") continue;
    // Skip if already included under upcoming lesson prep
    if (upcomingLesson && q.eventId === upcomingLesson.id) continue;

    let summary = "Question for instructor";
    let sourceType: SourceType = "question";
    let sourceId: Id = q.id;

    if (q.journalId) {
      const journalExists = (sources.journalEntries ?? []).some((j) => j.id === q.journalId);
      if (journalExists) {
        summary = "Question saved during flight debrief";
        sourceType = "journal";
        sourceId = q.journalId;
      } else {
        summary = "Question from flight debrief (source entry unavailable)";
        sourceType = "question";
        sourceId = q.id;
      }
    }

    candidates.push({
      id: `question:${q.id}`,
      title: q.text,
      kind: "question",
      precedence: "study",
      estimatedMinutes: null,
      subRank: 3,
      reason: {
        summary,
        sourceType,
        sourceId,
      },
      createdAt: q.createdAt,
    });
  }

  return candidates;
}

/**
 * Pure recommendation selector.
 *
 * Given a list of candidates and options:
 * 1. Orders candidates deterministically using strict precedence and stable tie-breaking.
 * 2. If a time budget (10, 20, 30 min) is specified:
 *    - Tasks with known estimatedMinutes are allocated within the timed budget.
 *    - Tasks with unknown/null estimates are NEVER assigned an invented duration; they remain
 *      reachable in priority order up to maxItems without claiming full session fit.
 *    - Tasks that exceed the remaining timed allocation are placed in `remaining`.
 * 3. If no time budget is specified:
 *    - Up to `maxItems` (default 3) candidates are placed in `suggested`, regardless of duration.
 *    - Remaining candidates are placed in `remaining`.
 * 4. Yields identical ordering and explanations for identical inputs and date.
 */
export function selectRecommendations(
  candidates: readonly RecommendationCandidate[],
  options?: RecommendationOptions,
): RecommendationResult {
  const budget = options?.timeBudget ?? null;
  const maxItems = options?.maxItems ?? 3;
  const today = options?.today;

  // Stable sort of all candidates
  const sorted = [...candidates].sort((a, b) => compareCandidates(a, b, today));

  interface PlacedItem {
    candidate: RecommendationCandidate;
    destination: "suggested" | "remaining";
    reasonTag: "timed_fits" | "exceeds_budget" | "unknown_timed" | "untimed" | "overflow";
    requiredMinutes?: number;
    availableMinutes?: number;
  }

  const placed: PlacedItem[] = [];
  let totalEstimatedMinutes = 0;
  let unestimatedCount = 0;
  let suggestedCount = 0;

  for (const candidate of sorted) {
    if (candidate.estimatedMinutes === null) {
      unestimatedCount++;
    }

    if (budget !== null && budget > 0) {
      if (suggestedCount < maxItems) {
        if (candidate.estimatedMinutes !== null) {
          if (totalEstimatedMinutes + candidate.estimatedMinutes <= budget) {
            totalEstimatedMinutes += candidate.estimatedMinutes;
            suggestedCount++;
            placed.push({
              candidate,
              destination: "suggested",
              reasonTag: "timed_fits",
            });
          } else {
            placed.push({
              candidate,
              destination: "remaining",
              reasonTag: "exceeds_budget",
              requiredMinutes: candidate.estimatedMinutes,
              availableMinutes: budget - totalEstimatedMinutes,
            });
          }
        } else {
          // Unestimated task: keep visibly unknown duration (null, never fabricated or treated as zero)
          // Keep valid work reachable by priority without claiming the session fits the budget
          suggestedCount++;
          placed.push({
            candidate,
            destination: "suggested",
            reasonTag: "unknown_timed",
          });
        }
      } else {
        placed.push({
          candidate,
          destination: "remaining",
          reasonTag: "overflow",
        });
      }
    } else {
      // Untimed mode: suggest up to maxItems from top precedence
      if (suggestedCount < maxItems) {
        if (candidate.estimatedMinutes !== null) {
          totalEstimatedMinutes += candidate.estimatedMinutes;
        }
        suggestedCount++;
        placed.push({
          candidate,
          destination: "suggested",
          reasonTag: "untimed",
        });
      } else {
        placed.push({
          candidate,
          destination: "remaining",
          reasonTag: "overflow",
        });
      }
    }
  }

  const suggestedUnestimatedCount = placed.filter(
    (p) => p.destination === "suggested" && p.candidate.estimatedMinutes === null,
  ).length;
  const hasUnknownSuggested = suggestedUnestimatedCount > 0;
  const fitsBudgetCompletely =
    budget !== null && budget > 0
      ? suggestedCount > 0 && !hasUnknownSuggested && totalEstimatedMinutes <= budget
      : true;

  const suggested: Recommendation[] = [];
  const remaining: Recommendation[] = [];

  for (const item of placed) {
    const { candidate, destination, reasonTag, requiredMinutes, availableMinutes } = item;
    let explanation: string;

    if (destination === "suggested") {
      if (budget !== null && budget > 0) {
        if (candidate.estimatedMinutes === null && candidate.kind === "study_material") {
          // Study materials never carry an estimate; the suffix would repeat on every card.
          explanation = candidate.reason.summary;
        } else if (candidate.estimatedMinutes === null) {
          explanation = `${candidate.reason.summary} · No time estimate yet, included because it's important`;
        } else if (hasUnknownSuggested) {
          explanation = `${candidate.reason.summary} · About ${candidate.estimatedMinutes} min`;
        } else {
          // All suggested items have known estimates: full fit can be claimed
          const remainingMinutes = budget - totalEstimatedMinutes;
          explanation = `${candidate.reason.summary} · Fits ${budget}-min session (${candidate.estimatedMinutes} min, ${remainingMinutes} min remaining)`;
        }
      } else {
        explanation = candidate.reason.summary;
      }
      suggested.push({
        ...candidate,
        explanation,
      });
    } else {
      if (reasonTag === "exceeds_budget" && requiredMinutes !== undefined && availableMinutes !== undefined) {
        explanation = `${candidate.reason.summary} · Exceeds remaining timed allocation (${requiredMinutes} min vs ${availableMinutes} min left)`;
      } else {
        explanation = `${candidate.reason.summary} · Available in unfinished work`;
      }
      remaining.push({
        ...candidate,
        explanation,
      });
    }
  }

  return {
    suggested,
    remaining,
    totalEstimatedMinutes,
    allocatedMinutes: totalEstimatedMinutes,
    suggestedUnestimatedCount,
    timeBudget: budget,
    unestimatedCount,
    fitsBudgetCompletely,
  };
}

/**
 * End-to-end pure recommendation selector from domain sources.
 */
export function getRecommendations(
  sources: RecommendationSources,
  options?: RecommendationOptions,
): RecommendationResult {
  const effectiveToday = options?.today ?? sources.today;
  const candidates = buildRecommendationCandidates(sources, effectiveToday);
  const effectiveOptions: RecommendationOptions = {
    ...options,
    today: effectiveToday,
  };
  return selectRecommendations(candidates, effectiveOptions);
}
