import { describe, expect, it } from "vitest";

import type { NextAction, Note, PrepItem, Question, ScheduleEvent, StudyMaterial } from "@/domain/types";
import {
  applyBudgetChange,
  applyDefer,
  applyRefresh,
  applyResetDecision,
  applyResetToday,
  applySkip,
  dailyPlanSignature,
  computeDailyPlan,
  createInitialDailyPlanState,
  getStartTarget,
  parseDailyPlanState,
  rolloverDailyPlanState,
  serializeDailyPlanState,
  type DailyPlanState,
} from "./dailyPlan";
import type { Recommendation, RecommendationSources } from "./recommendations";
import { makeJournalEntry } from "@/testing/factories";

const TODAY = "2026-09-25";
const YESTERDAY = "2026-09-24";

function mockAction(overrides: Partial<NextAction> = {}): NextAction {
  return {
    id: "act-1",
    title: "Preflight weather check",
    description: "Check METAR/TAF",
    category: "prepare",
    priority: "important",
    status: "open",
    dueDate: TODAY,
    estimatedMinutes: 10,
    relatedType: null,
    relatedId: null,
    materialId: null,
    completedAt: null,
    createdAt: "2026-09-20T12:00:00.000Z",
    updatedAt: "2026-09-20T12:00:00.000Z",
    ...overrides,
  };
}

function mockMaterial(overrides: Partial<StudyMaterial> = {}): StudyMaterial {
  return {
    id: "mat-1",
    title: "Airspace Classification",
    materialType: "reference",
    topic: "airports",
    reviewStatus: "needs_review",
    priority: "important",
    goalId: null,
    eventId: null,
    filePath: "documents/airspace.pdf",
    originalFileName: "airspace.pdf",
    fileSize: 1024,
    tags: ["airspace"],
    notes: "",
    lastReviewedAt: null,
    createdAt: "2026-09-20T12:00:00.000Z",
    updatedAt: "2026-09-20T12:00:00.000Z",
    ...overrides,
  };
}

function mockNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "Crosswind rudder reminder",
    body: "Top rudder on flare",
    pinned: true,
    createdAt: "2026-09-20T12:00:00.000Z",
    updatedAt: "2026-09-20T12:00:00.000Z",
    ...overrides,
  };
}

function mockEvent(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: "event-1",
    title: "Crosswind Pattern Work",
    eventType: "flight_lesson",
    date: TODAY,
    startTime: null,
    endTime: null,
    location: "KPAO",
    notes: "",
    status: "scheduled",
    instructor: "Captain Morgan",
    goalId: null,
    estimatedCost: null,
    actualCost: null,
    materialIds: [],
    createdAt: "2026-09-20T12:00:00.000Z",
    updatedAt: "2026-09-20T12:00:00.000Z",
    ...overrides,
  };
}

function mockPrepItem(overrides: Partial<PrepItem> = {}): PrepItem {
  return {
    id: "prep-1",
    eventId: "event-1",
    title: "Calculate density altitude",
    done: false,
    position: 0,
    createdAt: "2026-09-20T12:00:00.000Z",
    ...overrides,
  };
}

function mockQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q-1",
    text: "When to transition from crab to slip?",
    topic: "general",
    status: "to_ask",
    eventId: null,
    journalId: null,
    materialId: null,
    answer: "",
    answeredAt: null,
    createdAt: "2026-09-20T12:00:00.000Z",
    updatedAt: "2026-09-20T12:00:00.000Z",
    ...overrides,
  };
}

describe("D4 — Daily Plan State & Logic", () => {
  describe("State serialization and deserialization", () => {
    it("safely serializes and parses clean state", () => {
      const state: DailyPlanState = {
        version: 1,
        date: TODAY,
        timeBudget: 20,
        suggestedIds: ["action:act-1", "note:note-1"],
        decisions: {
          "action:act-2": { type: "skip", date: TODAY },
        },
        updatedAt: "2026-09-25T14:00:00.000Z",
      };

      const serialized = serializeDailyPlanState(state);
      const parsed = parseDailyPlanState(serialized);

      expect(parsed).toEqual(state);
    });

    it("returns null safely for corrupt or missing JSON without throwing", () => {
      expect(parseDailyPlanState(null)).toBeNull();
      expect(parseDailyPlanState("")).toBeNull();
      expect(parseDailyPlanState("{ malformed json")).toBeNull();
      expect(parseDailyPlanState(JSON.stringify({ version: 2 }))).toBeNull();
      expect(parseDailyPlanState(JSON.stringify({ version: 1, date: 123 }))).toBeNull();
    });
  });

  describe("Start Routing for all supported recommendation types", () => {
    const sources: RecommendationSources = {
      today: TODAY,
      actions: [
        mockAction({ id: "a-standalone", title: "Review AIM 4-3" }),
        mockAction({ id: "a-journal", relatedType: "journal", relatedId: "j-100", title: "Debrief action" }),
        mockAction({ id: "a-material", relatedType: "material", relatedId: "mat-1", title: "Study action" }),
        mockAction({ id: "a-event", relatedType: "event", relatedId: "event-1", title: "Lesson action" }),
        mockAction({ id: "a-goal", relatedType: "goal", relatedId: "g-1", title: "Milestone action" }),
      ],
      materials: [mockMaterial({ id: "mat-1", title: "Airspace Guide" })],
      notes: [mockNote({ id: "note-1", title: "Landing flare" })],
      events: [mockEvent({ id: "event-1", title: "Stage Check" })],
      prepItems: [mockPrepItem({ id: "prep-1", eventId: "event-1", title: "Compute W&B" })],
      questions: [mockQuestion({ id: "q-1", text: "VFR fuel reserves" })],
      journalEntries: [makeJournalEntry({ id: "j-100", title: "Pattern work debrief" })],
    };

    it("routes study materials to /study/:id", () => {
      const rec: Recommendation = {
        id: "material:mat-1",
        title: "Airspace Guide",
        kind: "study_material",
        precedence: "study",
        estimatedMinutes: null,
        reason: { summary: "Needs review", sourceType: "material", sourceId: "mat-1" },
        explanation: "Study material",
      };

      const target = getStartTarget(rec, sources);
      expect(target.path).toBe("/study/mat-1");
      expect(target.label).toContain("Airspace Guide");
    });

    it("routes lesson prep to /schedule/:eventId", () => {
      const rec: Recommendation = {
        id: "prep:prep-1",
        title: "Compute W&B",
        kind: "lesson_prep",
        precedence: "lesson_prep",
        estimatedMinutes: null,
        reason: { summary: "Lesson prep", sourceType: "event", sourceId: "event-1" },
        explanation: "Upcoming flight prep",
      };

      const target = getStartTarget(rec, sources);
      expect(target.path).toBe("/schedule/event-1");
      expect(target.label).toContain("Compute W&B");
    });

    it("routes questions to /questions", () => {
      const rec: Recommendation = {
        id: "question:q-1",
        title: "VFR fuel reserves",
        kind: "question",
        precedence: "study",
        estimatedMinutes: null,
        reason: { summary: "Question", sourceType: "question", sourceId: "q-1" },
        explanation: "Instructor question",
      };

      const target = getStartTarget(rec, sources);
      expect(target.path).toBe("/questions");
      expect(target.label).toContain("VFR fuel reserves");
    });

    it("routes notes to /notes", () => {
      const rec: Recommendation = {
        id: "note:note-1",
        title: "Landing flare",
        kind: "note",
        precedence: "pinned",
        estimatedMinutes: null,
        reason: { summary: "Pinned note", sourceType: "note", sourceId: "note-1" },
        explanation: "User pinned",
      };

      const target = getStartTarget(rec, sources);
      expect(target.path).toBe("/notes");
      expect(target.label).toContain("Landing flare");
    });

    it("routes standalone actions to element focus and linked actions to respective entities", () => {
      // Standalone action
      const standaloneRec: Recommendation = {
        id: "action:a-standalone",
        title: "Review AIM 4-3",
        kind: "action",
        precedence: "due_action",
        estimatedMinutes: 10,
        reason: { summary: "Due", sourceType: "action", sourceId: "a-standalone" },
        explanation: "Action",
      };
      const targetStandalone = getStartTarget(standaloneRec, sources);
      expect(targetStandalone.isLocalAction).toBe(true);
      expect(targetStandalone.elementId).toBe("action-a-standalone");

      // Journal-linked action
      const journalRec: Recommendation = {
        id: "action:a-journal",
        title: "Debrief action",
        kind: "action",
        precedence: "due_action",
        estimatedMinutes: 10,
        reason: { summary: "From debrief", sourceType: "journal", sourceId: "j-100" },
        explanation: "Debrief action",
      };
      expect(getStartTarget(journalRec, sources).path).toBe("/journal/j-100");

      // Material-linked action
      const materialRec: Recommendation = {
        id: "action:a-material",
        title: "Study action",
        kind: "action",
        precedence: "due_action",
        estimatedMinutes: 10,
        reason: { summary: "From material", sourceType: "material", sourceId: "mat-1" },
        explanation: "Material action",
      };
      expect(getStartTarget(materialRec, sources).path).toBe("/study/mat-1");

      // Flight-path linked action
      const goalRec: Recommendation = {
        id: "action:a-goal",
        title: "Milestone action",
        kind: "action",
        precedence: "due_action",
        estimatedMinutes: 10,
        reason: { summary: "From goal", sourceType: "goal", sourceId: "g-1" },
        explanation: "Goal action",
      };
      expect(getStartTarget(goalRec, sources).path).toBe("/flight-path");
    });
  });

  describe("Skip vs Defer behavior and idempotency", () => {
    it("applies skip today and preserves source due date", () => {
      const initial = createInitialDailyPlanState(TODAY, 20);
      initial.suggestedIds = ["action:act-1", "action:act-2"];

      const skipped = applySkip(initial, "action:act-1", TODAY);

      // The id stays saved so its slot counts as vacated; the decision hides it.
      expect(skipped.suggestedIds).toEqual(["action:act-1", "action:act-2"]);
      expect(skipped.decisions["action:act-1"]).toEqual({
        type: "skip",
        date: TODAY,
      });

      // Idempotency: repeated skip produces identical decision
      const repeat = applySkip(skipped, "action:act-1", TODAY);
      expect(repeat.decisions["action:act-1"]).toEqual({
        type: "skip",
        date: TODAY,
      });
    });

    it("applies defer to tomorrow and leaves source due date untouched", () => {
      const initial = createInitialDailyPlanState(TODAY, 20);
      initial.suggestedIds = ["action:act-1", "action:act-2"];

      const originalAction = mockAction({ id: "act-1", dueDate: TODAY });
      const deferred = applyDefer(initial, "action:act-1", TODAY);

      expect(deferred.suggestedIds).toEqual(["action:act-1", "action:act-2"]);
      expect(deferred.decisions["action:act-1"]).toEqual({
        type: "defer",
        date: TODAY,
      });

      // Proof: The source action's dueDate is untouched (planner-only deferral)
      expect(originalAction.dueDate).toBe(TODAY);

      // Resetting decision restores eligibility
      const reset = applyResetDecision(deferred, "action:act-1", TODAY);
      expect(reset.decisions["action:act-1"]).toBeUndefined();
    });
  });

  describe("Local Date Rollover (Midnight Rollover)", () => {
    it("expires skips and yesterday's deferrals when date advances, but retains timeBudget", () => {
      const yesterdayState: DailyPlanState = {
        version: 1,
        date: YESTERDAY,
        timeBudget: 30, // User preference
        suggestedIds: ["action:act-old"],
        decisions: {
          "action:act-skipped-yesterday": { type: "skip", date: YESTERDAY },
          "action:act-deferred-yesterday": { type: "defer", date: YESTERDAY },
        },
        updatedAt: "2026-09-24T18:00:00.000Z",
      };

      const rolledOver = rolloverDailyPlanState(yesterdayState, TODAY);

      // Date advances to TODAY
      expect(rolledOver.date).toBe(TODAY);
      // User timeBudget preference is retained
      expect(rolledOver.timeBudget).toBe(30);
      // Suggested IDs are cleared for a fresh daily selection
      expect(rolledOver.suggestedIds).toEqual([]);
      // Yesterday's skip and deferral have expired
      expect(rolledOver.decisions["action:act-skipped-yesterday"]).toBeUndefined();
      expect(rolledOver.decisions["action:act-deferred-yesterday"]).toBeUndefined();
    });
  });

  describe("computeDailyPlan: selection, stability, and handling changes", () => {
    it("maintains stable suggestions across re-evaluations when state is locked", () => {
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [
          mockAction({ id: "a-1", title: "Task 1", estimatedMinutes: 10, dueDate: TODAY }),
          mockAction({ id: "a-2", title: "Task 2", estimatedMinutes: 10, dueDate: TODAY }),
          mockAction({ id: "a-3", title: "Task 3", estimatedMinutes: 10, dueDate: TODAY }),
        ],
      };

      // Initial calculation
      const { result: r1, nextState: s1 } = computeDailyPlan(sources, null, { timeBudget: 20, today: TODAY });
      expect(r1.suggested.map((s) => s.id)).toEqual(["action:a-1", "action:a-2"]);
      expect(s1.suggestedIds).toEqual(["action:a-1", "action:a-2"]);

      // Second calculation passing saved state: exact order and items preserved
      const { result: r2, nextState: s2 } = computeDailyPlan(sources, s1, { today: TODAY });
      expect(r2.suggested.map((s) => s.id)).toEqual(["action:a-1", "action:a-2"]);
      expect(s2.suggestedIds).toEqual(["action:a-1", "action:a-2"]);
    });

    it("replaces skipped or completed items by promoting next eligible candidates", () => {
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [
          mockAction({ id: "a-1", title: "Task 1", estimatedMinutes: 10, dueDate: TODAY }),
          mockAction({ id: "a-2", title: "Task 2", estimatedMinutes: 10, dueDate: TODAY }),
          mockAction({ id: "a-3", title: "Task 3", estimatedMinutes: 10, dueDate: TODAY }),
        ],
      };

      const { nextState: s1 } = computeDailyPlan(sources, null, { timeBudget: 20, today: TODAY });
      // User skips a-1 for today
      const s2 = applySkip(s1, "action:a-1", TODAY);

      const { result: r2, nextState: s3 } = computeDailyPlan(sources, s2, { today: TODAY });
      // a-1 is excluded; a-2 and a-3 are suggested
      expect(r2.suggested.map((s) => s.id)).toEqual(["action:a-2", "action:a-3"]);
      expect(s3.suggestedIds).toEqual(["action:a-2", "action:a-3"]);
    });

    it("gracefully drops deleted items from session without error", () => {
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [
          mockAction({ id: "a-1", title: "Task 1", estimatedMinutes: 10, dueDate: TODAY }),
          mockAction({ id: "a-2", title: "Task 2", estimatedMinutes: 10, dueDate: TODAY }),
        ],
      };

      const { nextState: s1 } = computeDailyPlan(sources, null, { timeBudget: 20, today: TODAY });

      // Action a-1 is deleted from database (missing from sources)
      const modifiedSources: RecommendationSources = {
        today: TODAY,
        actions: [mockAction({ id: "a-2", title: "Task 2", estimatedMinutes: 10, dueDate: TODAY })],
      };

      const { result: r2 } = computeDailyPlan(modifiedSources, s1, { today: TODAY });
      expect(r2.suggested.map((s) => s.id)).toEqual(["action:a-2"]);
    });

    it("respects budget changes and re-allocates accordingly", () => {
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [
          mockAction({ id: "a-1", title: "Task 1", estimatedMinutes: 10, dueDate: TODAY }),
          mockAction({ id: "a-2", title: "Task 2", estimatedMinutes: 10, dueDate: TODAY }),
          mockAction({ id: "a-3", title: "Task 3", estimatedMinutes: 10, dueDate: TODAY }),
        ],
      };

      const initial = createInitialDailyPlanState(TODAY, 10);
      const { result: r10 } = computeDailyPlan(sources, initial, { timeBudget: 10, today: TODAY });
      expect(r10.suggested).toHaveLength(1);
      expect(r10.totalEstimatedMinutes).toBe(10);

      // Change budget to 30 min
      const state30 = applyBudgetChange(initial, 30, TODAY);
      const { result: r30 } = computeDailyPlan(sources, state30, { timeBudget: 30, today: TODAY });
      expect(r30.suggested).toHaveLength(3);
      expect(r30.totalEstimatedMinutes).toBe(30);
    });

    it("handles empty sources cleanly without fabricating items", () => {
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [],
      };

      const { result } = computeDailyPlan(sources, null, { timeBudget: 20, today: TODAY });
      expect(result.suggested).toHaveLength(0);
      expect(result.remaining).toHaveLength(0);
      expect(result.totalEstimatedMinutes).toBe(0);
    });
  });
  describe("Session stability policy", () => {
    const due = (id: string, title: string, minutes: number | null, dueDate = TODAY) =>
      mockAction({ id, title, estimatedMinutes: minutes, dueDate });

    it("keeps a saved A/B session in order when a higher-priority C arrives, until explicit refresh", () => {
      const before: RecommendationSources = {
        today: TODAY,
        actions: [due("a", "Alpha", 5), due("b", "Bravo", 5)],
      };
      const { nextState: saved } = computeDailyPlan(before, null, { timeBudget: 20, today: TODAY });
      expect(saved.suggestedIds).toEqual(["action:a", "action:b"]);

      // C is overdue, so it outranks both A and B.
      const after: RecommendationSources = {
        ...before,
        actions: [...(before.actions ?? []), due("c", "Charlie", 5, YESTERDAY)],
      };
      const { result, nextState } = computeDailyPlan(after, saved, { today: TODAY });
      expect(result.suggested.map((r) => r.id)).toEqual(["action:a", "action:b"]);
      expect(result.remaining.map((r) => r.id)).toEqual(["action:c"]);
      expect(nextState.suggestedIds).toEqual(["action:a", "action:b"]);
      expect(dailyPlanSignature(nextState)).toBe(dailyPlanSignature(saved));

      // An explicit refresh is what lets C in, in selector order.
      const refreshed = computeDailyPlan(after, applyRefresh(saved, TODAY), { today: TODAY });
      expect(refreshed.result.suggested.map((r) => r.id)).toEqual(["action:c", "action:a", "action:b"]);
    });

    it("refills only the slot a completed item vacated, keeping the others in place", () => {
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [due("a", "Alpha", 5), due("b", "Bravo", 5), due("d", "Delta", 5)],
      };
      const { nextState: saved } = computeDailyPlan(sources, null, { timeBudget: 10, today: TODAY });
      expect(saved.suggestedIds).toEqual(["action:a", "action:b"]);

      const completed: RecommendationSources = {
        ...sources,
        actions: [
          { ...due("a", "Alpha", 5), status: "completed" as const },
          due("b", "Bravo", 5),
          due("d", "Delta", 5),
        ],
      };
      const { result } = computeDailyPlan(completed, saved, { today: TODAY });
      expect(result.suggested.map((r) => r.id)).toEqual(["action:b", "action:d"]);
    });

    it("keeps a selected item whose estimate grew, and reports the session as over budget", () => {
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [due("a", "Alpha", 5), due("b", "Bravo", 5)],
      };
      const { nextState: saved } = computeDailyPlan(sources, null, { timeBudget: 10, today: TODAY });
      const grown: RecommendationSources = {
        ...sources,
        actions: [due("a", "Alpha", 25), due("b", "Bravo", 5)],
      };
      const { result } = computeDailyPlan(grown, saved, { today: TODAY });
      expect(result.suggested.map((r) => r.id)).toEqual(["action:a", "action:b"]);
      expect(result.allocatedMinutes).toBe(30);
      expect(result.fitsBudgetCompletely).toBe(false);
      expect(result.suggested[0]?.explanation).toContain("over the 10-min budget");
    });

    it("does not grow a healthy session to absorb new work", () => {
      const one: RecommendationSources = { today: TODAY, actions: [due("a", "Alpha", 5)] };
      const { nextState: saved } = computeDailyPlan(one, null, { timeBudget: 30, today: TODAY });
      const more: RecommendationSources = {
        today: TODAY,
        actions: [due("a", "Alpha", 5), due("b", "Bravo", 5)],
      };
      const { result } = computeDailyPlan(more, saved, { today: TODAY });
      expect(result.suggested.map((r) => r.id)).toEqual(["action:a"]);
      expect(result.remaining.map((r) => r.id)).toEqual(["action:b"]);
    });

    it("selects at most one replacement when a saved one-item session loses its only item", () => {
      const initialSources: RecommendationSources = {
        today: TODAY,
        actions: [due("a", "Alpha", 20)],
      };
      const { nextState: saved } = computeDailyPlan(initialSources, null, { timeBudget: 20, today: TODAY });
      expect(saved.suggestedIds).toEqual(["action:a"]);
      expect(saved.targetCapacity).toBe(1);

      // Action A is removed; 5-min actions B, C, D are available
      const nextSources: RecommendationSources = {
        today: TODAY,
        actions: [due("b", "Bravo", 5), due("c", "Charlie", 5), due("d", "Delta", 5)],
      };
      const { result, nextState } = computeDailyPlan(nextSources, saved, { today: TODAY });
      // Exactly 1 replacement selected, adhering to preserved session size
      expect(result.suggested.map((r) => r.id)).toEqual(["action:b"]);
      expect(result.remaining.map((r) => r.id)).toEqual(["action:c", "action:d"]);
      expect(nextState.suggestedIds).toEqual(["action:b"]);
      expect(nextState.targetCapacity).toBe(1);
    });

    it("selects at most two replacements when a saved two-item session loses both items", () => {
      const initialSources: RecommendationSources = {
        today: TODAY,
        actions: [due("a", "Alpha", 10), due("b", "Bravo", 10)],
      };
      const { nextState: saved } = computeDailyPlan(initialSources, null, { timeBudget: 20, today: TODAY });
      expect(saved.suggestedIds).toEqual(["action:a", "action:b"]);
      expect(saved.targetCapacity).toBe(2);

      // Both A and B are removed; C, D, E are available (5 min each)
      const nextSources: RecommendationSources = {
        today: TODAY,
        actions: [due("c", "Charlie", 5), due("d", "Delta", 5), due("e", "Echo", 5)],
      };
      const { result, nextState } = computeDailyPlan(nextSources, saved, { today: TODAY });
      expect(result.suggested.map((r) => r.id)).toEqual(["action:c", "action:d"]);
      expect(result.remaining.map((r) => r.id)).toEqual(["action:e"]);
      expect(nextState.suggestedIds).toEqual(["action:c", "action:d"]);
      expect(nextState.targetCapacity).toBe(2);
    });

    it("preserves session capacity across empty intermediate state and persistence/reopen", () => {
      const initialSources: RecommendationSources = {
        today: TODAY,
        actions: [due("a", "Alpha", 20)],
      };
      const { nextState: saved } = computeDailyPlan(initialSources, null, { timeBudget: 20, today: TODAY });
      expect(saved.suggestedIds).toEqual(["action:a"]);
      expect(saved.targetCapacity).toBe(1);

      // Step 1: A is removed, only a 25-min action E is available (exceeds 20-min budget).
      const intermediateSources: RecommendationSources = {
        today: TODAY,
        actions: [due("e", "Echo", 25)],
      };
      const { result: rIntermediate, nextState: intermediateState } = computeDailyPlan(
        intermediateSources,
        saved,
        { today: TODAY },
      );
      expect(rIntermediate.suggested).toHaveLength(0);
      expect(rIntermediate.remaining.map((r) => r.id)).toEqual(["action:e"]);
      expect(intermediateState.suggestedIds).toEqual([]);
      expect(intermediateState.targetCapacity).toBe(1);

      // Step 2: Persist and reopen intermediate state
      const serialized = serializeDailyPlanState(intermediateState);
      const reopened = parseDailyPlanState(serialized);
      expect(reopened).not.toBeNull();
      expect(reopened!.suggestedIds).toEqual([]);
      expect(reopened!.targetCapacity).toBe(1);

      // Step 3: Later, 5-min actions B, C, D become available.
      const laterSources: RecommendationSources = {
        today: TODAY,
        actions: [due("b", "Bravo", 5), due("c", "Charlie", 5), due("d", "Delta", 5), due("e", "Echo", 25)],
      };
      const { result: rLater, nextState: finalState } = computeDailyPlan(laterSources, reopened, { today: TODAY });
      expect(rLater.suggested.map((r) => r.id)).toEqual(["action:b"]);
      expect(rLater.remaining.map((r) => r.id)).toEqual(["action:c", "action:d", "action:e"]);
      expect(finalState.suggestedIds).toEqual(["action:b"]);
      expect(finalState.targetCapacity).toBe(1);
    });

    it("permits fresh selection on explicit refresh, budget change, and local-day rollover", () => {
      const initialSources: RecommendationSources = {
        today: TODAY,
        actions: [due("a", "Alpha", 20)],
      };
      const { nextState: saved } = computeDailyPlan(initialSources, null, { timeBudget: 20, today: TODAY });
      expect(saved.targetCapacity).toBe(1);

      // Action A is gone, 3 actions B, C, D (5 min each) are available
      const threeSources: RecommendationSources = {
        today: TODAY,
        actions: [due("b", "Bravo", 5), due("c", "Charlie", 5), due("d", "Delta", 5)],
      };

      // 1. Explicit refresh resets targetCapacity and selects all 3 items
      const refreshed = applyRefresh(saved, TODAY);
      expect(refreshed.targetCapacity).toBeUndefined();
      const rRefresh = computeDailyPlan(threeSources, refreshed, { today: TODAY });
      expect(rRefresh.result.suggested.map((r) => r.id)).toEqual(["action:b", "action:c", "action:d"]);
      expect(rRefresh.nextState.targetCapacity).toBe(3);

      // 2. Budget change resets targetCapacity and selects fresh session
      const budgetChanged = applyBudgetChange(saved, 30, TODAY);
      expect(budgetChanged.targetCapacity).toBeUndefined();
      const rBudget = computeDailyPlan(threeSources, budgetChanged, { timeBudget: 30, today: TODAY });
      expect(rBudget.result.suggested.map((r) => r.id)).toEqual(["action:b", "action:c", "action:d"]);
      expect(rBudget.nextState.targetCapacity).toBe(3);

      // 3. Local-day rollover resets targetCapacity and selects fresh session
      const rolledOver = rolloverDailyPlanState(saved, "2026-09-26");
      expect(rolledOver.targetCapacity).toBeUndefined();
      const rRollover = computeDailyPlan(threeSources, rolledOver, { today: "2026-09-26" });
      expect(rRollover.result.suggested.map((r) => r.id)).toEqual(["action:b", "action:c", "action:d"]);
      expect(rRollover.nextState.targetCapacity).toBe(3);
    });

    it("resets every decision for today in one state change", () => {
      let state = createInitialDailyPlanState(TODAY, 20);
      state = applySkip(state, "action:a", TODAY);
      state = applyDefer(state, "action:b", TODAY);
      const reset = applyResetToday(state, TODAY);
      expect(reset.decisions).toEqual({});
      expect(applyResetToday(reset, TODAY)).toBe(reset);
    });

    it("signature ignores updatedAt but reflects every meaningful field", () => {
      const a = createInitialDailyPlanState(TODAY, 20);
      const b = { ...a, updatedAt: "2030-01-01T00:00:00.000Z" };
      expect(dailyPlanSignature(a)).toBe(dailyPlanSignature(b));
      expect(dailyPlanSignature(applySkip(a, "action:x", TODAY))).not.toBe(dailyPlanSignature(a));
      expect(dailyPlanSignature(applyBudgetChange(a, 10, TODAY))).not.toBe(dailyPlanSignature(a));
    });
  });

  describe("Start targets when a linked record is gone", () => {
    const linked = (relatedType: "journal" | "material" | "event", relatedId: string) =>
      mockAction({ id: `a-${relatedType}`, relatedType, relatedId, title: `${relatedType} action` });
    const rec = (actionId: string): Recommendation => ({
      id: `action:${actionId}`,
      title: "Linked action",
      kind: "action",
      precedence: "due_action",
      estimatedMinutes: 10,
      reason: { summary: "Due", sourceType: "action", sourceId: actionId },
      explanation: "Due",
    });

    it.each([
      ["journal", "j-gone"],
      ["material", "mat-gone"],
      ["event", "event-gone"],
    ] as const)("falls back to the action itself when its %s was deleted", (type, id) => {
      const action = linked(type, id);
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [action],
        journalEntries: [],
        materials: [],
        events: [],
      };
      const target = getStartTarget(rec(action.id), sources);
      expect(target.isLocalAction).toBe(true);
      expect(target.elementId).toBe(`action-${action.id}`);
      expect(target.path).toBe("/");
    });

    it("still navigates to each linked record while it exists", () => {
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [linked("journal", "j-1"), linked("material", "mat-1"), linked("event", "event-1")],
        journalEntries: [makeJournalEntry({ id: "j-1" })],
        materials: [mockMaterial({ id: "mat-1" })],
        events: [mockEvent({ id: "event-1" })],
      };
      expect(getStartTarget(rec("a-journal"), sources).path).toBe("/journal/j-1");
      expect(getStartTarget(rec("a-material"), sources).path).toBe("/study/mat-1");
      expect(getStartTarget(rec("a-event"), sources).path).toBe("/schedule/event-1");
    });

    it("navigates bound homework action to /study/homework/:id?activity=...", () => {
      const hwAction = mockAction({ id: "act-hw-1", title: "Weather quiz" });
      const hwSnapshot = {
        version: 1,
        assignment: {
          id: "hw-99",
          title: "Weather Prep",
          action_id: "act-hw-1",
          state: "upcoming",
        },
        activities: [
          {
            record: { id: "entry-1", title: "Weather quiz", state: "upcoming", removed_at: null },
          },
        ],
      };
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [hwAction],
        homework: [hwSnapshot as any],
      };
      const target = getStartTarget(rec("act-hw-1"), sources);
      expect(target.path).toBe("/study/homework/hw-99?activity=entry-1");
      expect(target.label).toBe("Open homework for Linked action");
      expect(target.isLocalAction).toBeUndefined();
    });
  });

  describe("Session stability & date rollover", () => {
    it("pinned_and_locked_session_stable_until_refresh", () => {
      const act1 = mockAction({ id: "act-1", title: "Task 1", estimatedMinutes: 15 });
      const act2 = mockAction({ id: "act-2", title: "Task 2", estimatedMinutes: 15 });
      const pinnedAct = mockAction({ id: "act-pinned", title: "Pinned Task", estimatedMinutes: 15 });

      const initialSources: RecommendationSources = {
        today: TODAY,
        actions: [act1, act2, pinnedAct],
        pinnedActionIds: new Set(["act-pinned"]),
      };

      const lockedState = createInitialDailyPlanState(TODAY, null);
      lockedState.suggestedIds = ["action:act-pinned", "action:act-1", "action:act-2"];
      const initialPlan = computeDailyPlan(initialSources, lockedState);
      expect(initialPlan.result.suggested.map((s) => s.id)).toEqual([
        "action:act-pinned",
        "action:act-1",
        "action:act-2",
      ]);

      // Newly urgent overdue homework arrives
      const urgentHwAction = mockAction({
        id: "act-hw-urgent",
        title: "Urgent Homework",
        dueDate: "2026-09-01",
        estimatedMinutes: 20,
      });
      const hwSnapshot = {
        version: 1,
        assignment: {
          id: "hw-urgent",
          title: "Urgent Homework",
          action_id: "act-hw-urgent",
          due_date: "2026-09-01",
          state: "upcoming",
        },
        activities: [
          { record: { id: "e-1", title: "Urgent Homework", state: "upcoming", removed_at: null } },
        ],
      };

      const updatedSources: RecommendationSources = {
        today: TODAY,
        actions: [act1, act2, pinnedAct, urgentHwAction],
        pinnedActionIds: new Set(["act-pinned"]),
        homework: [hwSnapshot as any],
      };

      // Before refresh: locked session remains stable; newly urgent homework waits
      const stablePlan = computeDailyPlan(updatedSources, lockedState);
      expect(stablePlan.result.suggested.map((s) => s.id)).toEqual([
        "action:act-pinned",
        "action:act-1",
        "action:act-2",
      ]);
      expect(stablePlan.result.suggested.some((s) => s.id === "action:act-hw-urgent")).toBe(false);

      // After user clicks Refresh: locked session recomputes and includes urgent homework
      const refreshedState = applyRefresh(lockedState);
      const refreshedPlan = computeDailyPlan(updatedSources, refreshedState);
      expect(refreshedPlan.result.suggested.some((s) => s.id === "action:act-hw-urgent")).toBe(true);
      expect(refreshedPlan.result.suggested.some((s) => s.id === "action:act-pinned")).toBe(true);
    });

    it("date_rollover_dst_and_travel_recompute", () => {
      const state: DailyPlanState = {
        version: 1,
        date: "2026-09-25",
        timeBudget: null,
        suggestedIds: ["action:act-1"],
        decisions: {
          "action:act-old": { type: "skip", date: "2026-09-25" },
          "action:act-deferred": { type: "defer", date: "2026-09-25" },
        },
        updatedAt: "2026-09-25T10:00:00.000Z",
      };

      // Date advances across midnight / DST / travel to a new date
      const rolledState = rolloverDailyPlanState(state, "2026-09-26");
      expect(rolledState.date).toBe("2026-09-26");
      // Expired decisions are cleared
      expect(rolledState.decisions["action:act-old"]).toBeUndefined();
      expect(rolledState.decisions["action:act-deferred"]).toBeUndefined();

      // Actions evaluated against the new date reflect new overdue/due status
      const action = mockAction({ id: "act-due", dueDate: "2026-09-26" });
      const hwSnapshot = {
        version: 1,
        assignment: {
          id: "hw-1",
          title: "HW",
          action_id: "act-due",
          due_date: "2026-09-26",
          state: "upcoming",
        },
        activities: [{ record: { id: "e-1", title: "HW", state: "upcoming", removed_at: null } }],
      };

      const sources: RecommendationSources = {
        today: "2026-09-26",
        actions: [action],
        homework: [hwSnapshot as any],
      };
      const plan = computeDailyPlan(sources, rolledState);
      const hwRec = plan.result.suggested.find((s) => s.id === "action:act-due");
      expect(hwRec).toBeDefined();
      expect(hwRec!.reason.summary).toBe("Homework due today");
    });

    it("plan_logic_unchanged_by_wording (same inputs → same item IDs, order and budget numbers as before)", () => {
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [
          mockAction({ id: "act-unknown", title: "Review emergency checklist", estimatedMinutes: null, priority: "important", dueDate: TODAY }),
          mockAction({ id: "act-10m", title: "Preflight walkaround", estimatedMinutes: 10, priority: "important", dueDate: TODAY }),
          mockAction({ id: "act-15m", title: "Logbook review", estimatedMinutes: 15, priority: "later", dueDate: TODAY }),
        ],
      };
      const { result } = computeDailyPlan(sources, null, { timeBudget: 15, today: TODAY });

      // Item selection and ordering
      expect(result.suggested.map((s) => s.id)).toEqual(["action:act-10m", "action:act-unknown"]);
      expect(result.remaining.map((r) => r.id)).toEqual(["action:act-15m"]);

      // Budget numbers
      expect(result.allocatedMinutes).toBe(10);
      expect(result.totalEstimatedMinutes).toBe(10);
      expect(result.timeBudget).toBe(15);
      expect(result.suggestedUnestimatedCount).toBe(1);
      expect(result.fitsBudgetCompletely).toBe(false);

      // Plain wording in explanations
      expect(result.suggested[0]?.explanation).toBe("Due today · About 10 min");
      expect(result.suggested[1]?.explanation).toBe(
        "Due today · No time estimate yet, included because it's important",
      );
    });

    it("daily_plan_wording_is_plain (rendered plan text never contains allocation, allocated, indeterminate or timed item)", () => {
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [
          mockAction({ id: "act-unknown", title: "Review emergency checklist", estimatedMinutes: null, priority: "important", dueDate: TODAY }),
          mockAction({ id: "act-10m", title: "Preflight walkaround", estimatedMinutes: 10, priority: "important", dueDate: TODAY }),
        ],
      };
      const { result } = computeDailyPlan(sources, null, { timeBudget: 20, today: TODAY });

      for (const item of result.suggested) {
        const text = item.explanation.toLowerCase();
        expect(text).not.toContain("allocation");
        expect(text).not.toContain("allocated");
        expect(text).not.toContain("indeterminate");
        expect(text).not.toContain("timed item");
      }
    });
  });
});
