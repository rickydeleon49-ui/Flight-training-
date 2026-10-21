import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/domain/types";
import {
  buildRecommendationCandidates,
  compareCandidates,
  getRecommendations,
  isSourceIdValid,
  selectRecommendations,
  type RecommendationCandidate,
  type RecommendationSources,
} from "./recommendations";
import {
  makeAction,
  makeEvent,
  makeJournalEntry,
  makeMaterial,
  makeNote,
  makePrepItem,
  makeQuestion,
} from "@/testing/factories";

const TODAY: IsoDate = "2026-09-05";

const mockAction = makeAction;
const mockJournal = makeJournalEntry;
const mockQuestion = makeQuestion;
const mockMaterial = makeMaterial;
const mockNote = makeNote;
const mockLesson = makeEvent;
const mockPrepItem = makePrepItem;

describe("D2 — Pure Recommendation Selector", () => {
  describe("Candidate sets & empty set handling", () => {
    it("handles an empty candidate set cleanly", () => {
      const result = selectRecommendations([]);
      expect(result.suggested).toEqual([]);
      expect(result.remaining).toEqual([]);
      expect(result.totalEstimatedMinutes).toBe(0);
      expect(result.unestimatedCount).toBe(0);
      expect(result.timeBudget).toBeNull();
    });

    it("handles 3-item candidate sets within maxItems", () => {
      const candidates: RecommendationCandidate[] = [
        {
          id: "act-1",
          title: "Preflight checklist",
          kind: "action",
          precedence: "due_action",
          estimatedMinutes: 10,
          reason: { summary: "Due today", sourceType: "action", sourceId: "act-1" },
        },
        {
          id: "act-2",
          title: "Crosswind prep",
          kind: "lesson_prep",
          precedence: "lesson_prep",
          estimatedMinutes: 15,
          reason: { summary: "Upcoming lesson", sourceType: "event", sourceId: "ev-1" },
        },
        {
          id: "act-3",
          title: "Review airspace",
          kind: "study_material",
          precedence: "study",
          estimatedMinutes: 20,
          reason: { summary: "Needs review", sourceType: "material", sourceId: "mat-1" },
        },
      ];

      const result = selectRecommendations(candidates, { maxItems: 3 });
      expect(result.suggested).toHaveLength(3);
      expect(result.remaining).toHaveLength(0);
      expect(result.suggested.map((s) => s.id)).toEqual(["act-1", "act-2", "act-3"]);
      expect(result.totalEstimatedMinutes).toBe(45);
    });

    it("handles 20-item candidate sets without dropping unfinished work", () => {
      const candidates: RecommendationCandidate[] = Array.from({ length: 20 }, (_, i) => ({
        id: `act-${String(i).padStart(2, "0")}`,
        title: `Task ${i}`,
        kind: "action",
        precedence: "open_action",
        estimatedMinutes: 5,
        reason: { summary: `Action ${i}`, sourceType: "action", sourceId: `act-${i}` },
      }));

      const result = selectRecommendations(candidates, { maxItems: 3 });
      expect(result.suggested).toHaveLength(3);
      expect(result.remaining).toHaveLength(17);
      // All 20 items are accounted for across suggested + remaining
      const allIds = [...result.suggested, ...result.remaining].map((r) => r.id);
      expect(allIds).toHaveLength(20);
      expect(new Set(allIds).size).toBe(20);
    });
  });

  describe("Precedence & Overdue sorting", () => {
    it("orders user-pinned work and due actions before lesson prep and study", () => {
      const sources: RecommendationSources = {
        today: TODAY,
        notes: [mockNote({ id: "n-1", pinned: true, title: "Pinned cockpit note" })],
        actions: [
          mockAction({ id: "a-due", dueDate: TODAY, title: "Due today action" }),
          mockAction({ id: "a-open", dueDate: null, title: "Open backlog action" }),
        ],
        events: [mockLesson({ id: "ev-1" })],
        prepItems: [mockPrepItem({ id: "p-1", eventId: "ev-1", title: "Prep checklist" })],
        materials: [mockMaterial({ id: "m-1", title: "Weather theory" })],
      };

      const result = getRecommendations(sources, { maxItems: 10 });
      const order = result.suggested.map((s) => s.precedence);

      // Precedence order: pinned -> due_action -> lesson_prep -> study -> open_action
      expect(order).toEqual(["pinned", "due_action", "lesson_prep", "study", "open_action"]);
      expect(result.suggested[0]?.title).toBe("Pinned cockpit note");
      expect(result.suggested[1]?.title).toBe("Due today action");
      expect(result.suggested[2]?.title).toBe("Prep checklist");
      expect(result.suggested[3]?.title).toBe("Review: Weather theory");
      expect(result.suggested[4]?.title).toBe("Open backlog action");
    });

    it("prioritizes overdue tasks over tasks due today, and orders older overdue tasks first", () => {
      const sources: RecommendationSources = {
        today: TODAY, // 2026-09-05
        actions: [
          mockAction({ id: "a-today", dueDate: "2026-09-05", title: "Action due today" }),
          mockAction({ id: "a-recent-overdue", dueDate: "2026-09-04", title: "Overdue 1 day" }),
          mockAction({ id: "a-old-overdue", dueDate: "2026-09-01", title: "Overdue 4 days" }),
        ],
      };

      const result = getRecommendations(sources, { maxItems: 5 });
      const titles = result.suggested.map((s) => s.title);
      expect(titles).toEqual(["Overdue 4 days", "Overdue 1 day", "Action due today"]);
      expect(result.suggested[0]?.reason.summary).toBe("Overdue since 2026-09-01");
      expect(result.suggested[1]?.reason.summary).toBe("Overdue since 2026-09-04");
      expect(result.suggested[2]?.reason.summary).toBe("Due today");
    });
  });

  describe("Time Budgets (10, 20, 30 min) and Unknown Estimates", () => {
    const candidates: RecommendationCandidate[] = [
      {
        id: "task-unknown-pinned",
        title: "Pinned task with unknown duration",
        kind: "action",
        precedence: "pinned",
        estimatedMinutes: null,
        reason: { summary: "Pinned", sourceType: "action", sourceId: "task-unknown-pinned" },
      },
      {
        id: "task-10m",
        title: "Check ATIS & calculate density altitude",
        kind: "action",
        precedence: "due_action",
        estimatedMinutes: 10,
        reason: { summary: "Due today", sourceType: "action", sourceId: "task-10m" },
      },
      {
        id: "task-15m",
        title: "Review airspace restrictions",
        kind: "study_material",
        precedence: "study",
        estimatedMinutes: 15,
        reason: { summary: "Study review", sourceType: "material", sourceId: "task-15m" },
      },
      {
        id: "task-5m",
        title: "Verify fuel log",
        kind: "action",
        precedence: "open_action",
        estimatedMinutes: 5,
        reason: { summary: "Quick check", sourceType: "action", sourceId: "task-5m" },
      },
      {
        id: "task-30m",
        title: "Full weight & balance calculation",
        kind: "action",
        precedence: "open_action",
        estimatedMinutes: 30,
        reason: { summary: "W&B calculation", sourceType: "action", sourceId: "task-30m" },
      },
    ];

    it("handles an all-unknown candidate set without producing an empty session", () => {
      const allUnknown: RecommendationCandidate[] = [
        {
          id: "u-1",
          title: "Pre-solo briefing note",
          kind: "note",
          precedence: "pinned",
          estimatedMinutes: null,
          reason: { summary: "Pinned note", sourceType: "note", sourceId: "u-1" },
        },
        {
          id: "u-2",
          title: "Check runway NOTAMs",
          kind: "action",
          precedence: "due_action",
          estimatedMinutes: null,
          reason: { summary: "Due today", sourceType: "action", sourceId: "u-2" },
        },
        {
          id: "u-3",
          title: "Calculate density altitude",
          kind: "lesson_prep",
          precedence: "lesson_prep",
          estimatedMinutes: null,
          reason: { summary: "Prep item", sourceType: "prep_item", sourceId: "u-3" },
        },
      ];

      // A 10-minute session requested with an all-unknown candidate set
      const result = selectRecommendations(allUnknown, { timeBudget: 10, maxItems: 3 });

      // Must NOT produce an empty session when useful pinned or due work exists
      expect(result.suggested).toHaveLength(3);
      expect(result.suggested.map((s) => s.id)).toEqual(["u-1", "u-2", "u-3"]);

      // Durations remain visibly unknown (null) without fabricating a duration or treating as 0 min
      for (const item of result.suggested) {
        expect(item.estimatedMinutes).toBeNull();
        expect(item.explanation).toContain("Duration unknown (included by priority; not counted in 10-min timed allocation)");
      }

      // Allocated minutes track known duration (0), but unestimated count is recorded
      expect(result.totalEstimatedMinutes).toBe(0);
      expect(result.allocatedMinutes).toBe(0);
      expect(result.suggestedUnestimatedCount).toBe(3);
      expect(result.unestimatedCount).toBe(3);

      // Does not falsely claim the entire session fits the budget when durations are unknown
      expect(result.fitsBudgetCompletely).toBe(false);
      expect(result.remaining).toHaveLength(0);
    });

    it("respects a 10-minute budget with mixed known and unknown duration candidates", () => {
      const result = selectRecommendations(candidates, { timeBudget: 10, maxItems: 3 });

      // task-unknown-pinned is suggested #1 by precedence (visibly unknown duration, null)
      // task-10m is suggested #2 (10 min allocated; total duration indeterminate)
      // task-15m, task-5m exceed remaining budget -> remaining
      expect(result.suggested.map((s) => s.id)).toEqual(["task-unknown-pinned", "task-10m"]);
      expect(result.suggested[0]?.estimatedMinutes).toBeNull();
      expect(result.suggested[0]?.explanation).toBe(
        "Pinned · Duration unknown (included by priority; not counted in 10-min timed allocation)",
      );
      expect(result.suggested[1]?.estimatedMinutes).toBe(10);
      expect(result.suggested[1]?.explanation).toBe(
        "Due today · 10 min estimated for timed item (10 of 10 min allocated; total duration indeterminate)",
      );
      expect(result.suggested[1]?.explanation).not.toContain("Fits 10-min session");
      expect(result.suggested[1]?.explanation).not.toContain("0 min remaining");

      expect(result.totalEstimatedMinutes).toBe(10);
      expect(result.allocatedMinutes).toBe(10);
      expect(result.timeBudget).toBe(10);
      expect(result.suggestedUnestimatedCount).toBe(1);
      expect(result.fitsBudgetCompletely).toBe(false);

      // Remaining tasks
      const remainingIds = result.remaining.map((r) => r.id);
      expect(remainingIds).toContain("task-15m");
      expect(remainingIds).toContain("task-5m");
      expect(remainingIds).toContain("task-30m");
    });

    it("mixed session regression (unknown before known): formats timed item as estimate without claiming full fit", () => {
      const mixedCandidates: RecommendationCandidate[] = [
        {
          id: "pinned-note",
          title: "Preflight checklist reminder",
          kind: "note",
          precedence: "pinned",
          estimatedMinutes: null,
          reason: { summary: "Pinned note", sourceType: "note", sourceId: "pinned-note" },
        },
        {
          id: "due-action",
          title: "Check NOTAMs",
          kind: "action",
          precedence: "due_action",
          estimatedMinutes: 10,
          reason: { summary: "Due today", sourceType: "action", sourceId: "due-action" },
        },
      ];

      const result = selectRecommendations(mixedCandidates, { timeBudget: 15, maxItems: 3 });

      expect(result.suggested.map((s) => s.id)).toEqual(["pinned-note", "due-action"]);
      expect(result.suggestedUnestimatedCount).toBe(1);
      expect(result.allocatedMinutes).toBe(10);
      expect(result.totalEstimatedMinutes).toBe(10);
      expect(result.fitsBudgetCompletely).toBe(false);

      // Unknown item explanation
      expect(result.suggested[0]?.estimatedMinutes).toBeNull();
      expect(result.suggested[0]?.explanation).toBe(
        "Pinned note · Duration unknown (included by priority; not counted in 15-min timed allocation)",
      );

      // Known item explanation must NOT claim guaranteed session fit or remaining time
      expect(result.suggested[1]?.estimatedMinutes).toBe(10);
      expect(result.suggested[1]?.explanation).toBe(
        "Due today · 10 min estimated for timed item (10 of 15 min allocated; total duration indeterminate)",
      );
      expect(result.suggested[1]?.explanation).not.toContain("Fits 15-min session");
      expect(result.suggested[1]?.explanation).not.toContain("remaining");
    });

    it("mixed session regression (known before unknown): previously generated explanations remain accurate", () => {
      const mixedCandidates: RecommendationCandidate[] = [
        {
          id: "due-action",
          title: "Check NOTAMs",
          kind: "action",
          precedence: "due_action",
          estimatedMinutes: 10,
          reason: { summary: "Due today", sourceType: "action", sourceId: "due-action" },
        },
        {
          id: "prep-item",
          title: "Review maneuver flow",
          kind: "lesson_prep",
          precedence: "lesson_prep",
          estimatedMinutes: null,
          reason: { summary: "Lesson prep", sourceType: "prep_item", sourceId: "prep-item" },
        },
      ];

      const result = selectRecommendations(mixedCandidates, { timeBudget: 15, maxItems: 3 });

      expect(result.suggested.map((s) => s.id)).toEqual(["due-action", "prep-item"]);
      expect(result.suggestedUnestimatedCount).toBe(1);
      expect(result.allocatedMinutes).toBe(10);
      expect(result.totalEstimatedMinutes).toBe(10);
      expect(result.fitsBudgetCompletely).toBe(false);

      // Known item (which appears FIRST in sorted list) must still reflect indeterminate session duration
      expect(result.suggested[0]?.estimatedMinutes).toBe(10);
      expect(result.suggested[0]?.explanation).toBe(
        "Due today · 10 min estimated for timed item (10 of 15 min allocated; total duration indeterminate)",
      );
      expect(result.suggested[0]?.explanation).not.toContain("Fits 15-min session");
      expect(result.suggested[0]?.explanation).not.toContain("remaining");

      // Unknown item (which appears SECOND in sorted list)
      expect(result.suggested[1]?.estimatedMinutes).toBeNull();
      expect(result.suggested[1]?.explanation).toBe(
        "Lesson prep · Duration unknown (included by priority; not counted in 15-min timed allocation)",
      );
    });

    it("respects a 20-minute budget combining tasks that fit", () => {
      const result = selectRecommendations(candidates, { timeBudget: 20, maxItems: 3 });

      // task-unknown-pinned (pinned, unknown) + task-10m (10m) + task-5m (5m) = 15m <= 20m
      // task-15m requires 15m when 10m left -> exceeds budget
      expect(result.suggested.map((s) => s.id)).toEqual(["task-unknown-pinned", "task-10m", "task-5m"]);
      expect(result.totalEstimatedMinutes).toBe(15);
      expect(result.allocatedMinutes).toBe(15);
      expect(result.suggestedUnestimatedCount).toBe(1);
      expect(result.fitsBudgetCompletely).toBe(false);

      // task-15m was excluded from short list with explanation
      const task15 = result.remaining.find((r) => r.id === "task-15m");
      expect(task15?.explanation).toContain("Exceeds remaining timed allocation (15 min vs 10 min left)");
    });

    it("respects a 30-minute budget and marks complete fit when all suggested tasks are estimated", () => {
      const estimatedOnly = candidates.filter((c) => c.estimatedMinutes !== null);
      const result = selectRecommendations(estimatedOnly, { timeBudget: 30, maxItems: 3 });

      // task-10m (10m) + task-15m (15m) + task-5m (5m) = 30m
      expect(result.suggested.map((s) => s.id)).toEqual(["task-10m", "task-15m", "task-5m"]);
      expect(result.totalEstimatedMinutes).toBe(30);
      expect(result.allocatedMinutes).toBe(30);
      expect(result.suggestedUnestimatedCount).toBe(0);
      expect(result.fitsBudgetCompletely).toBe(true);

      // Verifies complete session fit wording when all items are estimated
      expect(result.suggested[0]?.explanation).toBe("Due today · Fits 30-min session (10 min, 0 min remaining)");
      expect(result.suggested[1]?.explanation).toBe("Study review · Fits 30-min session (15 min, 0 min remaining)");
      expect(result.suggested[2]?.explanation).toBe("Quick check · Fits 30-min session (5 min, 0 min remaining)");

      // task-30m exceeds remaining budget (evaluated when 5 min were left before task-5m was evaluated)
      const task30 = result.remaining.find((r) => r.id === "task-30m");
      expect(task30?.explanation).toContain("Exceeds remaining timed allocation (30 min vs 5 min left)");
    });
  });

  describe("Stable tie-breaking & Determinism", () => {
    it("breaks ties deterministically by title and unique ID", () => {
      const c1: RecommendationCandidate = {
        id: "act-b",
        title: "Alpha Task",
        kind: "action",
        precedence: "open_action",
        estimatedMinutes: 10,
        reason: { summary: "Action", sourceType: "action", sourceId: "act-b" },
      };
      const c2: RecommendationCandidate = {
        id: "act-a",
        title: "Alpha Task",
        kind: "action",
        precedence: "open_action",
        estimatedMinutes: 10,
        reason: { summary: "Action", sourceType: "action", sourceId: "act-a" },
      };
      const c3: RecommendationCandidate = {
        id: "act-c",
        title: "Beta Task",
        kind: "action",
        precedence: "open_action",
        estimatedMinutes: 10,
        reason: { summary: "Action", sourceType: "action", sourceId: "act-c" },
      };

      // Regardless of insertion order, order must be: act-a (Alpha Task), act-b (Alpha Task), act-c (Beta Task)
      const order1 = [...[c3, c1, c2]].sort((a, b) => compareCandidates(a, b, TODAY)).map((x) => x.id);
      const order2 = [...[c1, c3, c2]].sort((a, b) => compareCandidates(a, b, TODAY)).map((x) => x.id);
      expect(order1).toEqual(["act-a", "act-b", "act-c"]);
      expect(order2).toEqual(["act-a", "act-b", "act-c"]);
    });

    it("yields identical ordering and explanations for identical inputs and date", () => {
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [
          mockAction({ id: "a-1", title: "Action A", estimatedMinutes: 15, dueDate: TODAY }),
          mockAction({ id: "a-2", title: "Action B", estimatedMinutes: 10, dueDate: "2026-09-04" }),
        ],
        notes: [mockNote({ id: "n-1", pinned: true, title: "Note 1" })],
      };

      const res1 = getRecommendations(sources, { timeBudget: 20 });
      const res2 = getRecommendations(sources, { timeBudget: 20 });

      expect(res1).toEqual(res2);
    });
  });

  describe("Unavailable Sources & Source ID Validity", () => {
    it("validates that all displayed reasons reference real source IDs even when sources are archived", () => {
      const sources: RecommendationSources = {
        today: TODAY,
        actions: [
          // Action referencing an existing journal entry
          mockAction({
            id: "act-with-journal",
            title: "Practice rudder",
            relatedType: "journal",
            relatedId: "j-existing",
          }),
          // Action referencing a DELETED/UNAVAILABLE journal entry
          mockAction({
            id: "act-with-deleted-journal",
            title: "Practice steep turns",
            relatedType: "journal",
            relatedId: "j-deleted",
          }),
        ],
        questions: [
          // Question referencing an existing journal entry
          mockQuestion({
            id: "q-with-journal",
            text: "Question from existing debrief",
            journalId: "j-existing",
          }),
          // Question referencing a DELETED/UNAVAILABLE journal entry
          mockQuestion({
            id: "q-with-deleted-journal",
            text: "Question from deleted debrief",
            journalId: "j-deleted",
          }),
        ],
        journalEntries: [mockJournal({ id: "j-existing" })],
      };

      const candidates = buildRecommendationCandidates(sources);
      const result = selectRecommendations(candidates, { maxItems: 10 });

      // Verify that every single recommendation has a valid source ID
      for (const rec of [...result.suggested, ...result.remaining]) {
        const isValid = isSourceIdValid(rec.reason.sourceId, rec.reason.sourceType, sources);
        expect(isValid).toBe(true);
      }

      // Check specific fallbacks for unavailable sources (no dangling explanation links)
      const actDeleted = result.suggested.find((r) => r.id === "action:act-with-deleted-journal");
      expect(actDeleted?.reason.sourceType).toBe("action");
      expect(actDeleted?.reason.sourceId).toBe("act-with-deleted-journal");
      expect(actDeleted?.reason.summary).toContain("source entry unavailable");

      const qDeleted = result.suggested.find((r) => r.id === "question:q-with-deleted-journal");
      expect(qDeleted?.reason.sourceType).toBe("question");
      expect(qDeleted?.reason.sourceId).toBe("q-with-deleted-journal");
      expect(qDeleted?.reason.summary).toContain("source entry unavailable");
    });
  });

  describe("Debrief-created actions and questions: neither lost nor duplicated", () => {
    it("preserves both debrief-created actions and debrief questions without loss or duplication", () => {
      const debriefJournal = mockJournal({ id: "j-solo-1", title: "Solo circuit training" });

      // In a debrief, the student created an action AND a question with identical text
      const debriefAction = mockAction({
        id: "act-debrief-1",
        title: "Practice crosswind rudder coordination",
        relatedType: "journal",
        relatedId: "j-solo-1",
      });

      const debriefQuestion = mockQuestion({
        id: "q-debrief-1",
        text: "Practice crosswind rudder coordination",
        journalId: "j-solo-1",
      });

      const sources: RecommendationSources = {
        today: TODAY,
        actions: [debriefAction],
        questions: [debriefQuestion],
        journalEntries: [debriefJournal],
      };

      const result = getRecommendations(sources, { maxItems: 10 });
      const ids = result.suggested.map((s) => s.id);

      // Both must be present with distinct IDs
      expect(ids).toContain("action:act-debrief-1");
      expect(ids).toContain("question:q-debrief-1");
      expect(result.suggested).toHaveLength(2);

      const actionItem = result.suggested.find((s) => s.id === "action:act-debrief-1");
      const questionItem = result.suggested.find((s) => s.id === "question:q-debrief-1");

      expect(actionItem?.kind).toBe("action");
      expect(actionItem?.reason.sourceType).toBe("journal");
      expect(actionItem?.reason.sourceId).toBe("j-solo-1");

      expect(questionItem?.kind).toBe("question");
      expect(questionItem?.reason.sourceType).toBe("journal");
      expect(questionItem?.reason.sourceId).toBe("j-solo-1");
    });
  });

  describe("Purity, Date handling, and Category Uniqueness", () => {
    it("never mutates input candidates or options", () => {
      const candidate: RecommendationCandidate = {
        id: "test-cand-1",
        title: "Immutable test candidate",
        kind: "action",
        precedence: "open_action",
        estimatedMinutes: 10,
        reason: { summary: "Test action", sourceType: "action", sourceId: "test-cand-1" },
      };
      const candidateCopy = JSON.parse(JSON.stringify(candidate));
      const candidates = [candidate];

      selectRecommendations(candidates, { timeBudget: 15, maxItems: 3 });

      expect(candidate).toEqual(candidateCopy);
      expect(candidates).toHaveLength(1);
    });

    it("does not read the clock implicitly: changing reference today shifts overdue status deterministically", () => {
      const sources: RecommendationSources = {
        today: "2026-09-05",
        actions: [mockAction({ id: "act-sep5", dueDate: "2026-09-05", title: "Action" })],
      };

      // On 2026-09-05, it is due today
      const resToday = getRecommendations(sources, { today: "2026-09-05" });
      expect(resToday.suggested[0]?.reason.summary).toBe("Due today");

      // On 2026-09-06, it is overdue
      const resTomorrow = getRecommendations(sources, { today: "2026-09-06" });
      expect(resTomorrow.suggested[0]?.reason.summary).toBe("Overdue since 2026-09-05");

      // On 2026-09-04, it is not overdue or due today (open action)
      const resYesterday = getRecommendations(sources, { today: "2026-09-04" });
      expect(resYesterday.suggested[0]?.reason.summary).toBe("Open action");
    });

    it("ensures no single source entity appears twice across different recommendation categories", () => {
      const lesson = mockLesson({ id: "ev-upcoming", date: TODAY });
      const lessonQuestion = mockQuestion({
        id: "q-shared",
        eventId: "ev-upcoming",
        status: "to_ask",
        text: "Question for upcoming lesson",
      });

      const sources: RecommendationSources = {
        today: TODAY,
        events: [lesson],
        questions: [lessonQuestion],
      };

      const candidates = buildRecommendationCandidates(sources);
      const questionCandidates = candidates.filter((c) => c.id === "question:q-shared");

      // Question must only appear ONCE (under lesson_prep, not duplicated under study)
      expect(questionCandidates).toHaveLength(1);
      expect(questionCandidates[0]?.precedence).toBe("lesson_prep");
    });

    it("no_duplicate_prep_candidate_for_owned_action", () => {
      const lesson = mockLesson({ id: "ev-1", title: "Crosswind Landings", date: "2026-09-06" });
      const action = mockAction({
        id: "act-hw-1",
        title: "Pattern work checklist",
        dueDate: "2026-09-06",
        category: "prepare",
        status: "open",
      });
      const hwSnapshot = {
        version: 1,
        assignment: {
          id: "hw-1",
          title: "Crosswind Homework",
          instructions: "",
          school: null,
          instructor: null,
          lesson_id: "ev-1" as string | null,
          source_lesson_id: null,
          due_date: "2026-09-06" as string | null,
          state: "upcoming",
          revision: 1,
          action_id: "act-hw-1",
          archived: 0,
          created_at: "2026-09-01T10:00:00.000Z",
          updated_at: "2026-09-01T10:00:00.000Z",
          completed_at: null,
        },
        activities: [
          {
            record: {
              id: "act-entry-1",
              assignment_id: "hw-1",
              position: 0,
              kind: "checklist",
              title: "Pattern work checklist",
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
              created_at: "2026-09-01T10:00:00.000Z",
              updated_at: "2026-09-01T10:00:00.000Z",
              completed_at: null,
              removed_at: null,
            },
            source: null,
            evidence: null,
          },
        ],
        runs: [],
      };

      const candidates = buildRecommendationCandidates({
        today: "2026-09-05",
        actions: [action],
        events: [lesson],
        homework: [hwSnapshot as any],
      });

      // Exactly one candidate emitted for the homework: the action
      const hwCandidates = candidates.filter(
        (c) => c.id === "action:act-hw-1" || c.title === "Pattern work checklist",
      );
      expect(hwCandidates).toHaveLength(1);
      expect(hwCandidates[0]!.id).toBe("action:act-hw-1");
      expect(hwCandidates[0]!.reason.summary).toBe("Preparation for Crosswind Landings");

      // Check "Homework due today"
      const dueTodayCandidates = buildRecommendationCandidates({
        today: "2026-09-06",
        actions: [action],
        events: [lesson],
        homework: [hwSnapshot as any],
      });
      expect(dueTodayCandidates.find((c) => c.id === "action:act-hw-1")!.reason.summary).toBe(
        "Homework due today",
      );

      // Check "Homework overdue since …"
      const overdueCandidates = buildRecommendationCandidates({
        today: "2026-09-07",
        actions: [action],
        events: [lesson],
        homework: [hwSnapshot as any],
      });
      expect(overdueCandidates.find((c) => c.id === "action:act-hw-1")!.reason.summary).toBe(
        "Homework overdue since 2026-09-06",
      );

      // Check "Self-directed homework"
      const selfDirectedSnapshot = structuredClone(hwSnapshot);
      selfDirectedSnapshot.assignment.lesson_id = null;
      selfDirectedSnapshot.assignment.due_date = null;
      const selfDirectedAction = { ...action, dueDate: null };
      const selfDirectedCandidates = buildRecommendationCandidates({
        today: "2026-09-05",
        actions: [selfDirectedAction],
        events: [],
        homework: [selfDirectedSnapshot as any],
      });
      expect(selfDirectedCandidates.find((c) => c.id === "action:act-hw-1")!.reason.summary).toBe(
        "Self-directed homework",
      );
    });
  });
});
