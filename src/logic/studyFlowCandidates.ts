/**
 * Pure projection of Daily Plan recommendations into source-backed study-flow destinations.
 *
 * STUDY-FLOW-01a:
 * - Projects already-computed Daily Plan suggested items into read-only study flow candidates.
 * - Reuses existing getStartTarget for baseline navigation, layering only necessary homework and
 *   missing-target overrides.
 * - Distinguishes honest navigation modes:
 *     - "continue": only for active, uncompleted homework activities with durable in_progress/reopened state
 *                   and verified matching uninvalidated active runs.
 *     - "start": newly starting upcoming work or non-homework activities.
 *     - "open": safe read-only history or repair destinations (archived/completed homework, missing actions,
 *               missing homework materials).
 * - Distinguishes record presence (sourceAvailable) from destination source readiness (requiresSourceCheck):
 *     destination HomeworkView remains authoritative for source revision/file/offline checks.
 * - Pure: zero database writes, zero network, zero side-effects, no mutation of inputs.
 */

import type { Id } from "@/domain/types";
import type { HomeworkCardRun, HomeworkTestRun } from "@/domain/homework";
import {
  isSourceIdValid,
  type Recommendation,
  type RecommendationPrecedence,
  type RecommendationReason,
  type RecommendationResult,
  type RecommendationSources,
} from "./recommendations";
import { getStartTarget, type StartTarget } from "./dailyPlan";

export type StudyFlowKind = "start" | "continue" | "open";

export type StudyFlowTargetRole =
  | "homework"
  | "material"
  | "lesson"
  | "journal"
  | "flight_path"
  | "questions"
  | "notes"
  | "local_action";

export interface StudyFlowCandidate {
  readonly id: Id;
  readonly title: string;
  readonly precedence: RecommendationPrecedence;
  readonly estimatedMinutes: number | null;
  readonly reason: RecommendationReason;
  readonly target: StartTarget;
  readonly flowKind: StudyFlowKind;
  readonly isContinue: boolean;
  readonly targetRole: StudyFlowTargetRole;
  readonly sourceAvailable: boolean;
  readonly requiresSourceCheck: boolean;
  readonly assignmentId?: string;
  readonly activityId?: string;
  readonly activityState?: "upcoming" | "in_progress" | "reopened" | "completed";
}

function resolveHomeworkCandidate(
  item: Recommendation,
  actionId: string,
  sources: RecommendationSources,
): StudyFlowCandidate | null {
  const homeworkList = sources.homework;
  if (!homeworkList || homeworkList.length === 0) return null;

  const assignmentSnapshot = homeworkList.find((h) => h.assignment.action_id === actionId);
  if (!assignmentSnapshot) return null;

  const { assignment, activities, runs = [] } = assignmentSnapshot;
  const assignmentId = assignment.id;

  const baseReason: RecommendationReason = {
    summary: item.reason.summary,
    sourceType: item.reason.sourceType,
    sourceId: item.reason.sourceId,
  };

  // 1. Archived assignment: safe read-only parent destination, never start or continue
  if (assignment.archived === 1) {
    return {
      id: item.id,
      title: item.title,
      precedence: item.precedence,
      estimatedMinutes: item.estimatedMinutes,
      reason: baseReason,
      target: {
        path: `/study/homework/${assignmentId}`,
        label: `Open homework for ${item.title}`,
      },
      flowKind: "open",
      isContinue: false,
      targetRole: "homework",
      sourceAvailable: true,
      requiresSourceCheck: false,
      assignmentId,
    };
  }

  // 2. Active unremoved incomplete activities, ordered by position and stable ID tie-break
  const unremovedIncomplete = activities
    .filter((a) => !a.record.removed_at && a.record.state !== "completed")
    .sort((a, b) => {
      const posDiff = a.record.position - b.record.position;
      if (posDiff !== 0) return posDiff;
      return a.record.id.localeCompare(b.record.id);
    });

  // 3. Completed assignment: safe read-only parent destination
  if (unremovedIncomplete.length === 0 || assignment.state === "completed") {
    return {
      id: item.id,
      title: item.title,
      precedence: item.precedence,
      estimatedMinutes: item.estimatedMinutes,
      reason: baseReason,
      target: {
        path: `/study/homework/${assignmentId}`,
        label: `Open homework for ${item.title}`,
      },
      flowKind: "open",
      isContinue: false,
      targetRole: "homework",
      sourceAvailable: true,
      requiresSourceCheck: false,
      assignmentId,
      activityState: "completed",
    };
  }

  const earliest = unremovedIncomplete[0]!;
  const activity = earliest.record;
  const activityId = activity.id;
  const activityState = activity.state;

  // 4. Source record presence check
  const materialId = activity.source_material_id ?? activity.material_id;
  let sourceAvailable = true;
  if (materialId && !isSourceIdValid(materialId, "material", sources)) {
    sourceAvailable = false;
  }

  // 5. Missing source: safe open repair destination, never continue
  if (!sourceAvailable) {
    return {
      id: item.id,
      title: item.title,
      precedence: item.precedence,
      estimatedMinutes: item.estimatedMinutes,
      reason: baseReason,
      target: {
        path: `/study/homework/${assignmentId}?activity=${activityId}`,
        label: `Open homework for ${item.title}`,
      },
      flowKind: "open",
      isContinue: false,
      targetRole: "homework",
      sourceAvailable: false,
      requiresSourceCheck: false,
      assignmentId,
      activityId,
      activityState,
    };
  }

  // 6. Source is present in record: check if destination HomeworkView must verify source readiness
  const isSourceBackedKind =
    activity.kind === "read" || activity.kind === "cards" || activity.kind === "test";
  const requiresSourceCheck = isSourceBackedKind;

  // 7. Determine honest start vs continue
  // Assignment must be active (in_progress or reopened) and activity must be in_progress or reopened
  const isAssignmentActive =
    assignment.state === "in_progress" || assignment.state === "reopened";
  const isActivityActive =
    activityState === "in_progress" || activityState === "reopened";

  let isContinue = false;
  if (isAssignmentActive && isActivityActive) {
    if (activity.kind === "cards") {
      const activeCardRun = runs.find((r): r is HomeworkCardRun => {
        if (r.kind !== "cards") return false;
        if (r.activity_id !== activityId) return false;
        if (r.cycle !== activity.cycle) return false;
        if (r.activity_revision !== activity.revision) return false;
        if (r.finished_at !== null || r.invalidated_at !== null) return false;
        if (
          activity.source_material_id === null ||
          r.scope.material_id !== activity.source_material_id
        ) {
          return false;
        }
        if (
          activity.source_revision === null ||
          r.scope.source_revision !== activity.source_revision
        ) {
          return false;
        }
        if (activity.card_set_id === null || r.scope.card_set_id !== activity.card_set_id) {
          return false;
        }
        return true;
      });
      isContinue = Boolean(activeCardRun);
    } else if (activity.kind === "test") {
      const activeTestRun = runs.find((r): r is HomeworkTestRun => {
        if (r.kind !== "test") return false;
        if (r.activity_id !== activityId) return false;
        if (r.cycle !== activity.cycle) return false;
        if (r.activity_revision !== activity.revision) return false;
        if (r.finished_at !== null || r.invalidated_at !== null) return false;
        if (
          activity.source_material_id === null ||
          r.scope.material_id !== activity.source_material_id
        ) {
          return false;
        }
        if (
          activity.source_revision === null ||
          r.scope.source_revision !== activity.source_revision
        ) {
          return false;
        }
        const testVersionId = activity.source_test_version_id ?? activity.test_version_id;
        if (testVersionId === null || r.scope.test_version_id !== testVersionId) {
          return false;
        }
        return true;
      });
      isContinue = Boolean(activeTestRun);
    } else if (activity.kind === "read") {
      const hasValidReadScope =
        activity.source_material_id !== null &&
        activity.source_revision !== null &&
        activity.page_end !== null;
      isContinue = hasValidReadScope;
    } else {
      isContinue = true;
    }
  }

  const flowKind: StudyFlowKind = isContinue ? "continue" : "start";
  const label = isContinue
    ? `Continue homework for ${item.title}`
    : `Open homework for ${item.title}`;

  return {
    id: item.id,
    title: item.title,
    precedence: item.precedence,
    estimatedMinutes: item.estimatedMinutes,
    reason: baseReason,
    target: {
      path: `/study/homework/${assignmentId}?activity=${activityId}`,
      label,
    },
    flowKind,
    isContinue,
    targetRole: "homework",
    sourceAvailable: true,
    requiresSourceCheck,
    assignmentId,
    activityId,
    activityState,
  };
}

/**
 * Projects a single Daily Plan recommendation item into a source-backed StudyFlowCandidate.
 */
export function projectRecommendationToStudyFlow(
  item: Recommendation,
  sources: RecommendationSources,
): StudyFlowCandidate {
  const baseReason: RecommendationReason = {
    summary: item.reason.summary,
    sourceType: item.reason.sourceType,
    sourceId: item.reason.sourceId,
  };

  // 1. Check for homework assignment bound to action
  const actionId =
    item.kind === "action"
      ? item.reason.sourceType === "action"
        ? item.reason.sourceId
        : item.id.replace(/^action:/, "")
      : null;

  if (actionId !== null) {
    const action = (sources.actions ?? []).find((a) => a.id === actionId);
    if (!action) {
      // Missing action: generic Flight Deck Open without nonexistent elementId
      return {
        id: item.id,
        title: item.title,
        precedence: item.precedence,
        estimatedMinutes: item.estimatedMinutes,
        reason: baseReason,
        target: {
          path: "/",
          label: "Open Flight Deck",
        },
        flowKind: "open",
        isContinue: false,
        targetRole: "local_action",
        sourceAvailable: false,
        requiresSourceCheck: false,
      };
    }

    const hwCandidate = resolveHomeworkCandidate(item, actionId, sources);
    if (hwCandidate) return hwCandidate;

    // Reuse getStartTarget for action
    const target = getStartTarget(item, sources);
    let sourceAvailable = true;
    let targetRole: StudyFlowTargetRole = "local_action";
    let requiresSourceCheck = false;

    if (action.relatedType === "journal") {
      sourceAvailable = Boolean(
        action.relatedId && isSourceIdValid(action.relatedId, "journal", sources),
      );
      targetRole = sourceAvailable ? "journal" : "local_action";
    } else if (action.relatedType === "material") {
      sourceAvailable = Boolean(
        action.relatedId && isSourceIdValid(action.relatedId, "material", sources),
      );
      targetRole = sourceAvailable ? "material" : "local_action";
      if (sourceAvailable) {
        requiresSourceCheck = true;
      }
    } else if (action.relatedType === "event") {
      sourceAvailable = Boolean(
        action.relatedId && isSourceIdValid(action.relatedId, "event", sources),
      );
      targetRole = sourceAvailable ? "lesson" : "local_action";
    } else if (action.relatedType === "goal") {
      targetRole = "flight_path";
    }

    const flowKind: StudyFlowKind = sourceAvailable ? "start" : "open";

    return {
      id: item.id,
      title: item.title,
      precedence: item.precedence,
      estimatedMinutes: item.estimatedMinutes,
      reason: baseReason,
      target,
      flowKind,
      isContinue: false,
      targetRole,
      sourceAvailable,
      requiresSourceCheck,
    };
  }

  // 2. Study material recommendation
  if (item.kind === "study_material") {
    const materialId = item.reason.sourceId;
    const sourceAvailable = isSourceIdValid(materialId, "material", sources);
    const target = sourceAvailable
      ? getStartTarget(item, sources)
      : { path: "/study", label: `Study ${item.title}` };

    return {
      id: item.id,
      title: item.title,
      precedence: item.precedence,
      estimatedMinutes: item.estimatedMinutes,
      reason: baseReason,
      target,
      flowKind: sourceAvailable ? "start" : "open",
      isContinue: false,
      targetRole: "material",
      sourceAvailable,
      requiresSourceCheck: sourceAvailable,
    };
  }

  // 3. Lesson prep recommendation
  if (item.kind === "lesson_prep") {
    if (item.reason.sourceType === "event") {
      const eventId = item.reason.sourceId;
      const sourceAvailable = isSourceIdValid(eventId, "event", sources);
      const target = sourceAvailable
        ? getStartTarget(item, sources)
        : { path: "/schedule", label: `Open schedule for ${item.title}` };

      return {
        id: item.id,
        title: item.title,
        precedence: item.precedence,
        estimatedMinutes: item.estimatedMinutes,
        reason: baseReason,
        target,
        flowKind: sourceAvailable ? "start" : "open",
        isContinue: false,
        targetRole: "lesson",
        sourceAvailable,
        requiresSourceCheck: false,
      };
    }

    return {
      id: item.id,
      title: item.title,
      precedence: item.precedence,
      estimatedMinutes: item.estimatedMinutes,
      reason: baseReason,
      target: getStartTarget(item, sources),
      flowKind: "start",
      isContinue: false,
      targetRole: "lesson",
      sourceAvailable: true,
      requiresSourceCheck: false,
    };
  }

  // 4. Question recommendation
  if (item.kind === "question") {
    if (item.reason.sourceType === "event") {
      const eventId = item.reason.sourceId;
      const sourceAvailable = isSourceIdValid(eventId, "event", sources);
      const target = sourceAvailable
        ? getStartTarget(item, sources)
        : { path: "/questions", label: `Review question: ${item.title}` };

      return {
        id: item.id,
        title: item.title,
        precedence: item.precedence,
        estimatedMinutes: item.estimatedMinutes,
        reason: baseReason,
        target,
        flowKind: sourceAvailable ? "start" : "open",
        isContinue: false,
        targetRole: sourceAvailable ? "lesson" : "questions",
        sourceAvailable,
        requiresSourceCheck: false,
      };
    }

    const questionId = item.reason.sourceId;
    const sourceAvailable = isSourceIdValid(questionId, "question", sources);
    const target = sourceAvailable
      ? getStartTarget(item, sources)
      : { path: "/questions", label: `Review question: ${item.title}` };
    return {
      id: item.id,
      title: item.title,
      precedence: item.precedence,
      estimatedMinutes: item.estimatedMinutes,
      reason: baseReason,
      target,
      flowKind: sourceAvailable ? "start" : "open",
      isContinue: false,
      targetRole: "questions",
      sourceAvailable,
      requiresSourceCheck: false,
    };
  }

  // 5. Note recommendation
  if (item.kind === "note") {
    const noteId = item.reason.sourceId;
    const sourceAvailable = isSourceIdValid(noteId, "note", sources);
    const target = sourceAvailable
      ? getStartTarget(item, sources)
      : { path: "/notes", label: `View pinned note: ${item.title}` };
    return {
      id: item.id,
      title: item.title,
      precedence: item.precedence,
      estimatedMinutes: item.estimatedMinutes,
      reason: baseReason,
      target,
      flowKind: sourceAvailable ? "start" : "open",
      isContinue: false,
      targetRole: "notes",
      sourceAvailable,
      requiresSourceCheck: false,
    };
  }

  // Default fallback
  return {
    id: item.id,
    title: item.title,
    precedence: item.precedence,
    estimatedMinutes: item.estimatedMinutes,
    reason: baseReason,
    target: getStartTarget(item, sources),
    flowKind: "start",
    isContinue: false,
    targetRole: "local_action",
    sourceAvailable: true,
    requiresSourceCheck: false,
  };
}

/**
 * Projects the already-computed Daily Plan suggested items into source-backed study-flow destinations.
 *
 * Guarantees:
 * - Preserves exact suggested item order, IDs, precedence, and duration estimates (including null).
 * - Excludes remaining items outside the suggested list.
 * - Honest start/continue/open distinction: "continue" only for durable in_progress/reopened homework activities
 *   with matching verified runs; "open" for archived/completed work or missing sources.
 * - Safe target fallbacks when linked sources (material, event, journal) are missing: never dangling routes.
 * - Pure: zero mutation of inputs, zero storage or network access.
 */
export function buildStudyFlowCandidates(
  planOrSuggested: RecommendationResult | readonly Recommendation[],
  sources: RecommendationSources,
): readonly StudyFlowCandidate[] {
  const suggested: readonly Recommendation[] =
    "suggested" in planOrSuggested && Array.isArray(planOrSuggested.suggested)
      ? planOrSuggested.suggested
      : Array.isArray(planOrSuggested)
      ? planOrSuggested
      : [];

  return suggested.map((item) => projectRecommendationToStudyFlow(item, sources));
}
