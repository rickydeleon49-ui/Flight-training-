import { describe, expect, it } from "vitest";

import {
  validateHomeworkSnapshot,
  type HomeworkCardRun,
  type HomeworkSnapshot,
  type HomeworkTestRun,
} from "@/domain/homework";
import type { NextAction, StudyMaterial } from "@/domain/types";
import {
  makeAction,
  makeEvent,
  makeJournalEntry,
  makeMaterial,
  makeNote,
  makeQuestion,
} from "@/testing/factories";
import {
  buildStudyFlowCandidates,
  projectRecommendationToStudyFlow,
} from "./studyFlowCandidates";
import type {
  Recommendation,
  RecommendationResult,
  RecommendationSources,
} from "./recommendations";

const TODAY = "2026-09-25";
const NOW = "2026-09-25T10:00:00.000Z";

const VALID_ASSIGNMENT_ID = "10000000-0000-4000-8000-000000000001";
const VALID_ACTION_ID = "20000000-0000-4000-8000-000000000002";
const VALID_ACTIVITY_ID = "30000000-0000-4000-8000-000000000003";
const VALID_MATERIAL_ID = "40000000-0000-4000-8000-000000000004";
const VALID_RUN_ID = "50000000-0000-4000-8000-000000000005";
const VALID_TEST_VERSION_ID = "60000000-0000-4000-8000-000000000006";
const VALID_ATTEMPT_ID = "70000000-0000-4000-8000-000000000007";
const VALID_HASH_A = "a".repeat(64);
const VALID_HASH_B = "b".repeat(64);
const VALID_HASH_C = "c".repeat(64);

function mockRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: `action:${VALID_ACTION_ID}`,
    title: "Preflight inspection checklist",
    kind: "action",
    precedence: "due_action",
    estimatedMinutes: 15,
    reason: {
      summary: "Due today",
      sourceType: "action",
      sourceId: VALID_ACTION_ID,
    },
    explanation: "Due today · Fits 20-min session",
    ...overrides,
  };
}

/**
 * Builds a valid domain HomeworkSnapshot for an in_progress "read" activity,
 * verifying it through validateHomeworkSnapshot before returning.
 */
function createValidReadHomework(overrides?: {
  state?: "upcoming" | "in_progress" | "reopened" | "completed";
  materialId?: string;
  sourceRevision?: string;
}): HomeworkSnapshot {
  const materialId = overrides?.materialId ?? VALID_MATERIAL_ID;
  const sourceRevision = overrides?.sourceRevision ?? VALID_HASH_A;
  const activityState = overrides?.state ?? "in_progress";
  const assignmentState = activityState === "upcoming" ? "upcoming" : "in_progress";

  const snapshot: HomeworkSnapshot = {
    version: 1,
    assignment: {
      id: VALID_ASSIGNMENT_ID,
      title: "FAR Reading Assignment",
      instructions: "",
      school: null,
      instructor: null,
      lesson_id: null,
      source_lesson_id: null,
      due_date: null,
      state: assignmentState,
      revision: 1,
      action_id: VALID_ACTION_ID,
      archived: 0,
      created_at: NOW,
      updated_at: NOW,
      completed_at: null,
    },
    activities: [
      {
        record: {
          id: VALID_ACTIVITY_ID,
          assignment_id: VALID_ASSIGNMENT_ID,
          position: 0,
          kind: "read",
          title: "FAR Part 61",
          body: "",
          material_id: materialId,
          source_material_id: materialId,
          source_revision: sourceRevision,
          card_set_id: null,
          test_version_id: null,
          source_test_version_id: null,
          page_start: 1,
          page_end: 20,
          state: activityState,
          cycle: 1,
          revision: 1,
          created_at: NOW,
          updated_at: NOW,
          completed_at: null,
          removed_at: null,
        },
        source: {
          title: "FAR/AIM Manual",
          total_pages: 100,
        },
        evidence: null,
      },
    ],
    runs: [],
  };

  return validateHomeworkSnapshot(snapshot);
}

/**
 * Builds a valid domain HomeworkSnapshot for an in_progress "cards" activity with an active run,
 * verifying it through validateHomeworkSnapshot before returning.
 */
function createValidCardsHomework(overrides?: {
  activeRun?: boolean;
  finishedRun?: boolean;
  invalidatedRun?: boolean;
}): HomeworkSnapshot {
  const isFinished = overrides?.finishedRun ?? false;
  const isInvalidated = overrides?.invalidatedRun ?? false;
  const hasRun = overrides?.activeRun ?? true;

  const finishedAt = isFinished ? "2026-09-25T10:15:00.000Z" : null;
  const invalidatedAt = isInvalidated ? "2026-09-25T10:10:00.000Z" : null;
  const activityState = isFinished ? "completed" : isInvalidated ? "upcoming" : "in_progress";
  const assignmentState = isFinished ? "completed" : isInvalidated ? "upcoming" : "in_progress";
  const completedAt = isFinished ? finishedAt : null;
  const updatedAt = isFinished ? finishedAt! : isInvalidated ? invalidatedAt! : NOW;

  const runs: HomeworkCardRun[] = hasRun
    ? [
        {
          id: VALID_RUN_ID,
          activity_id: VALID_ACTIVITY_ID,
          cycle: 1,
          activity_revision: 1,
          kind: "cards",
          scope: {
            version: 1,
            material_id: VALID_MATERIAL_ID,
            source_revision: VALID_HASH_A,
            card_set_id: VALID_HASH_B,
            generation: 1,
            item_ids: [VALID_HASH_C],
            next_local_midnight: "2026-09-25T20:00:00.000Z",
          },
          ratings: isFinished
            ? [
                {
                  event_id: VALID_RUN_ID,
                  operation_id: VALID_RUN_ID,
                  item_id: VALID_HASH_C,
                  generation: 1,
                  reviewed_at: finishedAt!,
                  rating: "good",
                  item_revision: 1,
                  assignment_revision: 1,
                },
              ]
            : [],
          started_at: NOW,
          finished_at: finishedAt,
          invalidated_at: invalidatedAt,
        },
      ]
    : [];

  const snapshot: HomeworkSnapshot = {
    version: 1,
    assignment: {
      id: VALID_ASSIGNMENT_ID,
      title: "Airspace Flashcards Assignment",
      instructions: "",
      school: null,
      instructor: null,
      lesson_id: null,
      source_lesson_id: null,
      due_date: null,
      state: assignmentState,
      revision: isFinished ? 2 : 1,
      action_id: VALID_ACTION_ID,
      archived: 0,
      created_at: NOW,
      updated_at: updatedAt,
      completed_at: completedAt,
    },
    activities: [
      {
        record: {
          id: VALID_ACTIVITY_ID,
          assignment_id: VALID_ASSIGNMENT_ID,
          position: 0,
          kind: "cards",
          title: "Airspace Flashcards",
          body: "",
          material_id: VALID_MATERIAL_ID,
          source_material_id: VALID_MATERIAL_ID,
          source_revision: VALID_HASH_A,
          card_set_id: VALID_HASH_B,
          test_version_id: null,
          source_test_version_id: null,
          page_start: null,
          page_end: null,
          state: activityState,
          cycle: 1,
          revision: 1,
          created_at: NOW,
          updated_at: updatedAt,
          completed_at: completedAt,
          removed_at: null,
        },
        source: {
          title: "Airspace Flashcards Deck",
          total_pages: null,
        },
        evidence: isFinished
          ? {
              version: 1,
              activity_id: VALID_ACTIVITY_ID,
              revision: 1,
              cycle: 1,
              kind: "cards",
              completed_at: completedAt!,
              body: "",
              source_material_id: VALID_MATERIAL_ID,
              source_revision: VALID_HASH_A,
              page_start: null,
              page_end: null,
            }
          : null,
      },
    ],
    runs,
  };

  return validateHomeworkSnapshot(snapshot);
}

/**
 * Builds a valid domain HomeworkSnapshot for an in_progress "test" activity with an active run,
 * verifying it through validateHomeworkSnapshot before returning.
 */
function createValidTestHomework(): HomeworkSnapshot {
  const runs: HomeworkTestRun[] = [
    {
      id: VALID_RUN_ID,
      activity_id: VALID_ACTIVITY_ID,
      cycle: 1,
      activity_revision: 1,
      kind: "test",
      scope: {
        version: 1,
        material_id: VALID_MATERIAL_ID,
        source_revision: VALID_HASH_A,
        test_version_id: VALID_TEST_VERSION_ID,
        attempt_id: VALID_ATTEMPT_ID,
      },
      evidence: null,
      started_at: NOW,
      finished_at: null,
      invalidated_at: null,
    },
  ];

  const snapshot: HomeworkSnapshot = {
    version: 1,
    assignment: {
      id: VALID_ASSIGNMENT_ID,
      title: "Aerodynamics Quiz Assignment",
      instructions: "",
      school: null,
      instructor: null,
      lesson_id: null,
      source_lesson_id: null,
      due_date: null,
      state: "in_progress",
      revision: 1,
      action_id: VALID_ACTION_ID,
      archived: 0,
      created_at: NOW,
      updated_at: NOW,
      completed_at: null,
    },
    activities: [
      {
        record: {
          id: VALID_ACTIVITY_ID,
          assignment_id: VALID_ASSIGNMENT_ID,
          position: 0,
          kind: "test",
          title: "Aerodynamics Quiz",
          body: "",
          material_id: VALID_MATERIAL_ID,
          source_material_id: VALID_MATERIAL_ID,
          source_revision: VALID_HASH_A,
          card_set_id: null,
          test_version_id: VALID_TEST_VERSION_ID,
          source_test_version_id: VALID_TEST_VERSION_ID,
          page_start: null,
          page_end: null,
          state: "in_progress",
          cycle: 1,
          revision: 1,
          created_at: NOW,
          updated_at: NOW,
          completed_at: null,
          removed_at: null,
        },
        source: {
          title: "Aerodynamics Quiz",
          total_pages: null,
        },
        evidence: null,
      },
    ],
    runs,
  };

  return validateHomeworkSnapshot(snapshot);
}

/**
 * Builds a valid domain HomeworkSnapshot for a checklist activity.
 */
function createValidChecklistHomework(state: "upcoming" | "in_progress" | "reopened"): HomeworkSnapshot {
  const assignmentState = state === "upcoming" ? "upcoming" : state === "reopened" ? "reopened" : "in_progress";
  const snapshot: HomeworkSnapshot = {
    version: 1,
    assignment: {
      id: VALID_ASSIGNMENT_ID,
      title: "Preflight Checklist Homework",
      instructions: "",
      school: null,
      instructor: null,
      lesson_id: null,
      source_lesson_id: null,
      due_date: null,
      state: assignmentState,
      revision: 1,
      action_id: VALID_ACTION_ID,
      archived: 0,
      created_at: NOW,
      updated_at: NOW,
      completed_at: null,
    },
    activities: [
      {
        record: {
          id: VALID_ACTIVITY_ID,
          assignment_id: VALID_ASSIGNMENT_ID,
          position: 0,
          kind: "checklist",
          title: "Preflight Walkaround",
          body: "",
          material_id: null,
          source_material_id: null,
          source_revision: null,
          card_set_id: null,
          test_version_id: null,
          source_test_version_id: null,
          page_start: null,
          page_end: null,
          state,
          cycle: 1,
          revision: 1,
          created_at: NOW,
          updated_at: NOW,
          completed_at: null,
          removed_at: null,
        },
        source: null,
        evidence: null,
      },
    ],
    runs: [],
  };

  return validateHomeworkSnapshot(snapshot);
}

/**
 * Builds a valid domain HomeworkSnapshot for an archived assignment.
 */
function createValidArchivedHomework(): HomeworkSnapshot {
  const snapshot: HomeworkSnapshot = {
    version: 1,
    assignment: {
      id: VALID_ASSIGNMENT_ID,
      title: "Archived Homework",
      instructions: "",
      school: null,
      instructor: null,
      lesson_id: null,
      source_lesson_id: null,
      due_date: null,
      state: "upcoming",
      revision: 1,
      action_id: VALID_ACTION_ID,
      archived: 1,
      created_at: NOW,
      updated_at: NOW,
      completed_at: null,
    },
    activities: [
      {
        record: {
          id: VALID_ACTIVITY_ID,
          assignment_id: VALID_ASSIGNMENT_ID,
          position: 0,
          kind: "checklist",
          title: "Archived Task",
          body: "",
          material_id: null,
          source_material_id: null,
          source_revision: null,
          card_set_id: null,
          test_version_id: null,
          source_test_version_id: null,
          page_start: null,
          page_end: null,
          state: "upcoming",
          cycle: 1,
          revision: 1,
          created_at: NOW,
          updated_at: NOW,
          completed_at: null,
          removed_at: null,
        },
        source: null,
        evidence: null,
      },
    ],
    runs: [],
  };

  return validateHomeworkSnapshot(snapshot);
}

/**
 * Builds a valid domain HomeworkSnapshot for a completed assignment.
 */
function createValidCompletedHomework(): HomeworkSnapshot {
  const completedAt = "2026-09-25T10:30:00.000Z";
  const snapshot: HomeworkSnapshot = {
    version: 1,
    assignment: {
      id: VALID_ASSIGNMENT_ID,
      title: "Completed Homework",
      instructions: "",
      school: null,
      instructor: null,
      lesson_id: null,
      source_lesson_id: null,
      due_date: null,
      state: "completed",
      revision: 1,
      action_id: VALID_ACTION_ID,
      archived: 0,
      created_at: NOW,
      updated_at: completedAt,
      completed_at: completedAt,
    },
    activities: [
      {
        record: {
          id: VALID_ACTIVITY_ID,
          assignment_id: VALID_ASSIGNMENT_ID,
          position: 0,
          kind: "checklist",
          title: "Completed Task",
          body: "",
          material_id: null,
          source_material_id: null,
          source_revision: null,
          card_set_id: null,
          test_version_id: null,
          source_test_version_id: null,
          page_start: null,
          page_end: null,
          state: "completed",
          cycle: 1,
          revision: 1,
          created_at: NOW,
          updated_at: completedAt,
          completed_at: completedAt,
          removed_at: null,
        },
        source: null,
        evidence: {
          version: 1,
          activity_id: VALID_ACTIVITY_ID,
          revision: 1,
          cycle: 1,
          kind: "checklist",
          completed_at: completedAt,
          body: "",
          source_material_id: null,
          source_revision: null,
          page_start: null,
          page_end: null,
        },
      },
    ],
    runs: [],
  };

  return validateHomeworkSnapshot(snapshot);
}

describe("studyFlowCandidates pure contract (DIFF01-A)", () => {
  describe("cold and empty handling", () => {
    it("handles completely empty suggested items", () => {
      const sources: RecommendationSources = { today: TODAY };
      const candidates = buildStudyFlowCandidates([], sources);
      expect(candidates).toEqual([]);
    });

    it("handles RecommendationResult with empty suggested items", () => {
      const result: RecommendationResult = {
        suggested: [],
        remaining: [],
        totalEstimatedMinutes: 0,
        allocatedMinutes: 0,
        suggestedUnestimatedCount: 0,
        timeBudget: 20,
        unestimatedCount: 0,
        fitsBudgetCompletely: true,
      };
      const sources: RecommendationSources = { today: TODAY };
      const candidates = buildStudyFlowCandidates(result, sources);
      expect(candidates).toEqual([]);
    });

    it("handles minimal sources with no school, instructor, lesson, or history", () => {
      const action = makeAction({ id: VALID_ACTION_ID });
      const rec = mockRecommendation();
      const sources: RecommendationSources = { today: TODAY, actions: [action] };
      const candidates = buildStudyFlowCandidates([rec], sources);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.id).toBe(`action:${VALID_ACTION_ID}`);
      expect(candidates[0]!.flowKind).toBe("start");
      expect(candidates[0]!.isContinue).toBe(false);
      expect(candidates[0]!.target.isLocalAction).toBe(true);
      expect(candidates[0]!.requiresSourceCheck).toBe(false);
    });
  });

  describe("suggested ordering, pinning, estimates, and remaining exclusion", () => {
    it("preserves exact suggested order, IDs, precedence, and duration estimates (including null)", () => {
      const rec1 = mockRecommendation({
        id: "action:pinned-act",
        title: "Pinned task",
        precedence: "pinned",
        estimatedMinutes: null,
        reason: { summary: "Pinned", sourceType: "action", sourceId: "pinned-act" },
      });
      const rec2 = mockRecommendation({
        id: "action:due-act",
        title: "Due task",
        precedence: "due_action",
        estimatedMinutes: 20,
        reason: { summary: "Due", sourceType: "action", sourceId: "due-act" },
      });
      const rec3 = mockRecommendation({
        id: `material:${VALID_MATERIAL_ID}`,
        title: "Study aerodynamics",
        kind: "study_material",
        precedence: "study",
        estimatedMinutes: null,
        reason: { summary: "Study", sourceType: "material", sourceId: VALID_MATERIAL_ID },
      });

      const remainingRec = mockRecommendation({
        id: "action:remaining-act",
        title: "Excluded task",
      });

      const result: RecommendationResult = {
        suggested: [rec1, rec2, rec3],
        remaining: [remainingRec],
        totalEstimatedMinutes: 20,
        allocatedMinutes: 20,
        suggestedUnestimatedCount: 2,
        timeBudget: 30,
        unestimatedCount: 3,
        fitsBudgetCompletely: false,
      };

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [
          makeAction({ id: "pinned-act", title: "Pinned task" }),
          makeAction({ id: "due-act", title: "Due task" }),
        ],
        materials: [makeMaterial({ id: VALID_MATERIAL_ID, title: "Aerodynamics" })],
      };

      const candidates = buildStudyFlowCandidates(result, sources);

      expect(candidates).toHaveLength(3);
      expect(candidates.map((c) => c.id)).toEqual([
        "action:pinned-act",
        "action:due-act",
        `material:${VALID_MATERIAL_ID}`,
      ]);
      expect(candidates.map((c) => c.precedence)).toEqual(["pinned", "due_action", "study"]);
      expect(candidates.map((c) => c.estimatedMinutes)).toEqual([null, 20, null]);
      expect(candidates.map((c) => c.reason.summary)).toEqual(["Pinned", "Due", "Study"]);
      expect(candidates.some((c) => c.id === "action:remaining-act")).toBe(false);
    });
  });

  describe("frozen inputs and purity", () => {
    it("does not mutate inputs and functions seamlessly when inputs are deeply frozen", () => {
      const rec = Object.freeze(mockRecommendation());
      const action = Object.freeze(makeAction({ id: VALID_ACTION_ID }));
      const sources: RecommendationSources = Object.freeze({
        today: TODAY,
        actions: Object.freeze([action]) as readonly NextAction[],
      });

      const candidates = buildStudyFlowCandidates([rec], sources);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.id).toBe(rec.id);
      expect(Object.isFrozen(sources)).toBe(true);
      expect(Object.isFrozen(action)).toBe(true);
    });
  });

  describe("homework binding: start vs continue vs open boundaries", () => {
    it("marks an active in_progress read homework activity as continue and requiresSourceCheck: true", () => {
      const hw = createValidReadHomework({ state: "in_progress" });
      const action = makeAction({ id: VALID_ACTION_ID, title: "FAR reading" });
      const material: StudyMaterial = makeMaterial({ id: VALID_MATERIAL_ID, title: "FAR/AIM Manual" });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [hw],
        materials: [material],
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);

      expect(candidate.flowKind).toBe("continue");
      expect(candidate.isContinue).toBe(true);
      expect(candidate.targetRole).toBe("homework");
      expect(candidate.sourceAvailable).toBe(true);
      expect(candidate.requiresSourceCheck).toBe(true);
      expect(candidate.target.path).toBe(`/study/homework/${hw.assignment.id}?activity=${VALID_ACTIVITY_ID}`);
      expect(candidate.target.label).toContain("Continue homework");
      expect(candidate.assignmentId).toBe(hw.assignment.id);
      expect(candidate.activityId).toBe(VALID_ACTIVITY_ID);
      expect(candidate.activityState).toBe("in_progress");
    });

    it("marks a checklist in_progress homework activity as continue and requiresSourceCheck: false", () => {
      const hw = createValidChecklistHomework("in_progress");
      const action = makeAction({ id: VALID_ACTION_ID, title: "Preflight checklist" });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [hw],
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("continue");
      expect(candidate.isContinue).toBe(true);
      expect(candidate.requiresSourceCheck).toBe(false);
    });

    it("marks an upcoming homework activity as start, not continue", () => {
      const hw = createValidChecklistHomework("upcoming");
      const action = makeAction({ id: VALID_ACTION_ID, title: "Preflight checklist" });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [hw],
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);

      expect(candidate.flowKind).toBe("start");
      expect(candidate.isContinue).toBe(false);
      expect(candidate.target.label).toContain("Open homework");
      expect(candidate.target.path).toBe(`/study/homework/${hw.assignment.id}?activity=${VALID_ACTIVITY_ID}`);
      expect(candidate.requiresSourceCheck).toBe(false);
    });

    it("isolates isActivityActive: earliest unfinished READ activity is upcoming while another activity is in_progress", () => {
      const secondActivityId = "30000000-0000-4000-8000-000000000008";
      // Canonical IDs sorted: VALID_ACTIVITY_ID (..0003) < secondActivityId (..0008)
      // Contiguous distinct positions: position 0 and position 1
      const multiActivitySnapshot: HomeworkSnapshot = {
        version: 1,
        assignment: {
          id: VALID_ASSIGNMENT_ID,
          title: "Multi-activity Assignment",
          instructions: "",
          school: null,
          instructor: null,
          lesson_id: null,
          source_lesson_id: null,
          due_date: null,
          state: "in_progress",
          revision: 1,
          action_id: VALID_ACTION_ID,
          archived: 0,
          created_at: NOW,
          updated_at: NOW,
          completed_at: null,
        },
        activities: [
          {
            record: {
              id: VALID_ACTIVITY_ID,
              assignment_id: VALID_ASSIGNMENT_ID,
              position: 0,
              kind: "read",
              title: "FAR Part 61",
              body: "",
              material_id: VALID_MATERIAL_ID,
              source_material_id: VALID_MATERIAL_ID,
              source_revision: VALID_HASH_A,
              card_set_id: null,
              test_version_id: null,
              source_test_version_id: null,
              page_start: 1,
              page_end: 20,
              state: "upcoming",
              cycle: 1,
              revision: 1,
              created_at: NOW,
              updated_at: NOW,
              completed_at: null,
              removed_at: null,
            },
            source: {
              title: "FAR/AIM Manual",
              total_pages: 100,
            },
            evidence: null,
          },
          {
            record: {
              id: secondActivityId,
              assignment_id: VALID_ASSIGNMENT_ID,
              position: 1,
              kind: "checklist",
              title: "Cockpit Checklist",
              body: "",
              material_id: null,
              source_material_id: null,
              source_revision: null,
              card_set_id: null,
              test_version_id: null,
              source_test_version_id: null,
              page_start: null,
              page_end: null,
              state: "in_progress",
              cycle: 1,
              revision: 1,
              created_at: NOW,
              updated_at: NOW,
              completed_at: null,
              removed_at: null,
            },
            source: null,
            evidence: null,
          },
        ],
        runs: [],
      };

      // Validated domain snapshot
      const validatedHw = validateHomeworkSnapshot(multiActivitySnapshot);
      expect(validatedHw.assignment.state).toBe("in_progress");

      const action = makeAction({ id: VALID_ACTION_ID, title: "FAR reading" });
      const material: StudyMaterial = makeMaterial({ id: VALID_MATERIAL_ID, title: "FAR/AIM Manual" });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [validatedHw],
        materials: [material],
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);

      // Even though assignment.state is in_progress, earliest unfinished activity is upcoming -> flowKind must be start, isContinue false!
      expect(candidate.flowKind).toBe("start");
      expect(candidate.isContinue).toBe(false);
      expect(candidate.activityId).toBe(VALID_ACTIVITY_ID);
      expect(candidate.activityState).toBe("upcoming");
      expect(candidate.sourceAvailable).toBe(true);
      expect(candidate.requiresSourceCheck).toBe(true);
      expect(candidate.target.label).toContain("Open homework");
    });

    it("validates card run boundaries: active run is continue, finished or invalidated run is start", () => {
      const action = makeAction({ id: VALID_ACTION_ID, title: "Airspace flashcards" });
      const material = makeMaterial({ id: VALID_MATERIAL_ID, title: "Airspace Deck" });

      // 1. Active run
      const hwActive = createValidCardsHomework({ activeRun: true });
      const sourcesActive: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [hwActive],
        materials: [material],
      };
      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });
      const candidateActive = projectRecommendationToStudyFlow(rec, sourcesActive);
      expect(candidateActive.flowKind).toBe("continue");
      expect(candidateActive.isContinue).toBe(true);
      expect(candidateActive.requiresSourceCheck).toBe(true);

      // 2. Finished run
      const hwFinished = createValidCardsHomework({ finishedRun: true });
      const sourcesFinished: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [hwFinished],
        materials: [material],
      };
      const candidateFinished = projectRecommendationToStudyFlow(rec, sourcesFinished);
      // Completed homework assignment has mode "open"
      expect(candidateFinished.flowKind).toBe("open");
      expect(candidateFinished.isContinue).toBe(false);

      // 3. Invalidated run
      const hwInvalidated = createValidCardsHomework({ invalidatedRun: true });
      const sourcesInvalidated: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [hwInvalidated],
        materials: [material],
      };
      const candidateInvalidated = projectRecommendationToStudyFlow(rec, sourcesInvalidated);
      expect(candidateInvalidated.flowKind).toBe("start");
      expect(candidateInvalidated.isContinue).toBe(false);
    });

    it("validates test run: active run is continue with requiresSourceCheck: true", () => {
      const hwTest = createValidTestHomework();
      const action = makeAction({ id: VALID_ACTION_ID, title: "Aerodynamics Quiz" });
      const material = makeMaterial({ id: VALID_MATERIAL_ID, title: "Aerodynamics Quiz" });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [hwTest],
        materials: [material],
      };
      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });
      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("continue");
      expect(candidate.isContinue).toBe(true);
      expect(candidate.requiresSourceCheck).toBe(true);
    });

    it("archived homework assignment is open mode and routes to parent without resume", () => {
      const hw = createValidArchivedHomework();
      const action = makeAction({ id: VALID_ACTION_ID, title: "Old assignment" });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [hw],
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("open");
      expect(candidate.isContinue).toBe(false);
      expect(candidate.target.path).toBe(`/study/homework/${hw.assignment.id}`);
      expect(candidate.requiresSourceCheck).toBe(false);
    });

    it("completed homework assignment is open mode and routes to parent without resume", () => {
      const hw = createValidCompletedHomework();
      const action = makeAction({ id: VALID_ACTION_ID, title: "Finished assignment" });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [hw],
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("open");
      expect(candidate.isContinue).toBe(false);
      expect(candidate.target.path).toBe(`/study/homework/${hw.assignment.id}`);
      expect(candidate.activityState).toBe("completed");
    });
  });

  describe("negative / malformed / stale variants assert no Continue", () => {
    it("never continues when homework material is missing even if activity state is in_progress", () => {
      const hw = createValidReadHomework({ state: "in_progress" });
      const action = makeAction({ id: VALID_ACTION_ID, title: "Reading task" });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [hw],
        materials: [], // Material record missing!
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("open");
      expect(candidate.isContinue).toBe(false);
      expect(candidate.sourceAvailable).toBe(false);
      expect(candidate.requiresSourceCheck).toBe(false);
      expect(candidate.target.path).toBe(`/study/homework/${hw.assignment.id}?activity=${VALID_ACTIVITY_ID}`);
      expect(candidate.target.label).toBe(`Open homework for ${action.title}`);
    });

    it("stale run kind mismatch does not continue", () => {
      const hw = createValidCardsHomework({ activeRun: true });
      const action = makeAction({ id: VALID_ACTION_ID, title: "Airspace flashcards" });
      const material = makeMaterial({ id: VALID_MATERIAL_ID, title: "Airspace Deck" });

      // Properly typed HomeworkTestRun fixture on a cards activity (wrong kind)
      const wrongKindRun: HomeworkTestRun = {
        id: VALID_RUN_ID,
        activity_id: VALID_ACTIVITY_ID,
        cycle: 1,
        activity_revision: 1,
        kind: "test",
        scope: {
          version: 1,
          material_id: VALID_MATERIAL_ID,
          source_revision: VALID_HASH_A,
          test_version_id: VALID_TEST_VERSION_ID,
          attempt_id: VALID_ATTEMPT_ID,
        },
        evidence: null,
        started_at: NOW,
        finished_at: null,
        invalidated_at: null,
      };
      const staleHw: HomeworkSnapshot = { ...hw, runs: [wrongKindRun] };

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [staleHw],
        materials: [material],
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("start");
      expect(candidate.isContinue).toBe(false);
    });

    it("stale run revision mismatch does not continue", () => {
      const hw = createValidCardsHomework({ activeRun: true });
      const action = makeAction({ id: VALID_ACTION_ID, title: "Airspace flashcards" });
      const material = makeMaterial({ id: VALID_MATERIAL_ID, title: "Airspace Deck" });

      // Run has revision 1, but activity was bumped to revision 2
      const staleRuns = [{ ...hw.runs[0]!, activity_revision: 1 }];
      const updatedActivities = [{
        ...hw.activities[0]!,
        record: { ...hw.activities[0]!.record, revision: 2 },
      }];
      const staleHw: HomeworkSnapshot = { ...hw, activities: updatedActivities, runs: staleRuns };

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [staleHw],
        materials: [material],
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("start");
      expect(candidate.isContinue).toBe(false);
    });

    it("stale run scope mismatch does not continue", () => {
      const hw = createValidCardsHomework({ activeRun: true });
      const action = makeAction({ id: VALID_ACTION_ID, title: "Airspace flashcards" });
      const material = makeMaterial({ id: VALID_MATERIAL_ID, title: "Airspace Deck" });

      // Run scope card_set_id differs from current activity card_set_id
      const run = hw.runs[0] as HomeworkCardRun;
      const staleRuns = [{
        ...run,
        scope: { ...run.scope, card_set_id: "9".repeat(64) },
      }];
      const staleHw: HomeworkSnapshot = { ...hw, runs: staleRuns };

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [staleHw],
        materials: [material],
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("start");
      expect(candidate.isContinue).toBe(false);
    });

    it("refuses continue when test run has mismatched cycle, revision, test_version, or material", () => {
      const hwBase = createValidTestHomework();
      const action = makeAction({ id: VALID_ACTION_ID, title: "Aerodynamics Quiz" });
      const material = makeMaterial({ id: VALID_MATERIAL_ID, title: "Aerodynamics Quiz" });
      const baseRun = hwBase.runs[0] as HomeworkTestRun;

      const mismatchedVariants: Array<{
        name: string;
        run: HomeworkTestRun;
        activityOverrides?: Partial<HomeworkSnapshot["activities"][0]["record"]>;
        invalidDomain?: boolean;
      }> = [
        {
          name: "stale run cycle (run.cycle 1 vs activity.cycle 2)",
          run: { ...baseRun, cycle: 1 },
          activityOverrides: { cycle: 2 },
        },
        {
          name: "stale run activity revision (run.activity_revision 1 vs activity.revision 2)",
          run: { ...baseRun, activity_revision: 1 },
          activityOverrides: { revision: 2 },
        },
        {
          name: "mismatched test_version_id in scope",
          run: {
            ...baseRun,
            scope: { ...baseRun.scope, test_version_id: "60000000-0000-4000-8000-000000000099" },
          },
        },
        {
          name: "mismatched material_id in scope",
          run: {
            ...baseRun,
            scope: { ...baseRun.scope, material_id: "40000000-0000-4000-8000-000000000099" },
          },
        },
        {
          name: "mismatched source_revision in scope",
          run: {
            ...baseRun,
            scope: { ...baseRun.scope, source_revision: "9".repeat(64) },
          },
        },
      ];

      for (const variant of mismatchedVariants) {
        const variantHw: HomeworkSnapshot = {
          ...hwBase,
          activities: [
            {
              ...hwBase.activities[0]!,
              record: {
                ...hwBase.activities[0]!.record,
                ...variant.activityOverrides,
              },
            },
          ],
          runs: [variant.run],
        };

        // Ensure domain validator rejects inconsistent run bindings where appropriate
        expect(() => validateHomeworkSnapshot(variantHw)).toThrow();

        // Selector pure contract must conservatively refuse Continue and route to Start
        const sources: RecommendationSources = {
          today: TODAY,
          actions: [action],
          homework: [variantHw],
          materials: [material],
        };

        const rec = mockRecommendation({
          id: `action:${VALID_ACTION_ID}`,
          title: action.title,
          reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
        });

        const candidate = projectRecommendationToStudyFlow(rec, sources);
        expect(candidate.flowKind, `${variant.name} must be start`).toBe("start");
        expect(candidate.isContinue, `${variant.name} must not be continue`).toBe(false);
      }
    });

    it("refuses continue when in_progress read homework has malformed read scope", () => {
      const hwBase = createValidReadHomework({ state: "in_progress" });
      const action = makeAction({ id: VALID_ACTION_ID, title: "FAR reading" });
      const material = makeMaterial({ id: VALID_MATERIAL_ID, title: "FAR/AIM Manual" });

      const malformedScopeVariants: Array<{
        name: string;
        overrides: Partial<HomeworkSnapshot["activities"][0]["record"]>;
      }> = [
        {
          name: "missing page range (page_end is null)",
          overrides: { page_start: null, page_end: null },
        },
        {
          name: "missing source_revision (source_revision is null)",
          overrides: { source_revision: null },
        },
        {
          name: "missing source_material_id (source_material_id is null)",
          overrides: { source_material_id: null },
        },
      ];

      for (const variant of malformedScopeVariants) {
        const malformedHw: HomeworkSnapshot = {
          ...hwBase,
          activities: [
            {
              ...hwBase.activities[0]!,
              record: {
                ...hwBase.activities[0]!.record,
                ...variant.overrides,
              },
            },
          ],
        };

        // Assert domain codec rejects
        expect(() => validateHomeworkSnapshot(malformedHw)).toThrow();

        // Selector pure contract must never continue (routes safely to start or open)
        const sources: RecommendationSources = {
          today: TODAY,
          actions: [action],
          homework: [malformedHw],
          materials: [material],
        };

        const rec = mockRecommendation({
          id: `action:${VALID_ACTION_ID}`,
          title: action.title,
          reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
        });

        const candidate = projectRecommendationToStudyFlow(rec, sources);
        expect(candidate.isContinue, `${variant.name} must not continue`).toBe(false);
        expect(["start", "open"]).toContain(candidate.flowKind);
      }
    });

    it("assignment boundary: upcoming assignment with in_progress activity does not continue", () => {
      const hw = createValidReadHomework({ state: "in_progress" });
      const action = makeAction({ id: VALID_ACTION_ID, title: "Reading task" });
      const material = makeMaterial({ id: VALID_MATERIAL_ID, title: "FAR/AIM Manual" });

      // Malformed variant: assignment state left upcoming while activity is in_progress
      const boundaryHw: HomeworkSnapshot = {
        ...hw,
        assignment: { ...hw.assignment, state: "upcoming" as const },
      };

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [boundaryHw],
        materials: [material],
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("start");
      expect(candidate.isContinue).toBe(false);
    });
  });

  describe("missing actions: generic Flight Deck Open without phantom focus", () => {
    it("missing action recommendation falls back to generic Flight Deck Open with no elementId", () => {
      const rec = mockRecommendation({
        id: "action:non-existent-action",
        title: "Ghost action",
        reason: { summary: "From nowhere", sourceType: "action", sourceId: "non-existent-action" },
      });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [], // Action missing!
        homework: [],
      };

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("open");
      expect(candidate.isContinue).toBe(false);
      expect(candidate.targetRole).toBe("local_action");
      expect(candidate.sourceAvailable).toBe(false);
      expect(candidate.target.path).toBe("/");
      expect(candidate.target.label).toBe("Open Flight Deck");
      expect(candidate.target.elementId).toBeUndefined();
      expect(candidate.target.isLocalAction).toBeUndefined();
    });
  });

  describe("determinism and position tie-break", () => {
    it("defensively handles malformed equal-position input: asserts codec rejects and selector tie-breaks deterministically without continue", () => {
      const actAId = "11111111-1111-4111-8111-111111111111";
      const actBId = "22222222-2222-4222-8222-222222222222";

      const malformedSnapshot: HomeworkSnapshot = {
        version: 1 as const,
        assignment: {
          id: VALID_ASSIGNMENT_ID,
          title: "Malformed equal position tie-break",
          instructions: "",
          school: null,
          instructor: null,
          lesson_id: null,
          source_lesson_id: null,
          due_date: null,
          state: "upcoming" as const,
          revision: 1,
          action_id: VALID_ACTION_ID,
          archived: 0 as const,
          created_at: NOW,
          updated_at: NOW,
          completed_at: null,
        },
        activities: [
          {
            record: {
              id: actAId,
              assignment_id: VALID_ASSIGNMENT_ID,
              position: 0,
              kind: "checklist" as const,
              title: "Task A",
              body: "",
              material_id: null,
              source_material_id: null,
              source_revision: null,
              card_set_id: null,
              test_version_id: null,
              source_test_version_id: null,
              page_start: null,
              page_end: null,
              state: "upcoming" as const,
              cycle: 1,
              revision: 1,
              created_at: NOW,
              updated_at: NOW,
              completed_at: null,
              removed_at: null,
            },
            source: null,
            evidence: null,
          },
          {
            record: {
              id: actBId,
              assignment_id: VALID_ASSIGNMENT_ID,
              position: 0,
              kind: "checklist" as const,
              title: "Task B",
              body: "",
              material_id: null,
              source_material_id: null,
              source_revision: null,
              card_set_id: null,
              test_version_id: null,
              source_test_version_id: null,
              page_start: null,
              page_end: null,
              state: "upcoming" as const,
              cycle: 1,
              revision: 1,
              created_at: NOW,
              updated_at: NOW,
              completed_at: null,
              removed_at: null,
            },
            source: null,
            evidence: null,
          },
        ],
        runs: [],
      };

      // 1. Assert domain codec rejects equal-position activities as invalid canonical snapshot
      expect(() => validateHomeworkSnapshot(malformedSnapshot)).toThrow();

      // 2. Assert selector handles defensively and deterministically tie-breaks by stable UUID without continue
      const action = makeAction({ id: VALID_ACTION_ID, title: "Tie break" });
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [malformedSnapshot],
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.activityId).toBe(actAId);
      expect(candidate.flowKind).toBe("start");
      expect(candidate.isContinue).toBe(false);
    });

    it("selects earliest activity by distinct position in valid snapshot where canonical ID order differs from position order", () => {
      const actAId = "11111111-1111-4111-8111-111111111111";
      const actBId = "22222222-2222-4222-8222-222222222222";

      // Canonical snapshot: activities must be sorted by ID ascending (actAId < actBId).
      // Distinct contiguous positions: actA has position 1, actB has position 0.
      // Position order (B then A) differs from canonical ID order (A then B).
      const snapshot: HomeworkSnapshot = {
        version: 1,
        assignment: {
          id: VALID_ASSIGNMENT_ID,
          title: "Position order assignment",
          instructions: "",
          school: null,
          instructor: null,
          lesson_id: null,
          source_lesson_id: null,
          due_date: null,
          state: "upcoming",
          revision: 1,
          action_id: VALID_ACTION_ID,
          archived: 0,
          created_at: NOW,
          updated_at: NOW,
          completed_at: null,
        },
        activities: [
          {
            record: {
              id: actAId,
              assignment_id: VALID_ASSIGNMENT_ID,
              position: 1,
              kind: "checklist",
              title: "Task A",
              body: "",
              material_id: null,
              source_material_id: null,
              source_revision: null,
              card_set_id: null,
              test_version_id: null,
              source_test_version_id: null,
              page_start: null,
              page_end: null,
              state: "upcoming",
              cycle: 1,
              revision: 1,
              created_at: NOW,
              updated_at: NOW,
              completed_at: null,
              removed_at: null,
            },
            source: null,
            evidence: null,
          },
          {
            record: {
              id: actBId,
              assignment_id: VALID_ASSIGNMENT_ID,
              position: 0,
              kind: "checklist",
              title: "Task B",
              body: "",
              material_id: null,
              source_material_id: null,
              source_revision: null,
              card_set_id: null,
              test_version_id: null,
              source_test_version_id: null,
              page_start: null,
              page_end: null,
              state: "upcoming",
              cycle: 1,
              revision: 1,
              created_at: NOW,
              updated_at: NOW,
              completed_at: null,
              removed_at: null,
            },
            source: null,
            evidence: null,
          },
        ],
        runs: [],
      };

      const validatedHw = validateHomeworkSnapshot(snapshot);
      const action = makeAction({ id: VALID_ACTION_ID, title: "Position check" });
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        homework: [validatedHw],
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: action.title,
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      // Selected by position 0 (Task B), even though Task A has smaller UUID
      expect(candidate.activityId).toBe(actBId);
      expect(candidate.flowKind).toBe("start");
      expect(candidate.isContinue).toBe(false);
    });
  });

  describe("missing linked source safe fallbacks", () => {
    it("handles missing action before returning bound homework continue: generic Flight Deck Open without phantom elementId", () => {
      // Actual validated in_progress homework with an active run
      const hw = createValidCardsHomework({ activeRun: true });
      expect(hw.assignment.action_id).toBe(VALID_ACTION_ID);

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [], // Action record disappeared/deleted
        homework: [hw],
        materials: [makeMaterial({ id: VALID_MATERIAL_ID, title: "Airspace Deck" })],
      };

      const rec = mockRecommendation({
        id: `action:${VALID_ACTION_ID}`,
        title: "Airspace flashcards",
        reason: { summary: "Due today", sourceType: "action", sourceId: VALID_ACTION_ID },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);

      expect(candidate.flowKind).toBe("open");
      expect(candidate.isContinue).toBe(false);
      expect(candidate.target.path).toBe("/");
      expect(candidate.target.label).toBe("Open Flight Deck");
      expect(candidate.target.elementId).toBeUndefined();
      expect(candidate.targetRole).toBe("local_action");
      expect(candidate.sourceAvailable).toBe(false);
      expect(candidate.requiresSourceCheck).toBe(false);

      // Candidate cannot claim source-backed Continue on deleted recommendation source
      expect(candidate.flowKind).not.toBe("continue");

      // Verify parent homework data was preserved without mutation
      expect(sources.homework![0]!.assignment.action_id).toBe(VALID_ACTION_ID);
      expect(sources.homework![0]).toBe(hw);
    });

    it("falls back to local action in open mode when action's linked journal is missing", () => {
      const action = makeAction({
        id: "act-journal",
        title: "Debrief follow-up",
        relatedType: "journal",
        relatedId: "j-missing",
      });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        journalEntries: [],
      };

      const rec = mockRecommendation({
        id: `action:${action.id}`,
        title: action.title,
        reason: { summary: "From debrief", sourceType: "action", sourceId: action.id },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("open");
      expect(candidate.target.isLocalAction).toBe(true);
      expect(candidate.target.elementId).toBe(`action-${action.id}`);
      expect(candidate.targetRole).toBe("local_action");
      expect(candidate.sourceAvailable).toBe(false);
      expect(candidate.requiresSourceCheck).toBe(false);
    });

    it("falls back to local action in open mode when action's linked material is missing", () => {
      const action = makeAction({
        id: "act-mat",
        title: "Read chapter",
        relatedType: "material",
        relatedId: "mat-missing",
      });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        materials: [],
      };

      const rec = mockRecommendation({
        id: `action:${action.id}`,
        title: action.title,
        reason: { summary: "From material", sourceType: "action", sourceId: action.id },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("open");
      expect(candidate.target.isLocalAction).toBe(true);
      expect(candidate.targetRole).toBe("local_action");
      expect(candidate.sourceAvailable).toBe(false);
      expect(candidate.requiresSourceCheck).toBe(false);
    });

    it("navigates to material with requiresSourceCheck: true when action's linked material is present", () => {
      const material = makeMaterial({ id: "mat-present", title: "Navigation manual" });
      const action = makeAction({
        id: "act-mat-present",
        title: "Read nav manual",
        relatedType: "material",
        relatedId: material.id,
      });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        materials: [material],
      };

      const rec = mockRecommendation({
        id: `action:${action.id}`,
        title: action.title,
        reason: { summary: "From material", sourceType: "action", sourceId: action.id },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.target.path).toBe(`/study/${material.id}`);
      expect(candidate.targetRole).toBe("material");
      expect(candidate.sourceAvailable).toBe(true);
      expect(candidate.requiresSourceCheck).toBe(true);
      expect(candidate.flowKind).toBe("start");
      expect(candidate.isContinue).toBe(false);
    });

    it("falls back to local action in open mode when action's linked event is missing", () => {
      const action = makeAction({
        id: "act-event",
        title: "Lesson prep action",
        relatedType: "event",
        relatedId: "event-missing",
      });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        events: [],
      };

      const rec = mockRecommendation({
        id: `action:${action.id}`,
        title: action.title,
        reason: { summary: "From lesson", sourceType: "action", sourceId: action.id },
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("open");
      expect(candidate.target.isLocalAction).toBe(true);
      expect(candidate.targetRole).toBe("local_action");
      expect(candidate.sourceAvailable).toBe(false);
      expect(candidate.requiresSourceCheck).toBe(false);
    });

    it("falls back to /study in open mode when study_material recommendation references missing material", () => {
      const rec = mockRecommendation({
        id: "material:mat-missing",
        title: "Missing material",
        kind: "study_material",
        precedence: "study",
        reason: { summary: "Needs review", sourceType: "material", sourceId: "mat-missing" },
      });

      const sources: RecommendationSources = {
        today: TODAY,
        materials: [],
      };

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("open");
      expect(candidate.target.path).toBe("/study");
      expect(candidate.targetRole).toBe("material");
      expect(candidate.sourceAvailable).toBe(false);
      expect(candidate.requiresSourceCheck).toBe(false);
    });

    it("falls back to /schedule in open mode when lesson_prep event is missing", () => {
      const rec = mockRecommendation({
        id: "prep:prep-1",
        title: "Prep for solo",
        kind: "lesson_prep",
        precedence: "lesson_prep",
        reason: { summary: "Upcoming lesson", sourceType: "event", sourceId: "ev-missing" },
      });

      const sources: RecommendationSources = {
        today: TODAY,
        events: [],
      };

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("open");
      expect(candidate.target.path).toBe("/schedule");
      expect(candidate.targetRole).toBe("lesson");
      expect(candidate.sourceAvailable).toBe(false);
      expect(candidate.requiresSourceCheck).toBe(false);
    });

    it("falls back to /questions in open mode when question recommendation references missing question", () => {
      const rec = mockRecommendation({
        id: "question:q-missing",
        title: "Missing question",
        kind: "question",
        precedence: "study",
        reason: { summary: "Debrief question", sourceType: "question", sourceId: "q-missing" },
      });

      const sources: RecommendationSources = {
        today: TODAY,
        questions: [],
      };

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("open");
      expect(candidate.target.path).toBe("/questions");
      expect(candidate.targetRole).toBe("questions");
      expect(candidate.sourceAvailable).toBe(false);
      expect(candidate.requiresSourceCheck).toBe(false);
    });

    it("falls back to /notes in open mode when note recommendation references missing note", () => {
      const rec = mockRecommendation({
        id: "note:note-missing",
        title: "Missing note",
        kind: "note",
        precedence: "pinned",
        reason: { summary: "Pinned note", sourceType: "note", sourceId: "note-missing" },
      });

      const sources: RecommendationSources = {
        today: TODAY,
        notes: [],
      };

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("open");
      expect(candidate.target.path).toBe("/notes");
      expect(candidate.targetRole).toBe("notes");
      expect(candidate.sourceAvailable).toBe(false);
      expect(candidate.requiresSourceCheck).toBe(false);
    });

    it("navigates to lesson when lesson_prep event is present", () => {
      const event = makeEvent({ id: "ev-1", title: "Solo cross country" });
      const rec = mockRecommendation({
        id: "prep:prep-1",
        title: "Prep for solo",
        kind: "lesson_prep",
        precedence: "lesson_prep",
        reason: { summary: "Upcoming lesson", sourceType: "event", sourceId: event.id },
      });

      const sources: RecommendationSources = {
        today: TODAY,
        events: [event],
      };

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.target.path).toBe(`/schedule/${event.id}`);
      expect(candidate.targetRole).toBe("lesson");
      expect(candidate.sourceAvailable).toBe(true);
    });
  });

  describe("no inferred global last-active or card sessions", () => {
    it("never upgrades a study material or due cards to continue without durable homework evidence", () => {
      const material = makeMaterial({
        id: "mat-due-cards",
        title: "Airspace regs",
        reviewStatus: "needs_review",
      });

      const rec = mockRecommendation({
        id: `material:${material.id}`,
        title: material.title,
        kind: "study_material",
        precedence: "study",
        reason: { summary: "Review material", sourceType: "material", sourceId: material.id },
      });

      const sources: RecommendationSources = {
        today: TODAY,
        materials: [material],
      };

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      expect(candidate.flowKind).toBe("start");
      expect(candidate.isContinue).toBe(false);
      expect(candidate.sourceAvailable).toBe(true);
      expect(candidate.requiresSourceCheck).toBe(true);
    });

    it("never marks note or question recommendations as continue", () => {
      const noteRec = mockRecommendation({
        id: "note:note-1",
        title: "Important note",
        kind: "note",
        precedence: "pinned",
        reason: { summary: "Pinned note", sourceType: "note", sourceId: "note-1" },
      });
      const questionRec = mockRecommendation({
        id: "question:q-1",
        title: "Approach speed question",
        kind: "question",
        precedence: "study",
        reason: { summary: "Debrief question", sourceType: "question", sourceId: "q-1" },
      });

      const sources: RecommendationSources = {
        today: TODAY,
        notes: [makeNote({ id: "note-1", title: "Important note" })],
        questions: [makeQuestion({ id: "q-1", text: "Approach speed question" })],
      };

      const noteCandidate = projectRecommendationToStudyFlow(noteRec, sources);
      const questionCandidate = projectRecommendationToStudyFlow(questionRec, sources);

      expect(noteCandidate.flowKind).toBe("start");
      expect(noteCandidate.isContinue).toBe(false);
      expect(questionCandidate.flowKind).toBe("start");
      expect(questionCandidate.isContinue).toBe(false);
    });
  });

  describe("metadata boundary: explicitly select reason fields and zero private leakage", () => {
    it("does not leak personal journal bodies, feedback, instructions, or file paths into the candidate payload", () => {
      const journal = makeJournalEntry({
        id: "j-private",
        mission: "Solo cross country",
        wentWell: "Good radio comms",
        wasDifficult: "Felt very nervous during turbulence",
        instructorFeedback: "Review recovery procedures privately",
      });

      const action = makeAction({
        id: "act-sensitive",
        title: "Debrief notes",
        description: "Private description about health and nerves",
        relatedType: "journal",
        relatedId: journal.id,
      });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        journalEntries: [journal],
      };

      const extraReason = {
        summary: "From debrief",
        sourceType: "action" as const,
        sourceId: action.id,
        sensitiveNote: "should not be copied",
      };

      const rec = mockRecommendation({
        id: `action:${action.id}`,
        title: action.title,
        reason: extraReason,
      });

      const candidate = projectRecommendationToStudyFlow(rec, sources);
      const serialized = JSON.stringify(candidate);

      expect(serialized).not.toContain("turbulence");
      expect(serialized).not.toContain("nervous");
      expect(serialized).not.toContain("health");
      expect(serialized).not.toContain("Review recovery procedures privately");
      expect(serialized).not.toContain("should not be copied");

      // Verify reason is strictly the 3 metadata fields
      expect(candidate.reason).toEqual({
        summary: "From debrief",
        sourceType: "action",
        sourceId: action.id,
      });
    });
  });
});
